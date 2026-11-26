package com.synccanvas.crdt;

import com.fasterxml.jackson.databind.JsonNode;

public record Register(JsonNode value, String hlc) {}
