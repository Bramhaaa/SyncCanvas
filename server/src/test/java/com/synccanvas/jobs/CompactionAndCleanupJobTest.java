package com.synccanvas.jobs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synccanvas.persistence.BoardRepository;
import com.synccanvas.persistence.BoardStateService;
import com.synccanvas.persistence.SnapshotRepository;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;

class CompactionAndCleanupJobTest {

    @Test
    void compactionJobUpsertsSnapshotAndPrunesOldOps() {
        BoardStateService stateService = mock(BoardStateService.class);
        SnapshotRepository snapshotRepo = mock(SnapshotRepository.class);
        when(stateService.getSnapshot("brd_1"))
                .thenReturn(new BoardStateService.SnapshotView(Map.of(), 512L));
        when(snapshotRepo.pruneOpsOlderThan(eq("brd_1"), eq(512L), any(Duration.class)))
                .thenReturn(500);

        CompactionJob job = new CompactionJob(stateService, snapshotRepo);
        int pruned = job.compactBoard("brd_1", Duration.ofHours(24));

        assertThat(pruned).isEqualTo(500);
        verify(snapshotRepo).upsertSnapshot("brd_1", 512L, Map.of());
    }

    @Test
    void compactionJobSkipsEmptyBoards() {
        BoardStateService stateService = mock(BoardStateService.class);
        SnapshotRepository snapshotRepo = mock(SnapshotRepository.class);
        when(stateService.getSnapshot("brd_empty"))
                .thenReturn(new BoardStateService.SnapshotView(Map.of(), 0L));

        CompactionJob job = new CompactionJob(stateService, snapshotRepo);
        assertThat(job.compactBoard("brd_empty", Duration.ofHours(24))).isZero();
        verify(snapshotRepo, never()).upsertSnapshot(any(), eq(0L), any());
    }

    @Test
    void demoCleanupJobDeletesExpiredBoardsAndEvictsCache() {
        BoardRepository boardRepo = mock(BoardRepository.class);
        BoardStateService stateService = mock(BoardStateService.class);
        when(boardRepo.deleteExpiredDemoBoards(DemoCleanupJob.DEMO_TTL)).thenReturn(3);

        DemoCleanupJob job = new DemoCleanupJob(boardRepo, stateService);
        assertThat(job.cleanupExpiredDemoBoards()).isEqualTo(3);
        verify(stateService).evictAll();
    }
}
