package com.synccanvas.pubsub;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.synccanvas.protocol.PresenceMessage;
import com.synccanvas.protocol.SyncBroadcastMessage;
import io.micrometer.core.instrument.MeterRegistry;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "synccanvas.bus", havingValue = "redis")
public class RedisBoardBus implements BoardBus {

    private static final Logger log = LoggerFactory.getLogger(RedisBoardBus.class);
    private static final String OPS_CHANNEL_PREFIX = "board:ops:";
    private static final String PRESENCE_CHANNEL_PREFIX = "board:presence:";

    public record PresenceEnvelope(String nodeInstanceId, PresenceMessage payload) {}

    private static final class BoardSubscription {
        final CopyOnWriteArraySet<BoardListener> listeners = new CopyOnWriteArraySet<>();
        final MessageListener opsListener;
        final MessageListener presenceListener;

        BoardSubscription(MessageListener opsListener, MessageListener presenceListener) {
            this.opsListener = opsListener;
            this.presenceListener = presenceListener;
        }
    }

    private final StringRedisTemplate redisTemplate;
    private final RedisMessageListenerContainer listenerContainer;
    private final ObjectMapper objectMapper;
    private final String nodeInstanceId;
    private final MeterRegistry meterRegistry;

    private final ConcurrentHashMap<String, BoardSubscription> subscriptions = new ConcurrentHashMap<>();

    public RedisBoardBus(
            StringRedisTemplate redisTemplate,
            RedisMessageListenerContainer listenerContainer,
            ObjectMapper objectMapper,
            @Qualifier("nodeInstanceId") String nodeInstanceId,
            ObjectProvider<MeterRegistry> meterRegistryProvider) {
        this.redisTemplate = redisTemplate;
        this.listenerContainer = listenerContainer;
        this.objectMapper = objectMapper;
        this.nodeInstanceId = nodeInstanceId;
        this.meterRegistry = meterRegistryProvider.getIfAvailable();
    }

    public static String opsChannel(String boardId) {
        return OPS_CHANNEL_PREFIX + boardId;
    }

    public static String presenceChannel(String boardId) {
        return PRESENCE_CHANNEL_PREFIX + boardId;
    }

    @Override
    public void publishOps(String boardId, SyncBroadcastMessage msg) {
        try {
            String json = objectMapper.writeValueAsString(msg);
            redisTemplate.convertAndSend(opsChannel(boardId), json);
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize SYNC_BROADCAST for board {}", boardId, e);
        } catch (RuntimeException e) {
            log.warn("Redis publishOps failed for board {} (clients will recover via gap detection): {}",
                    boardId, e.getMessage());
            recordError("ops");
        }
    }

    @Override
    public void publishPresence(String boardId, PresenceMessage msg) {
        // Deliver to local listeners immediately (SessionRegistry excludes the origin clientId).
        BoardSubscription localSub = subscriptions.get(boardId);
        if (localSub != null) {
            for (BoardListener listener : localSub.listeners) {
                listener.onPresence(boardId, msg);
            }
        }

        // Publish to Redis tagged with nodeInstanceId so this node skips its own echo.
        try {
            String json = objectMapper.writeValueAsString(new PresenceEnvelope(nodeInstanceId, msg));
            redisTemplate.convertAndSend(presenceChannel(boardId), json);
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize PRESENCE envelope for board {}", boardId, e);
        } catch (RuntimeException e) {
            log.debug("Redis publishPresence failed for board {}: {}", boardId, e.getMessage());
            recordError("presence");
        }
    }

    @Override
    public void subscribe(String boardId, BoardListener listener) {
        subscriptions.compute(boardId, (id, existing) -> {
            if (existing == null) {
                MessageListener opsListener = (Message message, byte[] pattern) ->
                        handleOpsMessage(id, message);
                MessageListener presenceListener = (Message message, byte[] pattern) ->
                        handlePresenceMessage(id, message);

                BoardSubscription sub = new BoardSubscription(opsListener, presenceListener);
                sub.listeners.add(listener);
                listenerContainer.addMessageListener(opsListener, List.of(ChannelTopic.of(opsChannel(id))));
                listenerContainer.addMessageListener(
                        presenceListener, List.of(ChannelTopic.of(presenceChannel(id))));
                return sub;
            }
            existing.listeners.add(listener);
            return existing;
        });
    }

    @Override
    public void unsubscribe(String boardId, BoardListener listener) {
        subscriptions.computeIfPresent(boardId, (id, sub) -> {
            sub.listeners.remove(listener);
            if (sub.listeners.isEmpty()) {
                listenerContainer.removeMessageListener(sub.opsListener);
                listenerContainer.removeMessageListener(sub.presenceListener);
                return null;
            }
            return sub;
        });
    }

    public int activeBoardSubscriptionCount() {
        return subscriptions.size();
    }

    private void handleOpsMessage(String boardId, Message message) {
        BoardSubscription sub = subscriptions.get(boardId);
        if (sub == null || sub.listeners.isEmpty()) {
            return;
        }
        String raw = new String(message.getBody(), StandardCharsets.UTF_8);
        try {
            SyncBroadcastMessage broadcast = objectMapper.readValue(raw, SyncBroadcastMessage.class);
            for (BoardListener listener : sub.listeners) {
                listener.onOps(boardId, broadcast);
            }
        } catch (JsonProcessingException e) {
            log.error("Failed to deserialize SYNC_BROADCAST from Redis on board {}", boardId, e);
        }
    }

    private void handlePresenceMessage(String boardId, Message message) {
        BoardSubscription sub = subscriptions.get(boardId);
        if (sub == null || sub.listeners.isEmpty()) {
            return;
        }
        String raw = new String(message.getBody(), StandardCharsets.UTF_8);
        try {
            PresenceEnvelope envelope = objectMapper.readValue(raw, PresenceEnvelope.class);
            if (nodeInstanceId.equals(envelope.nodeInstanceId())) {
                // Already delivered locally in publishPresence; skip self-echo.
                return;
            }
            for (BoardListener listener : sub.listeners) {
                listener.onPresence(boardId, envelope.payload());
            }
        } catch (JsonProcessingException e) {
            log.error("Failed to deserialize PRESENCE envelope from Redis on board {}", boardId, e);
        }
    }

    private void recordError(String channelType) {
        if (meterRegistry != null) {
            meterRegistry.counter("synccanvas.redis.publish.errors", "channel", channelType).increment();
        }
    }
}
