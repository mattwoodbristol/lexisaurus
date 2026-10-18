// Generates a VAPID key pair (P-256) for Web Push and prints base64url strings.
// Store them as Worker secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
import { webcrypto } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = await webcrypto.subtle.exportKey('raw', kp.publicKey);
const jwk = await webcrypto.subtle.exportKey('jwk', kp.privateKey);
console.log('VAPID_PUBLIC_KEY=' + b64url(pub));
console.log('VAPID_PRIVATE_KEY=' + jwk.d);
