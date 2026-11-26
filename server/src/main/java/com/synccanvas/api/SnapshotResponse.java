package com.synccanvas.api;

import com.synccanvas.crdt.Register;
import java.util.Map;

public record SnapshotResponse(Map<String, Map<String, Register>> state, long snapshotSeq) {}
