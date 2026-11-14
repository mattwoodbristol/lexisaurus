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
  /** A short quiz from a lesson, scored automatically. Reviews no longer make one (2026-10-30): a grammar card is one example. */
  quiz?: LessonCheckItem[];
  lessonId?: number;
  /**
   * The sentence is part `part` of `of` of the batch's story; `prev` is the story so far
   * (linesBefore), `after` the lines that end it, on the last part (linesAfter).
   */
  story?: { title: string; part: number; of: number; prev?: { id?: number; zh: string; en: string }[]; after?: { zh: string; en: string }[] };
}

export const BLANK = '＿＿';

const LETTER = /[\p{L}\p{M}\p{N}]/u;

/**
 * The sentence with `target` blanked out, or undefined when it is not there. A whole-word match is
 * preferred, so "o" in "fai un nuovo pane o aspetti?" blanks the word "o", not the "o" in "nuovo";
 * scripts written without spaces (Chinese) fall back to the first match.
 */
export function blankOut(sentence: string, target: string): string | undefined {
  if (!target) return undefined;
  let first = -1;
  for (let i = sentence.indexOf(target); i >= 0; i = sentence.indexOf(target, i + 1)) {
    if (first < 0) first = i;
    const before = sentence[i - 1];
    const after = sentence[i + target.length];
    if ((!before || !LETTER.test(before)) && (!after || !LETTER.test(after))) return sentence.slice(0, i) + BLANK + sentence.slice(i + target.length);
  }
  return first < 0 ? undefined : sentence.slice(0, first) + BLANK + sentence.slice(first + target.length);
}

/** Fewest match cards a batch puts on a board; with fewer, those words get another exercise. */
export const MIN_MATCH = 3;

/**
 * How far a word card has come, from its FSRS stability (days): 0 = still shaky, 1 = getting there,
 * 2 = solid. Stability grows with each right answer and drops sharply on a Pass, so a word moves up
 * only as it is got right, and back down when it is missed.
 */
export const STEP_STABILITY_DAYS = [4, 12];
export function stepOf(stability: number): 0 | 1 | 2 {
  return stability >= STEP_STABILITY_DAYS[1]! ? 2 : stability >= STEP_STABILITY_DAYS[0]! ? 1 : 0;
}

/** A card's progress as chooseKind needs it. */
export interface CardProgress {
  reps: number;
  stability: number;
}

/**
 * Easiest first: a shaky word is recognised (its sentence's meaning, picked from choices, or the
 * matching board), then filled in (cloze), and only a solid word is said from English.
 */
const WORD_STEPS = [['zh_to_en'], ['cloze', 'zh_to_en'], ['cloze', 'zh_to_en', 'en_to_zh']] as const;

/**
 * The kinds for the card's step rotate by review count, so the same word is practised in different
 * ways. `salt` (the card id) staggers cards that share a review count, e.g. after a bulk import.
 * `canMatch` (a word with a meaning) adds the matching board to the rotation, and replaces the
 * flashcard for a word without a sentence.
 */
export function chooseKind(card: CardProgress, hasSentence: boolean, isWord: boolean, salt = 0, canMatch = false): ExerciseKind {
  const match = canMatch && isWord;
  if (!hasSentence) return match ? 'match' : 'flash';
  // A grammar point's example: said from English, then its meaning picked, turn about.
  if (!isWord) return (['en_to_zh', 'zh_to_en'] as const)[(card.reps + salt) % 2]!;
  const kinds: ExerciseKind[] = [...WORD_STEPS[stepOf(card.stability)]];
  if (match) kinds.splice(1, 0, 'match');
  return kinds[(card.reps + salt) % kinds.length]!;
}

/** Word cards never reviewed before are introduced first; after that the kinds rotate. */
export function kindFor(card: CardProgress, hasSentence: boolean, isWord: boolean, salt = 0, canMatch = false): ExerciseKind {
  if (isWord && card.reps === 0) return 'intro';
  return chooseKind(card, hasSentence, isWord, salt, canMatch);
}

/**
 * A word told in its set's story keeps a kind that shows its story line. The kind depends on the
 * set (a matching board needs a few words), and a story carried on after a reload is a smaller set,
 * so a word could otherwise become a board or Say-it card and drop out of the story. A shaky word
 * (step 0) keeps to the meaning of its line.
 */
export function storyKind(kind: ExerciseKind, card: CardProgress, salt = 0): ExerciseKind {
  if (kind === 'intro' || kind === 'cloze' || kind === 'zh_to_en') return kind;
  if (stepOf(card.stability) === 0) return 'zh_to_en';
  return (['cloze', 'zh_to_en'] as const)[(card.reps + salt) % 2]!;
}

export function makeExercise(kind: ExerciseKind, s: Sentence | undefined): Exercise {
  if (kind === 'intro') return s ? { kind, sentenceId: s.id, promptZh: s.zh, answerEn: s.en, ...(s.target ? { target: s.target } : {}) } : { kind };
  if (kind === 'match') return { kind };
  // A quiz is built from the lesson, not from a cached sentence (see the review route).
  if (!s || kind === 'flash' || kind === 'quiz') return { kind: 'flash' };
  switch (kind) {
    case 'cloze': {
      const clozeZh = s.target ? blankOut(s.zh, s.target) : undefined;
      if (clozeZh) return { kind, sentenceId: s.id, clozeZh, promptEn: s.en, answerZh: s.target! };
      return { kind: 'zh_to_en', sentenceId: s.id, promptZh: s.zh, answerEn: s.en, ...(s.target ? { target: s.target } : {}) };
    }
    case 'zh_to_en':
      return { kind, sentenceId: s.id, promptZh: s.zh, answerEn: s.en, ...(s.target ? { target: s.target } : {}) };
    case 'en_to_zh':
      return { kind, sentenceId: s.id, promptEn: s.en, answerZh: s.zh, ...(s.target ? { target: s.target } : {}) };
  }
}

/**
 * The exercise with a corrected sentence ("Something looks wrong?"), when it shows that sentence
 * (or the one before it in its story). Multiple choice keeps its options, with the new meaning
 * in place of the old one.
 */
export function withFixedSentence(ex: Exercise, s: Sentence): Exercise {
  const prev = ex.story?.prev?.some((l) => l.id === s.id) ? { ...ex, story: { ...ex.story, prev: ex.story.prev.map((l) => (l.id === s.id ? { id: s.id, zh: s.zh, en: s.en } : l)) } } : ex;
  if (ex.sentenceId !== s.id) return prev;
  const made = makeExercise(ex.kind, s);
  if (made.kind !== ex.kind) return prev;
  const story = prev.story ? { story: prev.story } : {};
  if (!ex.choices) return { ...made, ...story };
  if (ex.kind === 'zh_to_en') return { ...made, ...story, choices: ex.choices.map((c) => (c === ex.choiceAnswer ? made.answerEn! : c)), choiceAnswer: made.answerEn! };
  return { ...made, ...story, choices: ex.choices, ...(ex.choiceAnswer ? { choiceAnswer: ex.choiceAnswer } : {}) };
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
