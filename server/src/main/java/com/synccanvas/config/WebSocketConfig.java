package com.synccanvas.config;

import com.synccanvas.ws.BoardWebSocketHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final BoardWebSocketHandler boardWebSocketHandler;
    private final String[] allowedOrigins;

    public WebSocketConfig(
            BoardWebSocketHandler boardWebSocketHandler,
            @Value("${synccanvas.cors.allowed-origins:*}") String[] allowedOrigins) {
        this.boardWebSocketHandler = boardWebSocketHandler;
        this.allowedOrigins = allowedOrigins;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(boardWebSocketHandler, "/ws/boards/*")
                .setAllowedOriginPatterns(allowedOrigins);
    }

    @Bean
    public ServletServerContainerFactoryBean createWebSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        // Allow slightly above 64 KiB so the handler can send ERROR FRAME_TOO_LARGE cleanly.
        container.setMaxTextMessageBufferSize(128 * 1024);
        container.setMaxBinaryMessageBufferSize(128 * 1024);
        return container;
    }
}
