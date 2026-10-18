// The course as files, in the app: download it, upload changes (a whole pack or single lessons),
// and have Claude plan the next lessons. The same checks and sync rules as `npm run course`.
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import { callStructured, claudeErrorResponse, StructuredOutputError } from './claude';
import { getLanguage } from '../core/languages';
import { SLUG } from '../core/course/lesson-file';
import { courseFromDb, courseToFiles, mergeUpload, packFromFiles } from '../core/course/files';
import { planSync, describeSync, type DbGrammarPoint, type DbLesson, type DbSnapshot, type DbTopic } from '../core/course/sync-plan';
import type { FileMap } from '../core/course/zip';
import { COURSE_PLAN_V1 } from '../../prompts';
import { learnerProfile } from './learner';
import { levelCheck } from './level';

export const courseRoutes = new Hono<{ Bindings: Env }>();

const LESSON_COLS = 'id, slug, course_no, source, title, content_json, completed_at, created_at';

async function lessonRows(db: D1Database, lang: string): Promise<DbLesson[]> {
  return (await db.prepare(`SELECT ${LESSON_COLS} FROM lessons WHERE lang = ?1 ORDER BY course_no IS NULL, course_no, created_at`).bind(lang).all<DbLesson>()).results;
}

async function snapshot(db: D1Database, lang: string): Promise<DbSnapshot> {
  const [lessons, gps, topics, plan] = await db.batch([
    db.prepare(`SELECT ${LESSON_COLS} FROM lessons WHERE lang = ?1`).bind(lang),
    db
      .prepare(
        `SELECT g.id, g.lesson_id, g.title, g.summary, (SELECT COUNT(*) FROM srs_cards s WHERE s.item_type = 'grammar_point' AND s.item_id = g.id) AS has_card
         FROM grammar_points g WHERE g.lang = ?1 AND g.lesson_id IS NOT NULL`,
      )
      .bind(lang),
    db.prepare('SELECT name, tags, scenario_seed FROM topics WHERE lang = ?1').bind(lang),
    db.prepare('SELECT slug FROM course_plan WHERE lang = ?1 ORDER BY position').bind(lang),
  ]);
  return {
    lessons: lessons!.results as unknown as DbLesson[],
    grammarPoints: gps!.results as unknown as DbGrammarPoint[],
    topics: topics!.results as unknown as DbTopic[],
    planSlugs: (plan!.results as { slug: string }[]).map((r) => r.slug),
  };
}

async function currentFiles(db: D1Database, lang: string): Promise<FileMap> {
  const [rows, plan, topics] = await Promise.all([
    lessonRows(db, lang),
    db.prepare('SELECT slug AS id, title, level, focus FROM course_plan WHERE lang = ?1 ORDER BY position').bind(lang).all<{ id: string; title: string; level: string; focus: string }>(),
    db.prepare('SELECT name, tags, scenario_seed FROM topics WHERE lang = ?1 ORDER BY id').bind(lang).all<DbTopic>(),
  ]);
  return courseToFiles(courseFromDb(lang, rows, plan.results, topics.results));
}

/** True when the upload is a whole pack, so the current course is not needed to merge into. */
function isWholePack(files: FileMap): boolean {
  return Object.keys(files).some((p) => p.split('/').pop() === 'course.json');
}

courseRoutes.get('/:lang/files', async (c) => {
  const lang = c.req.param('lang');
  if (!getLanguage(lang)) return c.json({ error: 'unknown language' }, 404);
  return c.json({ files: await currentFiles(c.env.DB, lang) });
});

/**
 * Check uploaded files and show what syncing them would change; with apply, do it. Files without a
 * course.json change the current course (see mergeUpload). Lessons left out are kept, never deleted.
 */
courseRoutes.post('/:lang/sync', async (c) => {
  const lang = c.req.param('lang');
  if (!getLanguage(lang)) return c.json({ error: 'unknown language' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { files?: unknown; apply?: unknown };
  const raw = body.files && typeof body.files === 'object' ? (body.files as Record<string, unknown>) : null;
  if (!raw || !Object.values(raw).every((v) => typeof v === 'string')) return c.json({ error: 'files must map file names to text' }, 400);
  const uploaded = raw as FileMap;
  if (!Object.keys(uploaded).length) return c.json({ error: 'no course files (.md or .json) found' }, 400);

  const { files, whole } = mergeUpload(isWholePack(uploaded) ? {} : await currentFiles(c.env.DB, lang), uploaded);
  const { pack, problems } = packFromFiles(files);
  if (!pack) return c.json({ ok: false, problems });
  if (pack.lang !== lang) return c.json({ ok: false, problems: [`course.json is for "${pack.lang}", but you are studying "${lang}" here. Switch language on the home screen first.`] });
  const plan = planSync(await snapshot(c.env.DB, lang), pack);
  const apply = body.apply === true;
  // One batch: D1 runs it as a single transaction, so a failure changes nothing.
  if (apply) await c.env.DB.batch(plan.sql.map((s) => c.env.DB.prepare(s)));
  return c.json({ ok: true, whole, applied: apply, lines: describeSync(plan) });
});

const PlanSchema = z.object({
  title: z.string(),
  planned: z.array(z.object({ id: z.string(), title: z.string(), level: z.string(), focus: z.string() })),
  topics: z.array(z.object({ name: z.string(), tags: z.array(z.string()), scenario: z.string() })),
});

/** Claude drafts the next lessons (and optionally topics) from the learner's goals. Nothing is saved. */
courseRoutes.post('/:lang/plan', async (c) => {
  const lang = c.req.param('lang');
  const language = getLanguage(lang);
  if (!language) return c.json({ error: 'unknown language' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { goals?: unknown; count?: unknown; topics?: unknown };
  const goals = typeof body.goals === 'string' ? body.goals.trim().slice(0, 2000) : '';
  const count = Math.min(30, Math.max(3, Math.round(Number(body.count) || 10)));
  const withTopics = body.topics === true;

  const db = c.env.DB;
  const [rows, plan, mistakes, measured, profile] = await Promise.all([
    lessonRows(db, lang),
    db.prepare('SELECT slug, title FROM course_plan WHERE lang = ?1 ORDER BY position').bind(lang).all<{ slug: string; title: string }>(),
    db.prepare('SELECT wrong, right FROM mistakes WHERE lang = ?1 ORDER BY id DESC LIMIT 15').bind(lang).all<{ wrong: string; right: string }>(),
    levelCheck(db, lang),
    learnerProfile(db, lang),
  ]);
  // Ids of written lessons, including the ones a download gives to lessons that have none yet.
  const usedIds = new Set(courseFromDb(lang, rows, [], []).lessons.map((l) => l.id));
  const request = [
    `Language being learnt: ${language.name}.`,
    `Learner's level: ${measured?.text ?? language.userLevel}.`,
    profile ? `About the learner: ${profile}` : '',
    goals ? `The learner's goals, in their words: ${goals}` : 'The learner gave no particular goals: plan a well-rounded next step.',
    rows.length
      ? `Lessons already in the course, in order (✓ = done):\n${rows.map((r) => `- ${r.title}${r.completed_at ? ' ✓' : ''}`).join('\n')}`
      : 'The course has no lessons yet.',
    plan.results.length
      ? `Lessons planned so far, which your plan replaces (keep any that still fit, with the same id):\n${plan.results.map((p) => `- ${p.slug}: ${p.title}`).join('\n')}`
      : '',
    mistakes.results.length ? `Recurring mistakes: ${mistakes.results.map((m) => `${m.wrong} → ${m.right}`).join('; ')}.` : '',
    usedIds.size ? `Ids already used by written lessons (do not use): ${[...usedIds].join(', ')}.` : '',
    `Plan the next ${count} lessons.${withTopics ? ' Also write 20 conversation topics.' : ' No topics.'}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const out = await callStructured(c.env, {
      role: 'lessons',
      system: [COURSE_PLAN_V1],
      messages: [{ role: 'user', content: request }],
      maxTokens: 8000,
      schema: PlanSchema,
      effort: 'medium',
      extraCheck: (v) => {
        const problems: string[] = [];
        if (v.planned.length === 0) problems.push('the plan is empty');
        const seen = new Set<string>();
        for (const p of v.planned) {
          if (!SLUG.test(p.id)) problems.push(`id "${p.id}" must be lower-case letters, digits and hyphens`);
          else if (usedIds.has(p.id)) problems.push(`id "${p.id}" is already used by a written lesson`);
          else if (seen.has(p.id)) problems.push(`id "${p.id}" is used twice`);
          seen.add(p.id);
          if (!p.title.trim() || !p.focus.trim()) problems.push(`lesson "${p.id}" needs a title and a focus`);
        }
        const names = new Set<string>();
        for (const t of v.topics) {
          if (names.has(t.name)) problems.push(`topic "${t.name}" is listed twice`);
          names.add(t.name);
          if (!t.tags.length || t.tags.some((x) => !x.trim() || x.includes(','))) problems.push(`topic "${t.name}": tags must be single words`);
        }
        return problems;
      },
    });
    return c.json({ title: out.title, planned: out.planned, topics: withTopics ? out.topics : null });
  } catch (e) {
    if (e instanceof StructuredOutputError) return c.json({ error: 'plan_failed', detail: e.message }, 502);
    const { status, body: err } = claudeErrorResponse(e);
    return c.json(err, status);
  }
});
