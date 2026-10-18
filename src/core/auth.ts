// Single-user passphrase auth with an HMAC-signed, expiring session token.
// Framework-agnostic: uses only WebCrypto, so it runs in Workers, Node and tests.

const enc = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return toBase64Url(sig);
}

async function sha256(data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(data)));
}

/** Constant-time comparison of two byte arrays. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Compare a submitted passphrase to the configured one without leaking length or prefix. */
export async function passphraseMatches(submitted: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  return constantTimeEqual(await sha256(submitted), await sha256(expected));
}

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Token format: `<expiresAtUnixSeconds>.<base64url(HMAC-SHA256(secret, "session:" + expiresAt))>` */
export async function signSession(secret: string, nowMs = Date.now(), ttlSeconds = SESSION_TTL_SECONDS): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  return `${exp}.${await hmac(secret, `session:${exp}`)}`;
}

export async function verifySession(secret: string, token: string | undefined, nowMs = Date.now()): Promise<boolean> {
  if (!secret || !token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(expStr) || !sig) return false;
  const exp = Number(expStr);
  if (exp * 1000 <= nowMs) return false;
  const expected = await hmac(secret, `session:${exp}`);
  return constantTimeEqual(enc.encode(sig), enc.encode(expected));
}
