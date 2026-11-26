package com.synccanvas.pubsub;

import com.synccanvas.protocol.PresenceMessage;
import com.synccanvas.protocol.SyncBroadcastMessage;

public interface BoardBus {

    void publishOps(String boardId, SyncBroadcastMessage msg);

    void publishPresence(String boardId, PresenceMessage msg);

    void subscribe(String boardId, BoardListener listener);

    void unsubscribe(String boardId, BoardListener listener);
}
