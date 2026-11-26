package com.synccanvas.ws;

import com.synccanvas.config.LimitsProperties;
import com.synccanvas.protocol.PresenceMessage;
import com.synccanvas.protocol.TokenBucketRateLimiter;
import com.synccanvas.pubsub.BoardBus;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class PresenceHandler {

    private static final int MAX_DISPLAY_NAME_LENGTH = 64;
    private static final int MAX_SELECTED_IDS = 50;
    private static final Pattern COLOR_PATTERN = Pattern.compile("^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$");

    private record LastIdentity(String displayName, String color) {}

    private final BoardBus boardBus;
    private final LimitsProperties limits;
    private final LongSupplier clock;

    private final ConcurrentHashMap<String, TokenBucketRateLimiter> limiters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, LastIdentity> identities = new ConcurrentHashMap<>();

    @Autowired
    public PresenceHandler(BoardBus boardBus, LimitsProperties limits) {
        this(boardBus, limits, System::currentTimeMillis);
    }

    public PresenceHandler(BoardBus boardBus, LimitsProperties limits, LongSupplier clock) {
        this.boardBus = boardBus;
        this.limits = limits;
        this.clock = clock;
    }

    public void onSessionOpened(SessionRegistry.RegisteredSession reg) {
        limiters.put(reg.sessionId(), new TokenBucketRateLimiter(limits.presencePerSecond(), clock));
    }

    /**
     * Validates and rate-limits an ephemeral PRESENCE frame, then relays it via BoardBus.
     * Returns true if published, false if dropped (invalid or rate-limited).
     */
    public boolean handlePresence(SessionRegistry.RegisteredSession reg, PresenceMessage presence) {
        TokenBucketRateLimiter limiter = limiters.get(reg.sessionId());
        if (limiter != null && !limiter.tryAcquire()) {
            return false;
        }
        if (!isValid(reg.clientId(), presence)) {
            return false;
        }

        identities.put(reg.sessionId(), new LastIdentity(presence.displayName(), presence.color()));
        boardBus.publishPresence(reg.boardId(), presence);
        return true;
    }

    /**
     * Cleans up per-session state and broadcasts a leave PRESENCE (`cursor: null`) to peers.
     */
    public void onSessionClosed(SessionRegistry.RegisteredSession reg) {
        if (reg == null) {
            return;
        }
        limiters.remove(reg.sessionId());
        LastIdentity last = identities.remove(reg.sessionId());
        String displayName = last != null ? last.displayName() : reg.clientId();
        String color = last != null ? last.color() : "#6b7280";

        PresenceMessage leave = new PresenceMessage(reg.clientId(), displayName, color, null, List.of());
        boardBus.publishPresence(reg.boardId(), leave);
    }

    private static boolean isValid(String sessionClientId, PresenceMessage msg) {
        if (msg == null || !sessionClientId.equals(msg.clientId())) {
            return false;
        }
        if (msg.displayName() == null || msg.displayName().length() > MAX_DISPLAY_NAME_LENGTH) {
            return false;
        }
        if (msg.color() == null || !COLOR_PATTERN.matcher(msg.color()).matches()) {
            return false;
        }
        if (msg.selectedIds() != null && msg.selectedIds().size() > MAX_SELECTED_IDS) {
            return false;
        }
        if (msg.cursor() != null) {
            if (!Double.isFinite(msg.cursor().x()) || !Double.isFinite(msg.cursor().y())) {
                return false;
            }
        }
        return true;
    }
}
