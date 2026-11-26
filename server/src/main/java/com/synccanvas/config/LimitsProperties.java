package com.synccanvas.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "synccanvas.limits")
public record LimitsProperties(
        int maxFrameBytes,
        int maxObjectsPerBoard,
        long maxDriftMs,
        int syncPushPerSecond,
        int presencePerSecond,
        int boardCreatesPerMinutePerIp,
        int maxFreehandPoints,
        int maxTextLength,
        int catchupMaxOps,
        int catchupMaxBytes) {

    public static LimitsProperties defaults() {
        return new LimitsProperties(
                65_536,
                500,
                60_000L,
                60,
                30,
                10,
                2_000,
                2_000,
                500,
                262_144);
    }

    public LimitsProperties {
        if (maxFrameBytes <= 0) maxFrameBytes = 65_536;
        if (maxObjectsPerBoard <= 0) maxObjectsPerBoard = 500;
        if (maxDriftMs <= 0) maxDriftMs = 60_000L;
        if (syncPushPerSecond <= 0) syncPushPerSecond = 60;
        if (presencePerSecond <= 0) presencePerSecond = 30;
        if (boardCreatesPerMinutePerIp <= 0) boardCreatesPerMinutePerIp = 10;
        if (maxFreehandPoints <= 0) maxFreehandPoints = 2_000;
        if (maxTextLength <= 0) maxTextLength = 2_000;
        if (catchupMaxOps <= 0) catchupMaxOps = 500;
        if (catchupMaxBytes <= 0) catchupMaxBytes = 262_144;
    }
}
