// Generated listening practice: a short dialogue or story written for the learner's level from
// words they know, played with text-to-speech, then comprehension questions. Pure functions
// shared by the API and the UI.
import type { Token } from '../pinyin/annotate';

export type ListeningKind = 'dialogue' | 'story';
export const LISTENING_KINDS: ListeningKind[] = ['dialogue', 'story'];

export interface ListeningLine {
  /** Speaker name in a dialogue (two speakers); null in a story. */
  speaker: string | null;
  /** The line in the language being learnt. */
  text: string;
  /** Translation into the learner's own language, shown with the transcript. */
  translation: string;
}

export interface ListeningQuestion {
  /** In the learner's own language, so it tests listening rather than reading. */
  question: string;
  options: string[];
  /** 0-based index of the right option. */
  answer: number;
}

export interface ListeningContent {
  title: string;
  kind: ListeningKind;
  lines: ListeningLine[];
  questions: ListeningQuestion[];
}

export const LINE_LIMITS = { min: 4, max: 24 };
export const QUESTION_LIMITS = { min: 2, max: 5 };

/** Problems with generated content, phrased for a retry. Empty when it is usable. */
export function listeningProblems(c: ListeningContent, hasTarget: (s: string) => boolean): string[] {
  const p: string[] = [];
  if (!c.title.trim()) p.push('title is empty');
  if (c.lines.length < LINE_LIMITS.min || c.lines.length > LINE_LIMITS.max) p.push(`write ${LINE_LIMITS.min}-${LINE_LIMITS.max} lines`);
  c.lines.forEach((l, i) => {
    if (!hasTarget(l.text)) p.push(`line ${i + 1} is not in the language being learnt`);
    if (!l.translation.trim()) p.push(`line ${i + 1} has no translation`);
  });
  if (c.kind === 'dialogue') {
    const speakers = new Set(c.lines.map((l) => l.speaker?.trim()).filter(Boolean));
    if (speakers.size !== 2 || c.lines.some((l) => !l.speaker?.trim())) p.push('a dialogue needs exactly two named speakers, one on every line');
  }
  if (c.questions.length < QUESTION_LIMITS.min || c.questions.length > QUESTION_LIMITS.max) p.push(`write ${QUESTION_LIMITS.min}-${QUESTION_LIMITS.max} questions`);
  c.questions.forEach((q, i) => {
    if (q.options.length < 3 || q.options.length > 4) p.push(`question ${i + 1} needs 3 or 4 options`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) p.push(`question ${i + 1} answer index is out of range`);
    if (new Set(q.options.map((o) => o.trim())).size !== q.options.length) p.push(`question ${i + 1} repeats an option`);
  });
  return p;
}

/**
 * Share of the words in the text the learner already knows (0-1): known words over all words
 * the word list was asked about. Comprehensible input is usually put at 95-98% known.
 */
export function knownShare(tokens: Token[][]): number | null {
  const words = tokens.flat().filter((t) => t.status);
  if (!words.length) return null;
  return words.filter((t) => t.status === 'known').length / words.length;
}

/** Voice for each line of a dialogue: the first speaker gets voice 0, the second voice 1. */
export function speakerVoices(lines: Pick<ListeningLine, 'speaker'>[]): number[] {
  const order: string[] = [];
  return lines.map((l) => {
    const s = l.speaker?.trim() ?? '';
    if (!s) return 0;
    if (!order.includes(s)) order.push(s);
    return order.indexOf(s) % 2;
  });
}
