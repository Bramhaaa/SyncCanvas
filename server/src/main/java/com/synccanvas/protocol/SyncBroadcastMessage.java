package com.synccanvas.protocol;

import com.synccanvas.crdt.Op;
import java.util.List;

public record SyncBroadcastMessage(
        long serverSeqStart, long serverSeqEnd, String originClientId, List<Op> ops)
        implements WsMessage {}
