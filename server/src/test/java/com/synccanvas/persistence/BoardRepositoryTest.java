package com.synccanvas.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest(
        properties = {
            "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration"
        })
@Testcontainers(disabledWithoutDocker = true)
class BoardRepositoryTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    private BoardRepository boardRepository;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void flywayMigrationAndBoardCrudWork() {
        Board created = boardRepository.create("brd_test0001", "My Board", true);
        assertThat(created.id()).isEqualTo("brd_test0001");
        assertThat(created.title()).isEqualTo("My Board");
        assertThat(created.isDemo()).isTrue();
        assertThat(created.nextSeq()).isZero();

        assertThat(boardRepository.existsById("brd_test0001")).isTrue();
        assertThat(boardRepository.findById("brd_test0001")).isPresent();
        assertThat(boardRepository.findById("brd_missing1")).isEmpty();

        assertThat(boardRepository.touchUpdatedAt("brd_test0001")).isEqualTo(1);

        // Create an old demo board and an old non-demo board
        boardRepository.create("brd_olddemo1", "Expired Demo", true);
        boardRepository.create("brd_oldperm1", "Permanent Board", false);
        jdbc.sql("UPDATE boards SET updated_at = NOW() - INTERVAL '48 hours' WHERE id IN ('brd_olddemo1', 'brd_oldperm1')")
                .update();

        int deleted = boardRepository.deleteExpiredDemoBoards(Duration.ofHours(24));
        assertThat(deleted).isEqualTo(1);
        assertThat(boardRepository.existsById("brd_olddemo1")).isFalse();
        assertThat(boardRepository.existsById("brd_oldperm1")).isTrue();
        assertThat(boardRepository.existsById("brd_test0001")).isTrue();
    }
}
