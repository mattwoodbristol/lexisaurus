import { rulesFor } from '../text/rules';
import type { Script } from '../languages/types';
// One lesson format for imported course notes and generated lessons alike.
// Lesson structure (SPEC 5): grammar, then drills, then conversation.

export interface LessonExample {
  zh: string;
  en: string;
}
export interface LessonDrill {
  en: string;
  zh: string;
}
export interface LessonError {
  wrong: string;
  right: string;
  note?: string;
}
export interface LessonGrammarPoint {
  title: string;
  summary: string;
}

/** Multiple choice: pick the correct sentence (or word) for an English prompt. */
export interface LessonChoice {
  prompt: string;
  options: string[];
  /** Index of the correct option. */
  answer: number;
}

/** One lesson-check item: choose, translate English into Chinese, or fix a wrong sentence. */
export type LessonCheckItem =
  | ({ kind: 'choice' } & LessonChoice)
  | { kind: 'translate'; en: string; zh: string }
  | { kind: 'fix'; wrong: string; right: string; note?: string };

export interface LessonContent {
  title: string;
  /** e.g. "HSK 3" */
  level: string;
  /** One-line pattern, e.g. "A 比 B + adjective". */
  pattern: string;
  /** English explanation paragraphs (Chinese allowed inline). */
  explanation: string[];
  examples: LessonExample[];
  keyPoints: string[];
  /** Translation drills: English prompt, Chinese answer. */
  drills: LessonDrill[];
  errors: LessonError[];
  grammarPoints: LessonGrammarPoint[];
  /** Suggested chat prompt for the conversation part. */
  chatPrompt?: string;
  /** Quick multiple-choice checks after the explanation (sectioned lessons). */
  recognise?: LessonChoice[];
  /** End-of-lesson check, scored against the pass mark (sectioned lessons). */
  check?: LessonCheckItem[];
}

/** A lesson has the full practice sequence once it has recognise questions and a check. */
export function isSectioned(l: Pick<LessonContent, 'recognise' | 'check'>): boolean {
  return !!l.recognise?.length && !!l.check?.length;
}

function validateChoice(c: LessonChoice | undefined, where: string, p: string[], script: Script): void {
  if (!c || typeof c.prompt !== 'string' || !c.prompt.trim()) p.push(`${where}: prompt missing`);
  if (!c || !Array.isArray(c.options) || c.options.length < 2) return void p.push(`${where}: needs at least 2 options`);
  if (!Number.isInteger(c.answer) || c.answer < 0 || c.answer >= c.options.length) p.push(`${where}: needs exactly one correct option`);
  if (new Set(c.options).size !== c.options.length) p.push(`${where}: options repeat`);
  if (script === 'han') for (const o of c.options) if (PINYIN_TONE.test(o)) p.push(`${where}: pinyin found in option: ${o}`);
}

function validatePractice(l: Partial<LessonContent>, p: string[], script: Script): void {
  const target = rulesFor(script).hasTarget;
  l.recognise?.forEach((c, i) => validateChoice(c, `recognise ${i + 1}`, p, script));
  if (l.check) {
    if (l.check.length < 5) p.push('lesson check needs at least 5 items');
    l.check.forEach((it, i) => {
      const w = `check ${i + 1}`;
      if (it.kind === 'choice') validateChoice(it, w, p, script);
      else if (it.kind === 'translate') {
        if (!it.en?.trim() || !target(it.zh ?? '')) p.push(`${w}: needs "English → translation"`);
        if (script === 'han' && PINYIN_TONE.test(it.zh ?? '')) p.push(`${w}: pinyin found in Chinese field: ${it.zh}`);
      } else if (it.kind === 'fix') {
        if (!target(it.wrong ?? '') || !target(it.right ?? '')) p.push(`${w}: needs "✗ wrong → ✓ right"`);
      } else p.push(`${w}: unknown kind`);
    });
  }
  if (!!l.recognise?.length !== !!l.check?.length) p.push('add both "Recognise" and "Lesson check", or neither');
}

const PINYIN_TONE = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;

/** Structural validation; returns a list of problems (empty = valid). */
/** Structural validation for a lesson in a language written in `script`; returns problems (empty = valid). */
export function validateLesson(x: unknown, script: Script = 'han'): string[] {
  const target = rulesFor(script).hasTarget;
  const p: string[] = [];
  if (!x || typeof x !== 'object') return ['not an object'];
  const l = x as Partial<LessonContent>;
  const str = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  if (!str(l.title)) p.push('title missing');
  if (!str(l.pattern)) p.push('pattern missing');
  if (!Array.isArray(l.explanation) || l.explanation.length === 0) p.push('explanation missing');
  if (!Array.isArray(l.examples) || l.examples.length < 2) p.push('need at least 2 examples');
  else l.examples.forEach((e, i) => (!target(e?.zh ?? '') || !str(e?.en)) && p.push(`example ${i} malformed`));
  if (!Array.isArray(l.drills) || l.drills.length < 3) p.push('need at least 3 drills');
  else l.drills.forEach((d, i) => (!target(d?.zh ?? '') || !str(d?.en)) && p.push(`drill ${i} malformed`));
  if (!Array.isArray(l.keyPoints)) p.push('keyPoints missing');
  if (!Array.isArray(l.errors)) p.push('errors missing');
  if (!Array.isArray(l.grammarPoints) || l.grammarPoints.length === 0) p.push('need at least 1 grammar point');
  // The pinyin rule applies to lessons too: Chinese fields must be Hanzi only.
  for (const e of [...(l.examples ?? []), ...(l.drills ?? [])]) {
    if (script === 'han' && PINYIN_TONE.test(e?.zh ?? '')) p.push(`pinyin found in Chinese field: ${e.zh}`);
  }
  validatePractice(l, p, script);
  return p;
}

/** Markdown rendering, used for full-text search and the export. */
export function renderLessonMd(l: LessonContent): string {
  const out: string[] = [`# ${l.title}`, '', `**Pattern:** ${l.pattern}`, `**Level:** ${l.level}`, ''];
  out.push('## Grammar', '', ...l.explanation.flatMap((p) => [p, '']));
  if (l.examples.length) out.push('### Examples', '', ...l.examples.map((e) => `- ${e.zh} — ${e.en}`), '');
  if (l.keyPoints.length) out.push('### Key points', '', ...l.keyPoints.map((k) => `- ${k}`), '');
  if (l.drills.length) out.push('## Drills', '', ...l.drills.map((d, i) => `${i + 1}. ${d.en} → ${d.zh}`), '');
  if (l.errors.length)
    out.push('## Common errors', '', ...l.errors.map((e) => `- ✗ ${e.wrong} → ✓ ${e.right}${e.note ? ` (${e.note})` : ''}`), '');
  if (l.grammarPoints.length) out.push('## Grammar points', '', ...l.grammarPoints.map((g) => `- **${g.title}**: ${g.summary}`), '');
  if (l.chatPrompt) out.push('## Conversation', '', l.chatPrompt, '');
  if (l.recognise?.length) out.push('## Recognise', '', ...l.recognise.map((c) => `- ${c.prompt}: ${c.options[c.answer]}`), '');
  return out.join('\n');
}

/**
 * Every string in the lesson to annotate in one go. For Chinese, any field with characters in it
 * (English explanations quote Chinese inline). For Latin-script languages only the fields that are
 * wholly in the target language, so English explanations are not treated as Italian.
 */
export function lessonStrings(l: LessonContent, script: Script = 'han'): string[] {
  const s = new Set<string>();
  const target = rulesFor(script).hasTarget;
  const add = (x: string | undefined) => x && target(x) && s.add(x);
  if (script === 'han') {
    add(l.title);
    add(l.pattern);
    l.explanation.forEach(add);
    l.keyPoints.forEach(add);
    l.grammarPoints.forEach((g) => (add(g.title), add(g.summary)));
    add(l.chatPrompt);
  }
  l.examples.forEach((e) => add(e.zh));
  l.drills.forEach((d) => add(d.zh));
  l.errors.forEach((e) => (add(e.wrong), add(e.right), script === 'han' && add(e.note)));
  l.recognise?.forEach((c) => c.options.forEach(add));
  l.check?.forEach((it) => {
    if (it.kind === 'choice') it.options.forEach(add);
    else if (it.kind === 'translate') add(it.zh);
    else (add(it.wrong), add(it.right), script === 'han' && add(it.note));
  });
  return [...s];
}
