package com.synccanvas.crdt;

import java.util.Objects;
import java.util.function.LongSupplier;

public final class HlcClock {

    public static final long DEFAULT_MAX_DRIFT_MS = 60_000L;

    private final String nodeId;
    private final LongSupplier now;
    private final long maxDriftMs;
    private Hlc state;

    public HlcClock(String nodeId, LongSupplier now, long maxDriftMs) {
        this(nodeId, now, maxDriftMs, new Hlc(0L, 0, nodeId));
    }

    public HlcClock(String nodeId, LongSupplier now, long maxDriftMs, Hlc initial) {
        Objects.requireNonNull(nodeId, "nodeId must not be null");
        Objects.requireNonNull(now, "now supplier must not be null");
        Objects.requireNonNull(initial, "initial HLC must not be null");
        this.nodeId = nodeId;
        this.now = now;
        this.maxDriftMs = maxDriftMs;
        this.state = new Hlc(initial.physicalTime(), initial.counter(), nodeId);
    }

    public synchronized Hlc tick() {
        long currentNow = now.getAsLong();
        long physicalTime;
        int counter;

        if (currentNow > state.physicalTime()) {
            physicalTime = currentNow;
            counter = 0;
        } else {
            physicalTime = state.physicalTime();
            counter = state.counter() + 1;
        }

        if (counter > Hlc.MAX_COUNTER) {
            physicalTime += 1;
            counter = 0;
        }

        state = new Hlc(physicalTime, counter, nodeId);
        return state;
    }

    public synchronized void receive(Hlc remote) throws ClockSkewException {
        Objects.requireNonNull(remote, "remote HLC must not be null");
        long currentNow = now.getAsLong();

        if (remote.physicalTime() > currentNow + maxDriftMs) {
            throw new ClockSkewException(
                    "Remote HLC physicalTime " + remote.physicalTime()
                            + " exceeds now (" + currentNow + ") + maxDriftMs (" + maxDriftMs + ")");
        }

        long physicalTime = Math.max(currentNow, Math.max(state.physicalTime(), remote.physicalTime()));
        int counter;

        if (physicalTime == state.physicalTime() && physicalTime == remote.physicalTime()) {
            counter = Math.max(state.counter(), remote.counter()) + 1;
        } else if (physicalTime == state.physicalTime()) {
            counter = state.counter() + 1;
        } else if (physicalTime == remote.physicalTime()) {
            counter = remote.counter() + 1;
        } else {
            counter = 0;
        }

        if (counter > Hlc.MAX_COUNTER) {
            physicalTime += 1;
            counter = 0;
        }

        state = new Hlc(physicalTime, counter, nodeId);
    }

    public synchronized Hlc last() {
        return state;
    }
}
