// What a review card says aloud by itself (setting review.autoplay), without giving the answer away:
// Chinese prompts as the card appears, Chinese answers only once revealed. Quizzes stay silent.
import { BLANK, type Exercise } from './exercise';

export function autoplayText(ex: Exercise, word: { lemma: string | null } | undefined, revealed: boolean): string | null {
  if (!revealed) {
    if (ex.kind === 'zh_to_en') return ex.promptZh ?? null; // listening practice; the answer is English
    if (ex.kind === 'intro') return word?.lemma ?? null; // nothing is being tested
    return null; // cloze has a blank; en_to_zh and flash would give the answer away
  }
  if (ex.kind === 'cloze' && ex.clozeZh && ex.answerZh) return ex.clozeZh.replace(BLANK, ex.answerZh);
  if (ex.kind === 'en_to_zh') return ex.answerZh ?? null;
  if (ex.kind === 'flash') return word?.lemma ?? null;
  return null; // zh_to_en and intro already played; quizzes have their own buttons
}
