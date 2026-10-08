export async function bumpConfigVersion(db: D1Database): Promise<number> {
  const row = await db.prepare(`
    INSERT INTO system_settings (key, value) VALUES ('config_version', '2')
    ON CONFLICT(key) DO UPDATE SET
      value = CAST(CAST(value AS INTEGER) + 1 AS TEXT),
      updated_at = datetime('now')
    RETURNING value
  `).first<{ value: string }>();
  return parseInt(row?.value || '2', 10);
}

export async function getConfigVersion(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM system_settings WHERE key = 'config_version'").first<{ value: string }>();
  return row ? parseInt(row.value, 10) || 1 : 1;
}
