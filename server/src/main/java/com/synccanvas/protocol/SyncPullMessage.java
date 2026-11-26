package com.synccanvas.protocol;

public record SyncPullMessage(long lastSyncedSeq) implements WsMessage {}
