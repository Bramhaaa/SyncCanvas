package com.synccanvas.protocol;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorMessage(ProtocolErrorCode code, String message, List<String> rejectedHlcs)
        implements WsMessage {

    public ErrorMessage(ProtocolErrorCode code, String message) {
        this(code, message, null);
    }
}
