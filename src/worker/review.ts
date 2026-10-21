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
import { MIN_STORY, linesBefore, storyOrder, type StoryLine, type StoryRecap } from '../core/review/story';
import { tidyListGloss } from '../core/words/gloss';
import { boardGloss } from '../core/assessment/sort-board';
import { withChoices } from '../core/review/choices';
import type { StoredStatus } from '../core/pinyin/annotate';
import { promptsFor, proofreadSentencesPrompt, storyPrompt } from '../../prompts';
import { getLanguage } from '../core/languages';
import { dayStartIso, poolMaxBand } from './day';
import { bandLabel, reachBand } from '../core/assessment/levels';

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

/**
 * Words the learner knows: all an example sentence may use besides its target. Words being learned
 * (due today or not) come first, so a long known list never crowds them out, then known words,
 * simplest first.
 */
async function knownWords(db: D1Database, lang: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT lemma FROM (SELECT lemma FROM words WHERE lang = ?1 AND status = 'learning' ORDER BY id DESC LIMIT 200)
       UNION ALL
       SELECT lemma FROM (SELECT lemma FROM words WHERE lang = ?1 AND status = 'known' ORDER BY COALESCE(level, json_extract(meta_json, '$.hsk'), 99), id LIMIT 400)`,
    )
    .bind(lang)
    .all<{ lemma: string }>();
  return results.map((r) => r.lemma);
}

/** Most words a story may borrow from the pool. */
const SOON_MAX = 80;

/**
 * New words at the learner's level that reviews will introduce soon (within reach, nearest the
 * measured band first): a story may use one of them in a sentence besides its target, which
 * widens what it can say and gives those words a first sighting. Never a target of this set.
 */
async function soonWords(db: D1Database, lang: string, exclude: string[]): Promise<string[]> {
  const check = await levelCheck(db, lang);
  const { results } = await db
    .prepare(
      `SELECT w.lemma FROM words w WHERE w.lang = ?1 AND w.status = 'new' AND ${WORD_LEVEL} <= ?2
       ORDER BY ABS(${WORD_LEVEL} - ?3), random() LIMIT ?4`,
    )
    .bind(lang, check ? reachBand(check.vocab ?? 0) : 2, check?.vocab ?? 1, SOON_MAX + exclude.length)
    .all<{ lemma: string }>();
  const skip = new Set(exclude.map((w) => w.trim()));
  return results.map((r) => r.lemma).filter((w) => !skip.has(w)).slice(0, SOON_MAX);
}

/** Below this many known words, the list says too little to hold sentences to it. */
const KNOWN_ENOUGH = 150;

/** Sentences that tell one story: what it is about, and what it may use besides the learner's words. */
interface StoryContext {
  /** Title and premise. */
  about: string;
  /** New words at the learner's level a sentence may borrow one of (soonWords). */
  soon: string[];
  /** The characters' names, which are not new words. */
  names: string[];
  /** The story's target words, which may come back in later lines. */
  targets: string[];
}

/**
 * What a sentence writer may use besides the targets. A short list (a language just started) is
 * not all the learner knows, so sentences are not held to it: common words at their level are
 * allowed too. Holding a story to a dozen words makes it strange.
 */
async function vocabulary(db: D1Database, lang: string, known: string[], soon: string[] = []): Promise<string> {
  const also = soon.length
    ? `\n\nWords at the learner's level they will learn soon: a sentence may also use ONE of these besides its target, where it helps the story:\n${soon.join(', ')}`
    : '';
  if (known.length >= KNOWN_ENOUGH) return `Words the learner knows (use only these besides the target words):\n${known.join(', ')}${also}`;
  const band = (await levelCheck(db, lang))?.vocab;
  const common = `the most common everyday words${band ? ` (level ${bandLabel(lang, band)} or below)` : ''}`;
  return (
    (known.length
      ? `Words the learner knows:\n${known.join(', ')}\n\nThis list is short, so besides these use only ${common}.`
      : `No word list: besides the target words use only ${common}.`) + also
  );
}

/**
 * Words in each sentence, besides its target, that the learner's list does not have as known or
 * learning (Chinese, where the list is matched word for word; Latin-script forms are not).
 */
async function extraNewWords(db: D1Database, lang: string, items: SentenceItem[], story?: StoryContext): Promise<Map<SentenceItem, string[]>> {
  const ann = await annotateStrings(db, lang, items.map((i) => i.zh));
  const allowed = new Set(story?.soon ?? []);
  // A name may be split into characters that read as words: none of them counts.
  const inName = (w: string) => [...(story?.names ?? []), ...(story?.targets ?? [])].some((n) => n.includes(w));
  const out = new Map<SentenceItem, string[]>();
  for (const it of items) {
    const extra = [
      ...new Set(
        (ann[it.zh] ?? [])
          .filter((t) => t.pinyin && (t.status === 'new' || t.status === 'unknown'))
          .map((t) => t.text)
          .filter((w) => !it.word.includes(w) && !w.includes(it.word) && !inName(w)),
      ),
    ];
    // One word the story was allowed to borrow is fine; any more, or any other, is a problem.
    const borrowed = extra.filter((w) => allowed.has(w));
    const problems = [...extra.filter((w) => !allowed.has(w)), ...(borrowed.length > 1 ? borrowed.slice(1) : [])];
    if (problems.length) out.set(it, problems);
  }
  return out;
}

/** A second pass by a stronger model: correct language, translation and vocabulary. Keeps the originals on failure. */
async function proofreadSentences(env: Env, lang: string, items: SentenceItem[], known: string[], problems?: Map<SentenceItem, string[]>, story?: StoryContext): Promise<SentenceItem[]> {
  const language = getLanguage(lang) ?? getLanguage('zh')!;
  const latin = language.script === 'latin';
  const content = [
    `Items:\n${JSON.stringify({ items })}`,
    await vocabulary(env.DB, lang, known, story?.soon),
    story?.names.length ? `The characters' names (not new words): ${story.names.join(', ')}` : '',
    problems?.size ? `Problems found (words the learner does not know):\n${[...problems].map(([it, w]) => `${it.word}: ${w.join(', ')}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const call = { role: 'checking' as const, effort: 'low' as const, system: [proofreadSentencesPrompt(language.name, latin, story?.about)], messages: [{ role: 'user' as const, content }], maxTokens: 3000 };
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

/** Checked before the learner sees them, and held to one new word: the target. */
async function checkSentences(env: Env, lang: string, items: SentenceItem[], known: string[], story?: StoryContext): Promise<SentenceItem[]> {
  items = await proofreadSentences(env, lang, items, known, undefined, story);
  if (getLanguage(lang)?.script !== 'latin' && known.length >= KNOWN_ENOUGH) {
    const problems = await extraNewWords(env.DB, lang, items, story);
    if (problems.size) {
      // The whole story goes back, so a rewritten sentence still follows on from its neighbours.
      const fixed = await proofreadSentences(env, lang, story ? items : [...problems.keys()], known, problems, story);
      const byWord = new Map(fixed.map((f) => [f.word.trim(), f]));
      items = items.map((it) => (problems.has(it) ? (byWord.get(it.word.trim()) ?? it) : it));
    }
  }
  return items;
}

/**
 * Cache sentences for their words, in order, skipping any without its target. Returns the saved
 * sentences (a sentence cached before keeps its row).
 */
async function saveSentences(env: Env, lang: string, words: { id: number; lemma: string }[], items: SentenceItem[], source: 'generated' | 'story'): Promise<{ wordId: number; sentence: Sentence }[]> {
  const language = getLanguage(lang);
  const latin = language?.script === 'latin';
  const byWord = new Map(words.map((w) => [w.lemma, w.id]));
  const rows: { wordId: number; zh: string; en: string; target: string }[] = [];
  for (const it of items) {
    const id = byWord.get(it.word.trim());
    const zh = (language?.hasRomanisation ? stripPinyin(it.zh) : it.zh).trim();
    // The sentence must contain the target exactly: the word itself, or (Latin script) the form used.
    const target = latin ? (it.form ?? it.word).trim() : it.word.trim();
    if (!id || !zh.includes(target) || rows.some((r) => r.wordId === id)) continue;
    rows.push({ wordId: id, zh, en: it.en.trim(), target });
  }
  if (!rows.length) return [];
  const saved = await env.DB.batch(
    rows.map((r) =>
      env.DB.prepare(
        `INSERT INTO exercises(lang, item_type, item_id, zh, en, target, source) VALUES (?1, 'word', ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (item_type, item_id, zh) DO UPDATE SET used_count = used_count RETURNING id, zh, en, target`,
      ).bind(lang, r.wordId, r.zh, r.en, r.target, source),
    ),
  );
  return rows.flatMap((r, i) => {
    const row = (saved[i]?.results as { id: number; zh: string; en: string; target: string | null }[] | undefined)?.[0];
    return row ? [{ wordId: r.wordId, sentence: { id: row.id, zh: row.zh, en: row.en, ...(row.target ? { target: row.target } : {}) } }] : [];
  });
}

/** Why sentences could not be written, for the review's notice. */
function sentenceNotice(e: unknown): string {
  if (e instanceof BudgetExceededError) return 'Daily budget reached: new practice sentences resume tomorrow; reviews use cached ones.';
  if (e instanceof NotConfiguredError) return 'No Claude key: reviews use flashcards only.';
  console.error('exercise generation failed', e);
  return 'Could not generate new practice sentences just now; using flashcards for those words.';
}

/** Generate and cache one sentence for each word lacking one. Degrades silently on budget/key errors. */
async function ensureWordSentences(env: Env, lang: string, words: { id: number; lemma: string }[]): Promise<string | null> {
  if (words.length === 0) return null;
  try {
    const latin = getLanguage(lang)?.script === 'latin';
    const known = await knownWords(env.DB, lang);
    const call = {
      role: 'exercises' as const,
      system: [promptsFor(lang).exercises],
      messages: [
        {
          role: 'user' as const,
          content: `Target words:\n${words.map((w) => w.lemma).join('\n')}\n\n${await vocabulary(env.DB, lang, known)}`,
        },
      ],
      maxTokens: 2000,
    };
    const items: SentenceItem[] = latin
      ? (await callStructured(env, { ...call, schema: ExerciseBatchLatin })).items
      : (await callStructured(env, { ...call, schema: ExerciseBatch })).items;
    await saveSentences(env, lang, words, await checkSentences(env, lang, items, known), 'generated');
    return null;
  } catch (e) {
    return sentenceNotice(e);
  }
}

// Title and premise come first, so the story is planned before its lines are written. A line with
// an empty "word" links the story along without testing a word.
const Story = z.object({ title: z.string(), premise: z.string(), names: z.array(z.string()), lines: ExerciseBatch.shape.items });
const StoryLatin = z.object({ title: z.string(), premise: z.string(), names: z.array(z.string()), lines: ExerciseBatchLatin.shape.items });
/** A linking line's key while it is checked (it has no word). */
const LINK = '~';

export interface ReviewStory {
  title: string;
  /** A review has shown it: it carries on while any of its words are still to do. */
  served: boolean;
  /** Every line, linking lines included, in order. */
  lines: StoryLine[];
  /** The tested sentences, in order. */
  sentences: Sentence[];
  /** Each word's sentence, by word id, with its place among the tested ones (0-based) and among all lines. */
  byWord: Map<number, { sentence: Sentence; pos: number; line: number }>;
}

/** Setting <lang>.review_story: the story the current (or next) set tells, kept a day or two. */
interface KeptStory {
  /** When it was written. */
  written?: string;
  /** Before stories were written ahead (2026-10-21): the day it was written. */
  day?: string;
  title: string;
  served?: boolean;
  /** A tested line (by its word and cached sentence) or a linking line. */
  lines?: ({ wordId: number; sentenceId: number } | { zh: string; en: string })[];
  /** Before linking lines (2026-10-21): tested lines only. */
  items?: { wordId: number; sentenceId: number }[];
}

/** How long a story written ahead waits to be used (the next day's set can use it). */
const STORY_KEEP_MS = 2 * 24 * 3600 * 1000;
/** How long a story being written (by the cron, or a home screen's request) holds off another. */
const STORY_PENDING_MS = 3 * 60 * 1000;

function storyFrom(title: string, lines: (StoryLine & { wordId?: number })[], served = false): ReviewStory {
  const byWord = new Map<number, { sentence: Sentence; pos: number; line: number }>();
  const sentences: Sentence[] = [];
  lines.forEach((l, line) => {
    if (l.id === undefined || l.wordId === undefined) return;
    const sentence: Sentence = { id: l.id, zh: l.zh, en: l.en, ...(l.target ? { target: l.target } : {}) };
    byWord.set(l.wordId, { sentence, pos: sentences.length, line });
    sentences.push(sentence);
  });
  return { title, served, lines: lines.map(({ wordId: _, ...l }) => l), sentences, byWord };
}

async function keepStory(db: D1Database, lang: string, story: ReviewStory): Promise<void> {
  const wordOf = new Map([...story.byWord].map(([wordId, { sentence }]) => [sentence.id, wordId]));
  const kept: KeptStory = {
    written: new Date().toISOString(),
    title: story.title,
    served: story.served,
    lines: story.lines.map((l) => (l.id !== undefined ? { wordId: wordOf.get(l.id)!, sentenceId: l.id } : { zh: l.zh, en: l.en })),
  };
  await db.prepare('INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(`${lang}.review_story`, JSON.stringify(kept)).run();
}

/**
 * The kept story, with its sentences as they are now (a fixed sentence reads fixed). Null if it is
 * more than two days old or its sentences are gone.
 */
export async function keptStory(db: D1Database, lang: string): Promise<ReviewStory | null> {
  const kept = await setting<KeptStory | null>(db, `${lang}.review_story`, null);
  const lines = kept?.lines ?? kept?.items;
  const written = Date.parse(kept?.written ?? kept?.day ?? '');
  if (!kept || !Array.isArray(lines) || !lines.length || !(Date.now() - written < STORY_KEEP_MS)) return null;
  const ids = lines.flatMap((l) => ('sentenceId' in l && Number.isInteger(l.sentenceId) ? [l.sentenceId] : []));
  if (ids.length < MIN_STORY) return null;
  const { results } = await db.prepare(`SELECT id, zh, en, target FROM exercises WHERE id IN (${ids.join(',')})`).all<{ id: number; zh: string; en: string; target: string | null }>();
  const byId = new Map(results.map((r) => [r.id, r]));
  const story = storyFrom(
    kept.title,
    lines.flatMap((l) => {
      if (!('sentenceId' in l)) return typeof l.zh === 'string' && typeof l.en === 'string' ? [{ zh: l.zh, en: l.en }] : [];
      const r = byId.get(l.sentenceId);
      return r ? [{ id: r.id, wordId: l.wordId, zh: r.zh, en: r.en, ...(r.target ? { target: r.target } : {}) }] : [];
    }),
    kept.served === true,
  );
  return story.sentences.length >= MIN_STORY ? story : null;
}

/**
 * Write a batch's sentences as one short story, in an order the writer picks, with linking lines
 * where the story needs them, and cache the tested sentences like any other. Null when it cannot
 * (no key, out of budget): the batch then uses cached single sentences.
 */
async function writeStory(env: Env, lang: string, words: { id: number; lemma: string }[], served: boolean): Promise<ReviewStory | null> {
  try {
    const language = getLanguage(lang) ?? getLanguage('zh')!;
    const latin = language.script === 'latin';
    const known = await knownWords(env.DB, lang);
    const lemmas = words.map((w) => w.lemma.trim());
    const soon = await soonWords(env.DB, lang, lemmas);
    const call = {
      role: 'stories' as const,
      system: [storyPrompt(language.name, latin)],
      messages: [
        {
          role: 'user' as const,
          content: `Target words:\n${lemmas.join('\n')}\n\n${await vocabulary(env.DB, lang, known, soon)}`,
        },
      ],
      maxTokens: 5000,
      // Every word gets exactly one sentence, or the story has a gap in the middle of the review;
      // linking lines carry the story, they do not replace it.
      extraCheck: (v: { lines: { word: string }[] }) => {
        const tested = v.lines.map((l) => l.word.trim()).filter(Boolean);
        const lost = lemmas.filter((l) => !tested.includes(l));
        const twice = [...new Set(tested.filter((w, i) => tested.indexOf(w) !== i))];
        const links = v.lines.length - tested.length;
        return [
          ...(lost.length ? [`no sentence for: ${lost.join(', ')}`] : []),
          ...(twice.length ? [`more than one sentence for: ${twice.join(', ')}`] : []),
          ...(links > tested.length ? [`${links} linking lines for ${tested.length} target sentences: use fewer`] : []),
        ];
      },
    };
    const out = latin ? await callStructured(env, { ...call, schema: StoryLatin }) : await callStructured(env, { ...call, schema: Story });
    const title = out.title.trim();
    // Linking lines get a key of their own while they are proofread.
    const keyed: SentenceItem[] = out.lines.map((l, i) => (l.word.trim() ? l : { ...l, word: `${LINK}${i}` }));
    const checked = await checkSentences(env, lang, keyed, known, { about: `${title}: ${out.premise.trim()}`, soon, names: out.names.map((n) => n.trim()).filter(Boolean), targets: lemmas });
    const saved = new Map((await saveSentences(env, lang, words, checked.filter((l) => !l.word.startsWith(LINK)), 'story')).map((x) => [x.wordId, x.sentence]));
    const idOf = new Map(words.map((w) => [w.lemma.trim(), w.id]));
    const tidy = (zh: string) => (language.hasRomanisation ? stripPinyin(zh) : zh).trim();
    const lines = checked.flatMap((l): (StoryLine & { wordId?: number })[] => {
      if (l.word.startsWith(LINK)) return tidy(l.zh) ? [{ zh: tidy(l.zh), en: l.en.trim() }] : [];
      const wordId = idOf.get(l.word.trim());
      const sentence = wordId === undefined ? undefined : saved.get(wordId);
      return sentence ? [{ ...sentence, wordId }] : [];
    });
    const story = storyFrom(title, lines, served);
    if (story.sentences.length < MIN_STORY) return null;
    await keepStory(env.DB, lang, story);
    return story;
  } catch (e) {
    if (!(e instanceof BudgetExceededError || e instanceof NotConfiguredError)) console.error('review story failed', e);
    return null;
  }
}

const pendingKey = (lang: string) => `${lang}.review_story_pending`;

/** Whether a story is being written for this language now (started less than a few minutes ago). */
async function storyPending(db: D1Database, lang: string): Promise<boolean> {
  const at = Date.parse(await setting<string>(db, pendingKey(lang), ''));
  return Date.now() - at < STORY_PENDING_MS;
}

async function setPending(db: D1Database, lang: string, on: boolean): Promise<void> {
  if (on) await db.prepare('INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(pendingKey(lang), JSON.stringify(new Date().toISOString())).run();
  else await db.prepare('DELETE FROM settings WHERE key = ?1').bind(pendingKey(lang)).run();
}

/**
 * A kept story suits a set when it tells enough of the set's words (all of them, for a set of
 * fewer than MIN_STORY), or any of them once a review has shown it (the story carries on).
 */
function suits(story: ReviewStory | null, told: DueRow[]): story is ReviewStory {
  if (!story) return false;
  const overlap = told.filter((d) => story.byWord.has(d.item_id)).length;
  return overlap >= Math.min(MIN_STORY, told.length) || (story.served && overlap > 0);
}

/**
 * The story a set tells: the kept one when it suits (written ahead, or carried on after a reload or
 * a fix), else a new one. `serve`: a review is showing it, so it waits for a story being written
 * ahead rather than writing a second, and marks the story shown.
 */
async function storyFor(env: Env, lang: string, told: DueRow[], serve: boolean): Promise<ReviewStory | null> {
  if (told.length === 0) return null;
  let kept = await keptStory(env.DB, lang);
  // Written ahead and nearly done: wait for it (up to about 40 seconds) rather than write another.
  for (let i = 0; serve && !suits(kept, told) && i < 26 && (await storyPending(env.DB, lang)); i++) {
    await new Promise((r) => setTimeout(r, 1500));
    kept = await keptStory(env.DB, lang);
  }
  if (suits(kept, told)) {
    if (serve && !kept.served) {
      kept.served = true;
      await keepStory(env.DB, lang, kept);
    }
    return kept;
  }
  if (told.length < MIN_STORY) return null;
  await setPending(env.DB, lang, true);
  try {
    return await writeStory(env, lang, told.map((d) => ({ id: d.item_id, lemma: d.lemma! })), serve);
  } finally {
    await setPending(env.DB, lang, false);
  }
}

/**
 * Write the next set's story ahead (cron, and the home screen on opening), so the review opens
 * without waiting for it. Words sorted or met in between may miss out: they get single sentences.
 */
export async function prepareStory(env: Env, lang: string): Promise<string> {
  if ((await setting(env.DB, 'review.story', true)) === false) return 'stories off';
  if (await storyPending(env.DB, lang)) return 'a story is being written';
  const batch = Math.min(30, Math.max(1, Number(await setting(env.DB, 'review.batch_size', 15)) || 15));
  const { due } = await pickSet(env.DB, lang, batch);
  const told = toldIn(due);
  if (told.length < MIN_STORY) return 'too few words for a story';
  if (suits(await keptStory(env.DB, lang), told)) return 'story ready';
  return (await storyFor(env, lang, told, false)) ? 'story written' : 'no story (no key or budget?)';
}

reviewRoutes.post('/prepare', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  return c.json({ status: await prepareStory(c.env, lang) });
});

export const DEFAULT_NEW_PER_DAY = 10;
/**
 * SQL condition: a word card that has never been reviewed (FSRS reps = 0) and so is rationed by
 * review.new_per_day. Pinned cards ("Don't know this" in the word sheet) are not rationed.
 */
const UNSEEN_WORD = `(s.item_type = 'word' AND json_extract(s.fsrs_state_json, '$.reps') = 0 AND s.pinned = 0)`;
/**
 * SQL: a fixed shuffle of words, for the order within a level. Words are often added A to Z (a
 * starter list, an import), so going by id would bring new words in alphabetically.
 */
const HASHED = `((w.id * 2654435761) % 4294967296)`;
const SHUFFLED = `(((${HASHED} | (${HASHED} / 65536)) - (${HASHED} & (${HASHED} / 65536))) % 65536)`; // (h XOR h >> 16) mod 2^16
/** SQL: a word's level (its band, else its HSK level; unlevelled counts as easy). */
const WORD_LEVEL = `COALESCE(w.level, json_extract(w.meta_json, '$.hsk'), 0)`;
/**
 * SQL: an unseen word within reach of the measured level (`param` binds reachBand, or 99 without
 * a level check), or one met in a chat or lesson. Harder words wait in the pool.
 */
const inReach = (param: string) => `(${WORD_LEVEL} <= ${param} OR w.status = 'learning')`;

/** The highest band of new words a review introduces (99: no level check, no limit). */
async function poolReach(db: D1Database, lang: string): Promise<number> {
  const check = await levelCheck(db, lang);
  return check ? reachBand(check.vocab ?? 0) : 99;
}

/**
 * Keep `want` unseen word cards ready: when there are fewer, give cards to pool words, lowest HSK
 * level first and words from the learner's own Pleco categories first within a level. The word
 * stays "new" until its first review makes it "learning".
 */
async function topUpFromPool(db: D1Database, lang: string, want: number, nowIso: string): Promise<void> {
  const check = await levelCheck(db, lang);
  const reach = check ? reachBand(check.vocab ?? 0) : 99;
  // Unseen cards for words beyond reach (from the level check, say) do not count: they wait.
  const have = await db
    .prepare(`SELECT COUNT(*) AS n FROM srs_cards s JOIN words w ON w.id = s.item_id WHERE s.lang = ?1 AND s.due_at <= ?2 AND ${UNSEEN_WORD} AND ${inReach('?3')}`)
    .bind(lang, nowIso, reach)
    .first<{ n: number }>();
  const need = want - (have?.n ?? 0);
  if (need <= 0) return;
  const maxBand = await poolMaxBand(db, lang);
  const { results } = await db
    .prepare(
      `SELECT w.id FROM words w
       WHERE w.lang = ?1 AND w.status = 'new' AND NOT EXISTS (SELECT 1 FROM srs_cards s WHERE s.item_type = 'word' AND s.item_id = w.id)
         AND (?4 IS NULL OR COALESCE(w.level, json_extract(w.meta_json, '$.hsk'), 0) <= ?4) AND ${WORD_LEVEL} <= ?5
       ORDER BY w.triaged_at IS NOT NULL DESC,
                (COALESCE(w.level, json_extract(w.meta_json, '$.hsk'), 99) >= ?3) DESC,
                COALESCE(w.level, json_extract(w.meta_json, '$.hsk'), 99),
                EXISTS (SELECT 1 FROM json_each(w.meta_json, '$.categories') c WHERE c.value IN ('Words', 'Duo Chars')) DESC, ${SHUFFLED}
       LIMIT ?2`,
    )
    // Only words within reach of the measured level (its band and the next): harder ones the level
    // check or sorting found unknown wait. Sorted-but-unknown words first, then words at or above
    // the measured level, easiest first.
    .bind(lang, need, check?.vocab ?? 0, maxBand, reach)
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
    .prepare(
      `SELECT COALESCE(SUM(NOT ${UNSEEN_WORD}), 0) AS seen, COALESCE(SUM(${UNSEEN_WORD} AND ${inReach('?3')}), 0) AS unseen
       FROM srs_cards s LEFT JOIN words w ON s.item_type = 'word' AND w.id = s.item_id WHERE s.lang = ?1 AND s.due_at <= ?2`,
    )
    .bind(lang, now, await poolReach(db, lang))
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

/**
 * The cards a review shows next: due cards already seen, and unseen word cards up to today's
 * new-word allowance, within the daily limit (`limitReached` when it is used up). `include` forces
 * a card in first (today's grammar point); `skip` leaves out cards answered in this sitting.
 */
async function pickSet(db: D1Database, lang: string, batch: number, skip: number[] = [], include = 0): Promise<{ due: DueRow[]; limitReached?: number }> {
  const now = new Date().toISOString();
  // Daily cap: the Pleco import leaves a large overdue backlog; work through it a slice a day.
  const limit = Number(await setting(db, 'review.daily_limit', 60)) || 60;
  const done = await reviewedToday(db, lang);
  const take = Math.min(batch, Math.max(0, limit - done));
  if (take === 0 && !include) return { due: [], limitReached: limit };
  // Unseen word cards (never reviewed, here or in Pleco) are rationed by review.new_per_day.
  const newPerDay = Math.max(0, Number(await setting(db, 'review.new_per_day', DEFAULT_NEW_PER_DAY)) || 0);
  const introduced = await introducedToday(db, lang);
  const newQuota = Math.min(take, Math.max(0, newPerDay - introduced));
  const cols = `s.*, w.lemma, w.reading, w.gloss, w.status, g.title AS g_title, g.summary AS g_summary
     FROM srs_cards s
     LEFT JOIN words w ON s.item_type = 'word' AND w.id = s.item_id
     LEFT JOIN grammar_points g ON s.item_type = 'grammar_point' AND g.id = s.item_id`;
  const skipSql = skip.length ? `AND s.id NOT IN (${skip.join(',')})` : '';
  const { results: seen } = await db.prepare(
    `SELECT ${cols}
     WHERE s.lang = ?1 AND (s.due_at <= ?2 OR s.id = ?4) ${skipSql} AND (s.id = ?4 OR NOT (${UNSEEN_WORD}))
     ORDER BY s.id = ?4 DESC, s.pinned DESC, s.item_type = 'grammar_point' DESC, w.status = 'learning' DESC, s.due_at LIMIT ?3`,
  )
    .bind(lang, now, Math.max(take, include ? 1 : 0), include || -1)
    .all<DueRow>();
  if (newQuota) await topUpFromPool(db, lang, newQuota, now);
  // Words met in chats and lessons (status 'learning'; pool words stay 'new') first, then by level,
  // so the pool is not taken alphabetically; words beyond reach of the measured level wait.
  const { results: fresh } = newQuota
    ? await db.prepare(
        `SELECT ${cols}
         WHERE s.lang = ?1 AND s.due_at <= ?2 ${skipSql} AND ${UNSEEN_WORD} AND ${inReach('?5')} AND s.id <> ?4
         ORDER BY w.status = 'learning' DESC, EXISTS (SELECT 1 FROM exposures e WHERE e.word_id = w.id) DESC, w.source IN ('conversation', 'lesson') DESC,
                  COALESCE(w.level, json_extract(w.meta_json, '$.hsk'), 99), ${SHUFFLED}
         LIMIT ?3`,
      )
        .bind(lang, now, newQuota, include || -1, await poolReach(db, lang))
        .all<DueRow>()
    : { results: [] as DueRow[] };
  const kept = seen.slice(0, Math.max(take - fresh.length, include ? 1 : 0));
  // A forced card (today's grammar point) stays first.
  const due = include && kept[0]?.id === include ? [kept[0], ...interleave(kept.slice(1), fresh)] : interleave(kept, fresh);
  return { due };
}

/** Word cards in a set that its story tells: not the ones headed for the matching board (it shows no sentences). */
function toldIn(due: DueRow[]): DueRow[] {
  const glossed = (d: DueRow) => !!d.gloss && !!tidyListGloss(d.gloss);
  const reps = (d: DueRow) => parseCard(d.fsrs_state_json).reps;
  const words = due.filter((d) => d.item_type === 'word' && d.lemma);
  const boardSize = words.filter((d) => kindFor(reps(d), true, true, d.id, glossed(d)) === 'match').length;
  return words.filter((d) => kindFor(reps(d), true, true, d.id, boardSize >= MIN_MATCH && glossed(d)) !== 'match');
}

reviewRoutes.get('/next', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const batch = Math.min(30, Math.max(1, Number(c.req.query('limit') ?? (await setting(c.env.DB, 'review.batch_size', 15)))));
  const skip = (c.req.query('skip') ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  const include = Number(c.req.query('include') ?? 0);
  const picked = await pickSet(c.env.DB, lang, batch, skip, include);
  if (picked.limitReached) return c.json({ items: [], notice: `Daily review limit of ${picked.limitReached} reached. Well done.`, limitReached: true });
  const due = picked.due;
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
  const glossed = (d: DueRow) => !!d.gloss && !!tidyListGloss(d.gloss);

  // The batch's sentence cards tell one short story (setting review.story), in the story's order.
  // Words headed for the matching board are left out of it: the board shows no sentences.
  const story = (await setting(c.env.DB, 'review.story', true)) !== false ? await storyFor(c.env, lang, toldIn(due), true) : null;
  const missing = due
    .filter((d) => d.item_type === 'word' && d.lemma && !sentences.has(`word:${d.item_id}`) && !story?.byWord.has(d.item_id))
    .map((d) => ({ id: d.item_id, lemma: d.lemma! }));
  const notice = await ensureWordSentences(c.env, lang, missing);
  if (missing.length) sentences = await loadSentences();
  if (story) for (const [wordId, { sentence }] of story.byWord) sentences.set(`word:${wordId}`, [sentence, ...(sentences.get(`word:${wordId}`) ?? []).filter((x) => x.id !== sentence.id)]);

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
    const made: Exercise = quiz.length ? { kind: 'quiz', quiz, lessonId: gl!.lessonId } : asChoice(makeExercise(kindFor(card.reps, !!s, isWord, d.id, canMatch && glossed(d)), s), d, d.id + card.reps);
    const told = isWord ? story?.byWord.get(d.item_id) : undefined;
    const prev = told ? linesBefore(story!.lines, told.line, told.sentence.target ?? d.lemma ?? undefined).map((l) => ({ ...(l.id !== undefined ? { id: l.id } : {}), zh: l.zh, en: l.en })) : [];
    const exercise: Exercise =
      told && made.sentenceId === told.sentence.id ? { ...made, story: { title: story!.title, part: told.pos + 1, of: story!.sentences.length, ...(prev.length ? { prev } : {}) } } : made;
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
  // Grammar (and a forced card) first, then the story in order, then the board and flashcards.
  const ordered = story ? storyOrder(items, (i) => (i.exercise.story ? i.exercise.story.part : undefined), (i) => i.cardId === include || i.itemType === 'grammar_point') : items;
  const recap: StoryRecap | null = story
    ? {
        title: story.title,
        sentences: story.lines,
      }
    : null;
  const quizStrings = (q: LessonCheckItem[] = []) => q.flatMap((it) => (it.kind === 'choice' ? it.options : it.kind === 'translate' ? [it.zh] : [it.wrong, it.right]));
  const strings = ordered.flatMap((i) =>
    [i.exercise.promptZh, i.exercise.clozeZh, i.exercise.answerZh, i.word?.lemma, i.grammar?.title, ...quizStrings(i.exercise.quiz)].filter((x): x is string => !!x),
  );
  const annotations = await annotateStrings(c.env.DB, lang, [...strings, ...(recap?.sentences.map((x) => x.zh) ?? [])]);
  return c.json({ items: ordered, annotations, notice, story: recap });
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
