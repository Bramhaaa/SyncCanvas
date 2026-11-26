package com.synccanvas.api;

import com.synccanvas.persistence.SequencedOp;
import java.util.List;

public record OpsPageResponse(List<SequencedOp> ops, boolean hasMore) {}
