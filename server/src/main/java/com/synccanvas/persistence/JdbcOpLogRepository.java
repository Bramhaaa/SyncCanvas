package com.synccanvas.persistence;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.synccanvas.crdt.Op;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * Per-board gap-free operation log backed by PostgreSQL.
 *
 * <p>Strategy: acquires a per-board {@code FOR UPDATE} lock on {@code boards} first, then filters
 * out duplicates (both intra-batch and already-persisted in {@code crdt_operations}), reserves
 * {@code n} contiguous sequence numbers via {@code UPDATE boards SET next_seq = next_seq + :n},
 * and batch-inserts the new ops. Because writers to the same board are serialized on that board's
 * row lock, sequence order equals commit order with zero gaps and zero cross-board contention.
 */
@Repository
public class JdbcOpLogRepository implements OpLogRepository {

    private final JdbcClient jdbc;
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public JdbcOpLogRepository(JdbcClient jdbc, JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional
    public List<SequencedOp> appendBatch(String boardId, String originClientId, List<Op> ops) {
        if (ops == null || ops.isEmpty()) {
            return List.of();
        }

        // 1. Lock the board row to serialize writers per board (no cross-board contention).
        Long currentNextSeq = jdbc.sql("SELECT next_seq FROM boards WHERE id = :boardId FOR UPDATE")
                .param("boardId", boardId)
                .query(Long.class)
                .optional()
                .orElseThrow(() -> new IllegalArgumentException("Board not found: " + boardId));

        // 2. Intra-batch dedup preserving input order.
        record OpKey(String objectId, String field, String hlc) {}
        Map<OpKey, Op> uniqueIncoming = new LinkedHashMap<>();
        for (Op op : ops) {
            uniqueIncoming.putIfAbsent(new OpKey(op.objectId(), op.field(), op.hlc()), op);
        }

        // 3. Filter out ops already persisted in crdt_operations for this board.
        Set<String> hlcs = new HashSet<>();
        for (Op op : uniqueIncoming.values()) {
            hlcs.add(op.hlc());
        }

        Set<OpKey> existingKeys = new HashSet<>();
        if (!hlcs.isEmpty()) {
            jdbc.sql("""
                            SELECT object_id, field_name, hlc
                            FROM crdt_operations
                            WHERE board_id = :boardId AND hlc IN (:hlcs)
                            """)
                    .param("boardId", boardId)
                    .param("hlcs", hlcs)
                    .query((rs, rowNum) -> new OpKey(
                            rs.getString("object_id"),
                            rs.getString("field_name"),
                            rs.getString("hlc")))
                    .list()
                    .forEach(existingKeys::add);
        }

        List<Op> newOps = new ArrayList<>();
        for (Map.Entry<OpKey, Op> entry : uniqueIncoming.entrySet()) {
            if (!existingKeys.contains(entry.getKey())) {
                newOps.add(entry.getValue());
            }
        }

        if (newOps.isEmpty()) {
            return List.of();
        }

        // 4. Reserve contiguous per-board sequence numbers atomically.
        int n = newOps.size();
        Long newNextSeq = jdbc.sql("""
                        UPDATE boards
                        SET next_seq = next_seq + :n, updated_at = NOW()
                        WHERE id = :boardId
                        RETURNING next_seq
                        """)
                .param("n", n)
                .param("boardId", boardId)
                .query(Long.class)
                .single();

        long firstSeq = newNextSeq - n + 1;
        if (firstSeq != currentNextSeq + 1) {
            throw new IllegalStateException("Unexpected sequence jump for board " + boardId);
        }

        List<SequencedOp> sequenced = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            sequenced.add(new SequencedOp(firstSeq + i, newOps.get(i)));
        }

        // 5. Batch-insert into crdt_operations.
        jdbcTemplate.batchUpdate(
                """
                INSERT INTO crdt_operations
                    (board_id, server_seq, object_id, field_name, field_value, hlc, origin_client_id)
                VALUES (?, ?, ?, ?, CAST(? AS jsonb), ?, ?)
                """,
                sequenced,
                500,
                (ps, seqOp) -> {
                    ps.setString(1, boardId);
                    ps.setLong(2, seqOp.serverSeq());
                    ps.setString(3, seqOp.op().objectId());
                    ps.setString(4, seqOp.op().field());
                    ps.setString(5, toJsonString(seqOp.op().value()));
                    ps.setString(6, seqOp.op().hlc());
                    ps.setString(7, originClientId);
                });

        return sequenced;
    }

    @Override
    public List<SequencedOp> readSince(String boardId, long sinceSeq, int limit) {
        return jdbc.sql("""
                        SELECT server_seq, object_id, field_name, field_value, hlc
                        FROM crdt_operations
                        WHERE board_id = :boardId AND server_seq > :sinceSeq
                        ORDER BY server_seq ASC
                        LIMIT :limit
                        """)
                .param("boardId", boardId)
                .param("sinceSeq", sinceSeq)
                .param("limit", limit)
                .query(this::mapSequencedOp)
                .list();
    }

    @Override
    public long oldestAvailableSeq(String boardId) {
        Long oldest = jdbc.sql("""
                        SELECT COALESCE(
                            (SELECT MIN(server_seq) FROM crdt_operations WHERE board_id = :boardId),
                            (SELECT next_seq + 1 FROM boards WHERE id = :boardId)
                        )
                        """)
                .param("boardId", boardId)
                .query(Long.class)
                .optional()
                .orElseThrow(() -> new IllegalArgumentException("Board not found: " + boardId));
        return oldest;
    }

    private SequencedOp mapSequencedOp(ResultSet rs, int rowNum) throws SQLException {
        long seq = rs.getLong("server_seq");
        String objectId = rs.getString("object_id");
        String field = rs.getString("field_name");
        String rawJson = rs.getString("field_value");
        String hlc = rs.getString("hlc");
        return new SequencedOp(seq, new Op(objectId, field, parseJson(rawJson), hlc));
    }

    private String toJsonString(JsonNode node) {
        try {
            return objectMapper.writeValueAsString(node);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Failed to serialize op field_value to JSON", e);
        }
    }

    private JsonNode parseJson(String raw) {
        if (raw == null) {
            return null;
        }
        try {
            return objectMapper.readTree(raw);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Corrupt JSONB in crdt_operations: " + raw, e);
        }
    }
}
