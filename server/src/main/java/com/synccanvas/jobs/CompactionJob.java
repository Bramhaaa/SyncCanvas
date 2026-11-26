package com.synccanvas.jobs;

import com.synccanvas.persistence.BoardStateService;
import com.synccanvas.persistence.SnapshotRepository;
import java.time.Duration;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class CompactionJob {

    private static final Logger log = LoggerFactory.getLogger(CompactionJob.class);
    public static final long DEFAULT_MIN_UNCOMPACTED_OPS = 500L;
    public static final Duration DEFAULT_OP_RETENTION = Duration.ofHours(24);

    private final BoardStateService boardStateService;
    private final SnapshotRepository snapshotRepository;

    public CompactionJob(BoardStateService boardStateService, SnapshotRepository snapshotRepository) {
        this.boardStateService = boardStateService;
        this.snapshotRepository = snapshotRepository;
    }

    @Scheduled(fixedDelayString = "${synccanvas.compaction.interval-ms:300000}")
    public void runScheduledCompaction() {
        List<String> boardIds = snapshotRepository.findBoardsNeedingCompaction(DEFAULT_MIN_UNCOMPACTED_OPS);
        for (String boardId : boardIds) {
            try {
                compactBoard(boardId, DEFAULT_OP_RETENTION);
            } catch (RuntimeException e) {
                log.warn("Compaction failed for board {}: {}", boardId, e.getMessage());
            }
        }
    }

    public int compactBoard(String boardId, Duration retention) {
        BoardStateService.SnapshotView view = boardStateService.getSnapshot(boardId);
        if (view.snapshotSeq() <= 0) {
            return 0;
        }
        snapshotRepository.upsertSnapshot(boardId, view.snapshotSeq(), view.state());
        int pruned = snapshotRepository.pruneOpsOlderThan(boardId, view.snapshotSeq(), retention);
        if (pruned > 0) {
            log.info("Compacted board {} at seq {} (pruned {} ops)", boardId, view.snapshotSeq(), pruned);
        }
        return pruned;
    }
}
