import { x25519 } from '@noble/curves/ed25519';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function generateRealityKeyPair(): { privateKey: string; publicKey: string } {
  const priv = x25519.utils.randomPrivateKey();
  const pub = x25519.getPublicKey(priv);
  return {
    privateKey: toBase64Url(priv),
    publicKey: toBase64Url(pub)
  };
}

export function generateToken(length = 32): string {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateUUID(): string {
  return crypto.randomUUID();
}
