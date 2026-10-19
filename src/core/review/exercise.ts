import type { LessonCheckItem } from '../lessons/types';
// Turning one cached sentence into a review exercise, and checking typed answers.
/**
 * 'intro' = a word seen for the first time: shown with its meaning, not tested. 'match' = the word
 * goes on a matching board with the other match cards in the batch (the Sort my words board).
 */
export type ExerciseKind = 'cloze' | 'zh_to_en' | 'en_to_zh' | 'flash' | 'intro' | 'quiz' | 'match';

export interface Sentence {
  id: number;
  zh: string;
  en: string;
  /** The word the sentence practises (for word cards). */
  target?: string;
}

export interface Exercise {
  kind: ExerciseKind;
  sentenceId?: number;
  /** Chinese shown to the learner (annotated client-side via tokens). */
  promptZh?: string;
  promptEn?: string;
  /** For cloze: the sentence with the target replaced by a blank. */
  clozeZh?: string;
  answerZh?: string;
  answerEn?: string;
  /** The word being tested as it appears in the prompt (an inflected form in Latin scripts). */
  target?: string;
  /**
   * Multiple choice: `choiceAnswer` among wrong options. zh_to_en: the sentence's meaning; flash
   * and intro: the word's meaning (an intro tests first and teaches the word only if missed).
   */
  choices?: string[];
  choiceAnswer?: string;
  /** For grammar reviews of lessons with practice sets: a three-question quiz, scored automatically. */
  quiz?: LessonCheckItem[];
  lessonId?: number;
}

export const BLANK = '＿＿';

/** Fewest match cards a batch puts on a board; with fewer, those words get another exercise. */
export const MIN_MATCH = 3;

/**
 * Rotate kinds by review count so the same word is practised in different directions.
 * `salt` (the card id) staggers cards that share a review count, e.g. after a bulk import.
 * `canMatch` (a word with a meaning) adds the matching board to the rotation, and replaces the
 * flashcard for a word without a sentence.
 */
export function chooseKind(reps: number, hasSentence: boolean, isWord: boolean, salt = 0, canMatch = false): ExerciseKind {
  const match = canMatch && isWord;
  if (!hasSentence) return match ? 'match' : 'flash';
  if (!isWord) return 'en_to_zh';
  const kinds = match ? (['cloze', 'match', 'zh_to_en', 'en_to_zh'] as const) : (['cloze', 'zh_to_en', 'en_to_zh'] as const);
  return kinds[(reps + salt) % kinds.length]!;
}

/** Word cards never reviewed before are introduced first; after that the kinds rotate. */
export function kindFor(reps: number, hasSentence: boolean, isWord: boolean, salt = 0, canMatch = false): ExerciseKind {
  if (isWord && reps === 0) return 'intro';
  return chooseKind(reps, hasSentence, isWord, salt, canMatch);
}

export function makeExercise(kind: ExerciseKind, s: Sentence | undefined): Exercise {
  if (kind === 'intro') return s ? { kind, sentenceId: s.id, promptZh: s.zh, answerEn: s.en, ...(s.target ? { target: s.target } : {}) } : { kind };
  if (kind === 'match') return { kind };
  // A quiz is built from the lesson, not from a cached sentence (see the review route).
  if (!s || kind === 'flash' || kind === 'quiz') return { kind: 'flash' };
  switch (kind) {
    case 'cloze':
      if (s.target && s.zh.includes(s.target))
        return { kind, sentenceId: s.id, clozeZh: s.zh.replace(s.target, BLANK), promptEn: s.en, answerZh: s.target };
      return { kind: 'zh_to_en', sentenceId: s.id, promptZh: s.zh, answerEn: s.en, ...(s.target ? { target: s.target } : {}) };
    case 'zh_to_en':
      return { kind, sentenceId: s.id, promptZh: s.zh, answerEn: s.en, ...(s.target ? { target: s.target } : {}) };
    case 'en_to_zh':
      return { kind, sentenceId: s.id, promptEn: s.en, answerZh: s.zh };
  }
}

/** Normalise a typed Chinese answer: drop spaces and punctuation, full-width forms. */
export function normaliseZh(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .trim();
}

export function checkCloze(typed: string, answer: string): boolean {
  return normaliseZh(typed) !== '' && normaliseZh(typed) === normaliseZh(answer);
}
