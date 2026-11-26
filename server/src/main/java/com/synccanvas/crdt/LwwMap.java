package com.synccanvas.crdt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.erdtman.jcs.JsonCanonicalizer;

public final class LwwMap {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final HexFormat HEX = HexFormat.of();

    private final Map<String, Map<String, Register>> objects = new HashMap<>();

    public MergeResult apply(Op op) {
        Map<String, Register> fields = objects.computeIfAbsent(op.objectId(), ignored -> new HashMap<>());
        Register current = fields.get(op.field());

        if (current == null) {
            fields.put(op.field(), new Register(op.value(), op.hlc()));
            return new Accepted(Optional.empty());
        }

        int cmp = Hlc.compareSerialized(op.hlc(), current.hlc());
        if (cmp > 0) {
            fields.put(op.field(), new Register(op.value(), op.hlc()));
            return new Accepted(Optional.of(current));
        }

        String reason = cmp == 0 ? "duplicate hlc" : "remote hlc < local hlc";
        return new DiscardedStale(current, reason);
    }

    public Optional<Register> get(String objectId, String field) {
        Map<String, Register> fields = objects.get(objectId);
        if (fields == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(fields.get(field));
    }

    public Optional<Map<String, JsonNode>> getObject(String objectId) {
        Map<String, Register> fields = objects.get(objectId);
        if (fields == null || !isVisible(fields)) {
            return Optional.empty();
        }

        Map<String, JsonNode> result = new LinkedHashMap<>();
        for (Map.Entry<String, Register> entry : fields.entrySet()) {
            result.put(entry.getKey(), entry.getValue().value());
        }
        return Optional.of(result);
    }

    public List<String> visibleObjectIds() {
        record VisibleEntry(String id, String zIndex) {}

        List<VisibleEntry> visible = new ArrayList<>();
        for (Map.Entry<String, Map<String, Register>> entry : objects.entrySet()) {
            Map<String, Register> fields = entry.getValue();
            if (!isVisible(fields)) {
                continue;
            }
            Register zReg = fields.get("zIndex");
            String zIndex = (zReg != null && zReg.value() != null && zReg.value().isTextual())
                    ? zReg.value().asText()
                    : "";
            visible.add(new VisibleEntry(entry.getKey(), zIndex));
        }

        visible.sort(Comparator.comparing(VisibleEntry::zIndex).thenComparing(VisibleEntry::id));
        return visible.stream().map(VisibleEntry::id).toList();
    }

    public Map<String, Map<String, Register>> toState() {
        Map<String, Map<String, Register>> snapshot = new LinkedHashMap<>();
        for (Map.Entry<String, Map<String, Register>> objEntry : objects.entrySet()) {
            Map<String, Register> fieldCopy = new LinkedHashMap<>(objEntry.getValue());
            snapshot.put(objEntry.getKey(), fieldCopy);
        }
        return snapshot;
    }

    public String stateHash() {
        record Tuple(String objectId, String field, Register reg) {}

        List<Tuple> tuples = new ArrayList<>();
        for (Map.Entry<String, Map<String, Register>> objEntry : objects.entrySet()) {
            String objectId = objEntry.getKey();
            for (Map.Entry<String, Register> fieldEntry : objEntry.getValue().entrySet()) {
                tuples.add(new Tuple(objectId, fieldEntry.getKey(), fieldEntry.getValue()));
            }
        }

        tuples.sort(Comparator.comparing(Tuple::objectId).thenComparing(Tuple::field));

        ArrayNode root = MAPPER.createArrayNode();
        for (Tuple t : tuples) {
            ArrayNode row = MAPPER.createArrayNode();
            row.add(t.objectId());
            row.add(t.field());
            row.add(t.reg().value());
            row.add(t.reg().hlc());
            root.add(row);
        }

        try {
            String rawJson = MAPPER.writeValueAsString(root);
            byte[] jcsBytes = new JsonCanonicalizer(rawJson).getEncodedUTF8();
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(jcsBytes);
            return HEX.formatHex(digest);
        } catch (IOException | NoSuchAlgorithmException e) {
            throw new IllegalStateException("Failed to compute canonical CRDT stateHash", e);
        }
    }

    public static LwwMap fromState(Map<String, Map<String, Register>> state) {
        LwwMap map = new LwwMap();
        if (state == null) {
            return map;
        }
        for (Map.Entry<String, Map<String, Register>> objEntry : state.entrySet()) {
            if (objEntry.getValue() == null || objEntry.getValue().isEmpty()) {
                continue;
            }
            Map<String, Register> copy = new HashMap<>(objEntry.getValue());
            map.objects.put(objEntry.getKey(), copy);
        }
        return map;
    }

    private static boolean isVisible(Map<String, Register> fields) {
        if (!fields.containsKey("type")) {
            return false;
        }
        Register deleted = fields.get("deleted");
        return deleted == null || deleted.value() == null || !deleted.value().asBoolean(false);
    }
}
