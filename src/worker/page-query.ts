// "Query this page": the learner flags something on any screen that looks wrong. Sonnet checks it;
// on a lesson it may rewrite the faulty sections, which the learner can apply to the lesson.
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import { callStructured, claudeErrorResponse, StructuredOutputError } from './claude';
import { explainFor } from './explain';
import { getLanguage } from '../core/languages';
import { renderLessonMd, validateLesson, type LessonContent } from '../core/lessons/types';
import { applyFix, hasFix, type LessonFix } from '../core/lessons/fix';
import { pageQueryPrompt } from '../../prompts';

export const pageQueryRoutes = new Hono<{ Bindings: Env }>();

const Pair = z.object({ zh: z.string(), en: z.string() });
const Fix = z.object({
  explanation: z.array(z.string()).nullable(),
  examples: z.array(Pair).nullable(),
  drills: z.array(Pair).nullable(),
  keyPoints: z.array(z.string()).nullable(),
});
const Verdict = z.object({ contentWrong: z.boolean(), explanation: z.string(), fix: Fix });

interface LessonRow {
  id: number;
  lang: string;
  title: string;
  content_json: string;
}
// The table from migration 0026, made here too in case a deploy skipped the migrations (the
// migration then finds it in place).
const TABLE = `CREATE TABLE IF NOT EXISTS page_queries (
  id INTEGER PRIMARY KEY, lang TEXT NOT NULL, screen TEXT NOT NULL,
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL, note TEXT NOT NULL, page_text TEXT NOT NULL,
  content_wrong INTEGER NOT NULL, explanation TEXT NOT NULL, fix_json TEXT, status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`;
let tableReady = false;
async function ensureTable(db: D1Database) {
  if (tableReady) return;
  await db.prepare(TABLE).run();
  tableReady = true;
}

const lessonRow = (db: D1Database, id: number) => db.prepare('SELECT id, lang, title, content_json FROM lessons WHERE id = ?1').bind(id).first<LessonRow>();

pageQueryRoutes.post('/', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { lang?: string; screen?: string; lessonId?: number; text?: string; note?: string };
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const note = str(b.note, 1000);
  const text = str(b.text, 8000);
  if (!note) return c.json({ error: 'Say what looks wrong' }, 400);
  // Before the Claude call, so a database problem does not waste one.
  await ensureTable(c.env.DB);
  const lesson = Number.isInteger(b.lessonId) ? await lessonRow(c.env.DB, b.lessonId!) : null;
  const lang = lesson?.lang ?? (getLanguage(str(b.lang, 10)) ? str(b.lang, 10) : 'zh');
  const language = getLanguage(lang) ?? getLanguage('zh')!;
  const content = lesson ? (JSON.parse(lesson.content_json) as LessonContent) : null;
  const question = [
    `Screen: ${str(b.screen, 40) || 'unknown'}`,
    `On screen:\n${text || '(nothing captured)'}`,
    content ? `Lesson content:\n${JSON.stringify(content)}` : '',
    `What the learner thinks is wrong: ${note}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  let verdict: z.infer<typeof Verdict>;
  try {
    verdict = await callStructured(c.env, {
      role: 'lessons',
      effort: 'medium',
      system: [pageQueryPrompt(language.name), (await explainFor(c.env.DB, lang)).instruction],
      messages: [{ role: 'user', content: question }],
      maxTokens: 6000,
      schema: Verdict,
      // A rewrite must still make a valid lesson.
      extraCheck: (v) => (content && v.contentWrong && hasFix(v.fix) ? validateLesson(applyFix(content, v.fix), language.script) : []),
    });
  } catch (e) {
    if (e instanceof StructuredOutputError) return c.json({ error: 'query_failed', detail: e.message }, 502);
    const { status, body } = claudeErrorResponse(e);
    return c.json(body, status);
  }
  const fix = content && verdict.contentWrong && hasFix(verdict.fix) ? verdict.fix : null;
  const row = await c.env.DB.prepare(
    `INSERT INTO page_queries(lang, screen, lesson_id, note, page_text, content_wrong, explanation, fix_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
  )
    .bind(lang, str(b.screen, 40) || 'unknown', lesson?.id ?? null, note, text, verdict.contentWrong ? 1 : 0, verdict.explanation.trim(), fix ? JSON.stringify(fix) : null)
    .first<{ id: number }>();
  return c.json({ id: row!.id, contentWrong: verdict.contentWrong, explanation: verdict.explanation.trim(), fix });
});

/** Put a query's corrected sections into its lesson. */
pageQueryRoutes.post('/:id{[0-9]+}/apply', async (c) => {
  await ensureTable(c.env.DB);
  const q = await c.env.DB.prepare('SELECT lesson_id, fix_json, status FROM page_queries WHERE id = ?1')
    .bind(Number(c.req.param('id')))
    .first<{ lesson_id: number | null; fix_json: string | null; status: string }>();
  if (!q || !q.fix_json || !q.lesson_id) return c.json({ error: 'No fix to apply' }, 404);
  const lesson = await lessonRow(c.env.DB, q.lesson_id);
  if (!lesson) return c.json({ error: 'Lesson not found' }, 404);
  const next = applyFix(JSON.parse(lesson.content_json) as LessonContent, JSON.parse(q.fix_json) as LessonFix);
  const problems = validateLesson(next, getLanguage(lesson.lang)?.script ?? 'han');
  if (problems.length) return c.json({ error: 'The fix no longer fits the lesson', detail: problems.join('; ') }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE lessons SET content_json = ?1, content_md = ?2 WHERE id = ?3').bind(JSON.stringify(next), renderLessonMd(next), lesson.id),
    c.env.DB.prepare("UPDATE page_queries SET status = 'applied' WHERE id = ?1").bind(Number(c.req.param('id'))),
  ]);
  return c.json({ ok: true });
});
