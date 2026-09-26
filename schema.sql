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
  protocol TEXT DEFAULT 'all',
  token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'offline',
  last_heartbeat_at TEXT,
  rtt_ms INTEGER DEFAULT 0,
  cpu_percent REAL DEFAULT 0,
  memory_percent REAL DEFAULT 0,
  uptime_seconds INTEGER DEFAULT 0,
  core_version TEXT DEFAULT 'v1.11.4',
  config_version INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(owner_id, name)
);

CREATE TABLE IF NOT EXISTS inbound_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  reality_dest TEXT DEFAULT 'www.amazon.com:443',
  reality_server_name TEXT DEFAULT 'www.amazon.com',
  reality_private_key TEXT NOT NULL,
  reality_public_key TEXT NOT NULL,
  reality_short_id TEXT DEFAULT '0123456789abcdef',
  hy2_up_mbps INTEGER DEFAULT 100,
  hy2_down_mbps INTEGER DEFAULT 100,
  hy2_masquerade TEXT DEFAULT 'https://bing.com',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
