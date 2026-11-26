package com.synccanvas;

import com.synccanvas.config.LimitsProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@EnableConfigurationProperties(LimitsProperties.class)
public class SyncCanvasApplication {

    public static void main(String[] args) {
        SpringApplication.run(SyncCanvasApplication.class, args);
    }
}
