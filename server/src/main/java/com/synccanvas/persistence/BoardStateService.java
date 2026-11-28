package com.synccanvas.persistence;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.synccanvas.crdt.LwwMap;
import com.synccanvas.crdt.Op;
import com.synccanvas.crdt.Register;
import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Bounded in-memory canonical CRDT state cache per board, lazily hydrated from
 * {@code board_snapshots} + tail of {@code crdt_operations}, kept warm across multi-node
 * instances via remote Redis broadcasts and catch-up reads.
 */
@Service
public class BoardStateService {

    private static final Logger log = LoggerFactory.getLogger(BoardStateService.class);
    private static final int HYDRATION_PAGE_SIZE = 1_000;
    private static final int MAX_CACHED_BOARDS = 256;
    private static final long AUTO_COMPACT_OP_THRESHOLD = 500L;
    private static final Duration AUTO_COMPACT_RETENTION = Duration.ofHours(24);
    private static final TypeReference<Map<String, Map<String, Register>>> STATE_TYPE =
            new TypeReference<>() {};

    private final OpLogRepository opLogRepository;
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;
    private final SnapshotRepository snapshotRepository;
    private final ConcurrentHashMap<String, BoardEntry> cache = new ConcurrentHashMap<>();

    public record SnapshotView(Map<String, Map<String, Register>> state, long snapshotSeq) {}

    private static final class BoardEntry {
        final LwwMap map;
        long latestSeq;
        final AtomicLong uncompactedOps = new AtomicLong(0);
        volatile long lastAccessedAt = System.currentTimeMillis();

        BoardEntry(LwwMap map, long latestSeq) {
            this.map = map;
            this.latestSeq = latestSeq;
        }
    }

    public BoardStateService(
            OpLogRepository opLogRepository, JdbcClient jdbc, ObjectMapper objectMapper) {
        this(opLogRepository, jdbc, objectMapper, (SnapshotRepository) null);
    }

    @Autowired
    public BoardStateService(
            OpLogRepository opLogRepository,
            JdbcClient jdbc,
            ObjectMapper objectMapper,
            ObjectProvider<SnapshotRepository> snapshotRepositoryProvider) {
        this(
                opLogRepository,
                jdbc,
                objectMapper,
                snapshotRepositoryProvider != null ? snapshotRepositoryProvider.getIfAvailable() : null);
    }

    private BoardStateService(
            OpLogRepository opLogRepository,
            JdbcClient jdbc,
            ObjectMapper objectMapper,
            SnapshotRepository snapshotRepository) {
        this.opLogRepository = opLogRepository;
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.snapshotRepository = snapshotRepository;
    }

    public LwwMap getState(String boardId) {
        BoardEntry entry = getOrLoad(boardId);
        synchronized (entry) {
            entry.lastAccessedAt = System.currentTimeMillis();
            return LwwMap.fromState(entry.map.toState());
        }
    }

    public SnapshotView getSnapshot(String boardId) {
        BoardEntry entry = getOrLoad(boardId);
        synchronized (entry) {
            entry.lastAccessedAt = System.currentTimeMillis();
            catchUpEntryLocked(boardId, entry);
            return new SnapshotView(entry.map.toState(), entry.latestSeq);
        }
    }

    public List<SequencedOp> appendAndApply(String boardId, String originClientId, List<Op> ops) {
        List<SequencedOp> stored = opLogRepository.appendBatch(boardId, originClientId, ops);
        if (stored.isEmpty()) {
            return stored;
        }
        BoardEntry entry = getOrLoad(boardId);
        boolean triggerCompaction = false;
        SnapshotView compactionView = null;

        synchronized (entry) {
            entry.lastAccessedAt = System.currentTimeMillis();
            for (SequencedOp seqOp : stored) {
                entry.map.apply(seqOp.op());
                if (seqOp.serverSeq() > entry.latestSeq) {
                    entry.latestSeq = seqOp.serverSeq();
                }
            }
            if (snapshotRepository != null
                    && entry.uncompactedOps.addAndGet(stored.size()) >= AUTO_COMPACT_OP_THRESHOLD) {
                entry.uncompactedOps.set(0);
                triggerCompaction = true;
                compactionView = new SnapshotView(entry.map.toState(), entry.latestSeq);
            }
        }

        if (triggerCompaction) {
            SnapshotView viewToPersist = compactionView;
            Thread.ofVirtual().start(() -> {
                try {
                    snapshotRepository.upsertSnapshot(
                            boardId, viewToPersist.snapshotSeq(), viewToPersist.state());
                    snapshotRepository.pruneOpsOlderThan(
                            boardId, viewToPersist.snapshotSeq(), AUTO_COMPACT_RETENTION);
                } catch (RuntimeException e) {
                    log.warn("Background 500-op compaction failed for board {}: {}", boardId, e.getMessage());
                }
            });
        }

        return stored;
    }

    /**
     * Keeps this node's cached {@link LwwMap} synchronized when another server instance publishes
     * a {@code SYNC_BROADCAST} over Redis Pub/Sub.
     */
    public void applyRemoteBroadcast(String boardId, long seqStart, long seqEnd, List<Op> ops) {
        BoardEntry entry = cache.get(boardId);
        if (entry == null) {
            // Board isn't cached on this node yet; next getState/getSnapshot will hydrate from DB.
            return;
        }
        synchronized (entry) {
            entry.lastAccessedAt = System.currentTimeMillis();
            if (seqEnd <= entry.latestSeq) {
                return;
            }
            if (seqStart > entry.latestSeq + 1) {
                // Gap detected (e.g. Redis blip); catch up directly from PostgreSQL op log.
                catchUpEntryLocked(boardId, entry);
                return;
            }
            for (int i = 0; i < ops.size(); i++) {
                long seq = seqStart + i;
                if (seq > entry.latestSeq) {
                    entry.map.apply(ops.get(i));
                }
            }
            entry.latestSeq = seqEnd;
        }
    }

    public void evict(String boardId) {
        cache.remove(boardId);
    }

    public void evictAll() {
        cache.clear();
    }

    private BoardEntry getOrLoad(String boardId) {
        BoardEntry existing = cache.get(boardId);
        if (existing != null) {
            return existing;
        }
        evictOldestIfFull();
        return cache.computeIfAbsent(boardId, this::loadFromDatabase);
    }

    private void evictOldestIfFull() {
        if (cache.size() < MAX_CACHED_BOARDS) {
            return;
        }
        String oldestKey = null;
        long oldestTime = Long.MAX_VALUE;
        for (Map.Entry<String, BoardEntry> e : cache.entrySet()) {
            long ts = e.getValue().lastAccessedAt;
            if (ts < oldestTime) {
                oldestTime = ts;
                oldestKey = e.getKey();
            }
        }
        if (oldestKey != null) {
            cache.remove(oldestKey);
        }
    }

    private void catchUpEntryLocked(String boardId, BoardEntry entry) {
        while (true) {
            List<SequencedOp> page = opLogRepository.readSince(boardId, entry.latestSeq, HYDRATION_PAGE_SIZE);
            if (page.isEmpty()) {
                break;
            }
            for (SequencedOp seqOp : page) {
                entry.map.apply(seqOp.op());
                entry.latestSeq = seqOp.serverSeq();
            }
            if (page.size() < HYDRATION_PAGE_SIZE) {
                break;
            }
        }
    }

    private BoardEntry loadFromDatabase(String boardId) {
        record SnapshotRow(long lastServerSeq, String stateJson) {}

        Optional<SnapshotRow> snapOpt = Optional.empty();
        if (jdbc != null) {
            snapOpt = jdbc.sql("""
                            SELECT last_server_seq, state_json::text AS state_json
                            FROM board_snapshots
                            WHERE board_id = :boardId
                            """)
                    .param("boardId", boardId)
                    .query((rs, rowNum) ->
                            new SnapshotRow(rs.getLong("last_server_seq"), rs.getString("state_json")))
                    .optional();
        }

        LwwMap map;
        long cursorSeq;
        if (snapOpt.isPresent()) {
            cursorSeq = snapOpt.get().lastServerSeq();
            map = LwwMap.fromState(parseState(snapOpt.get().stateJson()));
        } else {
            cursorSeq = 0L;
            map = new LwwMap();
        }

        BoardEntry entry = new BoardEntry(map, cursorSeq);
        catchUpEntryLocked(boardId, entry);
        return entry;
    }

    private Map<String, Map<String, Register>> parseState(String stateJson) {
        if (stateJson == null || stateJson.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(stateJson, STATE_TYPE);
        } catch (IOException e) {
            throw new IllegalStateException("Corrupt state_json in board_snapshots", e);
        }
    }
}
