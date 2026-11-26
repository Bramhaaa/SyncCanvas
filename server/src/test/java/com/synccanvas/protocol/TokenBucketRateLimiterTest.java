package com.synccanvas.protocol;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class TokenBucketRateLimiterTest {

    @Test
    void allowsBurstUpToCapacityAndRefillsOverTime() {
        AtomicLong now = new AtomicLong(1_000L);
        TokenBucketRateLimiter limiter = new TokenBucketRateLimiter(60, now::get);

        for (int i = 0; i < 60; i++) {
            assertThat(limiter.tryAcquire()).isTrue();
        }
        assertThat(limiter.tryAcquire()).isFalse();

        // Advance 500ms -> refills 30 tokens
        now.addAndGet(500L);
        for (int i = 0; i < 30; i++) {
            assertThat(limiter.tryAcquire()).isTrue();
        }
        assertThat(limiter.tryAcquire()).isFalse();
    }
}
