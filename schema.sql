-- Cloudflare D1 Database Schema for SM-UI Worker (Multi-Tenant Edition)

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- 'admin' | 'user'
  uuid TEXT UNIQUE NOT NULL,
  proxy_password TEXT NOT NULL,
  sub_token TEXT UNIQUE NOT NULL,
  status INTEGER DEFAULT 1,
  traffic_limit_bytes INTEGER DEFAULT 0,
  used_up_bytes INTEGER DEFAULT 0,
  used_down_bytes INTEGER DEFAULT 0,
  expire_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  server_ip TEXT NOT NULL DEFAULT '',
  proxy_port INTEGER DEFAULT 443,
  hop_ports TEXT DEFAULT '',
  protocol TEXT DEFAULT 'all',
  token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'offline',
  last_heartbeat_at TEXT,
  rtt_ms INTEGER DEFAULT 0,
  cpu_percent REAL DEFAULT 0,
  memory_percent REAL DEFAULT 0,
  uptime_seconds INTEGER DEFAULT 0,
  used_up_bytes INTEGER DEFAULT 0,
  used_down_bytes INTEGER DEFAULT 0,
  core_version TEXT DEFAULT 'v1.14.2',
  agent_version TEXT DEFAULT '',
  config_version INTEGER DEFAULT 1,
  protocol_version INTEGER DEFAULT 2,
  desired_state TEXT NOT NULL DEFAULT 'active',
  revoked_at TEXT,
  desired_config_version INTEGER DEFAULT 1,
  desired_config_hash TEXT DEFAULT '',
  applied_config_version INTEGER DEFAULT 0,
  applied_config_hash TEXT DEFAULT '',
  last_apply_error TEXT DEFAULT '',
  address_locked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(owner_id, name)
);

CREATE TABLE IF NOT EXISTS inbound_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL, -- 'vless' | 'hysteria2'
  reality_dest TEXT,
  reality_server_name TEXT,
  reality_private_key TEXT,
  reality_public_key TEXT,
  reality_short_id TEXT,
  hy2_up_mbps INTEGER DEFAULT 100,
  hy2_down_mbps INTEGER DEFAULT 100,
  hy2_masquerade TEXT DEFAULT 'https://bing.com',
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS node_inbounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  template_id INTEGER NOT NULL REFERENCES inbound_templates(id) ON DELETE RESTRICT,
  listen_port INTEGER NOT NULL DEFAULT 2096,
  hop_ports TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(node_id, template_id, listen_port)
);

CREATE INDEX IF NOT EXISTS idx_node_inbounds_template_id ON node_inbounds(template_id);
CREATE INDEX IF NOT EXISTS idx_inbound_templates_owner_id ON inbound_templates(owner_id);

CREATE TABLE IF NOT EXISTS traffic_receipts (
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  uplink_bytes INTEGER NOT NULL DEFAULT 0,
  downlink_bytes INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (node_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_traffic_receipts_received_at ON traffic_receipts(received_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  first_fail_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);

