// Generated listening practice: Claude writes a dialogue or story at the learner's level from
// the words they are learning and the grammar studied last; the app reads it aloud, marks the
// comprehension questions itself and measures how much of the text the learner already knows.
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import { callStructured, claudeErrorResponse } from './claude';
import { annotateStrings } from './annotate';
import { targetWords } from './words';
import { levelCheck } from './level';
import { learnerProfile } from './learner';
import { getSetting } from './day';
import { getLanguage } from '../core/languages';
import { DEFAULT_NATIVE, nativeLanguage } from '../core/languages/native';
import { rulesFor } from '../core/text/rules';
import { stripPinyin } from '../core/pinyin/strip';
import { LISTENING_KINDS, knownShare, listeningProblems, type ListeningContent, type ListeningKind } from '../core/listening/types';
import { listeningPrompt } from '../../prompts/listening.v1';

export const listeningRoutes = new Hono<{ Bindings: Env }>();

const Generated = z.object({
  title: z.string(),
  lines: z.array(z.object({ speaker: z.string().nullable(), text: z.string(), translation: z.string() })),
  questions: z.array(z.object({ question: z.string(), options: z.array(z.string()), answer: z.number().int() })),
});

interface Row {
  id: number;
  lang: string;
  kind: ListeningKind;
  title: string;
  content_json: string;
  known_share: number | null;
  score: number | null;
  total: number | null;
  done_at: string | null;
  created_at: string;
}

/** The grammar of the lesson worked on most recently, to recycle in the passage. */
async function recentPattern(db: D1Database, lang: string): Promise<string | null> {
  const r = await db
    .prepare(
      `SELECT l.title, json_extract(l.content_json, '$.pattern') AS pattern FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id
       WHERE l.lang = ?1 ORDER BY p.updated_at DESC LIMIT 1`,
    )
    .bind(lang)
    .first<{ title: string; pattern: string | null }>();
  return r ? (r.pattern ? `${r.title} (${r.pattern})` : r.title) : null;
}

/** A situation for the passage: a topic from the language's rotation, picked at random. */
async function situation(db: D1Database, lang: string): Promise<string> {
  const r = await db.prepare('SELECT name, scenario_seed FROM topics WHERE lang = ?1 ORDER BY random() LIMIT 1').bind(lang).first<{ name: string; scenario_seed: string | null }>();
  return r ? (r.scenario_seed ? `${r.name}: ${r.scenario_seed}` : r.name) : 'Everyday life';
}

listeningRoutes.get('/', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const { results } = await c.env.DB.prepare(
    'SELECT id, kind, title, known_share, score, total, done_at, created_at FROM listenings WHERE lang = ?1 ORDER BY created_at DESC LIMIT 20',
  )
    .bind(lang)
    .all<Omit<Row, 'lang' | 'content_json'>>();
  return c.json({ items: results });
});

listeningRoutes.post('/generate', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { lang?: unknown; kind?: unknown };
  const language = typeof body.lang === 'string' ? getLanguage(body.lang) : undefined;
  if (!language) return c.json({ error: 'unknown language' }, 400);
  const kind: ListeningKind = LISTENING_KINDS.includes(body.kind as ListeningKind) ? (body.kind as ListeningKind) : 'dialogue';
  const db = c.env.DB;
  const [measured, words, pattern, topic, profile, nativeCode] = await Promise.all([
    levelCheck(db, language.id),
    targetWords(db, language.id, 8),
    recentPattern(db, language.id),
    situation(db, language.id),
    learnerProfile(db, language.id),
    getSetting<unknown>(db, 'native_lang', DEFAULT_NATIVE),
  ]);
  const native = nativeLanguage(nativeCode);
  const han = language.hasRomanisation;
  const request = [
    `Write a ${kind}.`,
    `Learner level: ${measured?.text ?? language.userLevel}`,
    words.length ? `Words the learner is learning (use some where natural): ${words.join(han ? '、' : ', ')}` : 'No learning words: use only common words for the level.',
    pattern ? `Grammar studied last: ${pattern}` : null,
    `Situation: ${topic}`,
    profile ? `About the learner (use lightly): ${profile}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  const hasTarget = rulesFor(language.script).hasTarget;
  try {
    const out = await callStructured(c.env, {
      role: 'listening',
      effort: 'medium',
      system: [listeningPrompt({ langName: language.name, nativeName: native.english, han })],
      messages: [{ role: 'user', content: request }],
      maxTokens: 4000,
      schema: Generated,
      extraCheck: (v) => listeningProblems({ ...v, kind }, hasTarget),
    });
    const content: ListeningContent = {
      title: out.title.trim(),
      kind,
      lines: out.lines.map((l) => ({
        speaker: kind === 'dialogue' ? (l.speaker?.trim() ?? null) : null,
        text: (han ? stripPinyin(l.text) : l.text).trim(),
        translation: l.translation.trim(),
      })),
      questions: out.questions.map((q) => ({ question: q.question.trim(), options: q.options.map((o) => o.trim()), answer: q.answer })),
    };
    const ann = await annotateStrings(db, language.id, content.lines.map((l) => l.text));
    const share = knownShare(content.lines.map((l) => ann[l.text] ?? []));
    const row = await db
      .prepare('INSERT INTO listenings(lang, kind, title, content_json, known_share) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id')
      .bind(language.id, kind, content.title, JSON.stringify(content), share)
      .first<{ id: number }>();
    return c.json({ id: row!.id });
  } catch (e) {
    const { status, body: err } = claudeErrorResponse(e);
    return c.json(err, status);
  }
});

listeningRoutes.get('/:id{[0-9]+}', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM listenings WHERE id = ?1').bind(Number(c.req.param('id'))).first<Row>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const content = JSON.parse(row.content_json) as ListeningContent;
  // Annotated now, not when written: words learnt since then lose their pinyin.
  const annotations = await annotateStrings(c.env.DB, row.lang, content.lines.map((l) => l.text));
  return c.json({
    listening: { id: row.id, lang: row.lang, score: row.score, total: row.total, doneAt: row.done_at, createdAt: row.created_at, knownShare: knownShare(content.lines.map((l) => annotations[l.text] ?? [])), ...content },
    annotations,
  });
});

listeningRoutes.post('/:id{[0-9]+}/result', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { score?: unknown; total?: unknown };
  const score = Number(body.score);
  const total = Number(body.total);
  if (!Number.isInteger(score) || !Number.isInteger(total) || total <= 0 || score < 0 || score > total) return c.json({ error: 'score and total required' }, 400);
  const r = await c.env.DB.prepare("UPDATE listenings SET score = ?1, total = ?2, done_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?3")
    .bind(score, total, Number(c.req.param('id')))
    .run();
  if (!r.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});
