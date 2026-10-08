const STORED_HASH_RE = /^[0-9a-f]{32}:[0-9a-f]{64}$/i;
export const DUMMY_PASSWORD_HASH = `${'0'.repeat(32)}:${'0'.repeat(64)}`;

export async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
  return `${toHex(salt)}:${toHex(new Uint8Array(derived))}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!STORED_HASH_RE.test(storedHash || '')) {
    return false;
  }
  const [saltHex, hashHex] = storedHash.split(':');
  const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  const salt = fromHex(saltHex);
  const expected = fromHex(hashHex);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return crypto.subtle.timingSafeEqual(new Uint8Array(derived), expected);
}

export async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
