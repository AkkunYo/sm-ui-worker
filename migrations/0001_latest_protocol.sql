-- Latest Worker/Agent protocol. Apply against the existing sm-ui-db only.
-- This migration preserves all node, user, template and subscription IDs/tokens.
ALTER TABLE nodes ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 2;
ALTER TABLE nodes ADD COLUMN desired_state TEXT NOT NULL DEFAULT 'active';
ALTER TABLE nodes ADD COLUMN revoked_at TEXT;
ALTER TABLE nodes ADD COLUMN desired_config_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE nodes ADD COLUMN desired_config_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN applied_config_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN applied_config_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN last_apply_error TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN address_locked INTEGER NOT NULL DEFAULT 0;

UPDATE nodes
SET desired_config_version = COALESCE(config_version, 1),
    protocol_version = 2,
    desired_state = CASE WHEN status = 'disabled' THEN 'disabled' ELSE 'active' END,
    address_locked = CASE WHEN TRIM(COALESCE(server_ip, '')) <> '' THEN 1 ELSE 0 END
WHERE desired_config_version = 1;

CREATE TABLE IF NOT EXISTS traffic_receipts (
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  uplink_bytes INTEGER NOT NULL DEFAULT 0,
  downlink_bytes INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (node_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_traffic_receipts_received_at ON traffic_receipts(received_at);
