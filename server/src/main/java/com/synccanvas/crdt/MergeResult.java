package com.synccanvas.crdt;

public sealed interface MergeResult permits Accepted, DiscardedStale {}
