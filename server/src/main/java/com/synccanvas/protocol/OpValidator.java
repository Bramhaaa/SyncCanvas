package com.synccanvas.protocol;

import com.fasterxml.jackson.databind.JsonNode;
import com.synccanvas.config.LimitsProperties;
import com.synccanvas.crdt.Hlc;
import com.synccanvas.crdt.LwwMap;
import com.synccanvas.crdt.Op;
import com.synccanvas.crdt.Register;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class OpValidator {

    private static final Pattern OBJECT_ID_PATTERN = Pattern.compile("^[a-z0-9_]{1,64}$");
    private static final Pattern FIELD_PATTERN = Pattern.compile("^[a-zA-Z0-9]{1,64}$");
    private static final Pattern ZINDEX_PATTERN = Pattern.compile("^[0-9A-Za-z]{1,64}$");
    private static final Pattern HEX_COLOR_PATTERN = Pattern.compile("^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$");

    private static final Set<String> OBJECT_TYPES =
            Set.of("rect", "ellipse", "arrow", "freehand", "text", "diamond", "sticky");
    private static final Set<String> BOX_TYPES = Set.of("rect", "ellipse", "diamond", "sticky");
    private static final Set<String> TEXT_TYPES = Set.of("text", "sticky");
    private static final Set<String> ARROW_HEADS = Set.of("none", "end", "both");

    private final LimitsProperties limits;
    private final LongSupplier nowMillis;

    @Autowired
    public OpValidator(LimitsProperties limits) {
        this(limits, System::currentTimeMillis);
    }

    public OpValidator(LimitsProperties limits, LongSupplier nowMillis) {
        this.limits = limits;
        this.nowMillis = nowMillis;
    }

    public ValidationResult validateBatch(String sessionClientId, List<Op> ops, LwwMap boardState) {
        if (ops == null || ops.isEmpty()) {
            return new ValidationResult.Invalid(
                    ProtocolErrorCode.INVALID_MESSAGE, "SYNC_PUSH ops must not be empty", List.of());
        }

        long now = nowMillis.getAsLong();
        int existingObjectCount = countObjectsWithType(boardState);

        Map<String, String> batchTypes = new HashMap<>();
        Set<String> newObjectsInBatch = new HashSet<>();

        List<String> skewHlcs = new ArrayList<>();
        String skewMessage = null;

        List<String> invalidHlcs = new ArrayList<>();
        String invalidMessage = null;

        Set<String> boardFullObjectIds = new HashSet<>();

        for (Op op : ops) {
            if (op == null || op.objectId() == null || op.field() == null || op.hlc() == null) {
                return new ValidationResult.Invalid(
                        ProtocolErrorCode.INVALID_FIELD, "Op is missing required properties", List.of());
            }

            if (!OBJECT_ID_PATTERN.matcher(op.objectId()).matches()) {
                invalidHlcs.add(op.hlc());
                if (invalidMessage == null) invalidMessage = "Invalid objectId: " + op.objectId();
                continue;
            }

            if (!FIELD_PATTERN.matcher(op.field()).matches()) {
                invalidHlcs.add(op.hlc());
                if (invalidMessage == null) invalidMessage = "Invalid field name: " + op.field();
                continue;
            }

            Hlc parsedHlc;
            try {
                parsedHlc = Hlc.parse(op.hlc());
            } catch (IllegalArgumentException e) {
                invalidHlcs.add(op.hlc());
                if (invalidMessage == null) invalidMessage = e.getMessage();
                continue;
            }

            if (!parsedHlc.nodeId().equals(sessionClientId)) {
                invalidHlcs.add(op.hlc());
                if (invalidMessage == null) {
                    invalidMessage = "Op HLC nodeId '" + parsedHlc.nodeId()
                            + "' does not match session clientId '" + sessionClientId + "'";
                }
                continue;
            }

            if (parsedHlc.physicalTime() > now + limits.maxDriftMs()) {
                skewHlcs.add(op.hlc());
                if (skewMessage == null) {
                    skewMessage = "Op HLC exceeds max drift of " + limits.maxDriftMs() + "ms";
                }
                continue;
            }

            JsonNode val = op.value();
            if (val == null || val.isNull()) {
                invalidHlcs.add(op.hlc());
                if (invalidMessage == null) invalidMessage = "null value is not allowed for field '" + op.field() + "'";
                continue;
            }

            String existingType = resolveExistingType(op.objectId(), batchTypes, boardState);

            if ("type".equals(op.field())) {
                if (!val.isTextual() || !OBJECT_TYPES.contains(val.asText())) {
                    invalidHlcs.add(op.hlc());
                    if (invalidMessage == null) invalidMessage = "Invalid object type: " + val;
                    continue;
                }
                String requestedType = val.asText();
                if (existingType != null && !existingType.equals(requestedType)) {
                    invalidHlcs.add(op.hlc());
                    if (invalidMessage == null) {
                        invalidMessage = "Object type is write-once; cannot change '"
                                + existingType + "' to '" + requestedType + "'";
                    }
                    continue;
                }
                if (existingType == null) {
                    if (existingObjectCount + newObjectsInBatch.size() >= limits.maxObjectsPerBoard()) {
                        boardFullObjectIds.add(op.objectId());
                        continue;
                    }
                    newObjectsInBatch.add(op.objectId());
                }
                batchTypes.put(op.objectId(), requestedType);
                continue;
            }

            String fieldError = validateFieldValue(op.field(), val, existingType);
            if (fieldError != null) {
                invalidHlcs.add(op.hlc());
                if (invalidMessage == null) invalidMessage = fieldError;
            }
        }

        if (!skewHlcs.isEmpty()) {
            return new ValidationResult.Invalid(ProtocolErrorCode.CLOCK_SKEW, skewMessage, skewHlcs);
        }
        if (!boardFullObjectIds.isEmpty()) {
            List<String> rejected = ops.stream()
                    .filter(op -> op != null && boardFullObjectIds.contains(op.objectId()))
                    .map(Op::hlc)
                    .toList();
            return new ValidationResult.Invalid(
                    ProtocolErrorCode.BOARD_FULL,
                    "Board has reached the maximum of " + limits.maxObjectsPerBoard() + " objects",
                    rejected);
        }
        if (!invalidHlcs.isEmpty()) {
            return new ValidationResult.Invalid(ProtocolErrorCode.INVALID_FIELD, invalidMessage, invalidHlcs);
        }

        return new ValidationResult.Valid();
    }

    private static int countObjectsWithType(LwwMap boardState) {
        if (boardState == null) return 0;
        int count = 0;
        for (Map<String, Register> fields : boardState.toState().values()) {
            if (fields.containsKey("type")) {
                count++;
            }
        }
        return count;
    }

    private static String resolveExistingType(
            String objectId, Map<String, String> batchTypes, LwwMap boardState) {
        if (batchTypes.containsKey(objectId)) {
            return batchTypes.get(objectId);
        }
        if (boardState != null) {
            return boardState
                    .get(objectId, "type")
                    .map(Register::value)
                    .filter(JsonNode::isTextual)
                    .map(JsonNode::asText)
                    .orElse(null);
        }
        return null;
    }

    private String validateFieldValue(String field, JsonNode val, String objectType) {
        return switch (field) {
            case "x", "y" -> isFiniteNumber(val) ? null : "Field '" + field + "' must be a finite number";
            case "zIndex" -> (val.isTextual() && ZINDEX_PATTERN.matcher(val.asText()).matches())
                    ? null
                    : "Field 'zIndex' must be 1-64 alphanumeric chars";
            case "deleted" -> val.isBoolean() ? null : "Field 'deleted' must be a boolean";
            case "stroke" -> isValidColorOrTransparent(val)
                    ? null
                    : "Field 'stroke' must be a hex color or 'transparent'";
            case "strokeWidth" -> (isFiniteNumber(val)
                            && val.asDouble() >= 0.5
                            && val.asDouble() <= 32.0)
                    ? null
                    : "Field 'strokeWidth' must be between 0.5 and 32";
            case "opacity" -> (isFiniteNumber(val)
                            && val.asDouble() >= 0.0
                            && val.asDouble() <= 1.0)
                    ? null
                    : "Field 'opacity' must be between 0 and 1";
            case "w", "h" -> {
                if (objectType == null || !BOX_TYPES.contains(objectType)) {
                    yield "Field '" + field + "' not allowed for type '" + objectType + "'";
                }
                yield (isFiniteNumber(val) && val.asDouble() > 0.0)
                        ? null
                        : "Field '" + field + "' must be > 0";
            }
            case "fill" -> {
                if (objectType == null || !BOX_TYPES.contains(objectType)) {
                    yield "Field 'fill' not allowed for type '" + objectType + "'";
                }
                yield isValidColorOrTransparent(val)
                        ? null
                        : "Field 'fill' must be a hex color or 'transparent'";
            }
            case "x2", "y2" -> {
                if (!"arrow".equals(objectType)) {
                    yield "Field '" + field + "' not allowed for type '" + objectType + "'";
                }
                yield isFiniteNumber(val) ? null : "Field '" + field + "' must be a finite number";
            }
            case "arrowHead" -> {
                if (!"arrow".equals(objectType)) {
                    yield "Field 'arrowHead' not allowed for type '" + objectType + "'";
                }
                yield (val.isTextual() && ARROW_HEADS.contains(val.asText()))
                        ? null
                        : "Field 'arrowHead' must be one of none|end|both";
            }
            case "points" -> {
                if (!"freehand".equals(objectType)) {
                    yield "Field 'points' not allowed for type '" + objectType + "'";
                }
                yield validatePoints(val);
            }
            case "text" -> {
                if (objectType == null || !TEXT_TYPES.contains(objectType)) {
                    yield "Field 'text' not allowed for type '" + objectType + "'";
                }
                yield (val.isTextual() && val.asText().length() <= limits.maxTextLength())
                        ? null
                        : "Field 'text' must be a string <= " + limits.maxTextLength() + " UTF-16 units";
            }
            case "fontSize" -> {
                if (objectType == null || !TEXT_TYPES.contains(objectType)) {
                    yield "Field 'fontSize' not allowed for type '" + objectType + "'";
                }
                yield (isFiniteNumber(val) && val.asDouble() >= 8.0 && val.asDouble() <= 128.0)
                        ? null
                        : "Field 'fontSize' must be between 8 and 128";
            }
            default -> "Unknown field '" + field + "'";
        };
    }

    private String validatePoints(JsonNode val) {
        if (!val.isArray() || val.isEmpty() || val.size() > limits.maxFreehandPoints()) {
            return "Field 'points' must have 1.." + limits.maxFreehandPoints() + " point pairs";
        }
        for (JsonNode pt : val) {
            if (!pt.isArray()
                    || pt.size() != 2
                    || !isFiniteNumber(pt.get(0))
                    || !isFiniteNumber(pt.get(1))) {
                return "Each entry in 'points' must be a [x, y] pair of finite numbers";
            }
        }
        return null;
    }

    private static boolean isFiniteNumber(JsonNode node) {
        return node != null && node.isNumber() && Double.isFinite(node.asDouble());
    }

    private static boolean isValidColorOrTransparent(JsonNode node) {
        if (node == null || !node.isTextual()) return false;
        String s = node.asText();
        return "transparent".equals(s) || HEX_COLOR_PATTERN.matcher(s).matches();
    }
}
