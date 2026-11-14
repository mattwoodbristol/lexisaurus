// Themed vocabulary: Claude plans a short course (a few days) of words, phrases and grammar
// around a theme the learner picks (or one of the suggestions), and writes it a day at a time;
// the app checks it, shows which words are already known, keeps the quiz scores and which days
// are done, and adds each finished day's words to reviews.
import { Hono } from 'hono';
import { z } from 'zod';
import { createEmptyCard } from 'ts-fsrs';
import type { Env } from './env';
import { callStructured, claudeErrorResponse } from './claude';
import { annotateStrings } from './annotate';
import { getDict, invalidateDict } from './words';
import { pinyinForWord } from './pinyin';
import { levelCheck } from './level';
import { learnerProfile } from './learner';
import { getSetting, localToday } from './day';
import { getLanguage, type LanguageConfig } from '../core/languages';
import { DEFAULT_NATIVE, nativeLanguage } from '../core/languages/native';
import { rulesFor } from '../core/text/rules';
import { stripPinyin } from '../core/pinyin/strip';
import {
  DAY_LIMITS,
  cleanEmoji,
  currentDay,
  dayOf,
  dayProblems,
  dayWritten,
  themeDays,
  themeEntries,
  themeLemmas,
  themeProblems,
  type ThemeContent,
  type ThemeGrammar,
  type ThemeSection,
} from '../core/themes/types';
import { THEME_IDEAS } from '../core/themes/suggestions';
import { THEME_PIN } from '../core/review/queue';
import { themeIdeasPrompt, themePrompt } from '../../prompts/themes.v1';

export const themeRoutes = new Hono<{ Bindings: Env }>();

const Diagram = z.object({
  shapes: z.array(z.object({ d: z.string(), tone: z.enum(['line', 'light', 'mid', 'dark', 'accent']) })),
  markers: z.array(z.object({ item: z.number().int(), x: z.number(), y: z.number() })),
});
const Day = {
  sections: z.array(
    z.object({
      heading: z.string(),
      items: z.array(z.object({ kind: z.enum(['word', 'phrase']), text: z.string(), translation: z.string(), lemma: z.string().nullable(), note: z.string(), emoji: z.string() })),
      diagram: Diagram.nullable(),
    }),
  ),
  grammar: z.array(z.object({ title: z.string(), explanation: z.string(), examples: z.array(z.object({ text: z.string(), translation: z.string() })) })),
};
const FirstDay = z.object({ title: z.string(), intro: z.string(), days: z.array(z.object({ title: z.string(), focus: z.string() })), ...Day });
const LaterDay = z.object({ dayTitle: z.string(), ...Day });

const Ideas = z.object({ ideas: z.array(z.object({ name: z.string(), hint: z.string() })) });

interface Row {
  id: number;
  lang: string;
  title: string;
  request: string;
  content_json: string;
  score: number | null;
  total: number | null;
  practised_at: string | null;
  daily: number;
  days_done: number;
  last_done_date: string | null;
  created_at: string;
  updated_at: string;
}

const MAX_NAME = 120;
const MAX_HINT = 400;

async function nativeName(db: D1Database): Promise<string> {
  return nativeLanguage(await getSetting<unknown>(db, 'native_lang', DEFAULT_NATIVE)).english;
}

async function context(env: Env, language: LanguageConfig) {
  const db = env.DB;
  const [measured, profile, native] = await Promise.all([levelCheck(db, language.id), learnerProfile(db, language.id), nativeName(db)]);
  return {
    system: themePrompt({ langName: language.name, nativeName: native, han: language.hasRomanisation, latin: language.script === 'latin' }),
    lines: [
      `Learner level (general conversation): ${measured?.text ?? language.userLevel}. The theme's words may go well beyond this level; keep explanations and example sentences easy.`,
      profile ? `About the learner (use lightly): ${profile}` : null,
    ],
  };
}

/** Tidy one day's model output and tag it with its day. */
function tidyDay(language: LanguageConfig, day: number, out: z.infer<typeof LaterDay> | z.infer<typeof FirstDay>): { sections: ThemeSection[]; grammar: ThemeGrammar[] } {
  const rules = rulesFor(language.script);
  const clean = (s: string) => (language.hasRomanisation ? stripPinyin(s) : s).trim();
  return {
    sections: out.sections.map((s) => ({
      heading: s.heading.trim(),
      day,
      diagram: s.diagram ? { shapes: s.diagram.shapes.map((sh) => ({ d: sh.d.trim(), tone: sh.tone })), markers: s.diagram.markers.map((m) => ({ item: m.item, x: Math.round(m.x), y: Math.round(m.y) })) } : null,
      items: s.items.map((it) => ({
        kind: it.kind,
        text: clean(it.text),
        translation: it.translation.trim(),
        lemma: it.kind === 'word' && it.lemma ? rules.key(clean(it.lemma)) : null,
        note: it.note.trim(),
        emoji: cleanEmoji(it.emoji),
      })),
    })),
    grammar: out.grammar.map((g) => ({
      title: g.title.trim(),
      day,
      explanation: g.explanation.trim(),
      examples: g.examples.map((e) => ({ text: clean(e.text), translation: e.translation.trim() })),
    })),
  };
}

/** Plan a theme over `days` days and write day 1. */
async function writeTheme(env: Env, language: LanguageConfig, request: string, days: number): Promise<ThemeContent> {
  const rules = rulesFor(language.script);
  const ctx = await context(env, language);
  const out = await callStructured(env, {
    role: 'lessons',
    effort: 'medium',
    system: [ctx.system],
    messages: [{ role: 'user', content: [`Plan this theme over exactly ${days} days (title and focus for each), then write day 1.`, `Theme: ${request}`, ...ctx.lines].filter(Boolean).join('\n') }],
    maxTokens: 16000,
    schema: FirstDay,
    extraCheck: (v) => themeProblems({ ...v, sections: v.sections.map((s) => ({ ...s, day: 1 })), grammar: v.grammar }, days, rules.hasTarget, rules.isLookup),
  });
  return { title: out.title.trim(), intro: out.intro.trim(), days: out.days.map((d) => ({ title: d.title.trim(), focus: d.focus.trim() })), ...tidyDay(language, 1, out) };
}

/** Write day `day` of a theme (a planned day, or one more beyond the plan). */
async function writeDay(env: Env, language: LanguageConfig, request: string, content: ThemeContent, day: number): Promise<ThemeContent> {
  const rules = rulesFor(language.script);
  const ctx = await context(env, language);
  const covered = content.sections.flatMap((s) => s.items.map((it) => it.text));
  const plan = content.days ?? [];
  const planLines = plan.map((d, i) => `Day ${i + 1}: ${d.title} - ${d.focus}`);
  const ask = day <= plan.length ? `Write day ${day} of ${plan.length} (dayTitle: its title from the plan).` : `Write one more day (day ${day}) that goes further into the theme than the plan; dayTitle is its title.`;
  const out = await callStructured(env, {
    role: 'lessons',
    effort: 'medium',
    system: [ctx.system],
    messages: [
      {
        role: 'user',
        content: [ask, `Theme: ${request}`, planLines.length ? `Plan:\n${planLines.join('\n')}` : null, ...ctx.lines, `Already covered, repeat none: ${covered.join(language.hasRomanisation ? '、' : '; ')}`, `Grammar already taught: ${content.grammar.map((g) => g.title).join('; ')}`]
          .filter(Boolean)
          .join('\n'),
      },
    ],
    maxTokens: 14000,
    schema: LaterDay,
    extraCheck: (v) => dayProblems(v, rules.hasTarget, rules.isLookup, covered),
  });
  const written = tidyDay(language, day, out);
  const days = day <= plan.length ? plan : [...plan, ...(plan.length ? [] : [{ title: content.title, focus: '' }]), { title: out.dayTitle.trim(), focus: 'More detail' }];
  return { ...content, days, sections: [...content.sections, ...written.sections], grammar: [...content.grammar, ...written.grammar] };
}

async function loadTheme(db: D1Database, id: number): Promise<(Row & { content: ThemeContent }) | null> {
  const row = await db.prepare('SELECT * FROM themes WHERE id = ?1').bind(id).first<Row>();
  return row ? { ...row, content: JSON.parse(row.content_json) as ThemeContent } : null;
}

/** Days being written in this isolate, so a background write and a tap do not both pay. */
const writing = new Map<string, Promise<void>>();

/** Write a day unless it is written (or being written); the stored theme is re-read before saving. */
function ensureDay(env: Env, id: number, day: number): Promise<void> {
  const key = `${id}:${day}`;
  const running = writing.get(key);
  if (running) return running;
  const job = (async () => {
    const t = await loadTheme(env.DB, id);
    if (!t || dayWritten(t.content, day)) return;
    if (day > 1 && !dayWritten(t.content, day - 1)) throw new Error('write the days in order');
    const language = getLanguage(t.lang);
    if (!language) throw new Error('unknown language');
    const next = await writeDay(env, language, t.request, t.content, day);
    const now = await loadTheme(env.DB, id);
    if (!now || dayWritten(now.content, day)) return;
    await env.DB.prepare("UPDATE themes SET content_json = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2").bind(JSON.stringify(next), id).run();
  })().finally(() => writing.delete(key));
  writing.set(key, job);
  return job;
}

themeRoutes.get('/', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const { results } = await c.env.DB.prepare('SELECT * FROM themes WHERE lang = ?1 ORDER BY updated_at DESC LIMIT 100').bind(lang).all<Row>();
  const items = results.map(({ content_json, lang: _l, ...r }) => {
    const content = JSON.parse(content_json) as ThemeContent;
    return { ...r, items: themeEntries(content).length, days: themeDays(content) };
  });
  // Built-in ideas not yet written.
  const done = new Set(results.map((r) => r.request.split('\n')[0]!.trim().toLowerCase()));
  return c.json({ items, ideas: THEME_IDEAS.filter((i) => !done.has(i.name.toLowerCase())) });
});

/** Themes followed daily and not finished, for the home screen: today's day and whether it is done. */
themeRoutes.get('/today', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const db = c.env.DB;
  const [{ results }, today] = await Promise.all([db.prepare('SELECT * FROM themes WHERE lang = ?1 AND daily = 1 ORDER BY updated_at DESC').bind(lang).all<Row>(), localToday(db)]);
  const themes = results
    .map((r) => {
      const content = JSON.parse(r.content_json) as ThemeContent;
      const days = themeDays(content);
      const doneToday = r.last_done_date === today.date;
      if (r.days_done >= days && !doneToday) return null; // finished on an earlier day
      const day = doneToday ? r.days_done : currentDay(r.days_done, days);
      return { id: r.id, title: r.title, day, days, dayTitle: content.days?.[day - 1]?.title ?? null, doneToday };
    })
    .filter(Boolean);
  return c.json({ themes });
});

themeRoutes.post('/ideas', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { lang?: unknown };
  const language = typeof body.lang === 'string' ? getLanguage(body.lang) : undefined;
  if (!language) return c.json({ error: 'unknown language' }, 400);
  const db = c.env.DB;
  const [{ results }, profile, native] = await Promise.all([
    db.prepare('SELECT title FROM themes WHERE lang = ?1 ORDER BY updated_at DESC LIMIT 40').bind(language.id).all<{ title: string }>(),
    learnerProfile(db, language.id),
    nativeName(db),
  ]);
  const done = [...results.map((r) => r.title), ...THEME_IDEAS.map((i) => i.name)];
  try {
    const out = await callStructured(c.env, {
      role: 'chat',
      system: [themeIdeasPrompt({ langName: language.name, nativeName: native })],
      messages: [{ role: 'user', content: [`Already done or already offered: ${done.join('; ')}`, profile ? `About the learner: ${profile}` : null].filter(Boolean).join('\n') }],
      maxTokens: 1500,
      schema: Ideas,
      extraCheck: (v) => (v.ideas.length < 3 ? ['suggest 8 themes'] : []),
    });
    return c.json({ ideas: out.ideas.map((i) => ({ name: i.name.trim().slice(0, MAX_NAME), hint: i.hint.trim().slice(0, MAX_HINT) })).filter((i) => i.name) });
  } catch (e) {
    const { status, body: err } = claudeErrorResponse(e);
    return c.json(err, status);
  }
});

themeRoutes.post('/generate', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { lang?: unknown; name?: unknown; hint?: unknown; days?: unknown; daily?: unknown };
  const language = typeof body.lang === 'string' ? getLanguage(body.lang) : undefined;
  if (!language) return c.json({ error: 'unknown language' }, 400);
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  if (!name) return c.json({ error: 'name the theme' }, 400);
  const hint = typeof body.hint === 'string' ? body.hint.trim().slice(0, MAX_HINT) : '';
  const asked = Number(body.days);
  const days = Number.isInteger(asked) ? Math.min(DAY_LIMITS.max, Math.max(DAY_LIMITS.min, asked)) : DAY_LIMITS.default;
  const request = hint ? `${name}\n${hint}` : name;
  try {
    const content = await writeTheme(c.env, language, request, days);
    const row = await c.env.DB.prepare('INSERT INTO themes(lang, title, request, content_json, daily) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id')
      .bind(language.id, content.title, request, JSON.stringify(content), body.daily === false ? 0 : 1)
      .first<{ id: number }>();
    return c.json({ id: row!.id });
  } catch (e) {
    const { status, body: err } = claudeErrorResponse(e);
    return c.json(err, status);
  }
});

themeRoutes.get('/:id{[0-9]+}', async (c) => {
  const db = c.env.DB;
  const t = await loadTheme(db, Number(c.req.param('id')));
  if (!t) return c.json({ error: 'not found' }, 404);
  const language = getLanguage(t.lang);
  const rules = rulesFor(language?.script ?? 'han');
  // Statuses and pinyin worked out now, not when written: words learnt since then show as such.
  const [annotations, dict, today] = await Promise.all([annotateStrings(db, t.lang, themeEntries(t.content).map((e) => e.text)), getDict(db, t.lang), localToday(db)]);
  const statuses: Record<string, 'known' | 'learning' | 'new' | 'unknown'> = {};
  for (const l of themeLemmas(t.content, rules.key)) statuses[l] = dict.get(l)?.status ?? 'unknown';
  return c.json({
    theme: {
      id: t.id,
      lang: t.lang,
      request: t.request,
      score: t.score,
      total: t.total,
      practisedAt: t.practised_at,
      createdAt: t.created_at,
      daily: !!t.daily,
      daysDone: t.days_done,
      doneToday: t.last_done_date === today.date,
      ...t.content,
    },
    annotations,
    statuses,
  });
});

/** Write a day: the next planned one, or one more beyond the plan ("go deeper"). */
themeRoutes.post('/:id{[0-9]+}/days/:day{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'));
  const day = Number(c.req.param('day'));
  const t = await loadTheme(c.env.DB, id);
  if (!t) return c.json({ error: 'not found' }, 404);
  if (day < 1 || day > themeDays(t.content) + 1 || day > DAY_LIMITS.max * 2) return c.json({ error: 'no such day' }, 400);
  try {
    await ensureDay(c.env, id, day);
    return c.json({ ok: true });
  } catch (e) {
    const { status, body: err } = claudeErrorResponse(e);
    return c.json(err, status);
  }
});

/** Add words to reviews; see addWords. Without `lemmas`, all the theme's words. */
themeRoutes.post('/:id{[0-9]+}/learn', async (c) => {
  const t = await loadTheme(c.env.DB, Number(c.req.param('id')));
  if (!t) return c.json({ error: 'not found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { lemmas?: unknown };
  const lemmas = Array.isArray(body.lemmas) ? body.lemmas.filter((l): l is string => typeof l === 'string') : undefined;
  return c.json({ added: await addWords(c.env.DB, t, lemmas) });
});

/**
 * Add the theme's words to reviews: words not in the list are added with the theme's translation
 * as their gloss, whatever their level (theme words are often outside the graded lists); pool
 * words become learning. Cards are pinned with THEME_PIN: the learner has studied these, so they
 * skip the daily new-word ration and the level reach, but reviews mix them into each set (at most
 * a share of it) instead of putting them first, so a theme a day does not take reviews over.
 * Known words, and words already in reviews, are left alone.
 */
async function addWords(db: D1Database, t: Row & { content: ThemeContent }, only?: string[], day?: number): Promise<number> {
  const language = getLanguage(t.lang);
  if (!language) return 0;
  const rules = rulesFor(language.script);
  const glosses = new Map<string, string>();
  for (const s of t.content.sections) if (day === undefined || dayOf(s) === day) for (const it of s.items) if (it.lemma) glosses.set(rules.key(it.lemma), it.translation);
  const wanted = only ? only.map((l) => rules.key(l.trim())) : [...glosses.keys()];
  const lemmas = [...new Set(wanted)].filter((l) => glosses.has(l) && rules.isLookup(l));
  if (!lemmas.length) return 0;
  const dict = await getDict(db, t.lang);
  const now = new Date();
  const card = JSON.stringify(createEmptyCard(now));
  let added = 0;
  for (const lemma of lemmas) {
    const status = dict.get(lemma)?.status;
    if (status === 'known' || status === 'learning') continue;
    const word = await db
      .prepare(
        `INSERT INTO words(lang, lemma, reading, gloss, source, status) VALUES (?1, ?2, ?3, ?4, 'manual', 'learning')
         ON CONFLICT(lang, lemma) DO UPDATE SET status = 'learning', gloss = COALESCE(words.gloss, excluded.gloss) RETURNING id`,
      )
      .bind(t.lang, lemma, language.hasRomanisation ? pinyinForWord(lemma) : null, glosses.get(lemma) ?? null)
      .first<{ id: number }>();
    if (!word) continue;
    await db
      .prepare(
        `INSERT INTO srs_cards(item_type, item_id, lang, fsrs_state_json, due_at, pinned) VALUES ('word', ?1, ?2, ?3, ?4, ${THEME_PIN})
         ON CONFLICT(item_type, item_id) DO UPDATE SET pinned = CASE WHEN pinned = 1 THEN 1 ELSE ${THEME_PIN} END`,
      )
      .bind(word.id, t.lang, card, now.toISOString())
      .run();
    added++;
  }
  if (added) invalidateDict(t.lang);
  return added;
}

/**
 * A day's quiz is finished: the day is done (the score is kept), its words go into reviews, and
 * the next planned day is written in the background so it is ready tomorrow.
 */
themeRoutes.post('/:id{[0-9]+}/days/:day{[0-9]+}/done', async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const day = Number(c.req.param('day'));
  const body = (await c.req.json().catch(() => ({}))) as { score?: unknown; total?: unknown };
  const score = Number(body.score);
  const total = Number(body.total);
  if (!Number.isInteger(score) || !Number.isInteger(total) || total <= 0 || score < 0 || score > total) return c.json({ error: 'score and total required' }, 400);
  const t = await loadTheme(db, id);
  if (!t) return c.json({ error: 'not found' }, 404);
  if (!dayWritten(t.content, day)) return c.json({ error: 'no such day' }, 400);
  const today = await localToday(db);
  await db
    .prepare("UPDATE themes SET score = ?1, total = ?2, practised_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), days_done = MAX(days_done, ?3), last_done_date = ?4 WHERE id = ?5")
    .bind(score, total, day, today.date, id)
    .run();
  const added = await addWords(db, t, undefined, day);
  if (day < themeDays(t.content) && !dayWritten(t.content, day + 1)) c.executionCtx.waitUntil(ensureDay(c.env, id, day + 1).catch((e) => console.error(`[themes] day ${day + 1} of ${id} failed`, e)));
  return c.json({ ok: true, added });
});

/** A whole-theme quiz (any day): only the score is kept. */
themeRoutes.post('/:id{[0-9]+}/result', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { score?: unknown; total?: unknown };
  const score = Number(body.score);
  const total = Number(body.total);
  if (!Number.isInteger(score) || !Number.isInteger(total) || total <= 0 || score < 0 || score > total) return c.json({ error: 'score and total required' }, 400);
  const r = await c.env.DB.prepare("UPDATE themes SET score = ?1, total = ?2, practised_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?3")
    .bind(score, total, Number(c.req.param('id')))
    .run();
  if (!r.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

themeRoutes.put('/:id{[0-9]+}/daily', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { daily?: unknown };
  await c.env.DB.prepare('UPDATE themes SET daily = ?1 WHERE id = ?2').bind(body.daily ? 1 : 0, Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

themeRoutes.delete('/:id{[0-9]+}', async (c) => {
  await c.env.DB.prepare('DELETE FROM themes WHERE id = ?1').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});
