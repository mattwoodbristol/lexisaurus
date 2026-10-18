// The Worker's own keys: session signing and Web Push (VAPID). A secret set on the Worker wins
// (older installs set them by hand); otherwise they are generated on first use and kept in D1
// (app_keys), so a new owner only supplies a passphrase and an API key.
import type { Env } from './env';
import { b64urlEncode, generateVapidKeys } from '../core/push/vapid';

export interface AppKeys {
  sessionSecret: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
}

let cache: AppKeys | null = null;

async function stored(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare('SELECT name, value FROM app_keys').all<{ name: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.name, r.value]));
}

export async function appKeys(env: Env): Promise<AppKeys> {
  if (cache) return cache;
  let kept = await stored(env.DB);
  const missing: [string, string][] = [];
  if (!env.SESSION_SECRET && !kept.session_secret) missing.push(['session_secret', b64urlEncode(crypto.getRandomValues(new Uint8Array(32)))]);
  if (!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) && !(kept.vapid_public && kept.vapid_private)) {
    const v = await generateVapidKeys();
    missing.push(['vapid_public', v.publicKey], ['vapid_private', v.privateKey]);
  }
  if (missing.length) {
    // INSERT OR IGNORE, then read back: if two first requests race, both end up with the winner's keys.
    await env.DB.batch(missing.map(([n, v]) => env.DB.prepare('INSERT OR IGNORE INTO app_keys(name, value) VALUES (?1, ?2)').bind(n, v)));
    kept = await stored(env.DB);
  }
  const vapidFromEnv = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  const keys = {
    sessionSecret: env.SESSION_SECRET || kept.session_secret,
    vapidPublicKey: vapidFromEnv ? env.VAPID_PUBLIC_KEY : kept.vapid_public,
    vapidPrivateKey: vapidFromEnv ? env.VAPID_PRIVATE_KEY : kept.vapid_private,
  };
  if (!keys.sessionSecret || !keys.vapidPublicKey || !keys.vapidPrivateKey) throw new Error('app keys missing (is migration 0021 applied?)');
  cache = keys as AppKeys;
  return cache;
}

/**
 * Web Push "subject": the configured VAPID_SUBJECT, else the app's own address (remembered when a
 * device subscribes; push services, Apple's especially, reject made-up ones).
 */
export async function pushSubject(env: Env): Promise<string> {
  if (env.VAPID_SUBJECT) return env.VAPID_SUBJECT;
  const row = await env.DB.prepare("SELECT value FROM app_keys WHERE name = 'app_origin'").first<{ value: string }>();
  return row?.value ?? 'mailto:tutor@example.com';
}

export async function rememberOrigin(env: Env, url: string): Promise<void> {
  const origin = new URL(url).origin;
  if (!origin.startsWith('https://')) return;
  await env.DB.prepare("INSERT INTO app_keys(name, value) VALUES ('app_origin', ?1) ON CONFLICT(name) DO UPDATE SET value = excluded.value").bind(origin).run();
}
