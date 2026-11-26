package com.synccanvas.protocol;

import java.util.function.LongSupplier;

/**
 * Simple thread-safe token bucket rate limiter with injectable clock for deterministic tests.
 */
public final class TokenBucketRateLimiter {

    private final double capacity;
    private final double refillPerMs;
    private final LongSupplier nowMillis;

    private double tokens;
    private long lastRefillMs;

    public TokenBucketRateLimiter(int tokensPerSecond, LongSupplier nowMillis) {
        this(tokensPerSecond, tokensPerSecond, 1_000L, nowMillis);
    }

    public TokenBucketRateLimiter(int capacity, int refillTokens, long refillPeriodMs, LongSupplier nowMillis) {
        if (capacity <= 0 || refillTokens <= 0 || refillPeriodMs <= 0) {
            throw new IllegalArgumentException("Rate limiter parameters must be positive");
        }
        this.capacity = capacity;
        this.refillPerMs = (double) refillTokens / refillPeriodMs;
        this.nowMillis = nowMillis;
        this.tokens = capacity;
        this.lastRefillMs = nowMillis.getAsLong();
    }

    public synchronized boolean tryAcquire() {
        long now = nowMillis.getAsLong();
        if (now > lastRefillMs) {
            double added = (now - lastRefillMs) * refillPerMs;
            tokens = Math.min(capacity, tokens + added);
            lastRefillMs = now;
        }
        if (tokens >= 1.0) {
            tokens -= 1.0;
            return true;
        }
        return false;
    }
}
