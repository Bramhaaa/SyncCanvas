package com.synccanvas.pubsub;

import com.synccanvas.protocol.PresenceMessage;
import com.synccanvas.protocol.SyncBroadcastMessage;

public interface BoardListener {

    void onOps(String boardId, SyncBroadcastMessage message);

    void onPresence(String boardId, PresenceMessage message);
}
