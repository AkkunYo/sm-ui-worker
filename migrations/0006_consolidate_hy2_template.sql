-- Migration 0006: Consolidate Hysteria 2 into single unified template
-- Merge template 3 (hop) into template 2 (base Hysteria 2 with hop_ports enabled)

UPDATE inbound_templates
SET name = '默认 Hysteria 2',
    hop_ports = '22200-22300'
WHERE id = 2;

INSERT OR IGNORE INTO node_inbounds (node_id, template_id, enabled)
SELECT node_id, 2, enabled FROM node_inbounds WHERE template_id = 3;

DELETE FROM node_inbounds WHERE template_id = 3;
DELETE FROM inbound_templates WHERE id = 3;
