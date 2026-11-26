package com.synccanvas.persistence;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class BoardRepository {

    private final JdbcClient jdbc;

    public BoardRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Board create(String id, String title, boolean isDemo) {
        return jdbc.sql("""
                        INSERT INTO boards (id, title, is_demo)
                        VALUES (:id, :title, :isDemo)
                        RETURNING id, title, is_demo, next_seq, created_at, updated_at
                        """)
                .param("id", id)
                .param("title", title)
                .param("isDemo", isDemo)
                .query(BoardRepository::mapBoard)
                .single();
    }

    public Optional<Board> findById(String id) {
        return jdbc.sql("""
                        SELECT id, title, is_demo, next_seq, created_at, updated_at
                        FROM boards
                        WHERE id = :id
                        """)
                .param("id", id)
                .query(BoardRepository::mapBoard)
                .optional();
    }

    public boolean existsById(String id) {
        Integer count = jdbc.sql("SELECT COUNT(1) FROM boards WHERE id = :id")
                .param("id", id)
                .query(Integer.class)
                .single();
        return count != null && count > 0;
    }

    public int touchUpdatedAt(String id) {
        return jdbc.sql("UPDATE boards SET updated_at = NOW() WHERE id = :id")
                .param("id", id)
                .update();
    }

    public int deleteExpiredDemoBoards(Duration maxAge) {
        OffsetDateTime cutoff = Instant.now().minus(maxAge).atOffset(ZoneOffset.UTC);
        return jdbc.sql("DELETE FROM boards WHERE is_demo = TRUE AND updated_at < :cutoff")
                .param("cutoff", cutoff)
                .update();
    }

    private static Board mapBoard(ResultSet rs, int rowNum) throws SQLException {
        return new Board(
                rs.getString("id"),
                rs.getString("title"),
                rs.getBoolean("is_demo"),
                rs.getLong("next_seq"),
                rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                rs.getObject("updated_at", OffsetDateTime.class).toInstant());
    }
}
