-- Migration 0005: Master Template Ports & Multi-Protocol Expansion
-- 1. inbound_templates defines listen_port, hop_ports, hy2_obfs_password, tuic_congestion_control
-- 2. nodes drops obsolete proxy_port, hop_ports; adds cert_sha256 for cert pinning
-- 3. node_inbounds rebuilt to link node_id and template_id only; ports inherited from template

ALTER TABLE inbound_templates ADD COLUMN listen_port INTEGER NOT NULL DEFAULT 2096;
ALTER TABLE inbound_templates ADD COLUMN hop_ports TEXT DEFAULT '';
ALTER TABLE inbound_templates ADD COLUMN hy2_obfs_password TEXT DEFAULT '';
ALTER TABLE inbound_templates ADD COLUMN tuic_congestion_control TEXT DEFAULT 'bbr';

ALTER TABLE nodes ADD COLUMN cert_sha256 TEXT DEFAULT '';
ALTER TABLE nodes DROP COLUMN proxy_port;
ALTER TABLE nodes DROP COLUMN hop_ports;

-- Update existing default templates
UPDATE inbound_templates SET name = '默认 Hysteria 2 (单端口)', listen_port = 2096, hop_ports = '' WHERE id = 2;
UPDATE inbound_templates SET listen_port = 2096 WHERE id = 1;

-- Seed default Hysteria 2 (端口跳跃), TUIC v5, Trojan Reality, AnyTLS
INSERT INTO inbound_templates (
  owner_id, name, protocol, listen_port, hop_ports, hy2_up_mbps, hy2_down_mbps, hy2_masquerade, is_default
) VALUES (
  NULL, '默认 Hysteria 2 (端口跳跃)', 'hysteria2', 2096, '22200-22300', 100, 100, 'https://bing.com', 0
);

INSERT INTO inbound_templates (
  owner_id, name, protocol, listen_port, tuic_congestion_control, is_default
) VALUES (
  NULL, '默认 TUIC v5', 'tuic', 8443, 'bbr', 0
);

INSERT INTO inbound_templates (
  owner_id, name, protocol, listen_port, reality_dest, reality_server_name, reality_short_id, is_default
) VALUES (
  NULL, '默认 Trojan Reality', 'trojan', 443, 'www.amazon.com:443', 'www.amazon.com', '30ecd9e5f5a5cfb5', 0
);

INSERT INTO inbound_templates (
  owner_id, name, protocol, listen_port, is_default
) VALUES (
  NULL, '默认 AnyTLS', 'anytls', 10443, 0
);

-- Rebuild node_inbounds: retain (node_id, template_id, enabled)
CREATE TABLE node_inbounds_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  template_id INTEGER NOT NULL REFERENCES inbound_templates(id) ON DELETE CASCADE,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(node_id, template_id)
);

INSERT INTO node_inbounds_new (id, node_id, template_id, enabled)
SELECT MIN(id), node_id, template_id, enabled FROM node_inbounds GROUP BY node_id, template_id;

-- Bind US-Aliyun (node_id = 2) to the new Hysteria 2 (端口跳跃) template (id = 3)
INSERT OR IGNORE INTO node_inbounds_new (node_id, template_id, enabled)
SELECT 2, id, 1 FROM inbound_templates WHERE name = '默认 Hysteria 2 (端口跳跃)';

DROP TABLE node_inbounds;
ALTER TABLE node_inbounds_new RENAME TO node_inbounds;
CREATE INDEX IF NOT EXISTS idx_node_inbounds_template_id ON node_inbounds(template_id);
