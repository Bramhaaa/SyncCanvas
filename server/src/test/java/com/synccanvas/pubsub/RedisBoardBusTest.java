package com.synccanvas.pubsub;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.IntNode;
import com.synccanvas.crdt.Op;
import com.synccanvas.protocol.PresenceMessage;
import com.synccanvas.protocol.SyncBroadcastMessage;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class RedisBoardBusTest {

    @Container
    static GenericContainer<?> redis =
            new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);

    private static LettuceConnectionFactory newConnectionFactory() {
        RedisStandaloneConfiguration config =
                new RedisStandaloneConfiguration(redis.getHost(), redis.getMappedPort(6379));
        LettuceConnectionFactory factory = new LettuceConnectionFactory(config);
        factory.afterPropertiesSet();
        return factory;
    }

    private static <T> ObjectProvider<T> emptyProvider() {
        return new ObjectProvider<>() {
            @Override
            public T getObject() {
                return null;
            }

            @Override
            public T getObject(Object... args) {
                return null;
            }

            @Override
            public T getIfAvailable() {
                return null;
            }

            @Override
            public T getIfUnique() {
                return null;
            }
        };
    }

    @Test
    void deliversOpsAndPresenceAcrossTwoBusInstancesWithoutPresenceEcho() throws Exception {
        LettuceConnectionFactory cf1 = newConnectionFactory();
        LettuceConnectionFactory cf2 = newConnectionFactory();

        RedisMessageListenerContainer container1 = new RedisMessageListenerContainer();
        container1.setConnectionFactory(cf1);
        container1.afterPropertiesSet();
        container1.start();

        RedisMessageListenerContainer container2 = new RedisMessageListenerContainer();
        container2.setConnectionFactory(cf2);
        container2.afterPropertiesSet();
        container2.start();

        try {
            ObjectMapper mapper = new ObjectMapper();
            RedisBoardBus bus1 = new RedisBoardBus(
                    new StringRedisTemplate(cf1), container1, mapper, "server-1", emptyProvider());
            RedisBoardBus bus2 = new RedisBoardBus(
                    new StringRedisTemplate(cf2), container2, mapper, "server-2", emptyProvider());

            CountDownLatch opsLatch = new CountDownLatch(2);
            CountDownLatch presenceOnBus2 = new CountDownLatch(1);
            List<SyncBroadcastMessage> bus1Ops = new CopyOnWriteArrayList<>();
            List<SyncBroadcastMessage> bus2Ops = new CopyOnWriteArrayList<>();
            List<PresenceMessage> bus1Presence = new CopyOnWriteArrayList<>();
            List<PresenceMessage> bus2Presence = new CopyOnWriteArrayList<>();

            BoardListener listener1 = new BoardListener() {
                @Override
                public void onOps(String boardId, SyncBroadcastMessage msg) {
                    bus1Ops.add(msg);
                    opsLatch.countDown();
                }

                @Override
                public void onPresence(String boardId, PresenceMessage msg) {
                    bus1Presence.add(msg);
                }
            };

            BoardListener listener2 = new BoardListener() {
                @Override
                public void onOps(String boardId, SyncBroadcastMessage msg) {
                    bus2Ops.add(msg);
                    opsLatch.countDown();
                }

                @Override
                public void onPresence(String boardId, PresenceMessage msg) {
                    bus2Presence.add(msg);
                    presenceOnBus2.countDown();
                }
            };

            bus1.subscribe("brd_redis01", listener1);
            bus2.subscribe("brd_redis01", listener2);
            // Allow Redis SUBSCRIBE commands to settle
            Thread.sleep(150);

            SyncBroadcastMessage broadcast = new SyncBroadcastMessage(
                    1L,
                    1L,
                    "user_a",
                    List.of(new Op("obj_1", "x", IntNode.valueOf(42), "1732579200000:00000:user_a")));
            bus1.publishOps("brd_redis01", broadcast);

            assertThat(opsLatch.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(bus1Ops).hasSize(1);
            assertThat(bus2Ops).hasSize(1);
            assertThat(bus2Ops.getFirst().ops().getFirst().value().asInt()).isEqualTo(42);

            PresenceMessage presence = new PresenceMessage(
                    "user_a", "User A", "#2563eb", new PresenceMessage.CursorPosition(10, 20), List.of("obj_1"));
            bus1.publishPresence("brd_redis01", presence);

            assertThat(presenceOnBus2.await(5, TimeUnit.SECONDS)).isTrue();
            Thread.sleep(150);
            // bus1 receives presence once locally (not echoed from Redis); bus2 receives once via Redis
            assertThat(bus1Presence).hasSize(1);
            assertThat(bus2Presence).hasSize(1);
            assertThat(bus2Presence.getFirst().displayName()).isEqualTo("User A");

            bus1.unsubscribe("brd_redis01", listener1);
            bus2.unsubscribe("brd_redis01", listener2);
            assertThat(bus1.activeBoardSubscriptionCount()).isZero();
            assertThat(bus2.activeBoardSubscriptionCount()).isZero();
        } finally {
            container1.stop();
            container2.stop();
            cf1.destroy();
            cf2.destroy();
        }
    }
}
