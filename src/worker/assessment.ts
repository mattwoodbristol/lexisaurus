// Level check (words, grammar, optional writing) and "Sort my words". The app runs the questions;
// these routes prepare them, apply the answers to the word list and store the result, which then
// sets the level the tutor and lesson writer are told and the order new words come in.
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import { callStructured, claudeErrorResponse } from './claude';
import { getLanguage } from '../core/languages';
import { pinyinForWord } from './pinyin';
import { invalidateDict } from './words';
import { levelCheck, type LevelCheck } from './level';
import { markDone, type LessonRow } from './lessons';
import { assessWordsPrompt, starterWordsPrompt, assessWritingPrompt, grammarBankPrompt, pseudoCheckPrompt, sortGlossPrompt, writingPrompt } from '../../prompts';
import { BANDS, estimateGrammar, estimateVocab, lessonsBelow, levelText, sampleVocab, seededShuffle, bandLabel, starterBands, type GrammarAnswer, type LevelResult, type ListWord } from '../core/assessment/levels';
import { getSetting, poolMaxBand } from './day';
import { cleanGloss, tidyListGloss } from '../core/words/gloss';

export const assessmentRoutes = new Hono<{ Bindings: Env }>();

const PER_BAND = 8;
const PSEUDO = 10;
const BANK_MIN = 30;

const WordsSchema = z.object({
  pseudowords: z.array(z.string()),
  fillers: z.array(z.object({ band: z.number().int(), word: z.string(), gloss: z.string() })),
});
const BankSchema = z.object({
  items: z.array(z.object({ band: z.number().int(), prompt: z.string(), options: z.array(z.string()), answer: z.number().int(), topic: z.string() })),
});
const WritingSchema = z.object({
  band: z.number().int(),
  comment: z.string(),
  errors: z.array(z.object({ wrong: z.string(), right: z.string(), note: z.string() })),
});

/** Start a check: the vocabulary items (own words per band, gap fillers, made-up words), shuffled. */
assessmentRoutes.post('/start', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { lang?: string };
  const lang = body.lang ?? 'zh';
  const language = getLanguage(lang);
  if (!language) return c.json({ error: 'unknown language' }, 400);
  const db = c.env.DB;
  const { results } = await db
    .prepare('SELECT id, lemma, gloss, level AS band FROM words WHERE lang = ?1 AND level IS NOT NULL AND gloss IS NOT NULL')
    .bind(lang)
    .all<ListWord>();
  const words = results.map((w) => ({ ...w, gloss: w.gloss ? tidyListGloss(w.gloss) : null }));
  const seed = Date.now() % 1_000_000;
  const { picked, short } = sampleVocab(words, PER_BAND, seed);
  let pseudo: string[] = [];
  let fillers: { band: number; word: string; gloss: string }[] = [];
  try {
    const ask = Object.entries(short).map(([b, n]) => `band ${b}: ${n}`).join(', ');
    const out = await callStructured(c.env, {
      role: 'exercises',
      system: [assessWordsPrompt(language.name, lang)],
      messages: [
        {
          role: 'user',
          content: [`pseudowords: ${PSEUDO + 10}`, ask ? `fillers: ${ask}` : 'fillers: none', `Excluded words: ${picked.map((p) => p.lemma).slice(0, 80).join(', ')}`].join('\n'),
        },
      ],
      maxTokens: 2500,
      schema: WordsSchema,
    });
    const known = new Set(words.map((w) => w.lemma));
    const candidates = out.pseudowords.map((p) => p.trim()).filter((p) => p && !known.has(p));
    // Second opinion: a "made-up" word that is real would count knowing it against the learner.
    const check = await callStructured(c.env, {
      role: 'exercises',
      system: [pseudoCheckPrompt(language.name)],
      messages: [{ role: 'user', content: candidates.join('\n') }],
      maxTokens: 600,
      schema: z.object({ real: z.array(z.string()) }),
    });
    const real = new Set(check.real.map((r) => r.trim().toLowerCase()));
    pseudo = candidates.filter((p) => !real.has(p.toLowerCase())).slice(0, PSEUDO);
    fillers = out.fillers.filter((f) => BANDS.includes(f.band as 1) && f.word.trim() && !known.has(f.word.trim()));
  } catch (e) {
    const { status, body: err } = claudeErrorResponse(e);
    return c.json(err, status);
  }
  const items = seededShuffle(
    [
      ...picked.map((w) => ({ wordId: w.id, word: w.lemma, band: w.band, gloss: w.gloss, pseudo: false })),
      ...fillers.map((f) => ({ wordId: null, word: f.word.trim(), band: f.band, gloss: f.gloss.trim(), pseudo: false })),
      ...pseudo.map((p) => ({ wordId: null, word: p, band: 0, gloss: null, pseudo: true })),
    ],
    seed,
  );
  const ins = await db.prepare('INSERT INTO assessments(lang) VALUES (?1) RETURNING id').bind(lang).first<{ id: number }>();
  return c.json({ assessmentId: ins!.id, words: items });
});

/** Apply the vocabulary answers to the word list and score them. */
assessmentRoutes.post('/:id{[0-9]+}/words', async (c) => {
  const id = Number(c.req.param('id'));
  const a = await c.env.DB.prepare('SELECT lang FROM assessments WHERE id = ?1').bind(id).first<{ lang: string }>();
  if (!a) return c.json({ error: 'not found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { answers?: { wordId?: number | null; word?: string; band?: number; gloss?: string | null; pseudo?: boolean; known?: boolean }[] };
  const answers = (body.answers ?? []).filter((x) => typeof x.word === 'string' && x.word.trim());
  if (!answers.length) return c.json({ error: 'answers required' }, 400);
  const lang = a.lang;
  const language = getLanguage(lang);
  const db = c.env.DB;
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const x of answers) {
    if (x.pseudo) continue;
    const known = x.known === true;
    if (x.wordId) {
      // Known: out of the pool (a learning word keeps its card). Not known: back into the pool, queued first.
      stmts.push(
        known
          ? db.prepare("UPDATE words SET status = CASE WHEN status = 'new' THEN 'known' ELSE status END, triaged_at = ?2 WHERE id = ?1").bind(x.wordId, now)
          : db.prepare("UPDATE words SET status = CASE WHEN status = 'known' THEN 'new' ELSE status END, triaged_at = ?2 WHERE id = ?1").bind(x.wordId, now),
      );
    } else if (x.band && BANDS.includes(x.band as 1)) {
      // A gap filler: added to the list either way (known, or queued to learn at this level).
      stmts.push(
        db
          .prepare(
            `INSERT INTO words(lang, lemma, reading, gloss, source, status, level, triaged_at) VALUES (?1, ?2, ?3, ?4, 'manual', ?5, ?6, ?7)
             ON CONFLICT(lang, lemma) DO NOTHING`,
          )
          .bind(lang, x.word!.trim(), language?.hasRomanisation ? pinyinForWord(x.word!.trim()) : null, x.gloss ?? null, known ? 'known' : 'new', x.band, now),
      );
    }
  }
  if (stmts.length) await db.batch(stmts);
  invalidateDict(lang);
  const est = estimateVocab(answers.map((x) => ({ band: x.band ?? 0, pseudo: !!x.pseudo, known: x.known === true })));
  await db.prepare('UPDATE assessments SET vocab_json = ?1 WHERE id = ?2').bind(JSON.stringify(est), id).run();
  // A new language's pool is empty, or holds only the check's words: fill it at the measured level
  // while the rest of the check runs.
  c.executionCtx.waitUntil(fillStarterPool(c.env, lang, est.band));
  return c.json({ ...est, label: bandLabel(lang, est.band) });
});

/** Fewer unsorted new words than this at the learner's level (and the next) and the pool gets more. */
const STARTER_MIN = 40;
/** Starter words asked for per band. */
const STARTER_PER_BAND = 30;

/**
 * Keep the pool stocked at the learner's level (cron): once a level check has measured it, a pool
 * running low on unsorted words there gets more. Also covers a fill after the check that was cut
 * short (it runs after the response, where time is limited).
 */
export async function topUpStarterPool(env: Env, lang: string): Promise<void> {
  const check = await levelCheck(env.DB, lang);
  if (check && check.vocab !== null) await fillStarterPool(env, lang, check.vocab);
}

/**
 * Give the pool common words at the measured band and the next one up when it has few unsorted
 * ones, so reviews introduce everyday words at the learner's level rather than whatever the check
 * turned up, and Sort my words has words to sort.
 */
async function fillStarterPool(env: Env, lang: string, band: number): Promise<void> {
  const language = getLanguage(lang);
  if (!language) return;
  const db = env.DB;
  const bands = starterBands(band);
  try {
    const have = await db
      .prepare(`SELECT COUNT(*) AS n FROM words WHERE lang = ?1 AND status = 'new' AND triaged_at IS NULL AND level IN (${bands.join(',')})`)
      .bind(lang)
      .first<{ n: number }>();
    if ((have?.n ?? 0) >= STARTER_MIN) return;
    const { results: listed } = await db
      .prepare(`SELECT lemma FROM words WHERE lang = ?1 AND level IN (${bands.join(',')}) ORDER BY id DESC LIMIT 600`)
      .bind(lang)
      .all<{ lemma: string }>();
    const out = await callStructured(env, {
      role: 'exercises',
      system: [starterWordsPrompt(language.name, lang)],
      messages: [
        {
          role: 'user',
          content: [`words: ${bands.map((b) => `band ${b}: ${STARTER_PER_BAND}`).join(', ')}`, listed.length ? `Excluded words: ${listed.map((w) => w.lemma).join(', ')}` : ''].filter(Boolean).join('\n'),
        },
      ],
      maxTokens: 120 + bands.length * STARTER_PER_BAND * 25,
      schema: z.object({ words: z.array(z.object({ band: z.number().int(), word: z.string(), gloss: z.string() })) }),
    });
    const stmts = out.words
      .filter((w) => bands.includes(w.band) && w.word.trim() && w.gloss.trim())
      .map((w) =>
        db
          .prepare(`INSERT INTO words(lang, lemma, reading, gloss, source, status, level) VALUES (?1, ?2, ?3, ?4, 'manual', 'new', ?5) ON CONFLICT(lang, lemma) DO NOTHING`)
          .bind(lang, w.word.trim(), language.hasRomanisation ? pinyinForWord(w.word.trim()) : null, cleanGloss(w.gloss), w.band),
      );
    if (stmts.length) await db.batch(stmts);
    invalidateDict(lang);
  } catch (e) {
    // No key or budget: the pool fills from lessons and chats as before.
    console.error('starter pool failed', e);
  }
}

/** The grammar question bank for a language, written once (Sonnet) and kept. */
assessmentRoutes.get('/grammar', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const language = getLanguage(lang);
  if (!language) return c.json({ error: 'unknown language' }, 400);
  const db = c.env.DB;
  const load = () => db.prepare('SELECT id, band, item_json FROM assessment_items WHERE lang = ?1 ORDER BY id').bind(lang).all<{ id: number; band: number; item_json: string }>();
  let { results } = await load();
  if (results.length < BANK_MIN) {
    try {
      const out = await callStructured(c.env, {
        role: 'lessons',
        system: [grammarBankPrompt(language.name, lang)],
        messages: [{ role: 'user', content: 'Write the 36 questions.' }],
        maxTokens: 12000,
        effort: 'medium',
        schema: BankSchema,
        extraCheck: (v) => {
          const bad = v.items.filter((i) => !BANDS.includes(i.band as 1) || i.options.length < 2 || i.answer < 0 || i.answer >= i.options.length);
          return v.items.length < BANK_MIN ? [`only ${v.items.length} questions`] : bad.length ? [`${bad.length} malformed questions`] : [];
        },
      });
      await db.batch(out.items.map((i) => db.prepare('INSERT INTO assessment_items(lang, band, item_json) VALUES (?1, ?2, ?3)').bind(lang, i.band, JSON.stringify(i))));
      ({ results } = await load());
    } catch (e) {
      const { status, body } = claudeErrorResponse(e);
      return c.json(body, status);
    }
  }
  return c.json({ items: results.map((r) => ({ id: r.id, band: r.band, ...(JSON.parse(r.item_json) as object) })) });
});

assessmentRoutes.post('/:id{[0-9]+}/grammar', async (c) => {
  const id = Number(c.req.param('id'));
  const a = await c.env.DB.prepare('SELECT lang FROM assessments WHERE id = ?1').bind(id).first<{ lang: string }>();
  if (!a) return c.json({ error: 'not found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { answers?: GrammarAnswer[] };
  const answers = (body.answers ?? []).filter((x) => Number.isInteger(x.band));
  if (!answers.length) return c.json({ error: 'answers required' }, 400);
  const est = estimateGrammar(answers);
  await c.env.DB.prepare('UPDATE assessments SET grammar_json = ?1 WHERE id = ?2').bind(JSON.stringify(est), id).run();
  return c.json({ ...est, label: bandLabel(a.lang, est.band), writingPrompt: writingPrompt(a.lang, est.band) });
});

/** Optional writing sample: Sonnet rates it and its mistakes join the learner's mistakes list. */
assessmentRoutes.post('/:id{[0-9]+}/writing', async (c) => {
  const id = Number(c.req.param('id'));
  const a = await c.env.DB.prepare('SELECT lang FROM assessments WHERE id = ?1').bind(id).first<{ lang: string }>();
  if (!a) return c.json({ error: 'not found' }, 404);
  const language = getLanguage(a.lang);
  const body = (await c.req.json().catch(() => ({}))) as { text?: string; prompt?: string };
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 3000) : '';
  if (text.length < 10) return c.json({ error: 'write a few sentences first' }, 400);
  try {
    const out = await callStructured(c.env, {
      role: 'lessons',
      system: [assessWritingPrompt(language?.name ?? a.lang, a.lang)],
      messages: [{ role: 'user', content: `Task: ${body.prompt ?? ''}\n\nWriting:\n${text}` }],
      maxTokens: 2000,
      effort: 'low',
      schema: WritingSchema,
    });
    const band = Math.min(6, Math.max(1, out.band));
    const errors = out.errors.filter((e) => e.wrong.trim() && e.right.trim()).slice(0, 6);
    if (errors.length)
      await c.env.DB.batch(
        errors.map((e) =>
          c.env.DB.prepare("INSERT OR IGNORE INTO mistakes(lang, wrong, right, note, source) VALUES (?1, ?2, ?3, ?4, 'assessment')").bind(a.lang, e.wrong.trim(), e.right.trim(), e.note.trim()),
        ),
      );
    const result = { band, comment: out.comment.trim(), errors };
    await c.env.DB.prepare('UPDATE assessments SET writing_json = ?1 WHERE id = ?2').bind(JSON.stringify(result), id).run();
    return c.json({ ...result, label: bandLabel(a.lang, band) });
  } catch (e) {
    const { status, body: err } = claudeErrorResponse(e);
    return c.json(err, status);
  }
});

/** Finish: store the level (used by the tutor, lesson writer and new-word order) and offer lessons below it. */
assessmentRoutes.post('/:id{[0-9]+}/finish', async (c) => {
  const id = Number(c.req.param('id'));
  const a = await c.env.DB.prepare('SELECT * FROM assessments WHERE id = ?1').bind(id).first<{ lang: string; vocab_json: string | null; grammar_json: string | null; writing_json: string | null }>();
  if (!a) return c.json({ error: 'not found' }, 404);
  const vocab = a.vocab_json ? (JSON.parse(a.vocab_json) as { band: number }) : null;
  const grammar = a.grammar_json ? (JSON.parse(a.grammar_json) as { band: number; weak: string[] }) : null;
  const writing = a.writing_json ? (JSON.parse(a.writing_json) as { band: number }) : null;
  const result: LevelResult = { date: new Date().toISOString().slice(0, 10), vocab: vocab?.band ?? null, grammar: grammar?.band ?? null, writing: writing?.band ?? null, weak: grammar?.weak ?? [] };
  const check: LevelCheck = { ...result, text: levelText(a.lang, result) };
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE assessments SET result_json = ?1, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2").bind(JSON.stringify(check), id),
    c.env.DB.prepare('INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(`${a.lang}.level_check`, JSON.stringify(check)),
  ]);
  let offered: { id: number; title: string; level: string | null }[] = [];
  if (result.grammar) {
    const { results } = await c.env.DB.prepare('SELECT id, title, level, completed_at FROM lessons WHERE lang = ?1 ORDER BY course_no').bind(a.lang).all<{ id: number; title: string; level: string | null; completed_at: string | null }>();
    const ids = new Set(lessonsBelow(results.map((l) => ({ id: l.id, level: l.level, completed: !!l.completed_at })), result.grammar));
    offered = results.filter((l) => ids.has(l.id)).map((l) => ({ id: l.id, title: l.title, level: l.level }));
  }
  return c.json({
    check,
    labels: {
      vocab: result.vocab ? bandLabel(a.lang, result.vocab) : null,
      grammar: result.grammar ? bandLabel(a.lang, result.grammar) : null,
      writing: result.writing ? bandLabel(a.lang, result.writing) : null,
    },
    offered,
  });
});

/** Mark lessons below the measured level as done (Practised), as offered at the end of the check. */
assessmentRoutes.post('/skip-lessons', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { lessonIds?: number[] };
  const ids = (body.lessonIds ?? []).filter((n) => Number.isInteger(n)).slice(0, 100);
  let done = 0;
  for (const id of ids) {
    const row = await c.env.DB.prepare('SELECT * FROM lessons WHERE id = ?1 AND completed_at IS NULL').bind(id).first<LessonRow>();
    if (!row) continue;
    await markDone(c.env, row);
    done++;
  }
  return c.json({ ok: true, done });
});

/** The latest level check for a language (null if never taken). */
assessmentRoutes.get('/status', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const check = await levelCheck(c.env.DB, lang);
  const maxBand = await poolMaxBand(c.env.DB, lang);
  // Counted only up to 50: the home screen only asks whether there are enough to suggest sorting.
  const pool = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM words WHERE lang = ?1 AND status = 'new' AND triaged_at IS NULL ${UNDER_MAX_BAND} LIMIT ?2)`)
    .bind(lang, 50, maxBand)
    .first<{ n: number }>();
  return c.json({
    check,
    labels: check ? { vocab: check.vocab ? bandLabel(lang, check.vocab) : null, grammar: check.grammar ? bandLabel(lang, check.grammar) : null, writing: check.writing ? bandLabel(lang, check.writing) : null } : null,
    unsorted: pool?.n ?? 0,
    pile: await sortPile(c.env.DB, lang, maxBand),
  });
});

/** SQL: words above the language's pool_max_band are held back (bound as ?3; null = no limit). */
const UNDER_MAX_BAND = 'AND (?3 IS NULL OR COALESCE(level, 0) <= ?3)';

/** Most words in one sort pile; a bigger level is sorted as several piles in a row. */
const PILE_MAX = 250;

/**
 * The sort pile: up to PILE_MAX unsorted pool words at the lowest level that still has any
 * (unlevelled words last), so sorting goes a manageable batch at a time. The pile is kept in the
 * setting <lang>.sort_pile ({ band, size, since }); its words sorted since `since` count against
 * it, and a new pile starts when it is done or the lowest level changes.
 */
async function sortPile(db: D1Database, lang: string, maxBand: number | null): Promise<SortPile | null> {
  // The lowest level with unsorted words, then the count at that level only: walking the
  // (lang, status, level) index this way reads one level's words, not the whole list.
  // Unlevelled words come last, and are never held back by the band limit.
  let lowest: { level: number | null } | null = await db
    .prepare("SELECT level FROM words WHERE lang = ?1 AND status = 'new' AND level IS NOT NULL AND triaged_at IS NULL ORDER BY level LIMIT 1")
    .bind(lang)
    .first<{ level: number }>();
  if (lowest && maxBand !== null && lowest.level! > maxBand) lowest = null;
  lowest ??= await db.prepare("SELECT NULL AS level FROM words WHERE lang = ?1 AND status = 'new' AND level IS NULL AND triaged_at IS NULL LIMIT 1").bind(lang).first<{ level: null }>();
  if (!lowest) return null;
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM words WHERE lang = ?1 AND status = 'new' AND level IS ?2 AND triaged_at IS NULL")
    .bind(lang, lowest.level)
    .first<{ n: number }>();
  const row = { level: lowest.level, n: count?.n ?? 0 };
  const label = row.level ? bandLabel(lang, row.level) : 'Unlevelled';
  const key = `${lang}.sort_pile`;
  const saved = await getSetting<{ band?: number | null; size?: number; since?: string } | null>(db, key, null);
  if (saved && saved.band === row.level && typeof saved.since === 'string' && typeof saved.size === 'number') {
    const sorted = await db
      .prepare('SELECT COUNT(*) AS n FROM words WHERE lang = ?1 AND level IS ?2 AND triaged_at >= ?3')
      .bind(lang, row.level, saved.since)
      .first<{ n: number }>();
    const left = Math.min(saved.size - (sorted?.n ?? 0), row.n);
    if (left > 0) return { id: saved.since, band: row.level, label, left, size: saved.size, levelLeft: row.n };
  }
  const pile = { band: row.level, size: Math.min(PILE_MAX, row.n), since: new Date().toISOString() };
  await db.prepare('INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, JSON.stringify(pile)).run();
  return { id: pile.since, band: row.level, label, left: pile.size, size: pile.size, levelLeft: row.n };
}

interface SortPile {
  /** When the pile started: a new id means a new pile. */
  id: string;
  band: number | null;
  label: string;
  left: number;
  size: number;
  /** Unsorted words at this level in all (this pile and the ones after it). */
  levelLeft: number;
}

/** Most meanings written by Claude for one round (list words without a usable gloss). */
const SORT_GLOSS_MAX = 30;

/**
 * "Sort my words": one round of the current pile (one level), shuffled (not A to Z), for the
 * matching board. Every word needs a meaning to match: missing ones are written by Claude and
 * stored; a word still without one is left for a later round. Decoys are meanings of other words
 * at the level (known ones first), so a board always has one meaning too many.
 */
assessmentRoutes.get('/sort', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20)));
  const db = c.env.DB;
  const maxBand = await poolMaxBand(db, lang);
  const pile = await sortPile(db, lang, maxBand);
  type Row = { id: number; lemma: string; reading: string | null; gloss: string | null; level: number | null };
  const take = pile ? Math.min(limit, pile.left) : 0;
  // A few more than the round: the extras are decoys only.
  const { results } = pile
    ? await db
        .prepare(
          `SELECT id, lemma, reading, gloss, level FROM words WHERE lang = ?1 AND status = 'new' AND triaged_at IS NULL AND level IS ?3
           ORDER BY random() LIMIT ?2`,
        )
        .bind(lang, take + 10, pile.band)
        .all<Row>()
    : { results: [] as Row[] };
  const rows = results.map((w) => ({ ...w, gloss: w.gloss ? tidyListGloss(w.gloss) : null }));
  const round = rows.slice(0, take);
  const missing = round.filter((w) => !w.gloss).slice(0, SORT_GLOSS_MAX);
  if (missing.length) {
    try {
      const out = await callStructured(c.env, {
        role: 'exercises',
        system: [sortGlossPrompt(getLanguage(lang)?.name ?? lang)],
        messages: [{ role: 'user', content: missing.map((w) => w.lemma).join('\n') }],
        maxTokens: 60 + missing.length * 30,
        effort: 'low',
        schema: z.object({ words: z.array(z.object({ word: z.string(), meaning: z.string() })) }),
      });
      const byLemma = new Map(out.words.map((w) => [w.word.trim(), cleanGloss(w.meaning)]));
      const writes: D1PreparedStatement[] = [];
      for (const w of missing) {
        const g = byLemma.get(w.lemma);
        if (!g) continue;
        w.gloss = g;
        writes.push(db.prepare('UPDATE words SET gloss = ?1 WHERE id = ?2').bind(g, w.id));
      }
      if (writes.length) await db.batch(writes);
    } catch {
      // Claude unavailable: the words without a meaning wait for a later round.
    }
  }
  const { results: known } = pile
    ? await db
        .prepare("SELECT gloss FROM words WHERE lang = ?1 AND status = 'known' AND level IS ?2 AND gloss IS NOT NULL LIMIT 30")
        .bind(lang, pile.band)
        .all<{ gloss: string }>()
    : { results: [] as { gloss: string }[] };
  const decoys = [...known.map((k) => tidyListGloss(k.gloss)), ...rows.slice(take).map((w) => w.gloss)].filter((g): g is string => !!g);
  const left = await db
    .prepare(`SELECT COUNT(*) AS n FROM words WHERE lang = ?1 AND status = 'new' AND triaged_at IS NULL ${UNDER_MAX_BAND}`)
    .bind(lang, 0, maxBand)
    .first<{ n: number }>();
  return c.json({
    words: round
      .filter((w) => w.gloss)
      .map((w) => ({
        ...w,
        reading: w.reading ?? (lang === 'zh' ? pinyinForWord(w.lemma) : null),
        levelLabel: w.level ? bandLabel(lang, w.level) : null,
      })),
    decoys,
    left: left?.n ?? 0,
    pile,
  });
});

/** Known: out of the pool. Not known: stays in the pool, queued ahead of unsorted words. */
assessmentRoutes.post('/sort', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { lang?: string; id?: number; known?: boolean };
  if (!Number.isInteger(body.id)) return c.json({ error: 'id required' }, 400);
  await c.env.DB.prepare(
    `UPDATE words SET status = CASE WHEN ?2 = 1 THEN 'known' ELSE status END, triaged_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1 AND status = 'new'`,
  )
    .bind(body.id, body.known ? 1 : 0)
    .run();
  if (body.known) invalidateDict(body.lang ?? 'zh');
  return c.json({ ok: true });
});

/** Undo a sort (an accidental tap): the word goes back to unsorted, in the pool. */
assessmentRoutes.post('/sort/undo', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { lang?: string; id?: number };
  if (!Number.isInteger(body.id)) return c.json({ error: 'id required' }, 400);
  await c.env.DB.prepare(`UPDATE words SET status = 'new', triaged_at = NULL WHERE id = ?1 AND triaged_at IS NOT NULL AND status IN ('new', 'known')`)
    .bind(body.id)
    .run();
  invalidateDict(body.lang ?? 'zh');
  return c.json({ ok: true });
});
