package com.synccanvas.ws;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.synccanvas.config.LimitsProperties;
import com.synccanvas.crdt.Op;
import com.synccanvas.persistence.BoardRepository;
import com.synccanvas.persistence.BoardStateService;
import com.synccanvas.persistence.OpLogRepository;
import com.synccanvas.persistence.SequencedOp;
import com.synccanvas.protocol.ErrorMessage;
import com.synccanvas.protocol.OpValidator;
import com.synccanvas.protocol.PresenceMessage;
import com.synccanvas.protocol.ProtocolErrorCode;
import com.synccanvas.protocol.SnapshotRequiredMessage;
import com.synccanvas.protocol.SyncBroadcastMessage;
import com.synccanvas.protocol.SyncPullMessage;
import com.synccanvas.protocol.SyncPushMessage;
import com.synccanvas.protocol.TokenBucketRateLimiter;
import com.synccanvas.protocol.ValidationResult;
import com.synccanvas.protocol.WsMessage;
import com.synccanvas.pubsub.BoardBus;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import org.springframework.util.MultiValueMap;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.util.UriComponentsBuilder;

@Component
public class BoardWebSocketHandler extends TextWebSocketHandler {

    private static final Pattern NODE_ID_PATTERN = Pattern.compile("^[a-z0-9_]{1,32}$");
    private static final String BOARD_PREFIX = "/ws/boards/";

    private final BoardRepository boardRepository;
    private final BoardStateService boardStateService;
    private final OpLogRepository opLogRepository;
    private final OpValidator opValidator;
    private final BoardBus boardBus;
    private final SessionRegistry sessionRegistry;
    private final LimitsProperties limits;
    private final ObjectMapper objectMapper;

    private final ConcurrentHashMap<String, SessionRateLimiters> limiters = new ConcurrentHashMap<>();

    private record SessionRateLimiters(
            TokenBucketRateLimiter pushLimiter, TokenBucketRateLimiter presenceLimiter) {}

    public BoardWebSocketHandler(
            BoardRepository boardRepository,
            BoardStateService boardStateService,
            OpLogRepository opLogRepository,
            OpValidator opValidator,
            BoardBus boardBus,
            SessionRegistry sessionRegistry,
            LimitsProperties limits,
            ObjectMapper objectMapper) {
        this.boardRepository = boardRepository;
        this.boardStateService = boardStateService;
        this.opLogRepository = opLogRepository;
        this.opValidator = opValidator;
        this.boardBus = boardBus;
        this.sessionRegistry = sessionRegistry;
        this.limits = limits;
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        URI uri = session.getUri();
        if (uri == null) {
            closeWithError(session, ProtocolErrorCode.INVALID_MESSAGE, "Missing WebSocket URI");
            return;
        }

        String boardId = extractBoardId(uri.getPath());
        MultiValueMap<String, String> params = UriComponentsBuilder.fromUri(uri).build().getQueryParams();
        String clientId = params.getFirst("clientId");

        if (boardId == null || clientId == null || !NODE_ID_PATTERN.matcher(clientId).matches()) {
            closeWithError(session, ProtocolErrorCode.INVALID_MESSAGE, "Invalid boardId or clientId");
            return;
        }

        if (!boardRepository.existsById(boardId)) {
            closeWithError(session, ProtocolErrorCode.BOARD_NOT_FOUND, "Board not found: " + boardId);
            return;
        }

        sessionRegistry.register(boardId, clientId, session);
        limiters.put(
                session.getId(),
                new SessionRateLimiters(
                        new TokenBucketRateLimiter(limits.syncPushPerSecond(), System::currentTimeMillis),
                        new TokenBucketRateLimiter(limits.presencePerSecond(), System::currentTimeMillis)));
    }

    @Override
    protected void handleTextMessage(WebSocketSession rawSession, TextMessage message) throws Exception {
        SessionRegistry.RegisteredSession reg = sessionRegistry.get(rawSession.getId());
        if (reg == null) {
            return;
        }

        String payload = message.getPayload();
        if (payload.getBytes(StandardCharsets.UTF_8).length > limits.maxFrameBytes()) {
            closeWithError(
                    reg.session(),
                    ProtocolErrorCode.FRAME_TOO_LARGE,
                    "Frame exceeds max size of " + limits.maxFrameBytes() + " bytes");
            return;
        }

        WsMessage parsed;
        try {
            parsed = objectMapper.readValue(payload, WsMessage.class);
        } catch (JsonProcessingException e) {
            sessionRegistry.sendMessage(
                    reg.session(),
                    new ErrorMessage(ProtocolErrorCode.INVALID_MESSAGE, "Malformed message: " + e.getOriginalMessage()));
            return;
        }

        if (parsed instanceof SyncPushMessage push) {
            handleSyncPush(reg, push);
        } else if (parsed instanceof SyncPullMessage pull) {
            handleSyncPull(reg, pull);
        } else if (parsed instanceof PresenceMessage presence) {
            handlePresence(reg, presence);
        } else {
            sessionRegistry.sendMessage(
                    reg.session(),
                    new ErrorMessage(ProtocolErrorCode.INVALID_MESSAGE, "Unsupported client message type"));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessionRegistry.unregister(session.getId());
        limiters.remove(session.getId());
    }

    private void handleSyncPush(SessionRegistry.RegisteredSession reg, SyncPushMessage push) {
        SessionRateLimiters rl = limiters.get(reg.sessionId());
        if (rl != null && !rl.pushLimiter().tryAcquire()) {
            sessionRegistry.sendMessage(
                    reg.session(),
                    new ErrorMessage(ProtocolErrorCode.RATE_LIMITED, "SYNC_PUSH rate limit exceeded"));
            return;
        }

        if (!reg.clientId().equals(push.clientId())) {
            sessionRegistry.sendMessage(
                    reg.session(),
                    new ErrorMessage(
                            ProtocolErrorCode.INVALID_FIELD,
                            "SYNC_PUSH clientId does not match session clientId"));
            return;
        }

        ValidationResult validation = opValidator.validateBatch(
                reg.clientId(), push.ops(), boardStateService.getState(reg.boardId()));
        if (validation instanceof ValidationResult.Invalid invalid) {
            sessionRegistry.sendMessage(reg.session(), invalid.toErrorMessage());
            return;
        }

        List<SequencedOp> stored =
                boardStateService.appendAndApply(reg.boardId(), reg.clientId(), push.ops());
        if (stored.isEmpty()) {
            // All ops were duplicates; per spec/protocol.md §5.4.1 no broadcast is emitted.
            return;
        }

        long seqStart = stored.getFirst().serverSeq();
        long seqEnd = stored.getLast().serverSeq();
        List<Op> storedOps = stored.stream().map(SequencedOp::op).toList();
        SyncBroadcastMessage broadcast =
                new SyncBroadcastMessage(seqStart, seqEnd, reg.clientId(), storedOps);
        boardBus.publishOps(reg.boardId(), broadcast);
    }

    private void handleSyncPull(SessionRegistry.RegisteredSession reg, SyncPullMessage pull) {
        if (pull.lastSyncedSeq() < 0) {
            sessionRegistry.sendMessage(
                    reg.session(),
                    new ErrorMessage(ProtocolErrorCode.INVALID_MESSAGE, "lastSyncedSeq must be >= 0"));
            return;
        }

        long oldest = opLogRepository.oldestAvailableSeq(reg.boardId());
        if (pull.lastSyncedSeq() < oldest - 1) {
            sessionRegistry.sendMessage(reg.session(), new SnapshotRequiredMessage(oldest));
            return;
        }

        long cursor = pull.lastSyncedSeq();
        int maxOps = limits.catchupMaxOps();
        int maxBytes = limits.catchupMaxBytes();

        while (true) {
            List<SequencedOp> page = opLogRepository.readSince(reg.boardId(), cursor, maxOps);
            if (page.isEmpty()) {
                break;
            }
            sendChunkedCatchup(reg, page, maxBytes);
            cursor = page.getLast().serverSeq();
            if (page.size() < maxOps) {
                break;
            }
        }
    }

    private void sendChunkedCatchup(
            SessionRegistry.RegisteredSession reg, List<SequencedOp> page, int maxBytes) {
        List<Op> chunkOps = new ArrayList<>();
        long chunkStart = -1;
        long chunkEnd = -1;
        int estimatedBytes = 128; // envelope overhead

        for (SequencedOp seqOp : page) {
            int opBytes = estimateOpBytes(seqOp.op());
            if (!chunkOps.isEmpty() && estimatedBytes + opBytes > maxBytes) {
                sessionRegistry.sendMessage(
                        reg.session(), new SyncBroadcastMessage(chunkStart, chunkEnd, "server", List.copyOf(chunkOps)));
                chunkOps.clear();
                chunkStart = -1;
                estimatedBytes = 128;
            }
            if (chunkStart < 0) {
                chunkStart = seqOp.serverSeq();
            }
            chunkEnd = seqOp.serverSeq();
            chunkOps.add(seqOp.op());
            estimatedBytes += opBytes + 1;
        }

        if (!chunkOps.isEmpty()) {
            sessionRegistry.sendMessage(
                    reg.session(), new SyncBroadcastMessage(chunkStart, chunkEnd, "server", List.copyOf(chunkOps)));
        }
    }

    private void handlePresence(SessionRegistry.RegisteredSession reg, PresenceMessage presence) {
        SessionRateLimiters rl = limiters.get(reg.sessionId());
        if (rl != null && !rl.presenceLimiter().tryAcquire()) {
            return;
        }
        if (!reg.clientId().equals(presence.clientId())) {
            return;
        }
        boardBus.publishPresence(reg.boardId(), presence);
    }

    private int estimateOpBytes(Op op) {
        try {
            return objectMapper.writeValueAsBytes(op).length;
        } catch (JsonProcessingException e) {
            return 256;
        }
    }

    private void closeWithError(WebSocketSession session, ProtocolErrorCode code, String message) {
        sessionRegistry.sendMessage(session, new ErrorMessage(code, message));
        if (session.isOpen()) {
            try {
                session.close(CloseStatus.POLICY_VIOLATION);
            } catch (IOException ignored) {
                // Best-effort close
            }
        }
    }

    private static String extractBoardId(String path) {
        if (path == null || !path.startsWith(BOARD_PREFIX)) {
            return null;
        }
        String remainder = path.substring(BOARD_PREFIX.length());
        if (remainder.isEmpty() || remainder.contains("/")) {
            return null;
        }
        return remainder;
    }
}
