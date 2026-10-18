// Corrected lesson sections (from "Query this page") and putting them into a lesson. Pure.
import type { LessonContent, LessonDrill, LessonExample } from './types';

/** Sections rewritten whole; null leaves the lesson's own. */
export interface LessonFix {
  explanation: string[] | null;
  examples: LessonExample[] | null;
  drills: LessonDrill[] | null;
  keyPoints: string[] | null;
}

export const hasFix = (f: LessonFix | null | undefined): f is LessonFix => !!f && [f.explanation, f.examples, f.drills, f.keyPoints].some((x) => x?.length);

/** The lesson with the fixed sections in place of its own. */
export function applyFix(l: LessonContent, f: LessonFix): LessonContent {
  return {
    ...l,
    ...(f.explanation?.length ? { explanation: f.explanation } : {}),
    ...(f.examples?.length ? { examples: f.examples.map(({ zh, en }) => ({ zh, en })) } : {}),
    ...(f.drills?.length ? { drills: f.drills.map(({ en, zh }) => ({ en, zh })) } : {}),
    ...(f.keyPoints?.length ? { keyPoints: f.keyPoints } : {}),
  };
}
