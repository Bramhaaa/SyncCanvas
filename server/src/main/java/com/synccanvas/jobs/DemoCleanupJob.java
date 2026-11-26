package com.synccanvas.jobs;

import com.synccanvas.persistence.BoardRepository;
import com.synccanvas.persistence.BoardStateService;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class DemoCleanupJob {

    private static final Logger log = LoggerFactory.getLogger(DemoCleanupJob.class);
    public static final Duration DEMO_TTL = Duration.ofHours(24);

    private final BoardRepository boardRepository;
    private final BoardStateService boardStateService;

    public DemoCleanupJob(BoardRepository boardRepository, BoardStateService boardStateService) {
        this.boardRepository = boardRepository;
        this.boardStateService = boardStateService;
    }

    @Scheduled(fixedDelayString = "${synccanvas.demo-cleanup.interval-ms:3600000}")
    public int cleanupExpiredDemoBoards() {
        int deleted = boardRepository.deleteExpiredDemoBoards(DEMO_TTL);
        if (deleted > 0) {
            boardStateService.evictAll();
            log.info("Deleted {} expired demo boards older than {}", deleted, DEMO_TTL);
        }
        return deleted;
    }
}
