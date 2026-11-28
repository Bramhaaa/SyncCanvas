package com.synccanvas.api;

import com.synccanvas.config.LimitsProperties;
import com.synccanvas.persistence.Board;
import com.synccanvas.persistence.BoardRepository;
import com.synccanvas.persistence.BoardStateService;
import com.synccanvas.persistence.OpLogRepository;
import com.synccanvas.persistence.SequencedOp;
import com.synccanvas.protocol.TokenBucketRateLimiter;
import jakarta.servlet.http.HttpServletRequest;
import java.security.SecureRandom;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.ErrorResponseException;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/boards")
@CrossOrigin(originPatterns = "${synccanvas.cors.allowed-origins:*}")
public class BoardController {

    private static final String BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int MAX_TRACKED_IPS = 10_000;
    private static final long IP_IDLE_EVICT_MS = 5 * 60_000L;

    private static final class IpBucket {
        final TokenBucketRateLimiter limiter;
        volatile long lastSeenAt;

        IpBucket(TokenBucketRateLimiter limiter, long now) {
            this.limiter = limiter;
            this.lastSeenAt = now;
        }
    }

    private final BoardRepository boardRepository;
    private final BoardStateService boardStateService;
    private final OpLogRepository opLogRepository;
    private final LimitsProperties limits;
    private final ConcurrentHashMap<String, IpBucket> ipLimiters = new ConcurrentHashMap<>();

    public record CreateBoardRequest(String title, Boolean isDemo) {}

    public BoardController(
            BoardRepository boardRepository,
            BoardStateService boardStateService,
            OpLogRepository opLogRepository,
            LimitsProperties limits) {
        this.boardRepository = boardRepository;
        this.boardStateService = boardStateService;
        this.opLogRepository = opLogRepository;
        this.limits = limits;
    }

    @PostMapping
    public ResponseEntity<CreateBoardResponse> createBoard(
            @RequestBody(required = false) CreateBoardRequest request,
            HttpServletRequest httpRequest) {
        String ip = resolveClientIp(httpRequest);
        long now = System.currentTimeMillis();
        evictStaleIpBucketsIfNeeded(now);

        IpBucket bucket = ipLimiters.computeIfAbsent(
                ip,
                ignored -> new IpBucket(
                        new TokenBucketRateLimiter(
                                limits.boardCreatesPerMinutePerIp(),
                                limits.boardCreatesPerMinutePerIp(),
                                60_000L,
                                System::currentTimeMillis),
                        now));
        bucket.lastSeenAt = now;

        if (!bucket.limiter.tryAcquire()) {
            throw new ResponseStatusException(
                    HttpStatus.TOO_MANY_REQUESTS, "Board creation rate limit exceeded");
        }

        String title = (request != null && request.title() != null && !request.title().isBlank())
                ? request.title().substring(0, Math.min(request.title().length(), 128))
                : "Untitled Board";
        boolean isDemo = request == null || request.isDemo() == null || request.isDemo();

        String boardId = generateBoardId();
        Board board = boardRepository.create(boardId, title, isDemo);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new CreateBoardResponse(board.id(), board.createdAt()));
    }

    @GetMapping("/{boardId}/snapshot")
    public SnapshotResponse getSnapshot(@PathVariable String boardId) {
        if (!boardRepository.existsById(boardId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Board not found: " + boardId);
        }
        BoardStateService.SnapshotView view = boardStateService.getSnapshot(boardId);
        return new SnapshotResponse(view.state(), view.snapshotSeq());
    }

    @GetMapping("/{boardId}/ops")
    public OpsPageResponse getOps(
            @PathVariable String boardId,
            @RequestParam(defaultValue = "0") long sinceSeq,
            @RequestParam(defaultValue = "500") int limit) {
        if (!boardRepository.existsById(boardId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Board not found: " + boardId);
        }
        if (sinceSeq < 0 || limit < 1 || limit > 1_000) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "sinceSeq must be >= 0 and limit must be in 1..1000");
        }

        long oldest = opLogRepository.oldestAvailableSeq(boardId);
        if (sinceSeq < oldest - 1) {
            ProblemDetail detail = ProblemDetail.forStatusAndDetail(
                    HttpStatus.GONE,
                    "Requested sinceSeq " + sinceSeq + " was pruned (oldestAvailableSeq=" + oldest + ")");
            detail.setProperty("oldestAvailableSeq", oldest);
            throw new ErrorResponseException(HttpStatus.GONE, detail, null);
        }

        List<SequencedOp> rows = opLogRepository.readSince(boardId, sinceSeq, limit + 1);
        boolean hasMore = rows.size() > limit;
        List<SequencedOp> page = hasMore ? rows.subList(0, limit) : rows;
        return new OpsPageResponse(page, hasMore);
    }

    private void evictStaleIpBucketsIfNeeded(long now) {
        if (ipLimiters.size() < 1_024) {
            return;
        }
        long cutoff = now - IP_IDLE_EVICT_MS;
        ipLimiters.entrySet().removeIf(e -> e.getValue().lastSeenAt < cutoff);
        if (ipLimiters.size() >= MAX_TRACKED_IPS) {
            ipLimiters.clear();
        }
    }

    private static String generateBoardId() {
        StringBuilder sb = new StringBuilder(12);
        sb.append("brd_");
        for (int i = 0; i < 8; i++) {
            sb.append(BASE36.charAt(RANDOM.nextInt(BASE36.length())));
        }
        return sb.toString();
    }

    /**
     * Relies on Spring Boot's {@code server.forward-headers-strategy=framework} so proxy headers
     * are only honored from trusted reverse proxies (Caddy / Render / Koyeb).
     */
    private static String resolveClientIp(HttpServletRequest request) {
        return request.getRemoteAddr() != null ? request.getRemoteAddr() : "unknown";
    }
}
