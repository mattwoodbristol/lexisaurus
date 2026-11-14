import { Hono } from 'hono';
import { z } from 'zod';
import { createEmptyCard } from 'ts-fsrs';
import type { Env } from './env';
import { callStructured, BudgetExceededError, NotConfiguredError } from './claude';
import { annotateStrings } from './annotate';
import { invalidateDict } from './words';
import { stripPinyin } from '../core/pinyin/strip';
import { parseCard, reviewCard, statusAfterReview, isRating, DEFAULT_GRADUATE_DAYS } from '../core/srs/schedule';
import { kindFor, makeExercise, MIN_MATCH, STEP_STABILITY_DAYS, storyKind, type Exercise, type Sentence } from '../core/review/exercise';
import { levelCheck } from './level';
import { passFromQuiz } from './lessons';
import { THEME_PIN, interleave, themeSlots } from '../core/review/queue';
import { MIN_STORY, linesAfter, linesBefore, partAt, storyOrder, tellable, type StoryLine, type StoryRecap } from '../core/review/story';
import { tidyListGloss, isNameGloss } from '../core/words/gloss';
import { boardGloss } from '../core/assessment/sort-board';
import { withChoices } from '../core/review/choices';
import { gateNotice, newWordGate, RECENT_REVIEWS } from '../core/review/new-words';
import { randomSeed } from '../core/lessons/steps';
import type { StoredStatus } from '../core/pinyin/annotate';
import { grammarExamplesPrompt, promptsFor, proofreadSentencesPrompt, speakPrompt, storyPrompt } from '../../prompts';
import { getLanguage } from '../core/languages';
import { dayStartIso, heldBack, holdBack, poolMaxBand } from './day';
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
 * count only once they are going well (their card past step 0, see stepOf): a word just met, or
 * being missed, would make a sentence about another word hard. They come first, so a long known
 * list never crowds them out, then known words, simplest first.
 */
async function knownWords(db: D1Database, lang: string): Promise<string[]> {
  const stability = `json_extract(s.fsrs_state_json, '$.stability')`;
  const { results } = await db
    .prepare(
      `SELECT lemma FROM (SELECT w.lemma FROM words w JOIN srs_cards s ON s.item_type = 'word' AND s.item_id = w.id
                          WHERE w.lang = ?1 AND w.status = 'learning' AND ${stability} >= ?2 ORDER BY ${stability} DESC LIMIT 200)
       UNION ALL
       SELECT lemma FROM (SELECT lemma FROM words WHERE lang = ?1 AND status = 'known' ORDER BY COALESCE(level, json_extract(meta_json, '$.hsk'), 99), id LIMIT 400)`,
    )
    .bind(lang, STEP_STABILITY_DAYS[0])
    .all<{ lemma: string }>();
  return results.map((r) => r.lemma);
}

/**
 * Words the learner knows well (status known, easiest first), for sentences said aloud. With too
 * few of them, the wider list (learning words too) the other writers use.
 */
async function wellKnownWords(db: D1Database, lang: string): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT lemma FROM words WHERE lang = ?1 AND status = 'known' ORDER BY COALESCE(level, json_extract(meta_json, '$.hsk'), 99), id LIMIT 500`)
    .bind(lang)
    .all<{ lemma: string }>();
  return results.length >= KNOWN_ENOUGH ? results.map((r) => r.lemma) : knownWords(db, lang);
}

/** Most words offered to a story from the pool. */
const SOON_MAX = 80;

/** Most of those a whole story may use: each is a word the learner has not met, on top of the targets. */
const SOON_PER_STORY = 2;

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
 * The band of words a sentence may use besides a short known list: one below the measured level
 * (those are words the learner has had time to meet), the first band without a level check.
 */
async function easyBand(db: D1Database, lang: string): Promise<number> {
  const band = (await levelCheck(db, lang))?.vocab;
  return Math.max(1, Math.round(band ?? 1) - 1);
}

/**
 * What a sentence writer may use besides the targets. A short list (a language just started) is
 * not all the learner knows, so sentences are not held to it: the simplest everyday words are
 * allowed too (easyBand). Holding a story to a dozen words makes it strange.
 */
async function vocabulary(db: D1Database, lang: string, known: string[], soon: string[] = []): Promise<string> {
  const also = soon.length
    ? `\n\nWords at the learner's level they will learn soon: the whole story may use at most ${SOON_PER_STORY} of these (one per sentence), only where it cannot do without:\n${soon.join(', ')}`
    : '';
  if (known.length >= KNOWN_ENOUGH) return `Words the learner knows (use only these besides the target words):\n${known.join(', ')}${also}`;
  const common = `the simplest, most common everyday words (level ${bandLabel(lang, await easyBand(db, lang))} or below)`;
  return (
    (known.length
      ? `Words the learner knows:\n${known.join(', ')}\n\nThis list is short, so besides these use only ${common}.`
      : `No word list: besides the target words use only ${common}.`) + also
  );
}

/**
 * Words in each sentence, besides its target, that the learner does not know: words the list has
 * as new, or as learning but not among `known` (not going well yet) (Chinese, where the list is
 * matched word for word; Latin-script forms are not). With a short known list (`easyUpTo`, see
 * vocabulary) a new word up to that band is allowed, and a word not on the list at all is not
 * judged: its level is not known.
 */
async function extraNewWords(db: D1Database, lang: string, items: SentenceItem[], known: string[], story?: StoryContext, easyUpTo?: number): Promise<Map<SentenceItem, string[]>> {
  const ann = await annotateStrings(db, lang, items.map((i) => i.zh));
  const knownSet = new Set(known.map((k) => k.trim()));
  const unknown = (t: { text: string; status?: string }) =>
    easyUpTo === undefined ? t.status === 'new' || t.status === 'unknown' || (t.status === 'learning' && !knownSet.has(t.text)) : t.status === 'new' || (t.status === 'learning' && !knownSet.has(t.text));
  const candidates = [...new Set(Object.values(ann).flatMap((ts) => ts.filter((t) => t.pinyin && unknown(t)).map((t) => t.text)))];
  // With a short list, the easy pool words pass.
  const easy = new Set<string>();
  if (easyUpTo !== undefined && candidates.length) {
    const { results } = await db
      .prepare(`SELECT w.lemma FROM words w WHERE w.lang = ?1 AND w.lemma IN (SELECT value FROM json_each(?2)) AND w.status = 'new' AND ${WORD_LEVEL} <= ?3`)
      .bind(lang, JSON.stringify(candidates), easyUpTo)
      .all<{ lemma: string }>();
    for (const r of results) easy.add(r.lemma);
  }
  const allowed = new Set(story?.soon ?? []);
  // A name may be split into characters that read as words: none of them counts.
  const inName = (w: string) => [...(story?.names ?? []), ...(story?.targets ?? [])].some((n) => n.includes(w));
  const out = new Map<SentenceItem, string[]>();
  // The first SOON_PER_STORY borrowed words, in story order, are allowed; the rest are problems.
  const used = new Set<string>();
  for (const it of items) {
    const extra = [
      ...new Set(
        (ann[it.zh] ?? [])
          .filter((t) => t.pinyin && unknown(t) && !easy.has(t.text))
          .map((t) => t.text)
          .filter((w) => !it.word.includes(w) && !w.includes(it.word) && !inName(w)),
      ),
    ];
    // One word the story was allowed to borrow is fine (while the story is under its cap); any
    // more, or any other, is a problem.
    const borrowed = extra.filter((w) => allowed.has(w));
    const ok = borrowed.find((w) => used.has(w)) ?? (used.size < SOON_PER_STORY ? borrowed[0] : undefined);
    if (ok) used.add(ok);
    const problems = [...extra.filter((w) => !allowed.has(w)), ...borrowed.filter((w) => w !== ok)];
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

/** Rewrites asked for when a sentence uses words the learner does not know. */
const REWRITES = 2;

/**
 * Checked before the learner sees them, and held to one new word: the target. A sentence that
 * still has words the learner does not know after REWRITES goes is left out (its word gets
 * another exercise); a story's linking lines are kept, as they carry the story and are not tested.
 */
async function checkSentences(env: Env, lang: string, items: SentenceItem[], known: string[], story?: StoryContext): Promise<SentenceItem[]> {
  items = await proofreadSentences(env, lang, items, known, undefined, story);
  if (getLanguage(lang)?.script === 'latin') return items;
  const easyUpTo = known.length >= KNOWN_ENOUGH ? undefined : await easyBand(env.DB, lang);
  let problems = await extraNewWords(env.DB, lang, items, known, story, easyUpTo);
  for (let n = 0; n < REWRITES && problems.size; n++) {
    // The whole story goes back, so a rewritten sentence still follows on from its neighbours.
    const fixed = await proofreadSentences(env, lang, story ? items : [...problems.keys()], known, problems, story);
    const byWord = new Map(fixed.map((f) => [f.word.trim(), f]));
    const was = problems;
    items = items.map((it) => (was.has(it) ? (byWord.get(it.word.trim()) ?? it) : it));
    problems = await extraNewWords(env.DB, lang, items, known, story, easyUpTo);
  }
  return items.filter((it) => !problems.has(it) || it.word.startsWith(LINK));
}

/**
 * Cache sentences for their words, in order, skipping any without its target. Returns the saved
 * sentences (a sentence cached before keeps its row).
 */
async function saveSentences(env: Env, lang: string, words: { id: number; lemma: string }[], items: SentenceItem[], source: 'generated' | 'story' | 'speak'): Promise<{ wordId: number; sentence: Sentence }[]> {
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

/**
 * Short, simple sentences for Say-it cards (source 'speak'), for words that have none yet: the
 * learner says the whole sentence from its English. Returns a notice when they cannot be written.
 */
async function ensureSpeakSentences(env: Env, lang: string, words: { id: number; lemma: string }[]): Promise<string | null> {
  if (words.length === 0) return null;
  try {
    const language = getLanguage(lang) ?? getLanguage('zh')!;
    const latin = language.script === 'latin';
    const known = await wellKnownWords(env.DB, lang);
    const call = {
      role: 'exercises' as const,
      system: [speakPrompt(language.name, latin)],
      messages: [{ role: 'user' as const, content: `Target words:\n${words.map((w) => w.lemma).join('\n')}\n\n${await vocabulary(env.DB, lang, known)}` }],
      maxTokens: 2000,
    };
    const items: SentenceItem[] = latin
      ? (await callStructured(env, { ...call, schema: ExerciseBatchLatin })).items
      : (await callStructured(env, { ...call, schema: ExerciseBatch })).items;
    await saveSentences(env, lang, words, await checkSentences(env, lang, items, known), 'speak');
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
  /** When a review first showed it: its words answered since then are done. */
  servedAt?: string;
  /** Every line, linking lines included, in order. */
  lines: StoryLine[];
  /** The tested sentences, in order. */
  sentences: Sentence[];
  /** Each word's sentence, by word id, with its place among the tested ones (0-based) and among all lines. */
  byWord: Map<number, { sentence: Sentence; pos: number; line: number }>;
}

/**
 * Setting <lang>.review_story: the story the current set tells (or the next, before a review shows
 * it), kept a day or two. Setting <lang>.review_story_next: the story written ahead for the set after
 * a story under way, moved to review_story when a review shows it.
 */
interface KeptStory {
  /** When it was written. */
  written?: string;
  /** Before stories were written ahead (2026-10-21): the day it was written. */
  day?: string;
  title: string;
  served?: boolean;
  servedAt?: string;
  /** A tested line (by its word and cached sentence) or a linking line. */
  lines?: ({ wordId: number; sentenceId: number } | { zh: string; en: string })[];
  /** Before linking lines (2026-10-21): tested lines only. */
  items?: { wordId: number; sentenceId: number }[];
}

/** How long a story written ahead waits to be used (the next day's set can use it). */
const STORY_KEEP_MS = 2 * 24 * 3600 * 1000;
/** How long a story being written (by the cron, or a home screen's request) holds off another. */
const STORY_PENDING_MS = 3 * 60 * 1000;

function storyFrom(title: string, lines: (StoryLine & { wordId?: number })[], served = false, servedAt?: string): ReviewStory {
  const byWord = new Map<number, { sentence: Sentence; pos: number; line: number }>();
  const sentences: Sentence[] = [];
  lines.forEach((l, line) => {
    if (l.id === undefined || l.wordId === undefined) return;
    const sentence: Sentence = { id: l.id, zh: l.zh, en: l.en, ...(l.target ? { target: l.target } : {}) };
    byWord.set(l.wordId, { sentence, pos: sentences.length, line });
    sentences.push(sentence);
  });
  return { title, served, ...(servedAt ? { servedAt } : {}), lines: lines.map(({ wordId: _, ...l }) => l), sentences, byWord };
}

type StorySlot = 'current' | 'next';
const storyKey = (lang: string, slot: StorySlot) => (slot === 'next' ? `${lang}.review_story_next` : `${lang}.review_story`);

async function keepStory(db: D1Database, lang: string, story: ReviewStory, slot: StorySlot = 'current'): Promise<void> {
  const wordOf = new Map([...story.byWord].map(([wordId, { sentence }]) => [sentence.id, wordId]));
  const kept: KeptStory = {
    written: new Date().toISOString(),
    title: story.title,
    served: story.served,
    ...(story.servedAt ? { servedAt: story.servedAt } : {}),
    lines: story.lines.map((l) => (l.id !== undefined ? { wordId: wordOf.get(l.id)!, sentenceId: l.id } : { zh: l.zh, en: l.en })),
  };
  await db.prepare('INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(storyKey(lang, slot), JSON.stringify(kept)).run();
}

/**
 * The kept story, with its sentences as they are now (a fixed sentence reads fixed). Null if it is
 * more than two days old or its sentences are gone.
 */
export async function keptStory(db: D1Database, lang: string, slot: StorySlot = 'current'): Promise<ReviewStory | null> {
  const kept = await setting<KeptStory | null>(db, storyKey(lang, slot), null);
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
    typeof kept.servedAt === 'string' ? kept.servedAt : undefined,
  );
  return story.sentences.length >= MIN_STORY ? story : null;
}

/**
 * Write a batch's sentences as one short story, in an order the writer picks, with linking lines
 * where the story needs them, and cache the tested sentences like any other. Null when it cannot
 * (no key, out of budget): the batch then uses cached single sentences.
 */
async function writeStory(env: Env, lang: string, words: { id: number; lemma: string }[], served: boolean, slot: StorySlot = 'current'): Promise<ReviewStory | null> {
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
    const story = storyFrom(title, lines, served, served ? new Date().toISOString() : undefined);
    if (story.sentences.length < MIN_STORY) return null;
    await keepStory(env.DB, lang, story, slot);
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
 * A story written ahead suits a set when it tells enough of the set's words (all of them, for a set
 * of fewer than MIN_STORY). One a review has shown carries on only while it is under way
 * (storyInProgress), so a finished story is not told again.
 */
function suits(story: ReviewStory | null, told: DueRow[]): story is ReviewStory {
  if (!story || story.served) return false;
  const overlap = told.filter((d) => story.byWord.has(d.item_id)).length;
  return overlap >= Math.min(MIN_STORY, told.length);
}

/**
 * The story a review shows for a set: the kept one when it suits (carried on after a reload or a
 * fix, or written ahead), else the one written ahead for the set after it; it marks the story shown.
 * It neither waits for a story being written nor writes one: a story can take minutes, and the
 * review opens at once with example sentences (2026-11-03: an Italian review sat on "Preparing"
 * while one was written). The review asks for the next set's story as it shows this one.
 */
async function storyFor(env: Env, lang: string, told: DueRow[]): Promise<ReviewStory | null> {
  if (told.length === 0) return null;
  const kept = await keptStory(env.DB, lang);
  const next = suits(kept, told) ? null : await keptStory(env.DB, lang, 'next');
  const story = suits(kept, told) ? kept : suits(next, told) ? next : null;
  if (story) {
    story.served = true;
    story.servedAt = new Date().toISOString();
    await keepStory(env.DB, lang, story);
    if (story === next) await env.DB.prepare('DELETE FROM settings WHERE key = ?1').bind(storyKey(lang, 'next')).run();
    return story;
  }
  return null;
}

/**
 * A story a review has shown and not finished: its word cards not answered since it was shown, in
 * story order. A reload (or a return to the review) carries on with these alone, so the story is not
 * mixed with other words' sentences, nor told again from parts already done.
 */
async function storyInProgress(db: D1Database, lang: string): Promise<{ story: ReviewStory; left: DueRow[]; done: number[] } | null> {
  const story = await keptStory(db, lang);
  if (!story?.served || !story.servedAt) return null;
  const ids = [...story.byWord.keys()];
  const { results } = await db
    .prepare(
      `SELECT ${CARD_COLS}
       WHERE s.lang = ?1 AND s.item_type = 'word' AND s.item_id IN (${ids.join(',')})
         AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.card_id = s.id AND r.reviewed_at >= ?2)`,
    )
    .bind(lang, story.servedAt)
    .all<DueRow>();
  if (!results.length) return null;
  const pos = (d: DueRow) => story.byWord.get(d.item_id)!.pos;
  // Words answered since it was shown keep their parts, so the numbering carries on after a reload.
  const { results: answered } = await db
    .prepare(
      `SELECT s.item_id FROM srs_cards s WHERE s.lang = ?1 AND s.item_type = 'word' AND s.item_id IN (${ids.join(',')})
         AND EXISTS (SELECT 1 FROM reviews r WHERE r.card_id = s.id AND r.reviewed_at >= ?2)`,
    )
    .bind(lang, story.servedAt)
    .all<{ item_id: number }>();
  return { story, left: results.sort((a, b) => pos(a) - pos(b)), done: answered.map((r) => r.item_id) };
}

/** Cards in a set when nothing says otherwise: setting review.batch_size, at most 30. */
async function batchSize(db: D1Database): Promise<number> {
  return Math.min(30, Math.max(1, Number(await setting(db, 'review.batch_size', 15)) || 15));
}

/** New example sentences written for a grammar point at a time. */
const GRAMMAR_EXAMPLES = 3;

/**
 * New example sentences for grammar points whose cached examples have all been shown, so a grammar
 * card practises the point on a sentence it has not shown before. Proofread, but not held to the
 * known list word for word: a pattern's own words may be new. Returns a notice when they cannot be
 * written.
 */
async function ensureGrammarExamples(env: Env, lang: string, points: { id: number; title: string; summary: string | null }[]): Promise<string | null> {
  if (points.length === 0) return null;
  try {
    const language = getLanguage(lang) ?? getLanguage('zh')!;
    const latin = language.script === 'latin';
    const known = await knownWords(env.DB, lang);
    const call = {
      role: 'exercises' as const,
      system: [grammarExamplesPrompt(language.name, latin, GRAMMAR_EXAMPLES)],
      messages: [
        {
          role: 'user' as const,
          content: `Grammar points:\n${points.map((p) => `- ${p.title}${p.summary ? `: ${p.summary}` : ''}`).join('\n')}\n\n${await vocabulary(env.DB, lang, known)}`,
        },
      ],
      maxTokens: 2500,
    };
    const items: SentenceItem[] = (await callStructured(env, { ...call, schema: ExerciseBatch })).items;
    const checked = await proofreadSentences(env, lang, items, known);
    const idOf = new Map(points.map((p) => [p.title.trim(), p.id]));
    const rows = checked.flatMap((it) => {
      const id = idOf.get(it.word.trim());
      const zh = (language.hasRomanisation ? stripPinyin(it.zh) : it.zh).trim();
      return id && zh ? [{ id, zh, en: it.en.trim() }] : [];
    });
    if (rows.length)
      await env.DB.batch(
        rows.map((r) =>
          env.DB.prepare(
            `INSERT INTO exercises(lang, item_type, item_id, zh, en, source) VALUES (?1, 'grammar_point', ?2, ?3, ?4, 'generated')
             ON CONFLICT (item_type, item_id, zh) DO UPDATE SET used_count = used_count`,
          ).bind(lang, r.id, r.zh, r.en),
        ),
      );
    return null;
  } catch (e) {
    return sentenceNotice(e);
  }
}

/**
 * A set's cached sentences: each card's, least used first (`sentences`, by "type:id"), each
 * word's short sentence to say aloud, least used first (`speak`, by word id), and the cards with a
 * sentence not shown yet (`unused`, by "type:id").
 */
async function cachedSentences(db: D1Database, due: DueRow[]): Promise<{ sentences: Map<string, Sentence[]>; speak: Map<number, Sentence>; unused: Set<string> }> {
  const sentences = new Map<string, Sentence[]>();
  const speak = new Map<number, Sentence>();
  const unused = new Set<string>();
  if (!due.length) return { sentences, speak, unused };
  const keys = due.map((d) => `('${d.item_type}',${d.item_id})`).join(',');
  const { results } = await db
    .prepare(`SELECT id, item_type, item_id, zh, en, target, source, used_count FROM exercises WHERE (item_type, item_id) IN (VALUES ${keys}) ORDER BY used_count, id`)
    .all<{ id: number; item_type: string; item_id: number; zh: string; en: string; target: string | null; source: string; used_count: number }>();
  for (const r of results) {
    const k = `${r.item_type}:${r.item_id}`;
    if (!sentences.has(k)) sentences.set(k, []);
    const sentence = { id: r.id, zh: r.zh, en: r.en, ...(r.target ? { target: r.target } : {}) };
    sentences.get(k)!.push(sentence);
    if (r.used_count === 0) unused.add(k);
    if (r.source === 'speak' && r.item_type === 'word' && !speak.has(r.item_id)) speak.set(r.item_id, sentence);
  }
  return { sentences, speak, unused };
}
type Cached = Awaited<ReturnType<typeof cachedSentences>>;

/**
 * What a set still needs written: `said`, its Say-it words (said from a short sentence of their
 * own, unless the story tells them); `unsaid`, those with no such sentence yet; `missing`, its
 * other words with no sentence at all that the story does not tell; `stale`, its grammar points
 * with no example left that has not been shown.
 */
function sentencesWanted(due: DueRow[], story: ReviewStory | null, cached: Cached) {
  const said = new Set(saidIn(due).map((d) => d.item_id).filter((id) => !story?.byWord.has(id)));
  const missing = due
    .filter((d) => d.item_type === 'word' && d.lemma && !said.has(d.item_id) && !cached.sentences.has(`word:${d.item_id}`) && !story?.byWord.has(d.item_id))
    .map((d) => ({ id: d.item_id, lemma: d.lemma! }));
  const unsaid = due.filter((d) => said.has(d.item_id) && !cached.speak.has(d.item_id)).map((d) => ({ id: d.item_id, lemma: d.lemma! }));
  const stale = due
    .filter((d) => d.item_type === 'grammar_point' && d.g_title && !cached.unused.has(`grammar_point:${d.item_id}`))
    .map((d) => ({ id: d.item_id, title: d.g_title!, summary: d.g_summary }));
  return { said, missing, unsaid, stale };
}

/** How long a set's sentences being written ahead (by the cron, or a screen's request) hold off another writing. */
const PREP_PENDING_MS = STORY_PENDING_MS;
const prepKey = (lang: string) => `${lang}.review_prep_pending`;

/**
 * Write the next set ahead, so the review opens without waiting: its story, then the sentences it
 * still needs (Say-it words' short sentences, and single sentences for words the story leaves
 * out). Asked for by the cron and the home screen on opening (the first set of a sitting asks for
 * today's remaining cards, up to 30), and by a review as it shows a set (`skip`: that set's cards;
 * `batch`: the size of the set after it). While a story is under way, the one after it is written
 * to review_story_next, and the set it tells leaves out the words still to do in the one under
 * way. Words sorted or met in between may miss out: they get single sentences when the review
 * opens. Returns what became of the story and how many words got sentences.
 */
export async function prepareSet(env: Env, lang: string, opts: { skip?: number[]; batch?: number } = {}): Promise<{ story: string; sentences: number }> {
  const storiesOn = (await setting(env.DB, 'review.story', true)) !== false;
  const going = storiesOn ? await storyInProgress(env.DB, lang) : null;
  const skip = [...(opts.skip ?? []), ...(going?.left.map((d) => d.id) ?? [])];
  const { due } = await pickSet(env.DB, lang, opts.batch ?? 30, [...new Set(skip)]);
  // The story first, so the single sentences are for the words it leaves out.
  const storyPendingNow = storiesOn && (await storyPending(env.DB, lang));
  let story: ReviewStory | null = null;
  let status: string;
  if (!storiesOn) status = 'stories off';
  else if (storyPendingNow) status = 'a story is being written';
  else {
    const told = toldIn(due);
    if (told.length < MIN_STORY) status = 'too few words for a story';
    else {
      const [current, next] = await Promise.all([keptStory(env.DB, lang), keptStory(env.DB, lang, 'next')]);
      story = suits(current, told) ? current : suits(next, told) ? next : null;
      if (story) status = 'story ready';
      else {
        // A story under way is not written over: the one after it waits beside it.
        const slot: StorySlot = going ? 'next' : 'current';
        await setPending(env.DB, lang, true);
        try {
          story = await writeStory(env, lang, told.map((d) => ({ id: d.item_id, lemma: d.lemma! })), false, slot);
        } finally {
          await setPending(env.DB, lang, false);
        }
        status = story ? 'story written' : 'no story (no key or budget?)';
      }
    }
  }
  // Then the sentences: not while another request is writing them. Single sentences wait for a
  // story being written (it will tell those words); Say-it sentences do not depend on it.
  if (await heldBack(env.DB, prepKey(lang), PREP_PENDING_MS)) return { story: status, sentences: 0 };
  const { missing, unsaid, stale } = sentencesWanted(due, story, await cachedSentences(env.DB, due));
  const single = storyPendingNow ? [] : missing;
  if (!single.length && !unsaid.length && !stale.length) return { story: status, sentences: 0 };
  await holdBack(env.DB, prepKey(lang), true);
  try {
    await Promise.all([ensureWordSentences(env, lang, single), ensureSpeakSentences(env, lang, unsaid), ensureGrammarExamples(env, lang, stale)]);
  } finally {
    await holdBack(env.DB, prepKey(lang), false);
  }
  return { story: status, sentences: single.length + unsaid.length + stale.length };
}

/** Card ids from a comma-separated query value. */
const idList = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

// Awaited, not left to waitUntil (cut off about 30 seconds after the response): the page asking
// does not wait on it, and the story takes longer than that to write.
reviewRoutes.post('/prepare', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const skip = idList(c.req.query('skip'));
  const limit = Number(c.req.query('limit'));
  const batch = Number.isInteger(limit) && limit > 0 ? Math.min(30, limit) : skip.length ? await batchSize(c.env.DB) : undefined;
  const { story, sentences } = await prepareSet(c.env, lang, { ...(skip.length ? { skip } : {}), ...(batch ? { batch } : {}) });
  return c.json({ status: story, sentences });
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
         AND json_extract(w.meta_json, '$.name') IS NULL
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
 * Today's new-word allowance (review.new_per_day), held back while seen cards pile up or recent
 * reviews are being missed (newWordGate), with the review's notice when it is.
 */
async function newWordsToday(db: D1Database, lang: string, now: string): Promise<{ perDay: number; notice: string | null }> {
  const perDay = Math.max(0, Number(await setting(db, 'review.new_per_day', DEFAULT_NEW_PER_DAY)) || 0);
  if (!perDay) return { perDay, notice: null };
  const [backlog, recent] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM srs_cards s WHERE s.lang = ?1 AND s.due_at <= ?2 AND NOT ${UNSEEN_WORD}`).bind(lang, now).first<{ n: number }>(),
    // Word reviews of the last three days, newest first; a first sighting (intro) missed is not a miss.
    db
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(rating = 1), 0) AS missed FROM (
           SELECT r.rating FROM reviews r JOIN srs_cards s ON s.id = r.card_id
           WHERE s.lang = ?1 AND s.item_type = 'word' AND r.reviewed_at >= ?2 AND COALESCE(r.kind, '') <> 'intro'
           ORDER BY r.reviewed_at DESC LIMIT ?3)`,
      )
      .bind(lang, new Date(Date.parse(now) - 3 * 86_400_000).toISOString(), RECENT_REVIEWS)
      .first<{ total: number; missed: number }>(),
  ]);
  const gate = newWordGate(perDay, backlog?.n ?? 0, { total: recent?.total ?? 0, missed: recent?.missed ?? 0 });
  return { perDay: gate.perDay, notice: gateNotice(gate, backlog?.n ?? 0) };
}

/**
 * Cards a review would show now: due cards already seen, plus as many unseen word cards as today's
 * new-word allowance (review.new_per_day) has left, which is how the review rations them. Counting
 * every due card instead promised reviews the review would not show.
 */
export async function dueNow(db: D1Database, lang: string): Promise<number> {
  const now = new Date().toISOString();
  const { perDay } = await newWordsToday(db, lang, now);
  const left = Math.max(0, perDay - (await introducedToday(db, lang)));
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

/** Cards reviewed today, not counting Grammar of the day's Practise (it is not the day's reviews). */
export async function reviewedToday(db: D1Database, lang: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM reviews r CROSS JOIN srs_cards s ON s.id = r.card_id WHERE s.lang = ?1 AND r.reviewed_at >= ?2 AND r.via IS NOT 'practise'")
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
       (SELECT COUNT(*) FROM reviews r CROSS JOIN srs_cards s ON s.id = r.card_id WHERE s.lang = ?1 AND r.reviewed_at >= ?3 AND r.via IS NOT 'practise') AS reviewed_today,
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

/** SQL: a card with its word or grammar point, as a DueRow (from FROM on; add WHERE). */
const CARD_COLS = `s.*, w.lemma, w.reading, w.gloss, w.status, g.title AS g_title, g.summary AS g_summary
     FROM srs_cards s
     LEFT JOIN words w ON s.item_type = 'word' AND w.id = s.item_id
     LEFT JOIN grammar_points g ON s.item_type = 'grammar_point' AND g.id = s.item_id`;

/**
 * The cards a review shows next: due cards already seen, and unseen word cards up to today's
 * new-word allowance, within the daily limit (`limitReached` when it is used up). `include` forces
 * a card in first (today's grammar point); `skip` leaves out cards answered in this sitting.
 */
async function pickSet(db: D1Database, lang: string, batch: number, skip: number[] = [], include = 0): Promise<{ due: DueRow[]; limitReached?: number; notice?: string | null }> {
  const now = new Date().toISOString();
  // Daily cap: the Pleco import leaves a large overdue backlog; work through it a slice a day.
  const limit = Number(await setting(db, 'review.daily_limit', 60)) || 60;
  const done = await reviewedToday(db, lang);
  const take = Math.min(batch, Math.max(0, limit - done));
  if (take === 0 && !include) return { due: [], limitReached: limit };
  // Unseen word cards (never reviewed, here or in Pleco) are rationed by review.new_per_day, and
  // wait while seen words pile up or are being missed.
  const gate = await newWordsToday(db, lang, now);
  const introduced = await introducedToday(db, lang);
  const newQuota = Math.min(take, Math.max(0, gate.perDay - introduced));
  const skipSql = skip.length ? `AND s.id NOT IN (${skip.join(',')})` : '';
  const { results: seen } = await db.prepare(
    `SELECT ${CARD_COLS}
     WHERE s.lang = ?1 AND (s.due_at <= ?2 OR s.id = ?4) ${skipSql} AND (s.id = ?4 OR (NOT (${UNSEEN_WORD}) AND s.pinned <> ${THEME_PIN}))
     ORDER BY s.id = ?4 DESC, s.pinned = 1 DESC, s.item_type = 'grammar_point' DESC, w.status = 'learning' DESC, s.due_at LIMIT ?3`,
  )
    .bind(lang, now, Math.max(take, include ? 1 : 0), include || -1)
    .all<DueRow>();
  const seenOk = await withoutNames(db, seen);
  if (newQuota) await topUpFromPool(db, lang, newQuota, now);
  // Words met in chats and lessons (status 'learning'; pool words stay 'new') first, then by level,
  // so the pool is not taken alphabetically; words beyond reach of the measured level wait.
  const { results: fresh } = newQuota
    ? await db.prepare(
        `SELECT ${CARD_COLS}
         WHERE s.lang = ?1 AND s.due_at <= ?2 ${skipSql} AND ${UNSEEN_WORD} AND ${inReach('?5')} AND s.id <> ?4
         ORDER BY w.status = 'learning' DESC, EXISTS (SELECT 1 FROM exposures e WHERE e.word_id = w.id) DESC, w.source IN ('conversation', 'lesson') DESC,
                  COALESCE(w.level, json_extract(w.meta_json, '$.hsk'), 99), ${SHUFFLED}
         LIMIT ?3`,
      )
        .bind(lang, now, newQuota, include || -1, await poolReach(db, lang))
        .all<DueRow>()
    : { results: [] as DueRow[] };
  const freshOk = await withoutNames(db, fresh);
  // Theme words (pinned THEME_PIN) take up to a share of the set, mixed in, not the front of it.
  const room = Math.max(0, take - (include ? 1 : 0));
  const { results: themed } = room
    ? await db
        .prepare(`SELECT ${CARD_COLS} WHERE s.lang = ?1 AND s.due_at <= ?2 ${skipSql} AND s.pinned = ${THEME_PIN} AND s.id <> ?3 ORDER BY s.due_at, s.id LIMIT ?4`)
        .bind(lang, now, include || -1, room)
        .all<DueRow>()
    : { results: [] as DueRow[] };
  const themedOk = await withoutNames(db, themed);
  const others = seenOk.filter((d) => d.id !== include).length + freshOk.length;
  const themeTake = themeSlots(room, others, themedOk.length);
  const newKept = freshOk.slice(0, Math.max(0, room - themeTake));
  const kept = seenOk.slice(0, Math.max(take - newKept.length - themeTake, include ? 1 : 0));
  const mixed = (cards: DueRow[]) => interleave(interleave(cards, newKept), themedOk.slice(0, themeTake));
  // A forced card (today's grammar point) stays first.
  const due = include && kept[0]?.id === include ? [kept[0], ...mixed(kept.slice(1))] : mixed(kept);
  return { due, notice: gate.notice };
}

/**
 * Word cards whose every meaning is a person's name ("Zhu (surname)") are dropped from the set and
 * retired: the card and its cached sentences go, and the word is marked (meta name) so the pool
 * does not hand it a card again. Such a word cannot be tested: in "Teacher Zhu" any zhu fits.
 */
async function withoutNames(db: D1Database, cards: DueRow[]): Promise<DueRow[]> {
  const names = cards.filter((d) => d.item_type === 'word' && isNameGloss(d.gloss));
  if (!names.length) return cards;
  await db.batch(
    names.flatMap((d) => [
      db.prepare('DELETE FROM srs_cards WHERE id = ?1').bind(d.id),
      db.prepare("DELETE FROM exercises WHERE item_type = 'word' AND item_id = ?1").bind(d.item_id),
      db.prepare("UPDATE words SET meta_json = json_set(COALESCE(meta_json, '{}'), '$.name', 1) WHERE id = ?1").bind(d.item_id),
    ]),
  );
  const gone = new Set(names.map((d) => d.id));
  return cards.filter((d) => !gone.has(d.id));
}

/** The kind each word card in a set takes once it has a sentence. */
function wordKinds(due: DueRow[]): { d: DueRow; kind: ReturnType<typeof kindFor> }[] {
  const glossed = (d: DueRow) => !!d.gloss && !!tidyListGloss(d.gloss);
  const card = (d: DueRow) => parseCard(d.fsrs_state_json);
  const words = due.filter((d) => d.item_type === 'word' && d.lemma);
  const boardSize = words.filter((d) => kindFor(card(d), true, true, d.id, glossed(d)) === 'match').length;
  return words.map((d) => ({ d, kind: kindFor(card(d), true, true, d.id, boardSize >= MIN_MATCH && glossed(d)) }));
}

/**
 * Word cards in a set that its story tells: not the ones headed for the matching board (it shows no
 * sentences), nor Say-it cards (said aloud from a short sentence of their own).
 */
function toldIn(due: DueRow[]): DueRow[] {
  return wordKinds(due)
    .filter((w) => w.kind !== 'match' && w.kind !== 'en_to_zh')
    .map((w) => w.d);
}

/** Say-it word cards in a set: each is said from a short sentence of its own (source 'speak'). */
function saidIn(due: DueRow[]): DueRow[] {
  return wordKinds(due)
    .filter((w) => w.kind === 'en_to_zh')
    .map((w) => w.d);
}

/** How long a review waits for sentences written while it opens before it goes on with flashcards. */
const SENTENCE_WAIT_MS = 20 * 1000;

/**
 * Grammar of the day's quiz: `n` examples, taking turns through the grammar points, most overdue
 * (else soonest due) first, so a point can come up more than once (with another example).
 */
async function grammarToPractise(db: D1Database, lang: string, n: number): Promise<DueRow[]> {
  const { results } = await db
    .prepare(`SELECT ${CARD_COLS} WHERE s.lang = ?1 AND s.item_type = 'grammar_point' ORDER BY s.due_at LIMIT ?2`)
    .bind(lang, n)
    .all<DueRow>();
  return results.length ? Array.from({ length: n }, (_, i) => results[i % results.length]!) : [];
}

reviewRoutes.get('/next', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const batch = c.req.query('limit') ? Math.min(30, Math.max(1, Number(c.req.query('limit')) || 1)) : await batchSize(c.env.DB);
  const skip = idList(c.req.query('skip'));
  const include = Number(c.req.query('include') ?? 0);
  // Grammar of the day's Practise (grammar=N): a quiz of N examples from the grammar points (see
  // grammarToPractise). Not a review set: no words, no story.
  const grammarN = Math.min(30, Math.max(0, Number(c.req.query('grammar') ?? 0) || 0));
  const only = grammarN > 0;
  const picked = only
    ? { due: await grammarToPractise(c.env.DB, lang, grammarN), notice: null, limitReached: undefined }
    : await pickSet(c.env.DB, lang, batch, skip, include);
  if (picked.limitReached) return c.json({ items: [], notice: `Daily review limit of ${picked.limitReached} reached. Well done.`, limitReached: true });
  let due = picked.due;
  if (due.length === 0) return c.json({ items: [], notice: null });
  // The batch's sentence cards tell one short story (setting review.story), in the story's order.
  // Words headed for the matching board are left out of it: the board shows no sentences.
  const storiesOn = !only && (await setting(c.env.DB, 'review.story', true)) !== false;
  // A story under way (the page was reloaded, or left and come back to) carries on by itself:
  // today's grammar and a forced card still lead, other words wait for the next set.
  // Cards this sitting has answered are never served again, even if the story still counts them.
  const inProgress = storiesOn ? await storyInProgress(c.env.DB, lang) : null;
  const going = inProgress && inProgress.left.some((d) => !skip.includes(d.id)) ? { ...inProgress, left: inProgress.left.filter((d) => !skip.includes(d.id)) } : null;
  if (going) {
    const lead = due.filter((d) => d.id === include || d.item_type === 'grammar_point');
    due = [...lead, ...going.left.filter((d) => !lead.some((l) => l.id === d.id)).slice(0, Math.max(1, batch - lead.length))];
  }

  // Cached sentences for these cards (written ahead by prepareSet, as a rule).
  let cached = await cachedSentences(c.env.DB, due);
  const glossed = (d: DueRow) => !!d.gloss && !!tidyListGloss(d.gloss);

  const story = going ? going.story : storiesOn ? await storyFor(c.env, lang, toldIn(due)) : null;
  // Say-it cards are said from a short sentence of their own, not a story line.
  // A word the story tells is not said from a sentence of its own (see storyKind).
  // Grammar cards show an example not shown before. Whatever was not written ahead is written now.
  const { said, missing, unsaid, stale } = sentencesWanted(due, story, cached);
  // Grammar of the day's quiz: a point that comes up more often than it has examples gets more.
  if (only)
    for (const d of due) {
      const times = due.filter((x) => x.id === d.id).length;
      if (d.g_title && !stale.some((p) => p.id === d.item_id) && (cached.sentences.get(`grammar_point:${d.item_id}`)?.length ?? 0) < times)
        stale.push({ id: d.item_id, title: d.g_title, summary: d.g_summary });
    }
  // Written now only up to SENTENCE_WAIT_MS: past that the set opens with what is cached (other
  // cards are flashcards) and the writing finishes in the background, ready for the next set.
  const writing = Promise.all([ensureWordSentences(c.env, lang, missing), ensureSpeakSentences(c.env, lang, unsaid), ensureGrammarExamples(c.env, lang, stale)]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const notices = await Promise.race([writing, new Promise<null>((r) => (timer = setTimeout(() => r(null), SENTENCE_WAIT_MS)))]);
  clearTimeout(timer);
  if (!notices) c.executionCtx.waitUntil(writing.catch(() => {}));
  const notice = (notices ? notices.find(Boolean) : 'New practice sentences are still being written: flashcards for some words this time.') ?? (only ? null : picked.notice) ?? null;
  if (missing.length || unsaid.length || stale.length) cached = await cachedSentences(c.env.DB, due);
  const { sentences, speak } = cached;
  // The story's parts are the set's cards (and, carried on after a reload, those already answered).
  const carded = new Set(
    story ? [...due.filter((d) => d.item_type === 'word'), ...(going?.done ?? []).map((item_id) => ({ item_id }))].flatMap((d) => story.byWord.get(d.item_id)?.sentence.id ?? []) : [],
  );
  const lines = story ? tellable(story.lines, carded) : [];
  const parts = lines.filter((l) => l.id !== undefined).length;
  const first = (wordId: number, sentence: Sentence) => sentences.set(`word:${wordId}`, [sentence, ...(sentences.get(`word:${wordId}`) ?? []).filter((x) => x.id !== sentence.id)]);
  if (story) for (const [wordId, { sentence }] of story.byWord) if (!(said.has(wordId) && speak.has(wordId))) first(wordId, sentence);
  for (const wordId of said) if (speak.has(wordId)) first(wordId, speak.get(wordId)!);

  // A matching board needs a few words: with fewer match cards than that, they take another kind.
  const matches = due.filter((d) => !(d.item_type === 'word' && story?.byWord.has(d.item_id)) && kindFor(parseCard(d.fsrs_state_json), sentences.has(`${d.item_type}:${d.item_id}`), d.item_type === 'word', d.id, glossed(d)) === 'match').length;
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
  // A card can come more than once (Grammar of the day cycles through its points): each time with
  // another of its examples, and the kinds taking turns.
  const seen = new Map<number, number>();
  const items = due.map((d) => {
    const card = parseCard(d.fsrs_state_json);
    const nth = seen.get(d.id) ?? 0;
    seen.set(d.id, nth + 1);
    const list = sentences.get(`${d.item_type}:${d.item_id}`);
    const s = list?.[nth % list.length];
    const isWord = d.item_type === 'word';
    // A grammar card is one example of its point (the lesson's own check runs from the lesson).
    const told = isWord ? story?.byWord.get(d.item_id) : undefined;
    const kind = kindFor(card, !!s, isWord, d.id + nth, canMatch && glossed(d));
    const made: Exercise = asChoice(makeExercise(told ? storyKind(kind, card, d.id) : kind, s), d, randomSeed());
    const prev = told ? linesBefore(lines, told.line, told.sentence.target ?? d.lemma ?? undefined).map((l) => ({ ...(l.id !== undefined ? { id: l.id } : {}), zh: l.zh, en: l.en })) : [];
    const after = told ? linesAfter(lines, told.line).map((l) => ({ zh: l.zh, en: l.en })) : [];
    const exercise: Exercise =
      told && made.sentenceId === told.sentence.id
        ? { ...made, story: { title: story!.title, part: partAt(lines, told.line), of: parts, ...(prev.length ? { prev } : {}), ...(after.length ? { after } : {}) } }
        : made;
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
        sentences: lines,
      }
    : null;
  const strings = ordered.flatMap((i) => [i.exercise.promptZh, i.exercise.clozeZh, i.exercise.answerZh, i.word?.lemma, i.grammar?.title].filter((x): x is string => !!x));
  const annotations = await annotateStrings(c.env.DB, lang, [...strings, ...(recap?.sentences.map((x) => x.zh) ?? [])]);
  return c.json({ items: ordered, annotations, notice, story: recap });
});

reviewRoutes.post('/:cardId{[0-9]+}', async (c) => {
  const cardId = Number(c.req.param('cardId'));
  const body = (await c.req.json().catch(() => ({}))) as { rating?: unknown; kind?: string; exerciseId?: number; quiz?: { score?: unknown; total?: unknown }; via?: unknown };
  if (!isRating(body.rating)) return c.json({ error: 'rating must be 1-4' }, 400);
  const row = await c.env.DB.prepare('SELECT * FROM srs_cards WHERE id = ?1').bind(cardId).first<{ id: number; item_type: string; item_id: number; lang: string; fsrs_state_json: string; pinned: number }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  // A double tap rates a card twice within moments: keep the first only. (The same card on another
  // example, in Grammar of the day's quiz, is not a double tap.)
  const recent = await c.env.DB.prepare("SELECT 1 AS x FROM reviews WHERE card_id = ?1 AND exercise_id IS ?2 AND reviewed_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 seconds') LIMIT 1")
    .bind(cardId, body.exerciseId ?? null)
    .first<{ x: number }>();
  if (recent) return c.json({ due: (await c.env.DB.prepare('SELECT due_at FROM srs_cards WHERE id = ?1').bind(cardId).first<{ due_at: string }>())?.due_at ?? '', status: null, statusChanged: false, duplicate: true });

  // Grammar of the day's quiz can show a point more than once: only its first answer of the day
  // moves the point's schedule; the others count towards the quiz (setting session.grammar_per_day).
  const practise = body.via === 'practise';
  if (practise) {
    const again = await c.env.DB.prepare("SELECT 1 AS x FROM reviews WHERE card_id = ?1 AND via = 'practise' AND reviewed_at >= ?2 LIMIT 1")
      .bind(cardId, await dayStartIso(c.env.DB))
      .first<{ x: number }>();
    if (again) {
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO reviews(card_id, rating, kind, exercise_id, via) VALUES (?1, ?2, ?3, ?4, 'practise')").bind(cardId, body.rating, body.kind ?? null, body.exerciseId ?? null),
        ...(body.exerciseId
          ? [c.env.DB.prepare("UPDATE exercises SET used_count = used_count + 1, last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1").bind(body.exerciseId)]
          : []),
      ]);
      return c.json({ due: (await c.env.DB.prepare('SELECT due_at FROM srs_cards WHERE id = ?1').bind(cardId).first<{ due_at: string }>())?.due_at ?? '', status: null, statusChanged: false });
    }
  }

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
    // via 'practise': answered from Grammar of the day's Practise, which is what ticks it.
    c.env.DB.prepare('INSERT INTO reviews(card_id, rating, kind, exercise_id, via) VALUES (?1, ?2, ?3, ?4, ?5)').bind(cardId, body.rating, body.kind ?? null, body.exerciseId ?? null, practise ? 'practise' : null),
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
