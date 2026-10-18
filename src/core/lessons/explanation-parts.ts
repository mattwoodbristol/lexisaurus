// The explanatory text of a lesson, separated from the material being learnt, so it can be shown
// in another language (the language being learnt, or the learner's own) without touching the
// examples, drills or answers.
import type { LessonContent } from './types';

export interface ExplanationParts {
  explanation: string[];
  keyPoints: string[];
  /** Per error in the lesson (null where it has no note). */
  errorNotes: (string | null)[];
  /** Per grammar point. */
  grammarSummaries: string[];
  /** Per lesson-check item (null where it is not a fix item with a note). */
  checkNotes: (string | null)[];
}

export function explanationParts(l: LessonContent): ExplanationParts {
  return {
    explanation: l.explanation,
    keyPoints: l.keyPoints,
    errorNotes: l.errors.map((e) => e.note ?? null),
    grammarSummaries: l.grammarPoints.map((g) => g.summary),
    checkNotes: (l.check ?? []).map((it) => (it.kind === 'fix' ? (it.note ?? null) : null)),
  };
}

/** True when a translation has the same shape as the original (same count of each part, nulls kept). */
export function sameShape(a: ExplanationParts, b: ExplanationParts): boolean {
  const lists: (keyof ExplanationParts)[] = ['explanation', 'keyPoints', 'errorNotes', 'grammarSummaries', 'checkNotes'];
  return lists.every((k) => Array.isArray(b[k]) && a[k].length === b[k].length && a[k].every((x, i) => (x === null) === (b[k][i] === null || b[k][i] === '')));
}

/** The lesson with its explanatory text replaced. */
export function withParts(l: LessonContent, p: ExplanationParts): LessonContent {
  return {
    ...l,
    explanation: p.explanation,
    keyPoints: p.keyPoints,
    errors: l.errors.map((e, i) => (p.errorNotes[i] ? { ...e, note: p.errorNotes[i]! } : e)),
    grammarPoints: l.grammarPoints.map((g, i) => ({ ...g, summary: p.grammarSummaries[i] ?? g.summary })),
    check: l.check?.map((it, i) => (it.kind === 'fix' && p.checkNotes[i] ? { ...it, note: p.checkNotes[i]! } : it)),
  };
}

/** Every string in the parts, for annotation. */
export function partStrings(p: ExplanationParts): string[] {
  return [...p.explanation, ...p.keyPoints, ...p.errorNotes, ...p.grammarSummaries, ...p.checkNotes].filter((x): x is string => !!x);
}

/** Short stable hash of the original text, so a stored translation is redone when the lesson changes. */
export function partsHash(p: ExplanationParts): string {
  const s = JSON.stringify(p);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
