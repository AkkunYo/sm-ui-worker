-- core_version duplicated the sing-box version that is already encoded in
-- agent_version (<sing-box>-<revision>); nothing reads it any more.
ALTER TABLE nodes DROP COLUMN core_version;
