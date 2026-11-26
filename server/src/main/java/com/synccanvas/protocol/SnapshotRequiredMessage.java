package com.synccanvas.protocol;

public record SnapshotRequiredMessage(long oldestAvailableSeq) implements WsMessage {}
