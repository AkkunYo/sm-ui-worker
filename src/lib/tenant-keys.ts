import { generateRealityKeyPair } from '../keys';

/**
 * Give every listed tenant its own Reality key pair if it has none yet.
 * The conditional UPDATE makes concurrent callers converge on the first
 * written pair instead of overwriting each other.
 */
export async function ensureTenantRealityKeys(db: D1Database, userIds: number[]): Promise<void> {
  const ids = [...new Set(userIds)].filter(id => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return;
  await db.batch(ids.map(id => {
    const keys = generateRealityKeyPair();
    return db.prepare(`
      UPDATE users SET reality_private_key = ?, reality_public_key = ?
      WHERE id = ? AND COALESCE(reality_private_key, '') = ''
    `).bind(keys.privateKey, keys.publicKey, id);
  }));
}
