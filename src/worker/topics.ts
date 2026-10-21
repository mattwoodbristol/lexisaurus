import { Hono } from 'hono';
import type { Env } from './env';
import { getLanguage } from '../core/languages';
import { TOPIC_SEEDS } from '../core/languages/seeds';
import { pickTopic, seededRng, type TopicCandidate } from '../core/topics/select';
import { localToday } from './day';

const seeded = new Set<string>();

/**
 * Seed the built-in topics when a language has none (once per isolate). A synced course pack
 * owns the topics after that, so removed topics are not seeded back.
 */
export async function ensureTopics(db: D1Database, lang: string): Promise<void> {
  if (seeded.has(lang)) return;
  const seeds = TOPIC_SEEDS[lang] ?? [];
  const have = await db.prepare('SELECT COUNT(*) AS n FROM topics WHERE lang = ?1').bind(lang).first<{ n: number }>();
  if (seeds.length && (have?.n ?? 0) === 0) {
    await db.batch(
      seeds.map((t) =>
        db.prepare('INSERT OR IGNORE INTO topics(lang, name, tags, scenario_seed) VALUES (?1, ?2, ?3, ?4)').bind(lang, t.name, t.tags.join(','), t.scenario),
      ),
    );
  }
  seeded.add(lang);
}

interface TopicRow {
  id: number;
  name: string;
  tags: string;
  scenario_seed: string | null;
  last_used_at: string | null;
  use_count: number;
}

export async function suggestTopic(db: D1Database, lang: string, exclude: number[] = []) {
  await ensureTopics(db, lang);
  const { results: rows } = await db.prepare('SELECT * FROM topics WHERE lang = ?1').bind(lang).all<TopicRow>();
  const { results: recent } = await db
    .prepare('SELECT topic_id FROM conversations WHERE lang = ?1 AND topic_id IS NOT NULL ORDER BY started_at DESC, id DESC LIMIT 20')
    .bind(lang)
    .all<{ topic_id: number }>();
  const candidates: TopicCandidate[] = rows.map((r) => ({ id: r.id, name: r.name, tags: r.tags ? r.tags.split(',') : [], lastUsedAt: r.last_used_at }));
  // Jitter seeded by the local date: the reminder and the home page agree on today's topic.
  const today = await localToday(db);
  let seed = 0;
  for (const ch of `${lang}:${today.date}`) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;
  const pick = pickTopic(candidates, { recentTopicIds: recent.map((r) => r.topic_id), exclude, rng: seededRng(seed) });
  const row = pick ? rows.find((r) => r.id === pick.id) : undefined;
  return row ? { id: row.id, name: row.name, tags: row.tags.split(','), scenario: row.scenario_seed, useCount: row.use_count, lastUsedAt: row.last_used_at } : null;
}

export async function markTopicUsed(db: D1Database, topicId: number): Promise<void> {
  await db
    .prepare("UPDATE topics SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), use_count = use_count + 1 WHERE id = ?1")
    .bind(topicId)
    .run();
}

export const topicRoutes = new Hono<{ Bindings: Env }>();

topicRoutes.get('/suggest', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  if (!getLanguage(lang)) return c.json({ error: 'unknown language' }, 400);
  const exclude = (c.req.query('exclude') ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  return c.json({ topic: await suggestTopic(c.env.DB, lang, exclude) });
});

topicRoutes.get('/', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  await ensureTopics(c.env.DB, lang);
  const { results } = await c.env.DB.prepare('SELECT id, name, tags, scenario_seed AS scenario, last_used_at, use_count FROM topics WHERE lang = ?1 ORDER BY name')
    .bind(lang)
    .all();
  return c.json({ topics: results });
});
