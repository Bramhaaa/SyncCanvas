package com.synccanvas.protocol;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;

@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.PROPERTY, property = "type")
@JsonSubTypes({
    @JsonSubTypes.Type(value = SyncPushMessage.class, name = "SYNC_PUSH"),
    @JsonSubTypes.Type(value = SyncPullMessage.class, name = "SYNC_PULL"),
    @JsonSubTypes.Type(value = SyncBroadcastMessage.class, name = "SYNC_BROADCAST"),
    @JsonSubTypes.Type(value = SnapshotRequiredMessage.class, name = "SNAPSHOT_REQUIRED"),
    @JsonSubTypes.Type(value = ErrorMessage.class, name = "ERROR"),
    @JsonSubTypes.Type(value = PresenceMessage.class, name = "PRESENCE")
})
public sealed interface WsMessage
        permits SyncPushMessage,
                SyncPullMessage,
                SyncBroadcastMessage,
                SnapshotRequiredMessage,
                ErrorMessage,
                PresenceMessage {}
