-- Migration 0007: Pure Single-Port Architecture & Admin-Only Master Templates
-- 1. Drop index on owner_id first, then drop hop_ports and owner_id from inbound_templates
-- 2. Consolidate to 5 clean protocols: VLESS, Hysteria 2, TUIC v5, Trojan, AnyTLS

DROP INDEX IF EXISTS idx_inbound_templates_owner_id;
ALTER TABLE inbound_templates DROP COLUMN hop_ports;
ALTER TABLE inbound_templates DROP COLUMN owner_id;

-- Ensure templates 1, 2, 4, 5, 6 exist and clean up any others
DELETE FROM node_inbounds WHERE template_id NOT IN (1, 2, 4, 5, 6);
DELETE FROM inbound_templates WHERE id NOT IN (1, 2, 4, 5, 6);
UPDATE inbound_templates SET name = '默认 Hysteria 2' WHERE id = 2;
