package com.synccanvas.crdt;

import com.fasterxml.jackson.databind.JsonNode;

public record Op(String objectId, String field, JsonNode value, String hlc) {}
