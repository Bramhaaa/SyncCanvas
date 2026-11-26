package com.synccanvas.persistence;

import java.time.Instant;

public record Board(
        String id,
        String title,
        boolean isDemo,
        long nextSeq,
        Instant createdAt,
        Instant updatedAt) {}
