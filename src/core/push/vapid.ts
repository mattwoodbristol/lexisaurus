// VAPID (RFC 8292) authorisation for Web Push, using WebCrypto only (Workers, Node, browsers).
// Pushes are sent without a payload, so RFC 8291 payload encryption is not needed: the service
// worker fetches the message text from the API when the push arrives.

const enc = new TextEncoder();

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @param publicKey  base64url of the 65-byte uncompressed P-256 point (what browsers want as applicationServerKey)
 * @param privateKey base64url of the 32-byte private scalar (JWK "d")
 */
export async function importVapidPrivateKey(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const pub = b64urlDecode(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key must be a 65-byte uncompressed P-256 point');
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), d: privateKey, ext: true };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export interface VapidClaims {
  aud: string;
  exp: number;
  sub: string;
}

/** Signed ES256 JWT for the push service that owns `endpoint`. */
export async function vapidJwt(endpoint: string, key: CryptoKey, subject: string, nowMs = Date.now()): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims: VapidClaims = { aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: subject };
  const body = b64urlEncode(enc.encode(JSON.stringify(claims)));
  // WebCrypto ECDSA signatures are IEEE P1363 (r || s), which is exactly what JWS ES256 uses.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64urlEncode(sig)}`;
}

export function vapidAuthorization(jwt: string, publicKey: string): string {
  return `vapid t=${jwt}, k=${publicKey}`;
}

/** A new VAPID key pair as base64url strings (public: uncompressed point, private: JWK "d"). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer;
  const jwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey;
  return { publicKey: b64urlEncode(pub), privateKey: jwk.d! };
}
