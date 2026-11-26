package com.synccanvas.crdt;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.DoubleNode;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.Combinators;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import net.jqwik.api.constraints.IntRange;

class CrdtPropertyTest {

    @Provide
    Arbitrary<Op> ops() {
        Arbitrary<String> objectIds = Arbitraries.of("obj_a", "obj_b", "obj_c", "obj_d");
        Arbitrary<String> fields = Arbitraries.of("type", "x", "y", "fill", "deleted", "zIndex");
        Arbitrary<Long> pts = Arbitraries.longs().between(1_732_579_200_000L, 1_732_579_210_000L);
        Arbitrary<Integer> counters = Arbitraries.integers().between(0, 50);
        Arbitrary<String> nodes = Arbitraries.of("node_0", "node_1", "node_2", "node_3", "node_4");

        return Combinators.combine(objectIds, fields, pts, counters, nodes)
                .as((objId, field, pt, cnt, node) -> {
                    JsonNode value = switch (field) {
                        case "type" -> TextNode.valueOf("rect");
                        case "x", "y" -> (cnt % 2 == 0) ? IntNode.valueOf(cnt * 10) : DoubleNode.valueOf(cnt + 0.5);
                        case "fill" -> TextNode.valueOf(cnt % 2 == 0 ? "#EF4444" : "#3B82F6");
                        case "deleted" -> BooleanNode.valueOf(cnt % 3 == 0);
                        case "zIndex" -> TextNode.valueOf("a" + (cnt % 5));
                        default -> TextNode.valueOf("v");
                    };
                    String hlc = new Hlc(pt, cnt, node).format();
                    return new Op(objId, field, value, hlc);
                });
    }

    @Provide
    Arbitrary<List<Op>> opLists() {
        return ops().list().ofMinSize(1).ofMaxSize(30);
    }

    @Property(tries = 150)
    void mergeIsCommutative(
            @ForAll("opLists") List<Op> batchA,
            @ForAll("opLists") List<Op> batchB) {
        LwwMap ab = new LwwMap();
        batchA.forEach(ab::apply);
        batchB.forEach(ab::apply);

        LwwMap ba = new LwwMap();
        batchB.forEach(ba::apply);
        batchA.forEach(ba::apply);

        assertThat(ab.stateHash()).isEqualTo(ba.stateHash());
        assertThat(ab.visibleObjectIds()).isEqualTo(ba.visibleObjectIds());
    }

    @Property(tries = 150)
    void mergeIsAssociative(
            @ForAll("opLists") List<Op> a,
            @ForAll("opLists") List<Op> b,
            @ForAll("opLists") List<Op> c) {
        // (A ∪ B) ∪ C
        LwwMap ab = new LwwMap();
        a.forEach(ab::apply);
        b.forEach(ab::apply);
        LwwMap abThenC = LwwMap.fromState(ab.toState());
        c.forEach(abThenC::apply);

        // A ∪ (B ∪ C)
        LwwMap bc = new LwwMap();
        b.forEach(bc::apply);
        c.forEach(bc::apply);
        LwwMap aThenBc = new LwwMap();
        a.forEach(aThenBc::apply);
        bc.toState().forEach((objId, fields) ->
                fields.forEach((field, reg) -> aThenBc.apply(new Op(objId, field, reg.value(), reg.hlc()))));

        assertThat(abThenC.stateHash()).isEqualTo(aThenBc.stateHash());
    }

    @Property(tries = 150)
    void mergeIsIdempotent(@ForAll("opLists") List<Op> opList) {
        LwwMap once = new LwwMap();
        opList.forEach(once::apply);

        LwwMap twice = new LwwMap();
        opList.forEach(twice::apply);
        opList.forEach(twice::apply);

        assertThat(twice.stateHash()).isEqualTo(once.stateHash());
    }

    @Property(tries = 100)
    void fiveReplicasConvergeUnderChaos(
            @ForAll long seed,
            @ForAll @IntRange(min = 80, max = 140) int stepCount) {
        Random rng = new Random(seed);
        int replicaCount = 5;
        AtomicLong baseTime = new AtomicLong(1_732_579_200_000L);

        HlcClock[] clocks = new HlcClock[replicaCount];
        LwwMap[] maps = new LwwMap[replicaCount];
        for (int i = 0; i < replicaCount; i++) {
            long skew = rng.nextLong(-5_000L, 5_001L);
            String nodeId = "replica_" + i;
            clocks[i] = new HlcClock(nodeId, () -> baseTime.get() + skew, HlcClock.DEFAULT_MAX_DRIFT_MS);
            maps[i] = new LwwMap();
        }

        record Envelope(int from, int to, Op op) {}
        List<Envelope> inFlight = new ArrayList<>();
        List<Envelope> dropped = new ArrayList<>();
        Set<Integer> partitioned = new HashSet<>();
        String[] objects = {"obj_a", "obj_b", "obj_c", "obj_d", "obj_e"};
        String[] colors = {"#EF4444", "#3B82F6", "#10B981", "#F59E0B"};

        for (int step = 0; step < stepCount; step++) {
            int action = rng.nextInt(10);
            if (action < 4) {
                // Local mutation
                int r = rng.nextInt(replicaCount);
                String objId = objects[rng.nextInt(objects.length)];
                List<Op> batch = new ArrayList<>();
                int mutKind = rng.nextInt(5);
                if (mutKind == 0) {
                    batch.add(new Op(objId, "type", TextNode.valueOf("rect"), clocks[r].tick().format()));
                    batch.add(new Op(objId, "x", IntNode.valueOf(rng.nextInt(-200, 200)), clocks[r].tick().format()));
                    batch.add(new Op(objId, "zIndex", TextNode.valueOf("a" + rng.nextInt(9)), clocks[r].tick().format()));
                } else if (mutKind == 1) {
                    batch.add(new Op(objId, "x", DoubleNode.valueOf(rng.nextInt(500) + 0.5), clocks[r].tick().format()));
                    batch.add(new Op(objId, "y", IntNode.valueOf(rng.nextInt(500)), clocks[r].tick().format()));
                } else if (mutKind == 2) {
                    batch.add(new Op(objId, "fill", TextNode.valueOf(colors[rng.nextInt(colors.length)]), clocks[r].tick().format()));
                } else if (mutKind == 3) {
                    batch.add(new Op(objId, "deleted", BooleanNode.valueOf(true), clocks[r].tick().format()));
                } else {
                    batch.add(new Op(objId, "deleted", BooleanNode.valueOf(false), clocks[r].tick().format()));
                }
                for (Op op : batch) {
                    maps[r].apply(op);
                    for (int target = 0; target < replicaCount; target++) {
                        if (target != r) {
                            inFlight.add(new Envelope(r, target, op));
                        }
                    }
                }
            } else if (action < 7 && !inFlight.isEmpty()) {
                // Deliver random message (reordering)
                int idx = rng.nextInt(inFlight.size());
                Envelope env = inFlight.get(idx);
                if (!partitioned.contains(env.from()) && !partitioned.contains(env.to())) {
                    inFlight.remove(idx);
                    try {
                        clocks[env.to()].receive(Hlc.parse(env.op().hlc()));
                    } catch (ClockSkewException ignored) {
                        // Clients always merge broadcast ops
                    }
                    maps[env.to()].apply(env.op());
                }
            } else if (action == 7 && !inFlight.isEmpty()) {
                // Duplicate
                inFlight.add(inFlight.get(rng.nextInt(inFlight.size())));
            } else if (action == 8 && !inFlight.isEmpty()) {
                // Drop with later retry
                dropped.add(inFlight.remove(rng.nextInt(inFlight.size())));
            } else {
                // Toggle partition + advance time
                int target = rng.nextInt(replicaCount);
                if (!partitioned.remove(target)) {
                    partitioned.add(target);
                }
                baseTime.addAndGet(rng.nextLong(0, 200));
            }
        }

        // Heal partitions, shuffle remaining + dropped, deliver all
        partitioned.clear();
        inFlight.addAll(dropped);
        Collections.shuffle(inFlight, rng);
        for (Envelope env : inFlight) {
            try {
                clocks[env.to()].receive(Hlc.parse(env.op().hlc()));
            } catch (ClockSkewException ignored) {
                // Clients always merge broadcast ops
            }
            maps[env.to()].apply(env.op());
        }

        String expectedHash = maps[0].stateHash();
        List<String> expectedVisible = maps[0].visibleObjectIds();
        for (int i = 1; i < replicaCount; i++) {
            assertThat(maps[i].stateHash()).isEqualTo(expectedHash);
            assertThat(maps[i].visibleObjectIds()).isEqualTo(expectedVisible);
        }
    }
}
