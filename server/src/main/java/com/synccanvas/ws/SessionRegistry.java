package com.synccanvas.ws;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.synccanvas.config.SyncCanvasMetrics;
import com.synccanvas.persistence.BoardStateService;
import com.synccanvas.protocol.PresenceMessage;
import com.synccanvas.protocol.SyncBroadcastMessage;
import com.synccanvas.protocol.WsMessage;
import com.synccanvas.pubsub.BoardBus;
import com.synccanvas.pubsub.BoardListener;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

@Component
public class SessionRegistry implements BoardListener {

    private static final Logger log = LoggerFactory.getLogger(SessionRegistry.class);
    private static final int SEND_TIME_LIMIT_MS = 5_000;
    private static final int BUFFER_SIZE_LIMIT_BYTES = 512 * 1024;

    public record RegisteredSession(
            String sessionId, String boardId, String clientId, WebSocketSession session) {}

    private final BoardBus boardBus;
    private final BoardStateService boardStateService;
    private final SyncCanvasMetrics metrics;
    private final ObjectMapper objectMapper;
    private final ConcurrentHashMap<String, ConcurrentHashMap<String, RegisteredSession>> boardSessions =
            new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, RegisteredSession> bySessionId = new ConcurrentHashMap<>();

    public SessionRegistry(
            BoardBus boardBus,
            BoardStateService boardStateService,
            ObjectProvider<SyncCanvasMetrics> metricsProvider,
            ObjectMapper objectMapper) {
        this.boardBus = boardBus;
        this.boardStateService = boardStateService;
        this.metrics = metricsProvider != null ? metricsProvider.getIfAvailable() : null;
        this.objectMapper = objectMapper;
    }

    public RegisteredSession register(String boardId, String clientId, WebSocketSession rawSession) {
        WebSocketSession decorated =
                new ConcurrentWebSocketSessionDecorator(rawSession, SEND_TIME_LIMIT_MS, BUFFER_SIZE_LIMIT_BYTES);
        RegisteredSession reg = new RegisteredSession(rawSession.getId(), boardId, clientId, decorated);
        bySessionId.put(rawSession.getId(), reg);

        boardSessions.compute(boardId, (id, sessions) -> {
            if (sessions == null) {
                sessions = new ConcurrentHashMap<>();
                boardBus.subscribe(boardId, this);
            }
            sessions.put(rawSession.getId(), reg);
            return sessions;
        });

        if (metrics != null) {
            metrics.sessionOpened();
        }
        return reg;
    }

    public RegisteredSession unregister(String sessionId) {
        RegisteredSession removed = bySessionId.remove(sessionId);
        if (removed == null) {
            return null;
        }
        boardSessions.computeIfPresent(removed.boardId(), (id, sessions) -> {
            sessions.remove(sessionId);
            if (sessions.isEmpty()) {
                boardBus.unsubscribe(id, this);
                return null;
            }
            return sessions;
        });
        if (metrics != null) {
            metrics.sessionClosed();
        }
        return removed;
    }

    public RegisteredSession get(String sessionId) {
        return bySessionId.get(sessionId);
    }

    public void sendMessage(WebSocketSession session, WsMessage message) {
        if (!session.isOpen()) {
            return;
        }
        try {
            String payload = objectMapper.writeValueAsString(message);
            session.sendMessage(new TextMessage(payload));
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize WS message", e);
        } catch (IOException e) {
            log.debug("Failed to send WS message to session {}: {}", session.getId(), e.getMessage());
        }
    }

    @Override
    public void onOps(String boardId, SyncBroadcastMessage message) {
        // Keep this node's in-memory LwwMap cache fresh for remote Redis broadcasts.
        boardStateService.applyRemoteBroadcast(
                boardId, message.serverSeqStart(), message.serverSeqEnd(), message.ops());

        Map<String, RegisteredSession> sessions = boardSessions.get(boardId);
        if (sessions == null || sessions.isEmpty()) {
            return;
        }
        String payload;
        try {
            payload = objectMapper.writeValueAsString(message);
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize SYNC_BROADCAST for board {}", boardId, e);
            return;
        }
        TextMessage frame = new TextMessage(payload);
        // Deliver to ALL sessions on the board, INCLUDING the origin client (doubles as ack).
        for (RegisteredSession reg : sessions.values()) {
            sendFrame(reg.session(), frame);
        }
    }

    @Override
    public void onPresence(String boardId, PresenceMessage message) {
        Map<String, RegisteredSession> sessions = boardSessions.get(boardId);
        if (sessions == null || sessions.isEmpty()) {
            return;
        }
        String payload;
        try {
            payload = objectMapper.writeValueAsString(message);
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize PRESENCE for board {}", boardId, e);
            return;
        }
        TextMessage frame = new TextMessage(payload);
        // Presence excludes the origin client.
        for (RegisteredSession reg : sessions.values()) {
            if (!reg.clientId().equals(message.clientId())) {
                sendFrame(reg.session(), frame);
            }
        }
    }

    private static void sendFrame(WebSocketSession session, TextMessage frame) {
        if (!session.isOpen()) {
            return;
        }
        try {
            session.sendMessage(frame);
        } catch (IOException e) {
            log.debug("Dropping send to closed/slow session {}: {}", session.getId(), e.getMessage());
        }
    }
}
