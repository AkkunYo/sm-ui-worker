-- Clean up legacy columns removed in architecture overhaul:
-- 1. reality_private_key and reality_public_key from inbound_templates (Reality keys belong to users table per tenant)
-- 2. config_version from nodes (replaced by desired_config_version and applied_config_version)

ALTER TABLE inbound_templates DROP COLUMN reality_private_key;
ALTER TABLE inbound_templates DROP COLUMN reality_public_key;
ALTER TABLE nodes DROP COLUMN config_version;
