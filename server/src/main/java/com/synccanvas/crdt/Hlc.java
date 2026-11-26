package com.synccanvas.crdt;

import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public record Hlc(long physicalTime, int counter, String nodeId) implements Comparable<Hlc> {

    public static final long MAX_PHYSICAL_TIME = 9_999_999_999_999L;
    public static final int MAX_COUNTER = 99_999;

    private static final Pattern NODE_ID_PATTERN = Pattern.compile("^[a-z0-9_]{1,32}$");
    private static final Pattern HLC_PATTERN = Pattern.compile("^(\\d{13}):(\\d{5}):([a-z0-9_]{1,32})$");

    public Hlc {
        if (physicalTime < 0 || physicalTime > MAX_PHYSICAL_TIME) {
            throw new IllegalArgumentException("Invalid HLC physicalTime: " + physicalTime);
        }
        if (counter < 0 || counter > MAX_COUNTER) {
            throw new IllegalArgumentException("Invalid HLC counter: " + counter);
        }
        Objects.requireNonNull(nodeId, "nodeId must not be null");
        if (!NODE_ID_PATTERN.matcher(nodeId).matches()) {
            throw new IllegalArgumentException("Invalid HLC nodeId: \"" + nodeId + "\"");
        }
    }

    public static Hlc parse(String raw) {
        if (raw == null) {
            throw new IllegalArgumentException("HLC string must not be null");
        }
        Matcher matcher = HLC_PATTERN.matcher(raw);
        if (!matcher.matches()) {
            throw new IllegalArgumentException("Invalid HLC string: \"" + raw + "\"");
        }
        long pt = Long.parseLong(matcher.group(1));
        int cnt = Integer.parseInt(matcher.group(2));
        String node = matcher.group(3);
        return new Hlc(pt, cnt, node);
    }

    public String format() {
        return String.format("%013d:%05d:%s", physicalTime, counter, nodeId);
    }

    @Override
    public int compareTo(Hlc other) {
        int cmp = Long.compare(this.physicalTime, other.physicalTime);
        if (cmp != 0) {
            return cmp;
        }
        cmp = Integer.compare(this.counter, other.counter);
        if (cmp != 0) {
            return cmp;
        }
        return this.nodeId.compareTo(other.nodeId);
    }

    public static int compareSerialized(String a, String b) {
        return a.compareTo(b);
    }
}
