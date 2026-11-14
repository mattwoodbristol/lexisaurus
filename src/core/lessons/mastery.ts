// How well a lesson's grammar has been embedded, measured over time rather than in one sitting.
//
//   learning   the lesson has been started (or its check not yet passed)
//   practised  the lesson check has been passed
//   embedded   practised, plus two passed grammar quizzes on different later days, plus two
//              correct uses in chat that were not prompted by a hint
import type { LessonCheckItem, LessonContent } from './types';

export type MasteryLevel = 'new' | 'learning' | 'practised' | 'embedded';
export const MASTERY_LABEL: Record<MasteryLevel, string> = { new: 'Not started', learning: 'Learning', practised: 'Practised', embedded: 'Embedded' };

export const QUIZZES_NEEDED = 2;
export const CHAT_USES_NEEDED = 2;
/** A quiz counts as passed at two out of three. */
export const QUIZ_PASS_RATIO = 2 / 3;

export interface MasteryInput {
  started: boolean;
  /** When the lesson check was first passed. */
  passedAt: string | null;
  quizzes: { at: string; score: number; total: number }[];
  chatUses: { at: string; correct: boolean; prompted: boolean }[];
  /** Local calendar day of a timestamp (learner's time zone). */
  dayOf: (iso: string) => string;
}

export interface Mastery {
  level: MasteryLevel;
  quizDays: number;
  chatUses: number;
}

export function mastery(i: MasteryInput): Mastery {
  if (!i.passedAt) return { level: i.started ? 'learning' : 'new', quizDays: 0, chatUses: 0 };
  const passDay = i.dayOf(i.passedAt);
  const quizDays = new Set(
    i.quizzes.filter((q) => q.total > 0 && q.score / q.total >= QUIZ_PASS_RATIO - 1e-9 && q.at > i.passedAt! && i.dayOf(q.at) !== passDay).map((q) => i.dayOf(q.at)),
  ).size;
  const chatUses = i.chatUses.filter((u) => u.correct && !u.prompted && u.at > i.passedAt!).length;
  const level = quizDays >= QUIZZES_NEEDED && chatUses >= CHAT_USES_NEEDED ? 'embedded' : 'practised';
  return { level, quizDays, chatUses };
}

/** Day of an ISO timestamp in a time zone, e.g. '2026-10-05'. */
export function dayIn(tz: string): (iso: string) => string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (iso) => f.format(new Date(iso));
}

export const DEFAULT_QUIZ_QUESTIONS = 3;

/**
 * Quiz questions for a grammar review (review.quiz_questions, default three): one multiple choice,
 * one to translate, and one fix (or a second choice), then more of each kind in turn while the
 * lesson has them. Drawn from the lesson's practice (recognise questions, drills and errors). The
 * lesson check's own questions are kept for the check (a review that showed them would give its
 * answers away), and used only for a kind the practice has none of.
 *
 * `round` (the card's review count) moves each kind on through its own shuffled order (`salt`, the
 * card, sets the order), so the next quiz asks different questions while the lesson has enough, and
 * a lesson's questions all come round before any comes back.
 */
export function quizItems(c: Pick<LessonContent, 'check' | 'recognise' | 'drills' | 'errors'>, round: number, count = DEFAULT_QUIZ_QUESTIONS, salt = 0): LessonCheckItem[] {
  const check = c.check ?? [];
  const checked = new Set(check.map((i) => (i.kind === 'choice' ? i.prompt : i.kind === 'translate' ? i.en : i.wrong).trim()));
  const unless = <T extends LessonCheckItem>(practice: T[], kind: T['kind']): LessonCheckItem[] => {
    const own = practice.filter((i) => !checked.has((i.kind === 'choice' ? i.prompt : i.kind === 'translate' ? i.en : i.wrong).trim()));
    return own.length ? own : check.filter((i) => i.kind === kind);
  };
  const pools = [
    unless((c.recognise ?? []).map((r) => ({ kind: 'choice' as const, ...r })), 'choice'),
    unless(c.drills.map((d) => ({ kind: 'translate' as const, en: d.en, zh: d.zh })), 'translate'),
    unless(c.errors.map((e) => ({ kind: 'fix' as const, wrong: e.wrong, right: e.right, note: e.note })), 'fix'),
  ];
  // Which pool each question comes from: a choice, a translation and a fix (another choice when
  // there is nothing to fix), then round the kinds again while they last.
  const takes = [0, 0, 0];
  const order: number[] = [];
  const add = (p: number) => {
    if (order.length < count && takes[p]! < pools[p]!.length) {
      takes[p]!++;
      order.push(p);
    }
  };
  [0, 1, pools[2]!.length ? 2 : 0].forEach(add);
  const longest = Math.max(...pools.map((p) => p.length));
  for (let n = 1; order.length < count && n < longest; n++) [0, 1, 2].forEach(add);
  const picked = pools.map((pool, p) => quizWindow(pool, takes[p]!, round, salt * 3 + p));
  const next = [0, 0, 0];
  return order.map((p) => picked[p]![next[p]!++]!);
}

/**
 * The `round`th set of `take` items from a pool: the pool is gone through in a shuffled order, set
 * by set, then reshuffled, with the last set's items put to the back so they do not come straight
 * back (when the pool has room).
 */
function quizWindow<T>(pool: T[], take: number, round: number, seed: number): T[] {
  if (!take) return [];
  const sets = Math.max(1, Math.floor(pool.length / take));
  const cycle = Math.floor(round / sets);
  let order: T[] = [];
  for (let k = 0; k <= cycle; k++) {
    const last = new Set(order.slice((sets - 1) * take, sets * take));
    const shuffled = shuffle(pool, seed * 7919 + k);
    order = [...shuffled.filter((x) => !last.has(x)), ...shuffled.filter((x) => last.has(x))];
  }
  const at = (round % sets) * take;
  return order.slice(at, at + take);
}

/** A seeded shuffle (mulberry32, Fisher-Yates). */
function shuffle<T>(xs: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Review rating from a quiz score: all right = Good, one wrong = Hard, otherwise Pass (again). */
export function quizRating(score: number, total: number): 1 | 2 | 3 {
  if (total > 0 && score === total) return 3;
  if (total > 1 && score === total - 1) return 2;
  return 1;
}
