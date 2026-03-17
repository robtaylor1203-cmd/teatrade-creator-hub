/**
 * AES-256-GCM encryption/decryption for social tokens.
 * Uses the Web Crypto API (available in Deno / Edge Functions).
 *
 * Encryption key is derived from the TOKEN_ENCRYPTION_KEY env var
 * via PBKDF2 (so any passphrase length works, but 32+ chars recommended).
 *
 * Ciphertext format: base64( iv[12] + ciphertext + tag[16] )
 */

const SALT = new TextEncoder().encode('teatrade-token-v1');  // Fixed salt (OK since key is unique per deployment)

async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt a plaintext string → base64 ciphertext */
export async function encrypt(plaintext: string): Promise<string> {
  const passphrase = Deno.env.get('TOKEN_ENCRYPTION_KEY');
  if (!passphrase) throw new Error('TOKEN_ENCRYPTION_KEY not set');

  const key = await deriveKey(passphrase);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );

  // Prepend IV to ciphertext
  const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/** Decrypt a base64 ciphertext → plaintext string */
export async function decrypt(ciphertext: string): Promise<string> {
  const passphrase = Deno.env.get('TOKEN_ENCRYPTION_KEY');
  if (!passphrase) throw new Error('TOKEN_ENCRYPTION_KEY not set');

  const key = await deriveKey(passphrase);
  const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));

  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data,
  );

  return new TextDecoder().decode(plainBuf);
}
