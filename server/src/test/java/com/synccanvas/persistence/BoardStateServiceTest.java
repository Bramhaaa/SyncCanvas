package com.synccanvas.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.TextNode;
import com.synccanvas.crdt.Hlc;
import com.synccanvas.crdt.LwwMap;
import com.synccanvas.crdt.Op;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;

class BoardStateServiceTest {

    @Test
    void appendsAndAppliesOpsAndHydratesLazily() {
        List<SequencedOp> log = new CopyOnWriteArrayList<>();
        OpLogRepository stubRepo = new OpLogRepository() {
            private long seq = 0;

            @Override
            public synchronized List<SequencedOp> appendBatch(
                    String boardId, String originClientId, List<Op> ops) {
                List<SequencedOp> added = new ArrayList<>();
                for (Op op : ops) {
                    SequencedOp s = new SequencedOp(++seq, op);
                    log.add(s);
                    added.add(s);
                }
                return added;
            }

            @Override
            public List<SequencedOp> readSince(String boardId, long sinceSeq, int limit) {
                return log.stream()
                        .filter(s -> s.serverSeq() > sinceSeq)
                        .limit(limit)
                        .toList();
            }

            @Override
            public long oldestAvailableSeq(String boardId) {
                return log.isEmpty() ? seq + 1 : log.get(0).serverSeq();
            }
        };

        BoardStateService service = new BoardStateService(stubRepo, null, new ObjectMapper());
        List<Op> batch = List.of(
                new Op("obj_1", "type", TextNode.valueOf("rect"), new Hlc(1000L, 0, "user_a").format()),
                new Op("obj_1", "x", IntNode.valueOf(42), new Hlc(1000L, 1, "user_a").format()));

        List<SequencedOp> stored = service.appendAndApply("brd_12345678", "user_a", batch);
        assertThat(stored).hasSize(2);
        assertThat(service.getSnapshot("brd_12345678").snapshotSeq()).isEqualTo(2L);

        // Evict and re-hydrate from opLogRepository
        service.evict("brd_12345678");
        LwwMap hydrated = service.getState("brd_12345678");
        LwwMap expected = new LwwMap();
        batch.forEach(expected::apply);

        assertThat(hydrated.stateHash()).isEqualTo(expected.stateHash());
        assertThat(service.getSnapshot("brd_12345678").snapshotSeq()).isEqualTo(2L);

        // Remote broadcast from another node updates cached LwwMap without DB re-hydration
        Op remoteOp = new Op("obj_2", "type", TextNode.valueOf("ellipse"), new Hlc(2000L, 0, "user_b").format());
        service.applyRemoteBroadcast("brd_12345678", 3L, 3L, List.of(remoteOp));
        assertThat(service.getState("brd_12345678").get("obj_2", "type")).isPresent();
    }
}
