package com.synccanvas.crdt;

import java.util.Optional;

public record Accepted(Optional<Register> previous) implements MergeResult {}
