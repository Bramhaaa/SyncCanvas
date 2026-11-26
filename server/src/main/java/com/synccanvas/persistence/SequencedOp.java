package com.synccanvas.persistence;

import com.synccanvas.crdt.Op;

public record SequencedOp(long serverSeq, Op op) {}
