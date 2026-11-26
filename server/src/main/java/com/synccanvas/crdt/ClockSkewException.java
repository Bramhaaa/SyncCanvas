package com.synccanvas.crdt;

public final class ClockSkewException extends RuntimeException {

    public static final String CODE = "CLOCK_SKEW";

    public ClockSkewException(String message) {
        super(message);
    }
}
