// The prompt set for each language. Mandarin keeps its original prompts unchanged.
import { ZH_TUTOR_V1 } from './zh-tutor.v1';
import { ZH_LESSON_V1 } from './zh-lesson.v1';
import { ZH_LESSON_PRACTICE_V1 } from './zh-lesson-practice.v1';
import { ZH_EXERCISES_V1 } from './zh-exercises.v1';
import { GRADE_V1 } from './grade.v1';
import { QUERY_V1 } from './query.v1';
import { GLOSS_V1 } from './gloss.v1';
import { IT_EXERCISES_V1, IT_GLOSS_V1, IT_GRADE_V1, IT_LESSON_PRACTICE_V1, IT_LESSON_V1, IT_QUERY_V1, IT_TUTOR_V1 } from './it.v1';

export interface PromptSet {
  /** English name of the language, for generic prompts (translation). */
  name: string;
  tutor: string;
  lesson: string;
  practice: string;
  exercises: string;
  grade: string;
  query: string;
  /** Mandarin: plain-text gloss. Latin-script languages: structured {lemma, gloss}. */
  gloss: string;
}

const SETS: Record<string, PromptSet> = {
  zh: { name: 'Mandarin Chinese', tutor: ZH_TUTOR_V1, lesson: ZH_LESSON_V1, practice: ZH_LESSON_PRACTICE_V1, exercises: ZH_EXERCISES_V1, grade: GRADE_V1, query: QUERY_V1, gloss: GLOSS_V1 },
  it: { name: 'Italian', tutor: IT_TUTOR_V1, lesson: IT_LESSON_V1, practice: IT_LESSON_PRACTICE_V1, exercises: IT_EXERCISES_V1, grade: IT_GRADE_V1, query: IT_QUERY_V1, gloss: IT_GLOSS_V1 },
};

export function hasPrompts(lang: string): boolean {
  return lang in SETS;
}

/** The prompts for a language; Mandarin for an unknown one (callers check hasPrompts first). */
export function promptsFor(lang: string): PromptSet {
  return SETS[lang] ?? SETS.zh!;
}
