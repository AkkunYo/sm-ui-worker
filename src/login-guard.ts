export interface GuardKeyConfig {
  key: string;
  maxAttempts: number;
}

const WINDOW_MS = 15 * 60 * 1000; // 15-minute sliding failure window
const LOCK_MS = 15 * 60 * 1000;   // 15-minute lockout

export function loginGuardKeys(clientIp: string, username: string): GuardKeyConfig[] {
  const keys: GuardKeyConfig[] = [];
  const cleanIp = (clientIp || '').trim();
  const cleanUser = (username || '').trim().toLowerCase();
  if (cleanIp) {
    keys.push({ key: `ip:${cleanIp}`, maxAttempts: 5 });
  }
  if (cleanUser) {
    keys.push({ key: `user:${cleanUser}`, maxAttempts: 10 });
  }
  return keys;
}

export async function getLockRemaining(db: D1Database, keys: { key: string }[]): Promise<number> {
  if (keys.length === 0) return 0;
  const now = Date.now();
  const placeholders = keys.map(() => '?').join(',');
  const keyValues = keys.map(k => k.key);
  try {
    const rows = await db
      .prepare(`SELECT locked_until FROM login_attempts WHERE key IN (${placeholders}) AND locked_until > ?`)
      .bind(...keyValues, now)
      .all<{ locked_until: number }>();
    if (!rows.results || rows.results.length === 0) return 0;
    const maxLock = Math.max(...rows.results.map(r => r.locked_until));
    return Math.max(0, Math.ceil((maxLock - now) / 1000));
  } catch {
    return 0;
  }
}

export async function recordLoginFailure(db: D1Database, keys: GuardKeyConfig[]): Promise<void> {
  if (keys.length === 0) return;
  const now = Date.now();
  for (const { key, maxAttempts } of keys) {
    try {
      const existing = await db
        .prepare('SELECT fail_count, first_fail_at, locked_until FROM login_attempts WHERE key = ?')
        .bind(key)
        .first<{ fail_count: number; first_fail_at: number; locked_until: number }>();

      if (!existing || (now - existing.first_fail_at > WINDOW_MS && existing.locked_until <= now)) {
        await db.prepare(`
          INSERT INTO login_attempts (key, fail_count, first_fail_at, locked_until)
          VALUES (?, 1, ?, 0)
          ON CONFLICT(key) DO UPDATE SET
            fail_count = 1,
            first_fail_at = excluded.first_fail_at,
            locked_until = 0
        `).bind(key, now).run();
      } else {
        const nextCount = existing.fail_count + 1;
        const lockUntil = nextCount >= maxAttempts ? now + LOCK_MS : 0;
        await db.prepare(`
          UPDATE login_attempts
          SET fail_count = ?, locked_until = ?
          WHERE key = ?
        `).bind(nextCount, lockUntil, key).run();
      }
    } catch {
      // Non-blocking on tracking failure
    }
  }

  // Opportunistic cleanup of stale entries
  db.prepare('DELETE FROM login_attempts WHERE locked_until <= ? AND ? - first_fail_at > ?')
    .bind(now, now, WINDOW_MS * 2)
    .run()
    .catch(() => {});
}

export async function clearLoginFailures(db: D1Database, keys: { key: string }[]): Promise<void> {
  if (keys.length === 0) return;
  const placeholders = keys.map(() => '?').join(',');
  try {
    await db.prepare(`DELETE FROM login_attempts WHERE key IN (${placeholders})`).bind(...keys.map(k => k.key)).run();
  } catch {
    // Non-blocking
  }
}
