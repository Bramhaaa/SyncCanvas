package com.synccanvas.it;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.TextNode;
import com.synccanvas.api.CreateBoardResponse;
import com.synccanvas.api.SnapshotResponse;
import com.synccanvas.crdt.Hlc;
import com.synccanvas.crdt.LwwMap;
import com.synccanvas.crdt.Op;
import com.synccanvas.jobs.CompactionJob;
import com.synccanvas.protocol.SnapshotRequiredMessage;
import com.synccanvas.protocol.SyncBroadcastMessage;
import com.synccanvas.protocol.SyncPullMessage;
import com.synccanvas.protocol.SyncPushMessage;
import com.synccanvas.protocol.WsMessage;
import java.net.URI;
import java.time.Duration;
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
class CompactionIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private CompactionJob compactionJob;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void compactedBoardSendsSnapshotRequiredAndClientRecoversByMerging() throws Exception {
        CreateBoardResponse created =
                restTemplate.postForObject("/api/v1/boards", null, CreateBoardResponse.class);
        assertThat(created).isNotNull();
        String boardId = created.boardId();

        BlockingQueue<WsMessage> inboxA = new LinkedBlockingQueue<>();
        BlockingQueue<WsMessage> inboxB = new LinkedBlockingQueue<>();
        StandardWebSocketClient wsClient = new StandardWebSocketClient();

        WebSocketSession sessionA = wsClient
                .execute(
                        new TextWebSocketHandler() {
                            @Override
                            protected void handleTextMessage(WebSocketSession s, TextMessage m) throws Exception {
                                inboxA.add(objectMapper.readValue(m.getPayload(), WsMessage.class));
                            }
                        },
                        new WebSocketHttpHeaders(),
                        URI.create("ws://localhost:" + port + "/ws/boards/" + boardId + "?clientId=user_a"))
                .get(5, TimeUnit.SECONDS);

        try {
            long now = System.currentTimeMillis();
            List<Op> ops = List.of(
                    new Op("obj_a", "type", TextNode.valueOf("rect"), new Hlc(now, 0, "user_a").format()),
                    new Op("obj_a", "x", IntNode.valueOf(150), new Hlc(now, 1, "user_a").format()));
            sessionA.sendMessage(new TextMessage(objectMapper.writeValueAsString(new SyncPushMessage("user_a", ops))));
            SyncBroadcastMessage ack = (SyncBroadcastMessage) inboxA.poll(3, TimeUnit.SECONDS);
            assertThat(ack).isNotNull();
            assertThat(ack.serverSeqEnd()).isEqualTo(2L);

            // Compact and prune immediately (retention = 0)
            int pruned = compactionJob.compactBoard(boardId, Duration.ZERO);
            assertThat(pruned).isEqualTo(2);

            // Late client B pulls from seq 0 -> must receive SNAPSHOT_REQUIRED
            WebSocketSession sessionB = wsClient
                    .execute(
                            new TextWebSocketHandler() {
                                @Override
                                protected void handleTextMessage(WebSocketSession s, TextMessage m) throws Exception {
                                    inboxB.add(objectMapper.readValue(m.getPayload(), WsMessage.class));
                                }
                            },
                            new WebSocketHttpHeaders(),
                            URI.create("ws://localhost:" + port + "/ws/boards/" + boardId + "?clientId=user_b"))
                    .get(5, TimeUnit.SECONDS);
            try {
                sessionB.sendMessage(
                        new TextMessage(objectMapper.writeValueAsString(new SyncPullMessage(0L))));
                WsMessage reply = inboxB.poll(3, TimeUnit.SECONDS);
                assertThat(reply).isInstanceOf(SnapshotRequiredMessage.class);
                SnapshotRequiredMessage snapReq = (SnapshotRequiredMessage) reply;
                assertThat(snapReq.oldestAvailableSeq()).isEqualTo(3L);

                // Client B fetches /snapshot and merges with its own unsynced offline edit
                SnapshotResponse snap = restTemplate.getForObject(
                        "/api/v1/boards/" + boardId + "/snapshot", SnapshotResponse.class);
                assertThat(snap).isNotNull();
                assertThat(snap.snapshotSeq()).isEqualTo(2L);

                LwwMap mapB = LwwMap.fromState(snap.state());
                assertThat(mapB.get("obj_a", "x")).isPresent();
                assertThat(mapB.get("obj_a", "x").get().value().asInt()).isEqualTo(150);
            } finally {
                sessionB.close();
            }
        } finally {
            sessionA.close();
        }
    }
}
