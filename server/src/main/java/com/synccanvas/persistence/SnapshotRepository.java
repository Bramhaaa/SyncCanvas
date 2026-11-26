package com.synccanvas.persistence;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.synccanvas.crdt.Register;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class SnapshotRepository {

    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;

    public SnapshotRepository(JdbcClient jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public void upsertSnapshot(
            String boardId, long lastServerSeq, Map<String, Map<String, Register>> state) {
        String stateJson;
        try {
            stateJson = objectMapper.writeValueAsString(state);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize snapshot state for board " + boardId, e);
        }

        jdbc.sql("""
                        INSERT INTO board_snapshots (board_id, last_server_seq, state_json, updated_at)
                        VALUES (:boardId, :lastServerSeq, CAST(:stateJson AS jsonb), NOW())
                        ON CONFLICT (board_id) DO UPDATE
                        SET last_server_seq = GREATEST(board_snapshots.last_server_seq, EXCLUDED.last_server_seq),
                            state_json = CASE
                                WHEN EXCLUDED.last_server_seq >= board_snapshots.last_server_seq
                                    THEN EXCLUDED.state_json
                                ELSE board_snapshots.state_json
                            END,
                            updated_at = NOW()
                        """)
                .param("boardId", boardId)
                .param("lastServerSeq", lastServerSeq)
                .param("stateJson", stateJson)
                .update();
    }

    @Transactional
    public int pruneOpsOlderThan(String boardId, long maxSeq, Duration retention) {
        long retentionSeconds = Math.max(0L, retention.toSeconds());
        return jdbc.sql("""
                        DELETE FROM crdt_operations
                        WHERE board_id = :boardId
                          AND server_seq <= :maxSeq
                          AND created_at < NOW() - make_interval(secs => :retentionSeconds)
                        """)
                .param("boardId", boardId)
                .param("maxSeq", maxSeq)
                .param("retentionSeconds", retentionSeconds)
                .update();
    }

    public List<String> findBoardsNeedingCompaction(long minUncompactedOps) {
        return jdbc.sql("""
                        SELECT b.id
                        FROM boards b
                        LEFT JOIN board_snapshots s ON s.board_id = b.id
                        WHERE b.next_seq - COALESCE(s.last_server_seq, 0) >= :minOps
                        """)
                .param("minOps", minUncompactedOps)
                .query(String.class)
                .list();
    }
}
