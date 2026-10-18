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

/**
 * Three quiz questions for a grammar review: one multiple choice, one to translate, and one fix
 * (or a second choice). Drawn from the lesson's check, recognise questions, drills and errors,
 * rotating with the seed so repeat quizzes differ.
 */
export function quizItems(c: Pick<LessonContent, 'check' | 'recognise' | 'drills' | 'errors'>, seed: number): LessonCheckItem[] {
  const choices: LessonCheckItem[] = [...(c.check ?? []).filter((i) => i.kind === 'choice'), ...(c.recognise ?? []).map((r) => ({ kind: 'choice' as const, ...r }))];
  const typed: LessonCheckItem[] = [...(c.check ?? []).filter((i) => i.kind === 'translate'), ...c.drills.map((d) => ({ kind: 'translate' as const, en: d.en, zh: d.zh }))];
  const fixes: LessonCheckItem[] = [...(c.check ?? []).filter((i) => i.kind === 'fix'), ...c.errors.map((e) => ({ kind: 'fix' as const, wrong: e.wrong, right: e.right, note: e.note }))];
  const pick = (pool: LessonCheckItem[], k: number) => (pool.length ? pool[(seed + k) % pool.length] : undefined);
  const out = [pick(choices, 0), pick(typed, 1), pick(fixes, 2) ?? pick(choices, 3)].filter((x): x is LessonCheckItem => !!x);
  return out.filter((x, i) => out.indexOf(x) === i);
}

/** Review rating from a quiz score: all right = Good, one wrong = Hard, otherwise Pass (again). */
export function quizRating(score: number, total: number): 1 | 2 | 3 {
  if (total > 0 && score === total) return 3;
  if (total > 1 && score === total - 1) return 2;
  return 1;
}
