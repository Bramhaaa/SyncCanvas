package com.synccanvas.protocol;

import com.synccanvas.crdt.Op;
import java.util.List;

public record SyncPushMessage(String clientId, List<Op> ops) implements WsMessage {}
