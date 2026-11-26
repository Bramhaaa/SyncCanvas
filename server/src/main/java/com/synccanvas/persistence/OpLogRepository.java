package com.synccanvas.persistence;

import com.synccanvas.crdt.Op;
import java.util.List;

public interface OpLogRepository {

    /**
     * Atomically: lock board row, deduplicate against existing ops, reserve n per-board gap-free
     * sequence numbers, and insert. Returns only the newly stored ops with their assigned seqs.
     */
    List<SequencedOp> appendBatch(String boardId, String originClientId, List<Op> ops);

    List<SequencedOp> readSince(String boardId, long sinceSeq, int limit);

    long oldestAvailableSeq(String boardId);
}
