package com.synccanvas.pubsub;

import com.synccanvas.protocol.PresenceMessage;
import com.synccanvas.protocol.SyncBroadcastMessage;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "synccanvas.bus", havingValue = "local", matchIfMissing = true)
public class LocalBoardBus implements BoardBus {

    private final ConcurrentHashMap<String, CopyOnWriteArraySet<BoardListener>> subscribers =
            new ConcurrentHashMap<>();

    @Override
    public void publishOps(String boardId, SyncBroadcastMessage msg) {
        Set<BoardListener> listeners = subscribers.get(boardId);
        if (listeners == null) {
            return;
        }
        for (BoardListener listener : listeners) {
            listener.onOps(boardId, msg);
        }
    }

    @Override
    public void publishPresence(String boardId, PresenceMessage msg) {
        Set<BoardListener> listeners = subscribers.get(boardId);
        if (listeners == null) {
            return;
        }
        for (BoardListener listener : listeners) {
            listener.onPresence(boardId, msg);
        }
    }

    @Override
    public void subscribe(String boardId, BoardListener listener) {
        subscribers.computeIfAbsent(boardId, ignored -> new CopyOnWriteArraySet<>()).add(listener);
    }

    @Override
    public void unsubscribe(String boardId, BoardListener listener) {
        subscribers.computeIfPresent(boardId, (id, set) -> {
            set.remove(listener);
            return set.isEmpty() ? null : set;
        });
    }
}
