package com.synccanvas.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.TextNode;
import com.synccanvas.crdt.Hlc;
import com.synccanvas.crdt.LwwMap;
import com.synccanvas.crdt.Op;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.LongStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest(
        properties = {
            "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration"
        })
@Testcontainers(disabledWithoutDocker = true)
class OpLogRepositoryTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    private BoardRepository boardRepository;

    @Autowired
    private OpLogRepository opLogRepository;

    @Autowired
    private BoardStateService boardStateService;

    @Test
    void concurrentEightThreadsProduceGapFreeSequencesAndDedupWorks() throws Exception {
        String boardId = "brd_conc0001";
        boardRepository.create(boardId, "Concurrency Test", true);
        assertThat(opLogRepository.oldestAvailableSeq(boardId)).isEqualTo(1L);

        int threadCount = 8;
        int opsPerThread = 500;
        int batchSize = 25;

        ExecutorService pool = Executors.newFixedThreadPool(threadCount);
        List<Callable<List<SequencedOp>>> tasks = new ArrayList<>();
        List<Op> sampleBatchForDedup = Collections.synchronizedList(new ArrayList<>());

        for (int t = 0; t < threadCount; t++) {
            final int threadId = t;
            final String clientId = "client_" + threadId;
            tasks.add(() -> {
                List<SequencedOp> threadResults = new ArrayList<>();
                for (int i = 0; i < opsPerThread; i += batchSize) {
                    List<Op> batch = new ArrayList<>(batchSize);
                    for (int j = 0; j < batchSize; j++) {
                        int idx = i + j;
                        String hlc = new Hlc(1_732_579_200_000L + idx, threadId, clientId).format();
                        batch.add(new Op("obj_" + threadId, "x", IntNode.valueOf(idx), hlc));
                    }
                    if (threadId == 0 && i == 0) {
                        sampleBatchForDedup.addAll(batch);
                    }
                    threadResults.addAll(boardStateService.appendAndApply(boardId, clientId, batch));
                }
                return threadResults;
            });
        }

        List<Future<List<SequencedOp>>> futures = pool.invokeAll(tasks);
        pool.shutdown();

        List<Long> allSeqs = new ArrayList<>(threadCount * opsPerThread);
        for (Future<List<SequencedOp>> f : futures) {
            for (SequencedOp s : f.get()) {
                allSeqs.add(s.serverSeq());
            }
        }
        Collections.sort(allSeqs);

        List<Long> expectedSeqs = LongStream.rangeClosed(1, (long) threadCount * opsPerThread)
                .boxed()
                .toList();
        assertThat(allSeqs).isEqualTo(expectedSeqs);

        // readSince returns exact tail
        List<SequencedOp> tail = opLogRepository.readSince(boardId, 3990L, 100);
        assertThat(tail).hasSize(10);
        assertThat(tail.get(0).serverSeq()).isEqualTo(3991L);
        assertThat(tail.get(9).serverSeq()).isEqualTo(4000L);

        // Resending an already-stored batch inserts nothing and does not advance next_seq
        List<SequencedOp> resent = opLogRepository.appendBatch(boardId, "client_0", sampleBatchForDedup);
        assertThat(resent).isEmpty();
        assertThat(boardRepository.findById(boardId).orElseThrow().nextSeq()).isEqualTo(4000L);
        assertThat(opLogRepository.oldestAvailableSeq(boardId)).isEqualTo(1L);

        // Lazy hydration matches direct replay
        LwwMap cached = boardStateService.getState(boardId);
        boardStateService.evict(boardId);
        LwwMap rehydrated = boardStateService.getState(boardId);
        assertThat(rehydrated.stateHash()).isEqualTo(cached.stateHash());
    }

    @Test
    void boardStateServicePersistsAndLoadsTypeRegister() {
        String boardId = "brd_type0001";
        boardRepository.create(boardId, "Type Test", true);
        List<Op> ops = List.of(
                new Op("obj_a", "type", TextNode.valueOf("rect"), new Hlc(1000L, 0, "user_a").format()),
                new Op("obj_a", "zIndex", TextNode.valueOf("a0"), new Hlc(1000L, 1, "user_a").format()));
        boardStateService.appendAndApply(boardId, "user_a", ops);
        boardStateService.evict(boardId);
        assertThat(boardStateService.getState(boardId).visibleObjectIds()).containsExactly("obj_a");
    }
}
