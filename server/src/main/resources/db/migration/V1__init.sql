CREATE TABLE boards (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(128) NOT NULL DEFAULT 'Untitled Board',
    is_demo BOOLEAN NOT NULL DEFAULT TRUE,
    next_seq BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Periodic compacted state to prevent replaying millions of historical ops
CREATE TABLE board_snapshots (
    board_id VARCHAR(64) PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
    last_server_seq BIGINT NOT NULL DEFAULT 0,
    state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only operation log for incremental catch-up and auditing
CREATE TABLE crdt_operations (
    board_id VARCHAR(64) NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    server_seq BIGINT NOT NULL,
    object_id VARCHAR(64) NOT NULL,
    field_name VARCHAR(64) NOT NULL,
    field_value JSONB,
    hlc VARCHAR(64) NOT NULL,
    origin_client_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (board_id, server_seq)
);

-- Idempotency: a resent op (e.g., client retried after a dropped ack) is not stored twice
CREATE UNIQUE INDEX uq_crdt_ops_idem ON crdt_operations (board_id, object_id, field_name, hlc);
