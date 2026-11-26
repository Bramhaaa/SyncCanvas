package com.synccanvas.persistence;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.synccanvas.crdt.LwwMap;
import com.synccanvas.crdt.Op;
import com.synccanvas.crdt.Register;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * In-memory canonical CRDT state cache per board, lazily hydrated from {@code board_snapshots} +
 * tail of {@code crdt_operations}.
 */
@Service
public class BoardStateService {

    private static final int HYDRATION_PAGE_SIZE = 1_000;
    private static final TypeReference<Map<String, Map<String, Register>>> STATE_TYPE =
            new TypeReference<>() {};

    private final OpLogRepository opLogRepository;
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;
    private final ConcurrentHashMap<String, BoardEntry> cache = new ConcurrentHashMap<>();

    public record SnapshotView(Map<String, Map<String, Register>> state, long snapshotSeq) {}

    private static final class BoardEntry {
        final LwwMap map;
        long latestSeq;

        BoardEntry(LwwMap map, long latestSeq) {
            this.map = map;
            this.latestSeq = latestSeq;
        }
    }

    public BoardStateService(
            OpLogRepository opLogRepository, JdbcClient jdbc, ObjectMapper objectMapper) {
        this.opLogRepository = opLogRepository;
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public LwwMap getState(String boardId) {
        BoardEntry entry = getOrLoad(boardId);
        synchronized (entry) {
            return LwwMap.fromState(entry.map.toState());
        }
    }

    public SnapshotView getSnapshot(String boardId) {
        BoardEntry entry = getOrLoad(boardId);
        synchronized (entry) {
            return new SnapshotView(entry.map.toState(), entry.latestSeq);
        }
    }

    public List<SequencedOp> appendAndApply(String boardId, String originClientId, List<Op> ops) {
        List<SequencedOp> stored = opLogRepository.appendBatch(boardId, originClientId, ops);
        if (stored.isEmpty()) {
            return stored;
        }
        BoardEntry entry = getOrLoad(boardId);
        synchronized (entry) {
            for (SequencedOp seqOp : stored) {
                entry.map.apply(seqOp.op());
                if (seqOp.serverSeq() > entry.latestSeq) {
                    entry.latestSeq = seqOp.serverSeq();
                }
            }
        }
        return stored;
    }

    public void evict(String boardId) {
        cache.remove(boardId);
    }

    private BoardEntry getOrLoad(String boardId) {
        return cache.computeIfAbsent(boardId, this::loadFromDatabase);
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

        while (true) {
            List<SequencedOp> page = opLogRepository.readSince(boardId, cursorSeq, HYDRATION_PAGE_SIZE);
            if (page.isEmpty()) {
                break;
            }
            for (SequencedOp seqOp : page) {
                map.apply(seqOp.op());
                cursorSeq = seqOp.serverSeq();
            }
            if (page.size() < HYDRATION_PAGE_SIZE) {
                break;
            }
        }

        return new BoardEntry(map, cursorSeq);
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
