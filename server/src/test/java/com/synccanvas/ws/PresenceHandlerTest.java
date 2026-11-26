package com.synccanvas.ws;

import static org.assertj.core.api.Assertions.assertThat;

import com.synccanvas.config.LimitsProperties;
import com.synccanvas.protocol.PresenceMessage;
import com.synccanvas.protocol.SyncBroadcastMessage;
import com.synccanvas.pubsub.BoardListener;
import com.synccanvas.pubsub.LocalBoardBus;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class PresenceHandlerTest {

    @Test
    void validatesThrottlesAndBroadcastsLeaveOnClose() {
        LocalBoardBus bus = new LocalBoardBus();
        List<PresenceMessage> received = new ArrayList<>();
        bus.subscribe("brd_1", new BoardListener() {
            @Override
            public void onOps(String boardId, SyncBroadcastMessage msg) {}

            @Override
            public void onPresence(String boardId, PresenceMessage msg) {
                received.add(msg);
            }
        });

        AtomicLong now = new AtomicLong(1_000L);
        LimitsProperties limits = new LimitsProperties(
                65_536, 500, 60_000L, 60, 2, 10, 2_000, 2_000, 500, 262_144);
        PresenceHandler handler = new PresenceHandler(bus, limits, now::get);

        SessionRegistry.RegisteredSession reg =
                new SessionRegistry.RegisteredSession("sess-1", "brd_1", "user_a", null);
        handler.onSessionOpened(reg);

        // Mismatched clientId rejected
        assertThat(handler.handlePresence(
                        reg, new PresenceMessage("other", "Other", "#2563eb", null, List.of())))
                .isFalse();

        // Invalid color rejected
        assertThat(handler.handlePresence(
                        reg, new PresenceMessage("user_a", "User A", "not-a-hex", null, List.of())))
                .isFalse();

        // Advance clock to refill the 2/s bucket before testing valid rate-limiting
        now.addAndGet(1_000L);

        // Valid presence passes up to rate limit (2/s)
        PresenceMessage valid = new PresenceMessage(
                "user_a", "User A", "#2563eb", new PresenceMessage.CursorPosition(100, 200), List.of("obj_1"));
        assertThat(handler.handlePresence(reg, valid)).isTrue();
        assertThat(handler.handlePresence(reg, valid)).isTrue();
        // 3rd within same second is throttled
        assertThat(handler.handlePresence(reg, valid)).isFalse();
        assertThat(received).hasSize(2);

        // Session close broadcasts cursor: null leave event
        handler.onSessionClosed(reg);
        assertThat(received).hasSize(3);
        PresenceMessage leave = received.get(2);
        assertThat(leave.clientId()).isEqualTo("user_a");
        assertThat(leave.displayName()).isEqualTo("User A");
        assertThat(leave.color()).isEqualTo("#2563eb");
        assertThat(leave.cursor()).isNull();
        assertThat(leave.selectedIds()).isEmpty();
    }
}
