-- Per-tenant Reality key pairs. VLESS inbounds take their key material from
-- the node owner instead of the (possibly shared) template, so one tenant's
-- VPS never receives another tenant's private key.
-- Empty keys are generated lazily by the Worker on first use.
ALTER TABLE users ADD COLUMN reality_private_key TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN reality_public_key TEXT NOT NULL DEFAULT '';
