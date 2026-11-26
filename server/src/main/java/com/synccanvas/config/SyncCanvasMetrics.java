package com.synccanvas.config;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.stereotype.Component;

@Component
public class SyncCanvasMetrics {

    private final MeterRegistry registry;
    private final AtomicInteger activeWsSessions = new AtomicInteger(0);

    public SyncCanvasMetrics(MeterRegistry registry) {
        this.registry = registry;
        registry.gauge("ws.sessions", activeWsSessions);
    }

    public void sessionOpened() {
        activeWsSessions.incrementAndGet();
    }

    public void sessionClosed() {
        activeWsSessions.updateAndGet(v -> Math.max(0, v - 1));
    }

    public void recordOpsApplied(int count) {
        if (count > 0) {
            registry.counter("ops.applied").increment(count);
        }
    }

    public void recordOpsRejected(String code) {
        registry.counter("ops.rejected", "code", code).increment();
    }

    public void recordBroadcastLatencyNanos(long nanos) {
        Timer.builder("broadcast.latency").register(registry).record(nanos, TimeUnit.NANOSECONDS);
    }
}
