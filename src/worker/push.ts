// Web Push: subscriptions, sending (VAPID, no payload), and the message the service worker
// fetches when a push arrives.
import { Hono } from 'hono';
import type { Env } from './env';
import { importVapidPrivateKey, vapidJwt, vapidAuthorization } from '../core/push/vapid';
import { computeSession, toState } from './session';
import { composeReminder } from '../core/notify/schedule';
import { localToday, enabledLanguages } from './day';
import { appKeys, pushSubject, rememberOrigin } from './keys';

export interface Notice {
  lang: string;
  slot: string;
  title: string;
  body: string;
  url: string;
}

let keyCache: { pub: string; key: CryptoKey } | null = null;

async function vapidKey(env: Env): Promise<{ pub: string; key: CryptoKey }> {
  const { vapidPublicKey, vapidPrivateKey } = await appKeys(env);
  if (keyCache?.pub !== vapidPublicKey) keyCache = { pub: vapidPublicKey, key: await importVapidPrivateKey(vapidPublicKey, vapidPrivateKey) };
  return keyCache;
}

/** Log the notice (the service worker reads the latest one), then push to every subscription. */
export async function sendNotice(env: Env, n: Notice): Promise<{ sent: number; removed: number; statuses: number[] }> {
  const today = await localToday(env.DB);
  const logged = await env.DB.prepare(
    'INSERT INTO notifications_log(lang, local_date, slot, title, body, url) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT DO NOTHING RETURNING id',
  )
    .bind(n.lang, today.date, n.slot, n.title, n.body, n.url)
    .first<{ id: number }>();
  if (!logged) return { sent: 0, removed: 0, statuses: [] }; // slot already sent today

  const { pub, key } = await vapidKey(env);
  const subject = await pushSubject(env);
  const { results: subs } = await env.DB.prepare('SELECT endpoint FROM push_subscriptions').all<{ endpoint: string }>();
  let sent = 0;
  let removed = 0;
  const statuses: number[] = [];
  for (const { endpoint } of subs) {
    let status = 0;
    try {
      const jwt = await vapidJwt(endpoint, key, subject);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: vapidAuthorization(jwt, pub), TTL: String(4 * 3600), Urgency: 'normal', 'Content-Length': '0' },
      });
      status = res.status;
    } catch (e) {
      console.error('push failed', endpoint.slice(0, 60), e);
    }
    statuses.push(status);
    if (status >= 200 && status < 300) sent++;
    if (status === 404 || status === 410) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(endpoint).run(); // expired subscription
      removed++;
    } else {
      await env.DB.prepare("UPDATE push_subscriptions SET last_status = ?1, last_sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE endpoint = ?2").bind(status, endpoint).run();
    }
  }
  await env.DB.prepare('UPDATE notifications_log SET sent_to = ?1 WHERE id = ?2').bind(sent, logged.id).run();
  return { sent, removed, statuses };
}

export const pushRoutes = new Hono<{ Bindings: Env }>();

pushRoutes.get('/vapid-key', async (c) => c.json({ publicKey: (await appKeys(c.env)).vapidPublicKey }));

pushRoutes.post('/subscribe', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { endpoint?: unknown; keys?: unknown };
  if (typeof body.endpoint !== 'string' || !/^https:\/\//.test(body.endpoint)) return c.json({ error: 'endpoint required' }, 400);
  await c.env.DB.prepare('INSERT INTO push_subscriptions(endpoint, keys_json) VALUES (?1, ?2) ON CONFLICT(endpoint) DO UPDATE SET keys_json = excluded.keys_json')
    .bind(body.endpoint, JSON.stringify(body.keys ?? {}))
    .run();
  await rememberOrigin(c.env, c.req.url);
  return c.json({ ok: true });
});

pushRoutes.post('/unsubscribe', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { endpoint?: unknown };
  if (typeof body.endpoint === 'string') await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(body.endpoint).run();
  return c.json({ ok: true });
});

pushRoutes.get('/status', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT substr(endpoint, 1, 40) AS endpoint, created_at, last_status, last_sent_at FROM push_subscriptions').all();
  const { results: recent } = await c.env.DB.prepare('SELECT lang, local_date, slot, title, body, sent_to, created_at FROM notifications_log ORDER BY id DESC LIMIT 10').all();
  return c.json({ configured: true, subscriptions: results, recent });
});

/** Send a reminder now, with today's real content. */
pushRoutes.post('/test', async (c) => {
  const lang = (await enabledLanguages(c.env.DB))[0] ?? 'zh';
  const s = await computeSession(c.env.DB, lang);
  const msg = composeReminder(toState(s), new Date().toISOString().slice(11, 16));
  try {
    const r = await sendNotice(c.env, { lang, slot: 'test', title: msg.title, body: msg.body, url: '/#/' });
    return c.json({ ok: true, ...r });
  } catch (e) {
    return c.json({ error: 'push_failed', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

/** What the service worker shows: the most recent notice (pushes carry no payload). */
pushRoutes.get('/latest', async (c) => {
  const n = await c.env.DB.prepare('SELECT title, body, url, lang, slot FROM notifications_log ORDER BY id DESC LIMIT 1').first();
  return c.json(n ?? { title: 'Lexisaurus', body: 'Time to practise.', url: '/#/' });
});
