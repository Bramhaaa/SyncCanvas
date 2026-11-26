package com.synccanvas;

import com.synccanvas.config.LimitsProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(LimitsProperties.class)
public class SyncCanvasApplication {

    public static void main(String[] args) {
        SpringApplication.run(SyncCanvasApplication.class, args);
    }
}
