import { Hono } from 'hono';
import type { Env } from './env';

// Settings are JSON-encoded values keyed by dotted names, e.g. 'zh.pinyin_mode' -> '"smart"'.
export const settingsRoutes = new Hono<{ Bindings: Env }>();

const KEY_RE = /^[a-z][a-z0-9_.]{0,63}$/;

settingsRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT key, value FROM settings ORDER BY key').all<{ key: string; value: string }>();
  const out: Record<string, unknown> = {};
  for (const row of results) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return c.json(out);
});

settingsRoutes.put('/:key', async (c) => {
  const key = c.req.param('key');
  if (!KEY_RE.test(key)) return c.json({ error: 'bad key' }, 400);
  let body: { value?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (!body || !('value' in body)) return c.json({ error: 'value required' }, 400);
  await c.env.DB.prepare('INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(body.value))
    .run();
  return c.json({ ok: true, key, value: body.value });
});

// Tables left out of the backup: caches that rebuild themselves, logs, search index shadows and
// push subscriptions (device keys).
const EXPORT_SKIP = /^(sqlite_|_cf_|lessons_fts|gloss_cache$|exercises$|usage_log$|notifications_log$|push_subscriptions$)/;

/** A full backup of your data as one JSON file (Settings → Back up). */
settingsRoutes.get('/export', async (c) => {
  const db = c.env.DB;
  const { results: tables } = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>();
  const names = tables.map((t) => t.name).filter((n) => !EXPORT_SKIP.test(n));
  const rows = await db.batch(names.map((n) => db.prepare(`SELECT * FROM "${n}"`)));
  const out: Record<string, unknown[]> = {};
  names.forEach((n, i) => (out[n] = rows[i]!.results));
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify({ app: 'language-tutor', exportedAt: new Date().toISOString(), tables: out }), {
    headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="language-tutor-backup-${date}.json"` },
  });
});
