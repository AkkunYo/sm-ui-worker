import { generateRealityKeyPair, generateToken } from './keys';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
}

export async function ensureInitialDefaults(db: D1Database) {
  // 1. Ensure JWT Secret exists
  const jwtSetting = await db.prepare('SELECT value FROM system_settings WHERE key = ?').bind('jwt_secret').first<{ value: string }>();
  if (!jwtSetting) {
    const secret = generateToken(32);
    await db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').bind('jwt_secret', secret).run();
  }

  // 2. Ensure InboundTemplate exists
  const templateCount = await db.prepare('SELECT COUNT(*) as count FROM inbound_templates').first<{ count: number }>();
  if (!templateCount || templateCount.count === 0) {
    const keys = generateRealityKeyPair();
    const shortId = generateToken(16);
    await db.prepare(`
      INSERT INTO inbound_templates (
        reality_dest, reality_server_name, reality_private_key, reality_public_key, reality_short_id,
        hy2_up_mbps, hy2_down_mbps, hy2_masquerade
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      'www.amazon.com:443',
      'www.amazon.com',
      keys.privateKey,
      keys.publicKey,
      shortId,
      100,
      100,
      'https://bing.com'
    ).run();
  }
}

export async function getJwtSecret(db: D1Database): Promise<string> {
  const row = await db.prepare('SELECT value FROM system_settings WHERE key = ?').bind('jwt_secret').first<{ value: string }>();
  if (row && row.value) {
    return row.value;
  }
  const fallback = generateToken(32);
  await db.prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)').bind('jwt_secret', fallback).run();
  return fallback;
}

export async function isSetupCompleted(db: D1Database): Promise<boolean> {
  const row = await db.prepare('SELECT value FROM system_settings WHERE key = ?').bind('setup_completed').first<{ value: string }>();
  return row?.value === 'true';
}
