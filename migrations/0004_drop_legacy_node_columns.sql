-- Drop obsolete legacy columns from nodes table:
-- 1. protocol (unused in v2; protocols are defined in node_inbounds)
-- 2. protocol_version (unused; protocol version is verified from heartbeat payload)

ALTER TABLE nodes DROP COLUMN protocol;
ALTER TABLE nodes DROP COLUMN protocol_version;

-- Clean up expired traffic receipts older than 3 days (agent heartbeats are 30s)
DELETE FROM traffic_receipts WHERE received_at < datetime('now', '-3 days');
