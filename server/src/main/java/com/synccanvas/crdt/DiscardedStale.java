package com.synccanvas.crdt;

public record DiscardedStale(Register current, String reason) implements MergeResult {}
