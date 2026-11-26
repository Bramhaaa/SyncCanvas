package com.synccanvas.it;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.TextNode;
import com.synccanvas.api.CreateBoardResponse;
import com.synccanvas.crdt.Hlc;
import com.synccanvas.crdt.LwwMap;
import com.synccanvas.crdt.Op;
import com.synccanvas.protocol.ErrorMessage;
import com.synccanvas.protocol.ProtocolErrorCode;
import com.synccanvas.protocol.SyncBroadcastMessage;
import com.synccanvas.protocol.SyncPullMessage;
import com.synccanvas.protocol.SyncPushMessage;
import com.synccanvas.protocol.WsMessage;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration"
        })
@Testcontainers(disabledWithoutDocker = true)
class BackendIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    private String createBoard() {
        CreateBoardResponse resp = restTemplate.postForObject("/api/v1/boards", null, CreateBoardResponse.class);
        assertThat(resp).isNotNull();
        return resp.boardId();
    }

    private TestWsClient connect(String boardId, String clientId) throws Exception {
        BlockingQueue<WsMessage> inbox = new LinkedBlockingQueue<>();
        StandardWebSocketClient wsClient = new StandardWebSocketClient();
        URI uri = URI.create("ws://localhost:" + port + "/ws/boards/" + boardId + "?clientId=" + clientId);
        WebSocketSession session = wsClient
                .execute(
                        new TextWebSocketHandler() {
                            @Override
                            protected void handleTextMessage(WebSocketSession s, TextMessage message)
                                    throws Exception {
                                inbox.add(objectMapper.readValue(message.getPayload(), WsMessage.class));
                            }
                        },
                        new WebSocketHttpHeaders(),
                        uri)
                .get(5, TimeUnit.SECONDS);
        return new TestWsClient(session, inbox, objectMapper);
    }

    private record TestWsClient(
            WebSocketSession session, BlockingQueue<WsMessage> inbox, ObjectMapper mapper)
            implements AutoCloseable {

        void send(WsMessage msg) throws Exception {
            session.sendMessage(new TextMessage(mapper.writeValueAsString(msg)));
        }

        void sendRaw(String raw) throws Exception {
            session.sendMessage(new TextMessage(raw));
        }

        WsMessage next(long timeoutMs) throws InterruptedException {
            return inbox.poll(timeoutMs, TimeUnit.MILLISECONDS);
        }

        @Override
        public void close() throws Exception {
            if (session.isOpen()) {
                session.close();
            }
        }
    }

    @Test
    void scenarioA_and_C_broadcastToOriginAndPeerAndDedupResend() throws Exception {
        String boardId = createBoard();
        long now = System.currentTimeMillis();

        try (TestWsClient a = connect(boardId, "user_a");
                TestWsClient b = connect(boardId, "user_b")) {
            List<Op> ops = List.of(
                    new Op("obj_1", "type", TextNode.valueOf("rect"), new Hlc(now, 0, "user_a").format()),
                    new Op("obj_1", "x", IntNode.valueOf(100), new Hlc(now, 1, "user_a").format()));

            a.send(new SyncPushMessage("user_a", ops));

            SyncBroadcastMessage msgA = (SyncBroadcastMessage) a.next(3000);
            SyncBroadcastMessage msgB = (SyncBroadcastMessage) b.next(3000);
            assertThat(msgA).isNotNull();
            assertThat(msgB).isNotNull();
            assertThat(msgA.serverSeqStart()).isEqualTo(1L);
            assertThat(msgA.serverSeqEnd()).isEqualTo(2L);
            assertThat(msgB.serverSeqStart()).isEqualTo(1L);
            assertThat(msgB.serverSeqEnd()).isEqualTo(2L);

            // (c) Duplicate push gets no new seq and no broadcast
            a.send(new SyncPushMessage("user_a", ops));
            assertThat(a.next(300)).isNull();
            assertThat(b.next(300)).isNull();
        }
    }

    @Test
    void scenarioB_offlineCatchupViaSyncPullReturnsExact50Ops() throws Exception {
        String boardId = createBoard();
        long now = System.currentTimeMillis();

        try (TestWsClient a = connect(boardId, "user_a")) {
            List<Op> batch = new ArrayList<>();
            for (int i = 0; i < 50; i++) {
                batch.add(new Op("obj_1", "x", IntNode.valueOf(i), new Hlc(now, i, "user_a").format()));
            }
            a.send(new SyncPushMessage("user_a", batch));
            SyncBroadcastMessage ack = (SyncBroadcastMessage) a.next(3000);
            assertThat(ack).isNotNull();
            assertThat(ack.serverSeqEnd()).isEqualTo(50L);
        }

        try (TestWsClient b = connect(boardId, "user_b")) {
            b.send(new SyncPullMessage(0L));
            SyncBroadcastMessage catchup = (SyncBroadcastMessage) b.next(3000);
            assertThat(catchup).isNotNull();
            assertThat(catchup.serverSeqStart()).isEqualTo(1L);
            assertThat(catchup.serverSeqEnd()).isEqualTo(50L);
            assertThat(catchup.ops()).hasSize(50);
            assertThat(catchup.originClientId()).isEqualTo("server");
        }
    }

    @Test
    void scenarioD_and_E_clockSkewAndOversizedFrameRejected() throws Exception {
        String boardId = createBoard();
        long future = System.currentTimeMillis() + 120_000L;

        try (TestWsClient a = connect(boardId, "user_a")) {
            // (d) Clock skew
            String skewedHlc = new Hlc(future, 0, "user_a").format();
            a.send(new SyncPushMessage(
                    "user_a", List.of(new Op("obj_1", "x", IntNode.valueOf(1), skewedHlc))));
            ErrorMessage skewErr = (ErrorMessage) a.next(3000);
            assertThat(skewErr).isNotNull();
            assertThat(skewErr.code()).isEqualTo(ProtocolErrorCode.CLOCK_SKEW);
            assertThat(skewErr.rejectedHlcs()).containsExactly(skewedHlc);

            // (e) 70 KB frame rejected with FRAME_TOO_LARGE
            String oversized = "{\"type\":\"SYNC_PUSH\",\"clientId\":\"user_a\",\"pad\":\""
                    + "x".repeat(70 * 1024) + "\"}";
            a.sendRaw(oversized);
            ErrorMessage sizeErr = (ErrorMessage) a.next(3000);
            assertThat(sizeErr).isNotNull();
            assertThat(sizeErr.code()).isEqualTo(ProtocolErrorCode.FRAME_TOO_LARGE);
        }
    }

    @Test
    void scenarioF_concurrentPushesConvergeToIdenticalStateHash() throws Exception {
        String boardId = createBoard();
        long now = System.currentTimeMillis();

        try (TestWsClient a = connect(boardId, "user_a");
                TestWsClient b = connect(boardId, "user_b")) {
            List<Op> opsA = List.of(
                    new Op("obj_1", "type", TextNode.valueOf("rect"), new Hlc(now, 0, "user_a").format()),
                    new Op("obj_1", "x", IntNode.valueOf(120), new Hlc(now, 1, "user_a").format()),
                    new Op("obj_1", "zIndex", TextNode.valueOf("a0"), new Hlc(now, 2, "user_a").format()));
            List<Op> opsB = List.of(
                    new Op("obj_1", "y", IntNode.valueOf(240), new Hlc(now, 0, "user_b").format()),
                    new Op("obj_1", "x", IntNode.valueOf(150), new Hlc(now, 1, "user_b").format()));

            a.send(new SyncPushMessage("user_a", opsA));
            b.send(new SyncPushMessage("user_b", opsB));

            LwwMap mapA = new LwwMap();
            LwwMap mapB = new LwwMap();

            for (int i = 0; i < 2; i++) {
                SyncBroadcastMessage mA = (SyncBroadcastMessage) a.next(3000);
                SyncBroadcastMessage mB = (SyncBroadcastMessage) b.next(3000);
                assertThat(mA).isNotNull();
                assertThat(mB).isNotNull();
                mA.ops().forEach(mapA::apply);
                mB.ops().forEach(mapB::apply);
            }

            assertThat(mapA.stateHash()).isEqualTo(mapB.stateHash());
            assertThat(mapA.visibleObjectIds()).containsExactly("obj_1");
        }
    }
}
