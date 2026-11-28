package com.synccanvas.api;

import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.node.IntNode;
import com.synccanvas.crdt.Op;
import com.synccanvas.crdt.Register;
import com.synccanvas.persistence.Board;
import com.synccanvas.persistence.BoardRepository;
import com.synccanvas.persistence.BoardStateService;
import com.synccanvas.persistence.OpLogRepository;
import com.synccanvas.persistence.SequencedOp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = BoardController.class)
@Import(ApiExceptionHandler.class)
class BoardControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private BoardRepository boardRepository;

    @MockitoBean
    private BoardStateService boardStateService;

    @MockitoBean
    private OpLogRepository opLogRepository;

    @Test
    void createsBoardAndReturnsSnapshotAndOps() throws Exception {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        when(boardRepository.create(anyString(), anyString(), anyBoolean()))
                .thenAnswer(inv -> new Board(inv.getArgument(0), inv.getArgument(1), inv.getArgument(2), 0, now, now));

        mockMvc.perform(post("/api/v1/boards")
                        .with(req -> {
                            req.setRemoteAddr("10.0.0.1");
                            return req;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Design Review\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.boardId").isString())
                .andExpect(jsonPath("$.createdAt").value("2026-01-01T00:00:00Z"));

        when(boardRepository.existsById("brd_12345678")).thenReturn(true);
        when(boardStateService.getSnapshot("brd_12345678"))
                .thenReturn(new BoardStateService.SnapshotView(
                        Map.of("obj_1", Map.of("x", new Register(IntNode.valueOf(10), "1732579200000:00000:a"))),
                        5L));

        mockMvc.perform(get("/api/v1/boards/brd_12345678/snapshot"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.snapshotSeq").value(5))
                .andExpect(jsonPath("$.state.obj_1.x.value").value(10));

        when(opLogRepository.oldestAvailableSeq("brd_12345678")).thenReturn(1L);
        when(opLogRepository.readSince("brd_12345678", 0L, 3))
                .thenReturn(List.of(
                        new SequencedOp(1L, new Op("obj_1", "x", IntNode.valueOf(10), "1732579200000:00000:a")),
                        new SequencedOp(2L, new Op("obj_1", "y", IntNode.valueOf(20), "1732579200000:00001:a")),
                        new SequencedOp(3L, new Op("obj_1", "w", IntNode.valueOf(30), "1732579200000:00002:a"))));

        mockMvc.perform(get("/api/v1/boards/brd_12345678/ops?sinceSeq=0&limit=2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ops.length()").value(2))
                .andExpect(jsonPath("$.hasMore").value(true));
    }

    @Test
    void returns404ForMissingBoardAnd410ForPrunedOps() throws Exception {
        when(boardRepository.existsById("brd_missing1")).thenReturn(false);

        mockMvc.perform(get("/api/v1/boards/brd_missing1/snapshot"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404));

        when(boardRepository.existsById("brd_pruned01")).thenReturn(true);
        when(opLogRepository.oldestAvailableSeq("brd_pruned01")).thenReturn(500L);

        mockMvc.perform(get("/api/v1/boards/brd_pruned01/ops?sinceSeq=100"))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.status").value(410))
                .andExpect(jsonPath("$.oldestAvailableSeq").value(500));
    }

    @Test
    void returns429WhenIpExceedsBoardCreationRateLimit() throws Exception {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        when(boardRepository.create(anyString(), anyString(), anyBoolean()))
                .thenAnswer(inv -> new Board(inv.getArgument(0), inv.getArgument(1), inv.getArgument(2), 0, now, now));

        for (int i = 0; i < 10; i++) {
            mockMvc.perform(post("/api/v1/boards").with(req -> {
                        req.setRemoteAddr("10.0.0.99");
                        return req;
                    }))
                    .andExpect(status().isCreated());
        }

        mockMvc.perform(post("/api/v1/boards").with(req -> {
                    req.setRemoteAddr("10.0.0.99");
                    return req;
                }))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.status").value(429));
    }
}
