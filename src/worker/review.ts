import { Hono } from 'hono';
import { z } from 'zod';
import { createEmptyCard } from 'ts-fsrs';
import type { Env } from './env';
import { callStructured, BudgetExceededError, NotConfiguredError } from './claude';
import { annotateStrings } from './annotate';
import { invalidateDict } from './words';
import { stripPinyin } from '../core/pinyin/strip';
import { parseCard, reviewCard, statusAfterReview, isRating, DEFAULT_GRADUATE_DAYS } from '../core/srs/schedule';
import { kindFor, makeExercise, MIN_MATCH, type Exercise, type Sentence } from '../core/review/exercise';
import { isSectioned, type LessonCheckItem, type LessonContent } from '../core/lessons/types';
import { quizItems } from '../core/lessons/mastery';
import { levelCheck } from './level';
import { passFromQuiz } from './lessons';
import { interleave } from '../core/review/queue';
import { tidyListGloss } from '../core/words/gloss';
import { boardGloss } from '../core/assessment/sort-board';
import { withChoices } from '../core/review/choices';
import type { StoredStatus } from '../core/pinyin/annotate';
import { promptsFor, proofreadSentencesPrompt } from '../../prompts';
import { getLanguage } from '../core/languages';
import { dayStartIso, poolMaxBand } from './day';

export const reviewRoutes = new Hono<{ Bindings: Env }>();

interface DueRow {
  id: number;
  item_type: 'word' | 'grammar_point';
  item_id: number;
  lang: string;
  fsrs_state_json: string;
  due_at: string;
  lemma: string | null;
  reading: string | null;
  gloss: string | null;
  status: StoredStatus | null;
  g_title: string | null;
  g_summary: string | null;
}

const ExerciseBatch = z.object({
  items: z.array(z.object({ word: z.string(), zh: z.string(), en: z.string() })),
});
/** Latin-script languages also report the inflected form used, which becomes the cloze target. */
const ExerciseBatchLatin = z.object({
  items: z.array(z.object({ word: z.string(), form: z.string(), zh: z.string(), en: z.string() })),
});

async function setting<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?1').bind(key).first<{ value: string }>();
  try {
    return row ? (JSON.parse(row.value) as T) : fallback;
  } catch {
    return fallback;
  }
}

type SentenceItem = { word: string; form?: string; zh: string; en: string };

/** Words the learner knows, simplest first: all an example sentence may use besides its target. */
async function knownWords(db: D1Database, lang: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT lemma FROM words WHERE lang = ?1 AND status IN ('known', 'learning')
       ORDER BY status = 'known' DESC, COALESCE(json_extract(meta_json, '$.hsk'), 99), id LIMIT 400`,
    )
    .bind(lang)
    .all<{ lemma: string }>();
  return results.map((r) => r.lemma);
}

/** Below this many known words, the list says too little to hold sentences to it. */
const KNOWN_ENOUGH = 150;

/**
 * Words in each sentence, besides its target, that the learner's list does not have as known or
 * learning (Chinese, where the list is matched word for word; Latin-script forms are not).
 */
async function extraNewWords(db: D1Database, lang: string, items: SentenceItem[]): Promise<Map<SentenceItem, string[]>> {
  const ann = await annotateStrings(db, lang, items.map((i) => i.zh));
  const out = new Map<SentenceItem, string[]>();
  for (const it of items) {
    const extra = (ann[it.zh] ?? [])
      .filter((t) => t.pinyin && (t.status === 'new' || t.status === 'unknown'))
      .map((t) => t.text)
      .filter((w) => !it.word.includes(w) && !w.includes(it.word));
    if (extra.length) out.set(it, [...new Set(extra)]);
  }
  return out;
}

/** A second pass by a stronger model: correct language, translation and vocabulary. Keeps the originals on failure. */
async function proofreadSentences(env: Env, lang: string, items: SentenceItem[], known: string[], problems?: Map<SentenceItem, string[]>): Promise<SentenceItem[]> {
  const language = getLanguage(lang) ?? getLanguage('zh')!;
  const latin = language.script === 'latin';
  const content = [
    `Items:\n${JSON.stringify({ items })}`,
    known.length ? `Words the learner knows:\n${known.join(', ')}` : 'No word list: allow only the most common everyday words besides the target.',
    problems?.size ? `Problems found (words the learner does not know):\n${[...problems].map(([it, w]) => `${it.word}: ${w.join(', ')}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const call = { role: 'checking' as const, effort: 'low' as const, system: [proofreadSentencesPrompt(language.name, latin)], messages: [{ role: 'user' as const, content }], maxTokens: 3000 };
  try {
    const out: SentenceItem[] = latin ? (await callStructured(env, { ...call, schema: ExerciseBatchLatin })).items : (await callStructured(env, { ...call, schema: ExerciseBatch })).items;
    const byWord = new Map(out.map((o) => [o.word.trim(), o]));
    return items.map((it) => byWord.get(it.word.trim()) ?? it);
  } catch (e) {
    // Out of budget too: the sentences are already paid for, so they are kept rather than lost.
    console.error('proofreading sentences failed', e);
    return items;
  }
}

/** Generate and cache one sentence for each word lacking one. Degrades silently on budget/key errors. */
async function ensureWordSentences(env: Env, lang: string, words: { id: number; lemma: string }[]): Promise<string | null> {
  if (words.length === 0) return null;
  try {
    const language = getLanguage(lang);
    const latin = language?.script === 'latin';
    const known = await knownWords(env.DB, lang);
    const call = {
      role: 'exercises' as const,
      system: [promptsFor(lang).exercises],
      messages: [
        {
          role: 'user' as const,
          content: `Target words:\n${words.map((w) => w.lemma).join('\n')}${known.length ? `\n\nWords the learner knows (use only these besides the target):\n${known.join(', ')}` : ''}`,
        },
      ],
      maxTokens: 2000,
    };
    let items: SentenceItem[] = latin
      ? (await callStructured(env, { ...call, schema: ExerciseBatchLatin })).items
      : (await callStructured(env, { ...call, schema: ExerciseBatch })).items;
    // Checked before the learner sees them, and held to one new word: the target.
    items = await proofreadSentences(env, lang, items, known);
    if (!latin && known.length >= KNOWN_ENOUGH) {
      const problems = await extraNewWords(env.DB, lang, items);
      if (problems.size) {
        const fixed = await proofreadSentences(env, lang, [...problems.keys()], known, problems);
        const byWord = new Map(fixed.map((f) => [f.word.trim(), f]));
        items = items.map((it) => (problems.has(it) ? (byWord.get(it.word.trim()) ?? it) : it));
      }
    }
    const byWord = new Map(words.map((w) => [w.lemma, w.id]));
    const stmts: D1PreparedStatement[] = [];
    for (const it of items) {
      const id = byWord.get(it.word.trim());
      const zh = (language?.hasRomanisation ? stripPinyin(it.zh) : it.zh).trim();
      // The sentence must contain the target exactly: the word itself, or (Latin script) the form used.
      const target = latin ? (it.form ?? it.word).trim() : it.word.trim();
      if (!id || !zh.includes(target)) continue;
      stmts.push(
        env.DB.prepare(`INSERT OR IGNORE INTO exercises(lang, item_type, item_id, zh, en, target, source) VALUES (?1, 'word', ?2, ?3, ?4, ?5, 'generated')`).bind(
          lang,
          id,
          zh,
          it.en.trim(),
          target,
        ),
      );
    }
    if (stmts.length) await env.DB.batch(stmts);
    return null;
  } catch (e) {
    if (e instanceof BudgetExceededError) return 'Daily budget reached: new practice sentences resume tomorrow; reviews use cached ones.';
    if (e instanceof NotConfiguredError) return 'No Claude key: reviews use flashcards only.';
    console.error('exercise generation failed', e);
    return 'Could not generate new practice sentences just now; using flashcards for those words.';
  }
}

export const DEFAULT_NEW_PER_DAY = 10;
/**
 * SQL condition: a word card that has never been reviewed (FSRS reps = 0) and so is rationed by
 * review.new_per_day. Pinned cards ("Don't know this" in the word sheet) are not rationed.
 */
const UNSEEN_WORD = `(s.item_type = 'word' AND json_extract(s.fsrs_state_json, '$.reps') = 0 AND s.pinned = 0)`;

/**
 * Keep `want` unseen word cards ready: when there are fewer, give cards to pool words, lowest HSK
 * level first and words from the learner's own Pleco categories first within a level. The word
 * stays "new" until its first review makes it "learning".
 */
async function topUpFromPool(db: D1Database, lang: string, want: number, nowIso: string): Promise<void> {
  const have = await db
    .prepare(`SELECT COUNT(*) AS n FROM srs_cards s WHERE s.lang = ?1 AND s.due_at <= ?2 AND ${UNSEEN_WORD}`)
    .bind(lang, nowIso)
    .first<{ n: number }>();
  const need = want - (have?.n ?? 0);
  if (need <= 0) return;
  const maxBand = await poolMaxBand(db, lang);
  const { results } = await db
    .prepare(
      `SELECT w.id FROM words w
       WHERE w.lang = ?1 AND w.status = 'new' AND NOT EXISTS (SELECT 1 FROM srs_cards s WHERE s.item_type = 'word' AND s.item_id = w.id)
         AND (?4 IS NULL OR COALESCE(w.level, json_extract(w.meta_json, '$.hsk'), 0) <= ?4)
       ORDER BY w.triaged_at IS NOT NULL DESC,
                (COALESCE(w.level, json_extract(w.meta_json, '$.hsk'), 99) >= ?3) DESC,
                COALESCE(w.level, json_extract(w.meta_json, '$.hsk'), 99),
                EXISTS (SELECT 1 FROM json_each(w.meta_json, '$.categories') c WHERE c.value IN ('Words', 'Duo Chars')) DESC, w.id
       LIMIT ?2`,
    )
    // Sorted-but-unknown words first, then words at or above the measured vocabulary level, easiest first.
    .bind(lang, need, (await levelCheck(db, lang))?.vocab ?? 0, maxBand)
    .all<{ id: number }>();
  if (!results.length) return;
  const card = createEmptyCard(new Date(nowIso));
  await db.batch(
    results.map((r) =>
      db
        .prepare(`INSERT OR IGNORE INTO srs_cards(item_type, item_id, lang, fsrs_state_json, due_at) VALUES ('word', ?1, ?2, ?3, ?4)`)
        .bind(r.id, lang, JSON.stringify(card), nowIso),
    ),
  );
}

/**
 * Cards a review would show now: due cards already seen, plus as many unseen word cards as today's
 * new-word allowance (review.new_per_day) has left, which is how the review rations them. Counting
 * every due card instead promised reviews the review would not show.
 */
export async function dueNow(db: D1Database, lang: string): Promise<number> {
  const now = new Date().toISOString();
  const newPerDay = Math.max(0, Number(await setting(db, 'review.new_per_day', DEFAULT_NEW_PER_DAY)) || 0);
  const left = Math.max(0, newPerDay - (await introducedToday(db, lang)));
  if (left) await topUpFromPool(db, lang, left, now);
  const row = await db
    .prepare(`SELECT COALESCE(SUM(NOT ${UNSEEN_WORD}), 0) AS seen, COALESCE(SUM(${UNSEEN_WORD}), 0) AS unseen FROM srs_cards s WHERE s.lang = ?1 AND s.due_at <= ?2`)
    .bind(lang, now)
    .first<{ seen: number; unseen: number }>();
  return (row?.seen ?? 0) + Math.min(row?.unseen ?? 0, left);
}

/** Unseen word cards introduced since the start of today (learner's time zone). */
export async function introducedToday(db: D1Database, lang: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM srs_cards WHERE lang = ?1 AND item_type = 'word' AND first_seen_at >= ?2")
    .bind(lang, await dayStartIso(db))
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function reviewedToday(db: D1Database, lang: string): Promise<number> {
  const r = await db
    .prepare('SELECT COUNT(*) AS n FROM reviews r CROSS JOIN srs_cards s ON s.id = r.card_id WHERE s.lang = ?1 AND r.reviewed_at >= ?2')
    .bind(lang, await dayStartIso(db))
    .first<{ n: number }>();
  return r?.n ?? 0;
}

reviewRoutes.get('/summary', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const now = new Date().toISOString();
  const startOfDay = await dayStartIso(c.env.DB);
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM srs_cards WHERE lang = ?1 AND due_at <= ?2 AND item_type = 'grammar_point') AS due_grammar,
       (SELECT COUNT(*) FROM srs_cards WHERE lang = ?1) AS cards,
       (SELECT COUNT(*) FROM reviews r CROSS JOIN srs_cards s ON s.id = r.card_id WHERE s.lang = ?1 AND r.reviewed_at >= ?3) AS reviewed_today,
       (SELECT COALESCE(SUM(n), 0) FROM word_counts WHERE lang = ?1 AND status = 'known') AS known,
       (SELECT COALESCE(SUM(n), 0) FROM word_counts WHERE lang = ?1 AND status = 'learning') AS learning,
       (SELECT COALESCE(SUM(n), 0) FROM word_counts WHERE lang = ?1 AND status = 'new') AS pool`,
  )
    .bind(lang, now, startOfDay)
    .first<{ reviewed_today: number }>();
  const due = await dueNow(c.env.DB, lang);
  const limit = Number(await setting(c.env.DB, 'review.daily_limit', 60)) || 60;
  const remainingToday = row ? Math.max(0, Math.min(due, limit - row.reviewed_today)) : 0;
  return c.json({ ...row, due, daily_limit: limit, remaining_today: remainingToday });
});

/** Words known in a language (Lexi's stage), from the running totals (word_counts, kept by triggers). */
reviewRoutes.get('/known', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const row = await c.env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS known FROM word_counts WHERE lang = ?1 AND status = 'known'").bind(lang).first<{ known: number }>();
  return c.json({ known: row?.known ?? 0 });
});

reviewRoutes.get('/next', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const batch = Math.min(30, Math.max(1, Number(c.req.query('limit') ?? (await setting(c.env.DB, 'review.batch_size', 15)))));
  const skip = (c.req.query('skip') ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  const include = Number(c.req.query('include') ?? 0);
  const now = new Date().toISOString();
  // Daily cap: the Pleco import leaves a large overdue backlog; work through it a slice a day.
  const limit = Number(await setting(c.env.DB, 'review.daily_limit', 60)) || 60;
  const done = await reviewedToday(c.env.DB, lang);
  const take = Math.min(batch, Math.max(0, limit - done));
  if (take === 0 && !include) return c.json({ items: [], notice: `Daily review limit of ${limit} reached. Well done.`, limitReached: true });
  // Unseen word cards (never reviewed, here or in Pleco) are rationed by review.new_per_day.
  const newPerDay = Math.max(0, Number(await setting(c.env.DB, 'review.new_per_day', DEFAULT_NEW_PER_DAY)) || 0);
  const introduced = await introducedToday(c.env.DB, lang);
  const newQuota = Math.min(take, Math.max(0, newPerDay - introduced));
  const cols = `s.*, w.lemma, w.reading, w.gloss, w.status, g.title AS g_title, g.summary AS g_summary
     FROM srs_cards s
     LEFT JOIN words w ON s.item_type = 'word' AND w.id = s.item_id
     LEFT JOIN grammar_points g ON s.item_type = 'grammar_point' AND g.id = s.item_id`;
  const skipSql = skip.length ? `AND s.id NOT IN (${skip.join(',')})` : '';
  const { results: seen } = await c.env.DB.prepare(
    `SELECT ${cols}
     WHERE s.lang = ?1 AND (s.due_at <= ?2 OR s.id = ?4) ${skipSql} AND (s.id = ?4 OR NOT (${UNSEEN_WORD}))
     ORDER BY s.id = ?4 DESC, s.pinned DESC, s.item_type = 'grammar_point' DESC, w.status = 'learning' DESC, s.due_at LIMIT ?3`,
  )
    .bind(lang, now, Math.max(take, include ? 1 : 0), include || -1)
    .all<DueRow>();
  if (newQuota) await topUpFromPool(c.env.DB, lang, newQuota, now);
  // Words met in chats and lessons (status 'learning'; pool words stay 'new') first, then by HSK
  // level, so the pool is not taken alphabetically.
  const { results: fresh } = newQuota
    ? await c.env.DB.prepare(
        `SELECT ${cols}
         WHERE s.lang = ?1 AND s.due_at <= ?2 ${skipSql} AND ${UNSEEN_WORD} AND s.id <> ?4
         ORDER BY w.status = 'learning' DESC, EXISTS (SELECT 1 FROM exposures e WHERE e.word_id = w.id) DESC, w.source IN ('conversation', 'lesson') DESC,
                  COALESCE(json_extract(w.meta_json, '$.hsk'), 99), w.id
         LIMIT ?3`,
      )
        .bind(lang, now, newQuota, include || -1)
        .all<DueRow>()
    : { results: [] as DueRow[] };
  const kept = seen.slice(0, Math.max(take - fresh.length, include ? 1 : 0));
  // A forced card (today's grammar point) stays first.
  const due = include && kept[0]?.id === include ? [kept[0], ...interleave(kept.slice(1), fresh)] : interleave(kept, fresh);
  if (due.length === 0) return c.json({ items: [], notice: null });

  // Cached sentences for these cards.
  const loadSentences = async () => {
    const keys = due.map((d) => `('${d.item_type}',${d.item_id})`).join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT id, item_type, item_id, zh, en, target, used_count FROM exercises WHERE (item_type, item_id) IN (VALUES ${keys}) ORDER BY used_count, id`,
    ).all<{ id: number; item_type: string; item_id: number; zh: string; en: string; target: string | null; used_count: number }>();
    const map = new Map<string, Sentence[]>();
    for (const r of results) {
      const k = `${r.item_type}:${r.item_id}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push({ id: r.id, zh: r.zh, en: r.en, ...(r.target ? { target: r.target } : {}) });
    }
    return map;
  };
  let sentences = await loadSentences();
  const missing = due.filter((d) => d.item_type === 'word' && d.lemma && !sentences.has(`word:${d.item_id}`)).map((d) => ({ id: d.item_id, lemma: d.lemma! }));
  const notice = await ensureWordSentences(c.env, lang, missing);
  if (missing.length) sentences = await loadSentences();

  // Grammar cards whose lesson has practice sets become a three-question quiz.
  const gpIds = due.filter((d) => d.item_type === 'grammar_point').map((d) => d.item_id);
  const gpLessons = new Map<number, { lessonId: number; content: LessonContent }>();
  if (gpIds.length) {
    const { results } = await c.env.DB.prepare(
      `SELECT g.id, g.lesson_id, l.content_json FROM grammar_points g JOIN lessons l ON l.id = g.lesson_id WHERE g.id IN (${gpIds.join(',')})`,
    ).all<{ id: number; lesson_id: number; content_json: string }>();
    for (const r of results) gpLessons.set(r.id, { lessonId: r.lesson_id, content: JSON.parse(r.content_json) as LessonContent });
  }

  // A matching board needs a few words: with fewer match cards than that, they take another kind.
  const glossed = (d: DueRow) => !!d.gloss && !!tidyListGloss(d.gloss);
  const matches = due.filter((d) => kindFor(parseCard(d.fsrs_state_json).reps, sentences.has(`${d.item_type}:${d.item_id}`), d.item_type === 'word', d.id, glossed(d)) === 'match').length;
  const canMatch = matches >= MIN_MATCH;
  // Wrong options for multiple-choice cards: other sentences' and words' meanings, from this batch
  // and from the learner's own lists.
  const [moreEn, moreGloss] = await Promise.all([
    c.env.DB.prepare('SELECT en FROM exercises WHERE lang = ?1 ORDER BY RANDOM() LIMIT 12').bind(lang).all<{ en: string }>(),
    c.env.DB.prepare("SELECT gloss FROM words WHERE lang = ?1 AND gloss IS NOT NULL AND gloss <> '' ORDER BY RANDOM() LIMIT 12").bind(lang).all<{ gloss: string }>(),
  ]);
  const shortGloss = (g: string) => boardGloss(tidyListGloss(g) ?? '');
  const enPool = [...[...sentences.values()].map((x) => x[0]!.en), ...moreEn.results.map((x) => x.en)];
  const glossPool = [...due.filter(glossed).map((d) => shortGloss(d.gloss!)), ...moreGloss.results.map((x) => shortGloss(x.gloss)).filter(Boolean)];
  const asChoice = (ex: Exercise, d: DueRow, seed: number): Exercise => {
    if (ex.kind === 'zh_to_en' && ex.answerEn) {
      const choices = withChoices(ex.answerEn, enPool, seed);
      return choices ? { ...ex, choices, choiceAnswer: ex.answerEn } : ex;
    }
    // A word on its own, or met for the first time: pick its meaning (a new word is taught only if missed).
    if ((ex.kind === 'flash' || ex.kind === 'intro') && d.item_type === 'word' && glossed(d)) {
      const meaning = shortGloss(d.gloss!);
      const choices = withChoices(meaning, glossPool, seed);
      return choices ? { ...ex, ...(ex.kind === 'flash' ? { answerEn: meaning } : {}), choices, choiceAnswer: meaning } : ex;
    }
    return ex;
  };
  const items = due.map((d) => {
    const card = parseCard(d.fsrs_state_json);
    const s = sentences.get(`${d.item_type}:${d.item_id}`)?.[0];
    const isWord = d.item_type === 'word';
    const gl = !isWord ? gpLessons.get(d.item_id) : undefined;
    // Seeded by the card's review count, so each attempt (a retry the same day too) gets new questions.
    const quiz = gl && isSectioned(gl.content) ? quizItems(gl.content, d.id + card.reps) : [];
    const exercise: Exercise = quiz.length ? { kind: 'quiz', quiz, lessonId: gl!.lessonId } : asChoice(makeExercise(kindFor(card.reps, !!s, isWord, d.id, canMatch && glossed(d)), s), d, d.id + card.reps);
    return {
      cardId: d.id,
      itemType: d.item_type,
      itemId: d.item_id,
      reps: card.reps,
      state: card.state,
      word: isWord ? { lemma: d.lemma, reading: d.reading, gloss: d.gloss ? tidyListGloss(d.gloss) : null, status: d.status } : undefined,
      grammar: !isWord ? { title: d.g_title, summary: d.g_summary } : undefined,
      exercise,
    };
  });
  const quizStrings = (q: LessonCheckItem[] = []) => q.flatMap((it) => (it.kind === 'choice' ? it.options : it.kind === 'translate' ? [it.zh] : [it.wrong, it.right]));
  const strings = items.flatMap((i) =>
    [i.exercise.promptZh, i.exercise.clozeZh, i.exercise.answerZh, i.word?.lemma, i.grammar?.title, ...quizStrings(i.exercise.quiz)].filter((x): x is string => !!x),
  );
  const annotations = await annotateStrings(c.env.DB, lang, strings);
  return c.json({ items, annotations, notice });
});

reviewRoutes.post('/:cardId{[0-9]+}', async (c) => {
  const cardId = Number(c.req.param('cardId'));
  const body = (await c.req.json().catch(() => ({}))) as { rating?: unknown; kind?: string; exerciseId?: number; quiz?: { score?: unknown; total?: unknown } };
  if (!isRating(body.rating)) return c.json({ error: 'rating must be 1-4' }, 400);
  const row = await c.env.DB.prepare('SELECT * FROM srs_cards WHERE id = ?1').bind(cardId).first<{ id: number; item_type: string; item_id: number; lang: string; fsrs_state_json: string; pinned: number }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  // A double tap rates a card twice within moments: keep the first only.
  const recent = await c.env.DB.prepare("SELECT 1 AS x FROM reviews WHERE card_id = ?1 AND reviewed_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 seconds') LIMIT 1")
    .bind(cardId)
    .first<{ x: number }>();
  if (recent) return c.json({ due: (await c.env.DB.prepare('SELECT due_at FROM srs_cards WHERE id = ?1').bind(cardId).first<{ due_at: string }>())?.due_at ?? '', status: null, statusChanged: false, duplicate: true });

  const now = new Date();
  const before = parseCard(row.fsrs_state_json);
  const next = reviewCard(before, body.rating, now);
  const stmts: D1PreparedStatement[] = [
    // first_seen_at marks the day an unseen card was introduced (it counts against new_per_day).
    c.env.DB.prepare('UPDATE srs_cards SET fsrs_state_json = ?1, due_at = ?2, first_seen_at = COALESCE(first_seen_at, ?4), pinned = 0 WHERE id = ?3').bind(
      JSON.stringify(next),
      next.due.toISOString(),
      cardId,
      // A pinned card was asked for by the learner, so it does not use up the day's new words.
      before.reps === 0 && !row.pinned ? now.toISOString() : null,
    ),
    c.env.DB.prepare('INSERT INTO reviews(card_id, rating, kind, exercise_id) VALUES (?1, ?2, ?3, ?4)').bind(cardId, body.rating, body.kind ?? null, body.exerciseId ?? null),
  ];
  if (body.exerciseId) {
    stmts.push(
      c.env.DB.prepare("UPDATE exercises SET used_count = used_count + 1, last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1").bind(body.exerciseId),
    );
  }

  let status: StoredStatus | null = null;
  let changed = false;
  if (row.item_type === 'word') {
    const w = await c.env.DB.prepare('SELECT status FROM words WHERE id = ?1').bind(row.item_id).first<{ status: StoredStatus }>();
    if (w) {
      const days = Number(await setting(c.env.DB, 'srs.graduate_days', DEFAULT_GRADUATE_DAYS)) || DEFAULT_GRADUATE_DAYS;
      status = statusAfterReview(w.status, next, body.rating, days);
      if (status !== w.status) {
        changed = true;
        stmts.push(c.env.DB.prepare('UPDATE words SET status = ?1 WHERE id = ?2').bind(status, row.item_id));
      }
    }
  }
  // A grammar quiz result counts towards the lesson's mastery.
  const qs = Number(body.quiz?.score);
  const qt = Number(body.quiz?.total);
  const quizDone = row.item_type === 'grammar_point' && Number.isInteger(qs) && Number.isInteger(qt) && qt > 0 && qs >= 0 && qs <= qt;
  if (quizDone) stmts.push(c.env.DB.prepare('INSERT INTO grammar_quizzes(grammar_point_id, score, total) VALUES (?1, ?2, ?3)').bind(row.item_id, qs, qt));
  await c.env.DB.batch(stmts);
  if (changed) invalidateDict(row.lang);
  // A good enough quiz on a lesson whose check is not yet passed counts as passing it.
  const lessonPassed = quizDone ? await passFromQuiz(c.env, row.item_id, qs, qt) : false;
  return c.json({ due: next.due.toISOString(), stability: next.stability, status, statusChanged: changed, lessonPassed });
});
