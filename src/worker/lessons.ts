import { Hono } from 'hono';
import { z } from 'zod';
import { createEmptyCard } from 'ts-fsrs';
import type { Env } from './env';
import { callStructured, claudeErrorResponse, StructuredOutputError } from './claude';
import { annotateStrings } from './annotate';
import { getDict, trackWords } from './words';
import { pinyinPerChar } from './pinyin';
import { annotate } from '../core/pinyin/annotate';
import { isSectioned, renderLessonMd, validateLesson, lessonStrings, type LessonContent } from '../core/lessons/types';
import { fixAnswerKey, type WrongKey } from '../core/lessons/fix';
import { stripPinyin } from '../core/pinyin/strip';
import type { CurriculumItem } from '../core/languages/zh.curriculum';
import { CURRICULA } from '../core/languages/seeds';
import { promptsFor, hasPrompts, proofreadLessonPrompt } from '../../prompts';
import { getLanguage, type LanguageConfig } from '../core/languages';
import { sameText, rulesFor } from '../core/text/rules';
import { mixCheck } from '../core/lessons/practice';
import { lessonMastery } from './mastery';
import { levelCheck } from './level';
import { learnerProfile } from './learner';
import { recordStudyDay } from './session';
import { explainFor } from './explain';
import { lessonTextsIn, originalExplainLang } from './lesson-texts';
import { DEFAULT_PASS_MARK, STEP_LABEL, nextStep, pickWarmup, scoreCheck, type NextLesson, type StepKey, type WarmupSource } from '../core/lessons/steps';

export const lessonRoutes = new Hono<{ Bindings: Env }>();

export interface LessonRow {
  id: number;
  lang: string;
  title: string;
  level: string | null;
  content_json: string;
  content_md: string;
  course_no: number | null;
  source: string;
  completed_at: string | null;
  created_at: string;
  explain_lang?: string | null;
}

const LessonSchema = z.object({
  title: z.string(),
  level: z.string(),
  pattern: z.string(),
  explanation: z.array(z.string()),
  examples: z.array(z.object({ zh: z.string(), en: z.string() })),
  keyPoints: z.array(z.string()),
  drills: z.array(z.object({ en: z.string(), zh: z.string() })),
  errors: z.array(z.object({ wrong: z.string(), right: z.string(), note: z.string() })),
  grammarPoints: z.array(z.object({ title: z.string(), summary: z.string() })),
  chatPrompt: z.string(),
  // Practice sets for the stepped lesson (see prompts/zh-lesson.v1.ts).
  recognise: z.array(z.object({ prompt: z.string(), options: z.array(z.string()), answer: z.number().int() })),
  checkChoice: z.array(z.object({ prompt: z.string(), options: z.array(z.string()), answer: z.number().int() })),
  checkTranslate: z.array(z.object({ en: z.string(), zh: z.string() })),
  checkFix: z.array(z.object({ wrong: z.string(), right: z.string(), note: z.string() })),
});

const Proofread = LessonSchema.extend({ changes: z.array(z.string()) });

/**
 * A second pass over a new lesson before the learner sees it: a stronger model corrects the
 * language, translations, examples off the pattern and multiple-choice answers. The draft is kept
 * if the check fails or its result is not a valid lesson.
 */
async function proofreadLesson(env: Env, language: LanguageConfig, draft: z.infer<typeof LessonSchema>): Promise<z.infer<typeof LessonSchema>> {
  try {
    const { changes, ...checked } = await callStructured(env, {
      role: 'checking',
      system: [proofreadLessonPrompt(language.name)],
      messages: [{ role: 'user', content: JSON.stringify(draft) }],
      maxTokens: 9000,
      effort: 'medium',
      schema: Proofread,
      extraCheck: (v) => validateLesson(toLessonContent(v), language.script),
    });
    if (changes.length) console.log(`proofread "${draft.title}": ${changes.join('; ')}`);
    return checked;
  } catch (e) {
    // Out of budget too: the draft is already paid for, so it is kept rather than lost.
    console.error('proofreading the lesson failed; keeping the draft', e);
    return draft;
  }
}

/** The generated lesson in the stored shape: practice arrays become recognise + a mixed check. */
function toLessonContent(g: z.infer<typeof LessonSchema>): LessonContent {
  const { recognise, checkChoice, checkTranslate, checkFix, ...rest } = g;
  return { ...rest, recognise, check: mixCheck({ checkChoice, checkTranslate, checkFix }) };
}

const listCols = 'id, title, level, course_no, source, completed_at, created_at';

type PlanItem = CurriculumItem & { slug: string | null };

/**
 * The next planned lesson that has no lesson yet, and the course number it would get. A synced
 * course pack defines the plan (course_plan); without one, the built-in curriculum is used.
 */
async function nextToGenerate(db: D1Database, lang: string): Promise<{ item: PlanItem; courseNo: number } | null> {
  const { results } = await db.prepare('SELECT title, slug, course_no FROM lessons WHERE lang = ?1').bind(lang).all<{ title: string; slug: string | null; course_no: number | null }>();
  const { results: plan } = await db
    .prepare('SELECT slug, title, level, focus FROM course_plan WHERE lang = ?1 ORDER BY position')
    .bind(lang)
    .all<{ slug: string; title: string; level: string; focus: string }>();
  const haveSlug = new Set(results.map((r) => r.slug).filter(Boolean));
  const haveTitle = new Set(results.map((r) => r.title.replace(/^Lesson \d+:\s*/, '').toLowerCase()));
  const item: PlanItem | undefined = plan.length
    ? plan.find((p) => !haveSlug.has(p.slug))
    : (CURRICULA[lang] ?? []).map((c) => ({ ...c, slug: null })).find((c) => !haveTitle.has(c.title.toLowerCase()));
  if (!item) return null;
  const maxNo = Math.max(0, ...results.map((r) => r.course_no ?? 0));
  return { item, courseNo: maxNo + 1 };
}

/**
 * The first lesson in course order with something left to do. For a stepped lesson that means an
 * unfinished step, even if the lesson is flagged done, so no step is skipped; for a lesson without
 * steps, not yet marked done.
 */
async function nextLesson(db: D1Database, lang: string): Promise<NextLesson | null> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.title, l.course_no, l.completed_at, l.content_json, p.steps_json
       FROM lessons l LEFT JOIN lesson_progress p ON p.lesson_id = l.id
       WHERE l.lang = ?1 AND l.course_no IS NOT NULL ORDER BY l.course_no`,
    )
    .bind(lang)
    .all<{ id: number; title: string; course_no: number; completed_at: string | null; content_json: string; steps_json: string | null }>();
  for (const r of results) {
    const content = JSON.parse(r.content_json) as LessonContent;
    if (isSectioned(content)) {
      const done = r.steps_json ? (JSON.parse(r.steps_json) as StepKey[]) : [];
      const step = nextStep(content, done);
      if (step) return { id: r.id, title: r.title, course_no: r.course_no, step: STEP_LABEL[step], started: done.length > 0 };
    } else if (!r.completed_at) {
      return { id: r.id, title: r.title, course_no: r.course_no, step: null, started: false };
    }
  }
  return null;
}

lessonRoutes.get('/', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const q = (c.req.query('q') ?? '').trim();
  let rows: unknown[];
  if (q.length >= 3) {
    const match = `"${q.replace(/"/g, '""')}"`;
    rows = (
      await c.env.DB.prepare(
        `SELECT l.id, l.title, l.level, l.course_no, l.source, l.completed_at, l.created_at,
                snippet(lessons_fts, 1, '[', ']', '…', 12) AS snippet
         FROM lessons_fts JOIN lessons l ON l.id = lessons_fts.rowid
         WHERE lessons_fts MATCH ?1 AND l.lang = ?2 ORDER BY rank LIMIT 50`,
      )
        .bind(match, lang)
        .all()
    ).results;
  } else if (q.length > 0) {
    const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
    rows = (
      await c.env.DB.prepare(`SELECT ${listCols} FROM lessons WHERE lang = ?1 AND (title LIKE ?2 ESCAPE '\\' OR content_md LIKE ?2 ESCAPE '\\') ORDER BY course_no LIMIT 50`)
        .bind(lang, like)
        .all()
    ).results;
  } else {
    rows = (await c.env.DB.prepare(`SELECT ${listCols} FROM lessons WHERE lang = ?1 ORDER BY course_no IS NULL, course_no, created_at`).bind(lang).all()).results;
  }
  const next = await nextLesson(c.env.DB, lang);
  const gen = await nextToGenerate(c.env.DB, lang);
  const levels = await lessonMastery(c.env.DB, lang);
  const withMastery = (rows as { id: number }[]).map((r) => ({ ...r, mastery: levels.get(r.id) ?? null }));
  return c.json({ lessons: withMastery, nextLesson: next ?? null, nextToGenerate: gen ? { ...gen.item, courseNo: gen.courseNo } : null });
});

lessonRoutes.get('/:id{[0-9]+}', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM lessons WHERE id = ?1').bind(Number(c.req.param('id'))).first<LessonRow>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const content = JSON.parse(row.content_json) as LessonContent;
  const annotations = await annotateStrings(c.env.DB, row.lang, lessonStrings(content, getLanguage(row.lang)?.script ?? 'han'));
  const { results: points } = await c.env.DB.prepare(
    `SELECT g.id, g.title, g.summary, s.due_at FROM grammar_points g LEFT JOIN srs_cards s ON s.item_type = 'grammar_point' AND s.item_id = g.id WHERE g.lesson_id = ?1`,
  )
    .bind(row.id)
    .all();
  const nav = await c.env.DB.prepare(
    `SELECT (SELECT id FROM lessons WHERE lang = ?1 AND course_no < ?2 ORDER BY course_no DESC LIMIT 1) AS prev,
            (SELECT id FROM lessons WHERE lang = ?1 AND course_no > ?2 ORDER BY course_no LIMIT 1) AS next`,
  )
    .bind(row.lang, row.course_no ?? -1)
    .first();
  return c.json({
    lesson: { id: row.id, lang: row.lang, title: row.title, level: row.level, courseNo: row.course_no, source: row.source, completedAt: row.completed_at, createdAt: row.created_at, content, explainLang: originalExplainLang(row) },
    explain: await (async () => {
      const e = await explainFor(c.env.DB, row.lang);
      const native = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'native_lang'").first<{ value: string }>();
      return { code: e.code, target: e.target, nativeCode: native ? (JSON.parse(native.value) as string) : 'en' };
    })(),
    annotations,
    grammarPoints: points,
    nav,
    state: { ...(await lessonState(c.env.DB, row.id)), mastery: (await lessonMastery(c.env.DB, row.lang)).get(row.id) ?? null },
  });
});

/** The lesson's explanations in another language (written once, then stored). */
lessonRoutes.post('/:id{[0-9]+}/texts', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM lessons WHERE id = ?1').bind(Number(c.req.param('id'))).first<LessonRow>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { to?: unknown };
  const to = typeof body.to === 'string' && /^[a-z]{2,3}$/.test(body.to) ? body.to : null;
  if (!to) return c.json({ error: 'to required' }, 400);
  try {
    return c.json(await lessonTextsIn(c.env, row, to));
  } catch (e) {
    if (e instanceof StructuredOutputError) return c.json({ error: 'translation_failed', detail: e.message }, 502);
    const { status, body: err } = claudeErrorResponse(e);
    return c.json(err, status);
  }
});

/** Mark done: grammar points enter SRS, and the lesson's words start being tracked. */
lessonRoutes.post('/:id{[0-9]+}/done', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM lessons WHERE id = ?1').bind(id).first<LessonRow>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const res = await markDone(c.env, row);
  // Marked done by the learner: today's lesson step (done by a review quiz or the level check is not).
  await c.env.DB.prepare(
    `INSERT INTO lesson_progress(lesson_id) VALUES (?1) ON CONFLICT(lesson_id) DO UPDATE SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  )
    .bind(id)
    .run();
  return c.json(res);
});

export async function markDone(env: Env, row: LessonRow) {
  const c = { env };
  const id = row.id;
  const now = new Date();
  const card = createEmptyCard(now);
  const { results: points } = await c.env.DB.prepare('SELECT id FROM grammar_points WHERE lesson_id = ?1').bind(id).all<{ id: number }>();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE lessons SET completed_at = COALESCE(completed_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?1").bind(id),
    ...points.map((p) =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO srs_cards(item_type, item_id, lang, fsrs_state_json, due_at) VALUES ('grammar_point', ?1, ?2, ?3, ?4)`,
      ).bind(p.id, row.lang, JSON.stringify(card), card.due.toISOString()),
    ),
  ]);
  const tracked = await trackLessonWords(c.env.DB, row, now);
  await recordStudyDay(c.env.DB, row.lang);
  return { ok: true as const, grammarCards: points.length, newWords: tracked.added, promoted: tracked.promoted.length };
}

/**
 * The words in a lesson's examples and drills start being reviewed (idempotent). Also run when
 * the Learn step is done, so reviews draw on words the learner has met rather than the pool.
 */
async function trackLessonWords(db: D1Database, row: LessonRow, now = new Date()) {
  const content = JSON.parse(row.content_json) as LessonContent;
  const text = [...content.examples.map((e) => e.zh), ...content.drills.map((d) => d.zh)].join('\n');
  const dict = await getDict(db, row.lang);
  return trackWords(db, row.lang, rulesFor(getLanguage(row.lang)?.script ?? 'han').tokenize(text, dict, pinyinPerChar), 'lesson', now);
}

async function passMark(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'lesson.pass_mark'").first<{ value: string }>();
  const n = row ? Number(JSON.parse(row.value)) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_PASS_MARK;
}

/** Steps finished and check attempts, for the lesson page. */
async function lessonState(db: D1Database, id: number) {
  const progress = await db.prepare('SELECT steps_json FROM lesson_progress WHERE lesson_id = ?1').bind(id).first<{ steps_json: string }>();
  const { results: checks } = await db
    .prepare('SELECT score, total, passed, created_at FROM lesson_checks WHERE lesson_id = ?1 ORDER BY id DESC LIMIT 5')
    .bind(id)
    .all<{ score: number; total: number; passed: number; created_at: string }>();
  return { stepsDone: progress ? (JSON.parse(progress.steps_json) as StepKey[]) : [], checks, passMark: await passMark(db) };
}

/**
 * Grammar enters the reviews once its lesson's Learn step is done (not only at the lesson check),
 * due the next day. Idempotent: covers every such lesson in the language that has no card yet.
 */
export async function enterLearntGrammar(db: D1Database, lang: string): Promise<number> {
  const tomorrow = new Date(Date.now() + 86_400_000);
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO srs_cards(item_type, item_id, lang, fsrs_state_json, due_at)
       SELECT 'grammar_point', g.id, l.lang, ?2, ?3 FROM grammar_points g
       JOIN lessons l ON l.id = g.lesson_id JOIN lesson_progress p ON p.lesson_id = l.id
       WHERE l.lang = ?1 AND EXISTS (SELECT 1 FROM json_each(p.steps_json) WHERE value = 'learn')`,
    )
    .bind(lang, JSON.stringify(createEmptyCard(tomorrow)), tomorrow.toISOString())
    .run();
  return r.meta.changes ?? 0;
}

/**
 * Record a finished step; returns the steps now done. `today` false (a review quiz passing the
 * check) leaves the time alone, so it does not count as today's lesson step.
 */
export async function saveStep(db: D1Database, id: number, step: StepKey, today = true): Promise<StepKey[]> {
  const cur = await lessonState(db, id);
  const steps = [...new Set([...cur.stepsDone, step])];
  await db
    .prepare(
      `INSERT INTO lesson_progress(lesson_id, steps_json${today ? '' : ', updated_at'}) VALUES (?1, ?2${today ? '' : ", '1970-01-01T00:00:00.000Z'"})
       ON CONFLICT(lesson_id) DO UPDATE SET steps_json = excluded.steps_json${today ? ", updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')" : ''}`,
    )
    .bind(id, JSON.stringify(steps))
    .run();
  return steps;
}

/**
 * A grammar quiz from the daily review (questions drawn from the lesson check) that clears the
 * lesson pass mark counts as passing the check: the lesson is done (Practised) and its check step
 * is ticked off, so the lesson page and the home card move on. Returns true when that happened.
 */
export async function passFromQuiz(env: Env, grammarPointId: number, score: number, total: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT l.* FROM grammar_points g JOIN lessons l ON l.id = g.lesson_id WHERE g.id = ?1').bind(grammarPointId).first<LessonRow>();
  if (!row) return false;
  const content = JSON.parse(row.content_json) as LessonContent;
  const stepsDone = (await lessonState(env.DB, row.id)).stepsDone;
  // Mid-lesson, a quiz is practice only: the check is passed once the steps before it are done.
  const next = isSectioned(content) ? nextStep(content, stepsDone) : null;
  if (next && next !== 'check') return false;
  if (!scoreCheck(Array.from({ length: total }, (_, k) => ({ right: k < score })), await passMark(env.DB)).passed) return false;
  const checkDone = !isSectioned(content) || stepsDone.includes('check');
  if (row.completed_at && checkDone) return false;
  if (!row.completed_at) await markDone(env, row);
  if (!checkDone) await saveStep(env.DB, row.id, 'check', false);
  return true;
}

lessonRoutes.post('/:id{[0-9]+}/progress', async (c) => {
  const id = Number(c.req.param('id'));
  const body = (await c.req.json().catch(() => ({}))) as { step?: unknown };
  if (typeof body.step !== 'string' || !(body.step in STEP_LABEL)) return c.json({ error: 'unknown step' }, 400);
  const steps = await saveStep(c.env.DB, id, body.step as StepKey);
  const lesson = await c.env.DB.prepare('SELECT * FROM lessons WHERE id = ?1').bind(id).first<LessonRow>();
  if (lesson && steps.includes('learn')) {
    await enterLearntGrammar(c.env.DB, lesson.lang);
    await trackLessonWords(c.env.DB, lesson);
  }
  if (lesson) await recordStudyDay(c.env.DB, lesson.lang); // a finished step is a day's practice
  return c.json({ ok: true, stepsDone: steps });
});

/** Recall questions from earlier finished lessons (most-due grammar first). */
lessonRoutes.get('/:id{[0-9]+}/warmup', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT lang FROM lessons WHERE id = ?1').bind(id).first<{ lang: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.title, l.content_json,
            (SELECT MIN(s.due_at) FROM grammar_points g JOIN srs_cards s ON s.item_type = 'grammar_point' AND s.item_id = g.id WHERE g.lesson_id = l.id) AS due_at
     FROM lessons l WHERE l.lang = ?1 AND l.id <> ?2 AND l.completed_at IS NOT NULL`,
  )
    .bind(row.lang, id)
    .all<{ id: number; title: string; content_json: string; due_at: string | null }>();
  const sources: WarmupSource[] = results.map((r) => ({ lessonId: r.id, lessonTitle: r.title, dueAt: r.due_at, content: JSON.parse(r.content_json) as LessonContent }));
  const seed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, '')) + id;
  const items = pickWarmup(sources, seed);
  const annotations = await annotateStrings(c.env.DB, row.lang, items.flatMap((i) => (i.kind === 'choice' ? i.options : [i.zh])));
  return c.json({ items, annotations });
});

const GradeSchema = z.object({ correct: z.boolean(), feedback: z.string(), corrected: z.string() });

/** Mark a typed answer: exact match first, otherwise Claude judges meaning and pattern. */
lessonRoutes.post('/grade', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { lessonId?: number; lang?: string; kind?: string; task?: string; expected?: string; answer?: string };
  const lesson = body.lessonId ? await c.env.DB.prepare('SELECT lang, content_json FROM lessons WHERE id = ?1').bind(body.lessonId).first<{ lang: string; content_json: string }>() : null;
  const language = getLanguage(lesson?.lang ?? body.lang ?? 'zh') ?? getLanguage('zh')!;
  const raw = typeof body.answer === 'string' ? body.answer.trim() : '';
  // Pinyin clean-up is for Chinese only (it would eat accented letters such as è).
  const answer = (language.hasRomanisation ? stripPinyin(raw) : raw).slice(0, 200);
  const expected = typeof body.expected === 'string' ? body.expected : '';
  if (!answer || !expected || (body.kind !== 'translate' && body.kind !== 'fix' && body.kind !== 'cloze')) return c.json({ error: 'answer, expected and kind required' }, 400);
  if (sameText(language.script, answer, expected)) return c.json({ correct: true, feedback: 'Exactly right.', corrected: expected, judged: false });
  const pattern = lesson ? (JSON.parse(lesson.content_json) as LessonContent).pattern : '';
  const target = language.id === 'zh' ? 'Chinese' : language.name;
  const task =
    body.kind === 'fix'
      ? `Correct this wrong sentence: ${body.task ?? ''}`
      : body.kind === 'cloze'
        ? // A review's fill-in-the-blank: judge the word or phrase in the blank, in this sentence.
          `Fill in the blank (＿＿) with the right word or phrase. Mark only what goes in the blank: another word or form that is correct and natural here, with the same meaning, counts as right. ${body.task ?? ''}`
        : `Translate into ${target}: ${body.task ?? ''}`;
  try {
    const out = await callStructured(c.env, {
      // Sonnet, not Haiku: marking needs judgement (ambiguous English, alternative phrasings).
      role: 'lessons',
      effort: 'low',
      // Marking feedback is read mid-exercise, like a chat correction: same, later, language switch.
      system: [promptsFor(language.id).grade, (await explainFor(c.env.DB, language.id)).corrections.instruction],
      messages: [{ role: 'user', content: `Pattern: ${pattern}\nTask: ${task}\nModel answer: ${expected}\nLearner's answer: ${answer}` }],
      maxTokens: 1500,
      schema: GradeSchema,
    });
    const corrected = language.hasRomanisation ? stripPinyin(out.corrected.trim()) : out.corrected.trim();
    return c.json({ correct: out.correct, feedback: out.feedback.trim(), corrected: corrected || expected, judged: true });
  } catch (e) {
    if (e instanceof StructuredOutputError) return c.json({ correct: false, feedback: 'Could not mark this one automatically.', corrected: expected, judged: false });
    const { status, body: err } = claudeErrorResponse(e);
    return c.json(err, status);
  }
});

/**
 * Lesson check result (items are marked in the app, typed ones through /grade). A pass marks the
 * lesson done; otherwise its grammar is scheduled for review tomorrow so it comes back soon.
 */
lessonRoutes.post('/:id{[0-9]+}/check', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM lessons WHERE id = ?1').bind(id).first<LessonRow>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { results?: { kind?: string; right?: boolean; answer?: string }[] };
  const results = (body.results ?? []).map((r) => ({ kind: String(r.kind ?? ''), right: r.right === true, answer: String(r.answer ?? '').slice(0, 200) }));
  if (!results.length) return c.json({ error: 'results required' }, 400);
  const mark = await passMark(c.env.DB);
  const s = scoreCheck(results, mark);
  const ins = await c.env.DB.prepare('INSERT INTO lesson_checks(lesson_id, score, total, passed, details_json) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id')
    .bind(id, s.score, s.total, s.passed ? 1 : 0, JSON.stringify(results))
    .first<{ id: number }>();
  const checkId = ins?.id ?? null;
  let done = null;
  if (s.passed) done = await markDone(c.env, row);
  else {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const card = createEmptyCard(tomorrow);
    const { results: points } = await c.env.DB.prepare('SELECT id FROM grammar_points WHERE lesson_id = ?1').bind(id).all<{ id: number }>();
    if (points.length)
      await c.env.DB.batch(
        points.map((p) =>
          c.env.DB.prepare(
            `INSERT INTO srs_cards(item_type, item_id, lang, fsrs_state_json, due_at) VALUES ('grammar_point', ?1, ?2, ?3, ?4)
             ON CONFLICT(item_type, item_id) DO UPDATE SET due_at = MIN(due_at, excluded.due_at)`,
          ).bind(p.id, row.lang, JSON.stringify(card), tomorrow.toISOString()),
        ),
      );
  }
  return c.json({ ...s, passMark: mark, done, checkId });
});

const QuerySchema = z.object({ learnerRight: z.boolean(), keyWrong: z.boolean(), explanation: z.string(), betterKey: z.string() });

/**
 * "Query this mark": Sonnet re-checks one marked answer. A learner proved right on a lesson check
 * gets the mark back (and the pass, if that tips it); a wrong answer key is corrected in the lesson.
 */
lessonRoutes.post('/query', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as {
    lessonId?: number;
    place?: string;
    kind?: string;
    task?: string;
    options?: string[];
    expected?: string;
    answer?: string;
    markedRight?: boolean;
    note?: string;
    checkId?: number;
    itemIndex?: number;
  };
  const kind = ['choice', 'translate', 'fix', 'build'].includes(String(b.kind)) ? String(b.kind) : null;
  const str = (v: unknown, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const answer = str(b.answer);
  const expected = str(b.expected);
  if (!kind || !answer || !expected) return c.json({ error: 'kind, expected and answer required' }, 400);
  const lesson = b.lessonId ? await c.env.DB.prepare('SELECT * FROM lessons WHERE id = ?1').bind(b.lessonId).first<LessonRow>() : null;
  const pattern = lesson ? (JSON.parse(lesson.content_json) as LessonContent).pattern : '';
  const options = Array.isArray(b.options) ? b.options.map((o) => str(o, 120)).filter(Boolean) : [];
  const note = str(b.note, 500);
  const question = [
    `Pattern: ${pattern}`,
    `Question kind: ${kind === 'build' ? 'arrange word tiles into a sentence' : kind === 'fix' ? 'correct a wrong sentence' : kind === 'choice' ? 'multiple choice' : `translate English into ${getLanguage(lesson?.lang ?? 'zh')?.name ?? 'Chinese'}`}`,
    `Task: ${str(b.task)}`,
    options.length ? `Options: ${options.map((o, i) => `${i + 1}. ${o}`).join(' / ')}` : '',
    `Answer key: ${expected}`,
    `Learner's answer: ${answer}`,
    `It was marked: ${b.markedRight ? 'right' : 'wrong'}`,
    note ? `Learner's reason: ${note}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  let verdict: z.infer<typeof QuerySchema>;
  try {
    verdict = await callStructured(c.env, { role: 'lessons', system: [promptsFor(lesson?.lang ?? 'zh').query, (await explainFor(c.env.DB, lesson?.lang ?? 'zh')).instruction], messages: [{ role: 'user', content: question }], maxTokens: 1500, schema: QuerySchema, effort: 'medium' });
  } catch (e) {
    if (e instanceof StructuredOutputError) return c.json({ error: 'query_failed', detail: e.message }, 502);
    const { status, body: err } = claudeErrorResponse(e);
    return c.json(err, status);
  }
  const betterKey = verdict.keyWrong ? (getLanguage(lesson?.lang ?? 'zh')?.hasRomanisation ? stripPinyin(verdict.betterKey.trim()) : verdict.betterKey.trim()) : '';
  const logged = await c.env.DB.prepare(
    `INSERT INTO answer_queries(lesson_id, place, kind, task, expected, answer, marked_right, learner_note, learner_right, key_wrong, explanation, better_key)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) RETURNING id`,
  )
    .bind(lesson?.id ?? null, str(b.place, 40) || kind, kind, str(b.task), expected, answer, b.markedRight ? 1 : 0, note || null, verdict.learnerRight ? 1 : 0, verdict.keyWrong ? 1 : 0, verdict.explanation.trim(), betterKey || null)
    .first<{ id: number }>();

  // A wrong answer key is corrected in the lesson straight away, wherever the question appears.
  const keyFixed = lesson && betterKey && logged ? await correctAnswerKey(c.env.DB, lesson, { kind: kind as WrongKey['kind'], task: str(b.task), expected, better: betterKey }, logged.id) : false;

  // On a lesson check, a mark won on query counts: rescore, and mark the lesson done if it now passes.
  let check = null;
  if (verdict.learnerRight && !b.markedRight && lesson && Number.isInteger(b.checkId) && Number.isInteger(b.itemIndex)) {
    const row = await c.env.DB.prepare('SELECT * FROM lesson_checks WHERE id = ?1 AND lesson_id = ?2').bind(b.checkId, lesson.id).first<{ id: number; passed: number; details_json: string }>();
    const details = row ? (JSON.parse(row.details_json) as { kind: string; right: boolean; answer: string; queried?: boolean }[]) : [];
    const item = details[b.itemIndex!];
    if (row && item && !item.right) {
      item.right = true;
      item.queried = true;
      const mark = await passMark(c.env.DB);
      const s = scoreCheck(details, mark);
      await c.env.DB.prepare('UPDATE lesson_checks SET score = ?1, passed = ?2, details_json = ?3 WHERE id = ?4').bind(s.score, s.passed ? 1 : 0, JSON.stringify(details), row.id).run();
      const done = s.passed && !row.passed ? await markDone(c.env, lesson) : null;
      check = { ...s, passMark: mark, done, checkId: row.id };
    }
  }
  return c.json({ learnerRight: verdict.learnerRight, keyWrong: verdict.keyWrong, explanation: verdict.explanation.trim(), betterKey, keyFixed, check });
});

/**
 * Put a corrected answer key into the lesson (and the copies reviews use: its drills as grammar
 * exercises, its errors as mistakes), if the question is found and the lesson stays valid. The
 * query is then closed as fixed.
 */
async function correctAnswerKey(db: D1Database, lesson: LessonRow, key: WrongKey, queryId: number): Promise<boolean> {
  const next = fixAnswerKey(JSON.parse(lesson.content_json) as LessonContent, key);
  if (!next || validateLesson(next, getLanguage(lesson.lang)?.script ?? 'han').length) return false;
  await db.batch([
    db.prepare('UPDATE lessons SET content_json = ?1, content_md = ?2 WHERE id = ?3').bind(JSON.stringify(next), renderLessonMd(next), lesson.id),
    db
      .prepare(
        `UPDATE OR IGNORE exercises SET zh = ?1 WHERE item_type = 'grammar_point' AND en = ?2 AND zh = ?3
           AND item_id IN (SELECT id FROM grammar_points WHERE lesson_id = ?4)`,
      )
      .bind(key.better, key.task, key.expected, lesson.id),
    db
      .prepare(`UPDATE mistakes SET right = ?1 WHERE wrong = ?2 AND right = ?3 AND grammar_point_id IN (SELECT id FROM grammar_points WHERE lesson_id = ?4)`)
      .bind(key.better, key.task, key.expected, lesson.id),
    db.prepare("UPDATE answer_queries SET status = 'fixed' WHERE id = ?1").bind(queryId),
  ]);
  return true;
}

lessonRoutes.post('/:id{[0-9]+}/undone', async (c) => {
  await c.env.DB.prepare('UPDATE lessons SET completed_at = NULL WHERE id = ?1').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

lessonRoutes.post('/generate', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { lang?: string; title?: string };
  const lang = body.lang ?? 'zh';
  const language = getLanguage(lang);
  if (!language || !hasPrompts(lang)) return c.json({ error: 'no lesson prompts for this language' }, 400);
  const next = await nextToGenerate(c.env.DB, lang);
  const custom = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : null;
  const item: PlanItem | undefined = custom ? { title: custom, level: lang === 'zh' ? 'HSK 3-4' : 'C1', focus: custom, slug: null } : next?.item;
  if (!item) return c.json({ error: 'curriculum finished; pass a title to generate a custom lesson' }, 400);
  const maxNo = (await c.env.DB.prepare('SELECT MAX(course_no) AS n FROM lessons WHERE lang = ?1').bind(lang).first<{ n: number | null }>())?.n ?? 0;
  const courseNo = maxNo + 1;

  const { results: covered } = await c.env.DB.prepare('SELECT title FROM lessons WHERE lang = ?1 ORDER BY course_no').bind(lang).all<{ title: string }>();
  const { results: mistakes } = await c.env.DB.prepare('SELECT wrong, right FROM mistakes WHERE lang = ?1 ORDER BY id DESC LIMIT 15').bind(lang).all<{ wrong: string; right: string }>();
  const measured = (await levelCheck(c.env.DB, lang))?.text ?? null;
  const profile = await learnerProfile(c.env.DB, lang);
  const explain = await explainFor(c.env.DB, lang);
  const request = [
    `Write lesson ${courseNo}: "${item.title}" (level ${item.level}).`,
    `Focus: ${item.focus}`,
    `Already covered (do not re-teach, but you may reuse): ${covered.map((r) => r.title.replace(/^Lesson \d+:\s*/, '')).join('; ')}.`,
    mistakes.length ? `Recurring mistakes of this learner (weave in a correction if relevant): ${mistakes.map((m) => `${m.wrong} → ${m.right}`).join('; ')}.` : '',
    `Learner level: ${measured ?? language.userLevel}`,
    profile ? `About the learner (personal context you may use in examples): ${profile}` : '',
    explain.instruction,
    `Use the title "Lesson ${courseNo}: ${item.title}".`,
  ]
    .filter(Boolean)
    .join('\n');

  let lesson: LessonContent;
  try {
    const draft = await callStructured(c.env, {
      role: 'lessons',
      system: [promptsFor(lang).lesson],
      messages: [{ role: 'user', content: request }],
      maxTokens: 8000,
      effort: 'medium',
      schema: LessonSchema,
      extraCheck: (v) => validateLesson(toLessonContent(v), language.script),
    });
    lesson = toLessonContent(await proofreadLesson(c.env, language, draft));
  } catch (e) {
    if (e instanceof StructuredOutputError) return c.json({ error: 'generation_failed', detail: e.message }, 502);
    const { status, body: err } = claudeErrorResponse(e);
    return c.json(err, status);
  }
  // Belt and braces for the pinyin rule (Chinese only: it would eat accented letters).
  if (language.hasRomanisation) {
    lesson.examples = lesson.examples.map((e) => ({ ...e, zh: stripPinyin(e.zh) }));
    lesson.drills = lesson.drills.map((d) => ({ ...d, zh: stripPinyin(d.zh) }));
    if (explain.target) {
      // Explanations written in Chinese: pinyin comes from the app.
      lesson.explanation = lesson.explanation.map((p) => stripPinyin(p));
      lesson.keyPoints = lesson.keyPoints.map((k) => stripPinyin(k));
    }
  }
  if (!lesson.title.startsWith(`Lesson ${courseNo}`)) lesson.title = `Lesson ${courseNo}: ${item.title}`;

  const ins = await c.env.DB.prepare(
    `INSERT INTO lessons(lang, title, level, content_json, content_md, course_no, source, slug, explain_lang) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'generated', ?7, ?8) RETURNING id`,
  )
    // A planned lesson keeps its pack id, so `course export --new` can pull it into the pack.
    .bind(lang, lesson.title, lesson.level, JSON.stringify(lesson), renderLessonMd(lesson), courseNo, item.slug, explain.code)
    .first<{ id: number }>();
  if (!ins) return c.json({ error: 'write failed' }, 500);
  for (const g of lesson.grammarPoints) {
    const gp = await c.env.DB.prepare('INSERT INTO grammar_points(lang, title, summary, lesson_id, meta_json) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id')
      .bind(lang, g.title, g.summary, ins.id, JSON.stringify({ courseNo }))
      .first<{ id: number }>();
    if (!gp) continue;
    await c.env.DB.batch([
      ...lesson.drills.map((d) =>
        c.env.DB.prepare(`INSERT OR IGNORE INTO exercises(lang, item_type, item_id, zh, en, source) VALUES (?1, 'grammar_point', ?2, ?3, ?4, 'lesson')`).bind(lang, gp.id, d.zh, d.en),
      ),
      ...lesson.errors.map((e) =>
        c.env.DB.prepare(`INSERT OR IGNORE INTO mistakes(lang, grammar_point_id, wrong, right, note, source) VALUES (?1, ?2, ?3, ?4, ?5, 'lesson')`).bind(lang, gp.id, e.wrong, e.right, e.note ?? null),
      ),
    ]);
    break; // drills and errors attach to the lesson's first grammar point
  }
  return c.json({ id: ins.id, title: lesson.title }, 201);
});

lessonRoutes.get('/mistakes', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.wrong, m.right, m.note, m.source, g.title AS grammar FROM mistakes m LEFT JOIN grammar_points g ON g.id = m.grammar_point_id WHERE m.lang = ?1 ORDER BY m.id`,
  )
    .bind(lang)
    .all();
  return c.json({ mistakes: results });
});
