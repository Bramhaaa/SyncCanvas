package com.synccanvas.pubsub;

import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

@Configuration
public class BusConfig {

    @Bean(name = "nodeInstanceId")
    public String nodeInstanceId(@Value("${synccanvas.instance-id:}") String configuredId) {
        if (configuredId != null && !configuredId.isBlank()) {
            return configuredId.trim();
        }
        return "node-" + UUID.randomUUID().toString().substring(0, 8);
    }

    @Bean
    @ConditionalOnProperty(name = "synccanvas.bus", havingValue = "redis")
    public RedisMessageListenerContainer redisMessageListenerContainer(
            RedisConnectionFactory connectionFactory) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        return container;
    }
}
