import { generateRealityKeyPair, generateToken } from './keys';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
}

export async function ensureInitialDefaults(db: D1Database) {
  // Ensure JWT Secret exists
  const jwtSetting = await db.prepare('SELECT value FROM system_settings WHERE key = ?').bind('jwt_secret').first<{ value: string }>();
  if (!jwtSetting) {
    const secret = generateToken(32);
    await db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').bind('jwt_secret', secret).run();
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
  if (row?.value !== 'true') return false;
  const adminCount = await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").first<{ count: number }>();
  return (adminCount?.count || 0) > 0;
}
