package com.synccanvas.api;

import java.time.Instant;

public record CreateBoardResponse(String boardId, Instant createdAt) {}
