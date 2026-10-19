// "Query this page": the learner flags something on any screen that looks wrong. Sonnet checks it;
// on a lesson it may rewrite the faulty sections, which the learner can apply to the lesson.
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import { callStructured, claudeErrorResponse, StructuredOutputError } from './claude';
import { explainFor } from './explain';
import { getLanguage } from '../core/languages';
import { renderLessonMd, validateLesson, type LessonContent } from '../core/lessons/types';
import { applyFix, fromFlat, hasFix, type LessonFix } from '../core/lessons/fix';
import { pageQueryPrompt } from '../../prompts';
import { stripPinyin } from '../core/pinyin/strip';
import { invalidateDict } from './words';

export const pageQueryRoutes = new Hono<{ Bindings: Env }>();

const Pair = z.object({ zh: z.string(), en: z.string() });
const Choice = z.object({ prompt: z.string(), options: z.array(z.string()), answer: z.number().int() });
const CheckItem = z.object({
  kind: z.enum(['choice', 'translate', 'fix']),
  prompt: z.string().nullable(),
  options: z.array(z.string()).nullable(),
  answer: z.number().int().nullable(),
  en: z.string().nullable(),
  zh: z.string().nullable(),
  wrong: z.string().nullable(),
  right: z.string().nullable(),
  note: z.string().nullable(),
});
const Fix = z.object({
  explanation: z.array(z.string()).nullable(),
  examples: z.array(Pair).nullable(),
  drills: z.array(Pair).nullable(),
  keyPoints: z.array(z.string()).nullable(),
  errors: z.array(z.object({ wrong: z.string(), right: z.string(), note: z.string() })).nullable(),
  recognise: z.array(Choice).nullable(),
  check: z.array(CheckItem).nullable(),
});
const Verdict = z.object({
  contentWrong: z.boolean(),
  explanation: z.string(),
  fix: Fix,
  // On a review card: the word's meaning, or its example sentence (and the answer it tests).
  wordGloss: z.string().nullable(),
  sentence: z.object({ zh: z.string(), en: z.string(), target: z.string() }).nullable(),
});

/** What a query may correct: lesson sections, a word's meaning, an example sentence. */
type PageFix = LessonFix & { word?: { id: number; gloss: string }; sentence?: { id: number; zh: string; en: string; target: string } };

/** The model's fix in the lesson's own shapes. */
const toFix = (f: z.infer<typeof Fix>): LessonFix => ({ ...f, check: f.check?.map(fromFlat) ?? null });

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

interface WordRow {
  id: number;
  lang: string;
  lemma: string;
  gloss: string | null;
}
interface SentenceRow {
  id: number;
  lang: string;
  zh: string;
  en: string;
  target: string | null;
}
const lessonRow = (db: D1Database, id: number) => db.prepare('SELECT id, lang, title, content_json FROM lessons WHERE id = ?1').bind(id).first<LessonRow>();

pageQueryRoutes.post('/', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { lang?: string; screen?: string; lessonId?: number; wordId?: number; sentenceId?: number; text?: string; note?: string };
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const note = str(b.note, 1000);
  const text = str(b.text, 8000);
  if (!note) return c.json({ error: 'Say what looks wrong' }, 400);
  // Before the Claude call, so a database problem does not waste one.
  await ensureTable(c.env.DB);
  const lesson = Number.isInteger(b.lessonId) ? await lessonRow(c.env.DB, b.lessonId!) : null;
  const word = Number.isInteger(b.wordId) ? await c.env.DB.prepare('SELECT id, lang, lemma, gloss FROM words WHERE id = ?1').bind(b.wordId).first<WordRow>() : null;
  const sentence = Number.isInteger(b.sentenceId) ? await c.env.DB.prepare('SELECT id, lang, zh, en, target FROM exercises WHERE id = ?1').bind(b.sentenceId).first<SentenceRow>() : null;
  const lang = lesson?.lang ?? word?.lang ?? sentence?.lang ?? (getLanguage(str(b.lang, 10)) ? str(b.lang, 10) : 'zh');
  const language = getLanguage(lang) ?? getLanguage('zh')!;
  const content = lesson ? (JSON.parse(lesson.content_json) as LessonContent) : null;
  const question = [
    `Screen: ${str(b.screen, 40) || 'unknown'}`,
    `On screen:\n${text || '(nothing captured)'}`,
    content ? `Lesson content:\n${JSON.stringify(content)}` : '',
    word ? `Word on this card: ${word.lemma}, meaning in the learner's word list: ${word.gloss ?? '(none)'}` : '',
    sentence ? `Example sentence on this card: ${JSON.stringify({ zh: sentence.zh, en: sentence.en, target: sentence.target ?? word?.lemma ?? '' })}` : '',
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
      extraCheck: (v) => [
        ...(content && v.contentWrong && hasFix(toFix(v.fix)) ? validateLesson(applyFix(content, toFix(v.fix)), language.script) : []),
        ...(v.sentence && !v.sentence.zh.includes(v.sentence.target.trim()) ? ['sentence.target must appear in sentence.zh exactly'] : []),
      ],
    });
  } catch (e) {
    if (e instanceof StructuredOutputError) return c.json({ error: 'query_failed', detail: e.message }, 502);
    const { status, body } = claudeErrorResponse(e);
    return c.json(body, status);
  }
  const clean = (t: string) => (language.hasRomanisation ? stripPinyin(t) : t).trim();
  const lessonFix = content && hasFix(toFix(verdict.fix)) ? toFix(verdict.fix) : null;
  const gloss = word && verdict.wordGloss?.trim() ? verdict.wordGloss.trim().slice(0, 200) : null;
  const newSentence = sentence && verdict.sentence ? { id: sentence.id, zh: clean(verdict.sentence.zh), en: verdict.sentence.en.trim(), target: clean(verdict.sentence.target) } : null;
  const fix: PageFix | null =
    verdict.contentWrong && (lessonFix || gloss || newSentence)
      ? { ...(lessonFix ?? { explanation: null, examples: null, drills: null, keyPoints: null }), ...(gloss ? { word: { id: word!.id, gloss } } : {}), ...(newSentence ? { sentence: newSentence } : {}) }
      : null;
  const row = await c.env.DB.prepare(
    `INSERT INTO page_queries(lang, screen, lesson_id, note, page_text, content_wrong, explanation, fix_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
  )
    .bind(lang, str(b.screen, 40) || 'unknown', lesson?.id ?? null, note, text, verdict.contentWrong ? 1 : 0, verdict.explanation.trim(), fix ? JSON.stringify(fix) : null)
    .first<{ id: number }>();
  return c.json({ id: row!.id, contentWrong: verdict.contentWrong, explanation: verdict.explanation.trim(), fix });
});

/** Put a query's corrections in place: lesson sections, a word's meaning, an example sentence. */
pageQueryRoutes.post('/:id{[0-9]+}/apply', async (c) => {
  await ensureTable(c.env.DB);
  const id = Number(c.req.param('id'));
  const q = await c.env.DB.prepare('SELECT lang, lesson_id, fix_json, status FROM page_queries WHERE id = ?1').bind(id).first<{ lang: string; lesson_id: number | null; fix_json: string | null; status: string }>();
  if (!q || !q.fix_json) return c.json({ error: 'No fix to apply' }, 404);
  const fix = JSON.parse(q.fix_json) as PageFix;
  const stmts: D1PreparedStatement[] = [];
  if (hasFix(fix)) {
    const lesson = q.lesson_id ? await lessonRow(c.env.DB, q.lesson_id) : null;
    if (!lesson) return c.json({ error: 'Lesson not found' }, 404);
    const next = applyFix(JSON.parse(lesson.content_json) as LessonContent, fix);
    const problems = validateLesson(next, getLanguage(lesson.lang)?.script ?? 'han');
    if (problems.length) return c.json({ error: 'The fix no longer fits the lesson', detail: problems.join('; ') }, 409);
    stmts.push(c.env.DB.prepare('UPDATE lessons SET content_json = ?1, content_md = ?2 WHERE id = ?3').bind(JSON.stringify(next), renderLessonMd(next), lesson.id));
  }
  if (fix.word) stmts.push(c.env.DB.prepare('UPDATE words SET gloss = ?1 WHERE id = ?2').bind(fix.word.gloss, fix.word.id));
  if (fix.sentence) {
    const s = fix.sentence;
    stmts.push(c.env.DB.prepare('UPDATE OR IGNORE exercises SET zh = ?1, en = ?2, target = ?3 WHERE id = ?4').bind(s.zh, s.en, s.target, s.id));
  }
  if (!stmts.length) return c.json({ error: 'No fix to apply' }, 404);
  stmts.push(c.env.DB.prepare("UPDATE page_queries SET status = 'applied' WHERE id = ?1").bind(id));
  await c.env.DB.batch(stmts);
  if (fix.word) invalidateDict(q.lang); // meanings are cached with the word list
  return c.json({ ok: true });
});

/**
 * Everything flagged, newest first (Settings → Flagged): marks queried in lessons and "Something
 * looks wrong?" queries, with what became of each.
 */
pageQueryRoutes.get('/list', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  await ensureTable(c.env.DB);
  const [marks, pages] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT q.id, q.created_at AS at, l.title AS lesson, q.kind, q.task, q.expected, q.answer, q.learner_right, q.key_wrong, q.better_key, q.explanation, q.status
       FROM answer_queries q JOIN lessons l ON l.id = q.lesson_id WHERE l.lang = ?1 ORDER BY q.id DESC LIMIT 40`,
    ).bind(lang),
    c.env.DB.prepare(
      `SELECT q.id, q.created_at AS at, q.screen, l.title AS lesson, q.note, q.content_wrong, q.explanation, q.fix_json IS NOT NULL AS has_fix, q.status
       FROM page_queries q LEFT JOIN lessons l ON l.id = q.lesson_id WHERE q.lang = ?1 ORDER BY q.id DESC LIMIT 40`,
    ).bind(lang),
  ]);
  type Mark = { id: number; at: string; lesson: string; kind: string; task: string; expected: string; answer: string; learner_right: number; key_wrong: number; better_key: string | null; explanation: string; status: string };
  type Page = { id: number; at: string; screen: string; lesson: string | null; note: string; content_wrong: number; explanation: string; has_fix: number; status: string };
  const items = [
    ...(marks!.results as Mark[]).map((m) => ({
      source: 'mark' as const,
      id: m.id,
      at: m.at,
      where: m.lesson,
      what: m.task,
      answer: m.answer,
      expected: m.expected,
      learnerRight: !!m.learner_right,
      keyWrong: !!m.key_wrong,
      better: m.better_key,
      explanation: m.explanation,
      status: m.status,
    })),
    ...(pages!.results as Page[]).map((p) => ({
      source: 'page' as const,
      id: p.id,
      at: p.at,
      where: p.lesson ?? p.screen,
      what: p.note,
      contentWrong: !!p.content_wrong,
      canApply: !!p.has_fix && p.status === 'open',
      explanation: p.explanation,
      status: p.status,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return c.json({ items: items.slice(0, 40) });
});
