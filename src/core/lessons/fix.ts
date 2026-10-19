// Corrected lesson sections (from "Query this page") and putting them into a lesson. Pure.
import type { LessonCheckItem, LessonChoice, LessonContent, LessonDrill, LessonError, LessonExample } from './types';

/** Sections rewritten whole; null (or absent) leaves the lesson's own. */
export interface LessonFix {
  explanation: string[] | null;
  examples: LessonExample[] | null;
  drills: LessonDrill[] | null;
  keyPoints: string[] | null;
  errors?: LessonError[] | null;
  /** The quick multiple-choice questions after the explanation. */
  recognise?: LessonChoice[] | null;
  /** The lesson check, which reviews also draw their grammar quizzes from. */
  check?: LessonCheckItem[] | null;
}

const SECTIONS = ['explanation', 'examples', 'drills', 'keyPoints', 'errors', 'recognise', 'check'] as const;

export const hasFix = (f: LessonFix | null | undefined): f is LessonFix => !!f && SECTIONS.some((k) => f[k]?.length);

/** The lesson with the fixed sections in place of its own. */
export function applyFix(l: LessonContent, f: LessonFix): LessonContent {
  return {
    ...l,
    ...(f.explanation?.length ? { explanation: f.explanation } : {}),
    ...(f.examples?.length ? { examples: f.examples.map(({ zh, en }) => ({ zh, en })) } : {}),
    ...(f.drills?.length ? { drills: f.drills.map(({ en, zh }) => ({ en, zh })) } : {}),
    ...(f.keyPoints?.length ? { keyPoints: f.keyPoints } : {}),
    ...(f.errors?.length ? { errors: f.errors.map(({ wrong, right, note }) => ({ wrong, right, ...(note ? { note } : {}) })) } : {}),
    ...(f.recognise?.length ? { recognise: f.recognise.map(({ prompt, options, answer }) => ({ prompt, options, answer })) } : {}),
    ...(f.check?.length ? { check: f.check } : {}),
  };
}

/** A check item as the model writes it (one flat shape, the fields its kind needs filled in). */
export interface FlatCheckItem {
  kind: 'choice' | 'translate' | 'fix';
  prompt: string | null;
  options: string[] | null;
  answer: number | null;
  en: string | null;
  zh: string | null;
  wrong: string | null;
  right: string | null;
  note: string | null;
}

export function fromFlat(x: FlatCheckItem): LessonCheckItem {
  if (x.kind === 'choice') return { kind: 'choice', prompt: x.prompt ?? '', options: x.options ?? [], answer: x.answer ?? -1 };
  if (x.kind === 'translate') return { kind: 'translate', en: x.en ?? '', zh: x.zh ?? '' };
  return { kind: 'fix', wrong: x.wrong ?? '', right: x.right ?? '', ...(x.note ? { note: x.note } : {}) };
}

/** A question whose answer key was found wrong ("Query this mark"), as the learner saw it. */
export interface WrongKey {
  kind: 'choice' | 'translate' | 'fix' | 'build';
  /** The question: the prompt, the English to translate, or the wrong sentence to fix. */
  task: string;
  /** The answer key as it stands. */
  expected: string;
  /** The corrected answer. */
  better: string;
}

/**
 * A corrected key is one answer, about as long as the old one, not an answer with notes or
 * advice attached ("… (the exercise should be reworded…)"), which must never go into a lesson.
 */
export function looksLikeAnswer(better: string, expected: string): boolean {
  if (/\n/.test(better)) return false;
  if (/[()]/.test(better) && !/[()]/.test(expected)) return false;
  return better.length <= expected.length * 1.6 + 15;
}

/**
 * The lesson with a wrong answer key corrected wherever that question appears (quick questions,
 * lesson check, drills, common errors), or null when it cannot be found or nothing would change.
 * A multiple-choice key moves to the option that is right, or the keyed option is rewritten.
 */
export function fixAnswerKey(l: LessonContent, k: WrongKey): LessonContent | null {
  const same = (a: string | undefined, b: string) => (a ?? '').trim() === b.trim();
  const better = k.better.trim();
  if (!better || same(k.expected, better) || !looksLikeAnswer(better, k.expected)) return null;
  let changed = false;
  const choice = <C extends LessonChoice>(c: C): C => {
    if (!same(c.prompt, k.task) || !same(c.options[c.answer], k.expected)) return c;
    changed = true;
    const at = c.options.findIndex((o) => same(o, better));
    return at >= 0 ? { ...c, answer: at } : { ...c, options: c.options.map((o, i) => (i === c.answer ? better : o)) };
  };
  const recognise = l.recognise?.map((c) => (k.kind === 'choice' ? choice(c) : c));
  const check = l.check?.map((it): LessonCheckItem => {
    if (k.kind === 'choice' && it.kind === 'choice') return choice(it);
    if ((k.kind === 'translate' || k.kind === 'build') && it.kind === 'translate' && same(it.en, k.task) && same(it.zh, k.expected)) {
      changed = true;
      return { ...it, zh: better };
    }
    if (k.kind === 'fix' && it.kind === 'fix' && same(it.wrong, k.task) && same(it.right, k.expected)) {
      changed = true;
      return { ...it, right: better };
    }
    return it;
  });
  const drills = l.drills.map((d) => {
    if ((k.kind !== 'translate' && k.kind !== 'build') || !same(d.en, k.task) || !same(d.zh, k.expected)) return d;
    changed = true;
    return { ...d, zh: better };
  });
  const errors = l.errors.map((e) => {
    if (k.kind !== 'fix' || !same(e.wrong, k.task) || !same(e.right, k.expected)) return e;
    changed = true;
    return { ...e, right: better };
  });
  if (!changed) return null;
  return { ...l, drills, errors, ...(recognise ? { recognise } : {}), ...(check ? { check } : {}) };
}
