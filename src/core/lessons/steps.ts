// Sectioned lessons: the step sequence, how practice items are split between steps, word tiles
// for the build step, check scoring and warm-up selection. Pure functions shared by API and UI.
import { normaliseZh } from '../review/exercise';
import type { LessonCheckItem, LessonChoice, LessonContent, LessonDrill } from './types';
import type { Token } from '../pinyin/annotate';

export type StepKey = 'warmup' | 'learn' | 'recognise' | 'build' | 'produce' | 'fix' | 'use' | 'check';

export const STEP_LABEL: Record<StepKey, string> = {
  warmup: 'Warm-up',
  learn: 'Learn',
  recognise: 'Recognise',
  build: 'Build',
  produce: 'Produce',
  fix: 'Fix',
  use: 'Use it',
  check: 'Lesson check',
};

export const DEFAULT_PASS_MARK = 80;
export const WARMUP_COUNT = 3;

/** How many items the practice steps use at most (settings lesson.*_count); lessons may have fewer. */
export interface StepCounts {
  recognise: number;
  build: number;
  produce: number;
}
export const DEFAULT_STEP_COUNTS: StepCounts = { recognise: 4, build: 3, produce: 5 };

/** Step counts from the settings, falling back to the defaults; each at least 1. */
export function stepCounts(s: Record<string, unknown>): StepCounts {
  const n = (k: keyof StepCounts) => {
    const v = Number(s[`lesson.${k}_count`]);
    return Number.isFinite(v) && v >= 1 ? Math.round(v) : DEFAULT_STEP_COUNTS[k];
  };
  return { recognise: n('recognise'), build: n('build'), produce: n('produce') };
}

/** The steps of a sectioned lesson, in order. Warm-up only when there is earlier material. */
export function stepsFor(c: Pick<LessonContent, 'errors'>, hasWarmup: boolean): StepKey[] {
  return [
    ...(hasWarmup ? (['warmup'] as const) : []),
    'learn',
    'recognise',
    'build',
    'produce',
    ...(c.errors.length ? (['fix'] as const) : []),
    'use',
    'check',
  ];
}

/** The home card's "next lesson": the first lesson with something left to do. */
export interface NextLesson {
  id: number;
  title: string;
  course_no: number;
  /** Label of the step to do next in a stepped lesson; null for a lesson without steps. */
  step: string | null;
  /** Some steps are already finished: the card says "continue" rather than "open". */
  started: boolean;
}

/**
 * The first step not yet finished, or null when the lesson is complete. The warm-up (optional
 * recall of earlier lessons) is not counted, so "complete" means its own steps are done.
 */
export function nextStep(c: Pick<LessonContent, 'errors'>, done: StepKey[]): StepKey | null {
  return stepsFor(c, false).find((s) => !done.includes(s)) ?? null;
}

/**
 * The first drills are built from tiles, the next ones typed, up to the given counts. Build
 * leaves at least two drills for produce when the lesson has few.
 */
export function splitDrills(drills: LessonDrill[], counts: Pick<StepCounts, 'build' | 'produce'> = DEFAULT_STEP_COUNTS): { build: LessonDrill[]; produce: LessonDrill[] } {
  const build = drills.slice(0, Math.min(counts.build, Math.max(1, drills.length - 2)));
  return { build, produce: drills.slice(build.length, build.length + counts.produce) };
}

const END_PUNCT = /^[。！？!?.…]+$/;
const PUNCT = /^[\p{P}\p{S}\s]+$/u;

/**
 * Word tiles for the build step: the sentence's words (as segmented for pinyin), without
 * punctuation. The final punctuation is added back automatically; the rest shows in the answer
 * once checked (marking ignores punctuation). Returns null if too short to be useful.
 */
export function tilesFor(tokens: Token[]): { tiles: string[]; ending: string } | null {
  const words = tokens.map((t) => t.text).filter((t) => t.trim() !== '');
  let ending = '';
  while (words.length && END_PUNCT.test(words[words.length - 1]!)) ending = words.pop()! + ending;
  const tiles = words.filter((w) => !PUNCT.test(w));
  return tiles.length >= 3 ? { tiles, ending } : null;
}

/** The tiles with the one at `from` moved to `to`. */
export function moveTile<T>(tiles: T[], from: number, to: number): T[] {
  const out = [...tiles];
  out.splice(to, 0, ...out.splice(from, 1));
  return out;
}

/**
 * The sentence the tiles make. Latin-script words need spaces between them, except after an
 * elided word: l' + accordo makes l'accordo.
 */
export function joinTiles(tiles: string[], latin: boolean): string {
  if (!latin) return tiles.join('');
  return tiles.reduce((out, t, k) => (k === 0 ? t : /['’]$/.test(out) ? out + t : `${out} ${t}`), '');
}

/** Deterministic shuffle (seeded), never returning the original order when that is avoidable. */
export function shuffle<T>(items: T[], seed: number): T[] {
  const a = [...items];
  let s = seed || 1;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) | 0) >>> 0) / 2 ** 32;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  if (a.length > 1 && a.every((x, i) => x === items[i])) a.push(a.shift()!);
  return a;
}

/** Exact match after normalising (punctuation, spacing, full-width forms). */
export function sameZh(a: string, b: string): boolean {
  return normaliseZh(a) !== '' && normaliseZh(a) === normaliseZh(b);
}

export interface CheckResult {
  right: boolean;
}

export function scoreCheck(results: CheckResult[], passMark = DEFAULT_PASS_MARK): { score: number; total: number; percent: number; passed: boolean } {
  const total = results.length;
  const score = results.filter((r) => r.right).length;
  const percent = total ? Math.round((score / total) * 100) : 0;
  return { score, total, percent, passed: total > 0 && percent >= passMark };
}

export type WarmupItem = ({ kind: 'choice' } & LessonChoice) | { kind: 'translate'; en: string; zh: string };

export interface WarmupSource {
  lessonId: number;
  lessonTitle: string;
  /** Review due date of the lesson's grammar, if any: sooner = more worth recalling. */
  dueAt: string | null;
  content: Pick<LessonContent, 'recognise' | 'check'>;
}

/**
 * Up to `n` recall questions from earlier finished lessons, one per lesson, most-due lessons
 * first. Choice questions are preferred: a warm-up should be quick.
 */
export function pickWarmup(sources: WarmupSource[], seed: number, n = WARMUP_COUNT): (WarmupItem & { lessonId: number; lessonTitle: string })[] {
  const ordered = [...sources].sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || b.lessonId - a.lessonId);
  const out: (WarmupItem & { lessonId: number; lessonTitle: string })[] = [];
  for (const s of ordered) {
    if (out.length >= n) break;
    const pool: WarmupItem[] = [
      ...(s.content.check ?? []).filter((c): c is WarmupItem => c.kind === 'choice' || c.kind === 'translate'),
      ...(s.content.recognise ?? []).map((c) => ({ kind: 'choice' as const, ...c })),
    ].sort((a, b) => (a.kind === 'choice' ? 0 : 1) - (b.kind === 'choice' ? 0 : 1));
    const choices = pool.filter((p) => p.kind === 'choice');
    const from = choices.length ? choices : pool;
    if (!from.length) continue;
    const item = from[(seed + s.lessonId) % from.length]!;
    out.push({ ...item, lessonId: s.lessonId, lessonTitle: s.lessonTitle });
  }
  return out;
}

export type { LessonCheckItem };
