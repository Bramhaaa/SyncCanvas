package com.synccanvas.protocol;

import java.util.List;

public record PresenceMessage(
        String clientId,
        String displayName,
        String color,
        CursorPosition cursor,
        List<String> selectedIds)
        implements WsMessage {

    public record CursorPosition(double x, double y) {}
}
