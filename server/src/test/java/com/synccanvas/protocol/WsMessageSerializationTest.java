package com.synccanvas.protocol;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.DoubleNode;
import com.synccanvas.crdt.Op;
import java.util.List;
import org.junit.jupiter.api.Test;

class WsMessageSerializationTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void roundTripsAllWireMessageTypes() throws Exception {
        Op op = new Op("obj_1", "x", DoubleNode.valueOf(42.5), "1732579200000:00000:user_a");

        List<WsMessage> messages = List.of(
                new SyncPushMessage("user_a", List.of(op)),
                new SyncPullMessage(1015L),
                new SyncBroadcastMessage(1L, 1L, "user_a", List.of(op)),
                new SnapshotRequiredMessage(5200L),
                new ErrorMessage(ProtocolErrorCode.INVALID_FIELD, "bad", List.of(op.hlc())),
                new ErrorMessage(ProtocolErrorCode.FRAME_TOO_LARGE, "too big"),
                new PresenceMessage("user_a", "User A", "#EF4444", new PresenceMessage.CursorPosition(10, 20), List.of("obj_1")),
                new PresenceMessage("user_a", "User A", "#EF4444", null, List.of()));

        for (WsMessage msg : messages) {
            String json = mapper.writeValueAsString(msg);
            WsMessage decoded = mapper.readValue(json, WsMessage.class);
            assertThat(decoded).isEqualTo(msg);
        }

        // ErrorMessage without rejectedHlcs omits the null property
        String noRejectedJson = mapper.writeValueAsString(
                new ErrorMessage(ProtocolErrorCode.FRAME_TOO_LARGE, "too big"));
        assertThat(noRejectedJson).doesNotContain("rejectedHlcs");
    }
}
