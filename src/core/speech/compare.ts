// Comparing what the speech recogniser heard with the sentence the learner meant to say.
// A recogniser is not a pronunciation grader: it returns the most likely sentence, so a wrong
// tone in a long sentence is often "fixed" from context. Marking each target character (or word)
// as heard or not still shows where it did not understand, which is what this reports.
import { rulesFor } from '../text/rules';
import type { Script } from '../languages/types';

export interface SpokenPart {
  /** A character of the target (Han) or a word (Latin), as written in the target. */
  text: string;
  /** Heard in the right place (or a character that sounds the same). */
  ok: boolean;
  /** Heard as the same syllable in another tone: half marks. */
  close?: boolean;
}

export interface SpokenResult {
  /** The recogniser's best guess that matches the target most closely. */
  heard: string;
  /** Target and heard are the same after normalising. */
  match: boolean;
  /** Share of the target's characters or words that were heard (0-1); a tone slip counts half. */
  score: number;
  parts: SpokenPart[];
}

const ZH_DIGITS = '零一二三四五六七八九';

/** Small whole numbers as Chinese numerals (recognisers often write 3 for 三, 10 for 十). */
export function numberToZh(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n);
  if (n < 10) return ZH_DIGITS[n]!;
  const units = ['', '十', '百', '千'];
  const digits = String(n).split('').map(Number);
  let out = '';
  let zero = false;
  digits.forEach((d, i) => {
    const place = digits.length - 1 - i;
    if (d === 0) {
      zero = out !== '';
      return;
    }
    if (zero) out += '零';
    zero = false;
    out += (d === 1 && place === 1 && out === '' ? '' : ZH_DIGITS[d]!) + units[place]!;
  });
  return out;
}

/** Recogniser output in the form the target is written in: Chinese numerals for digits (Han only). */
export function normaliseHeard(script: Script, heard: string): string {
  return script === 'han' ? heard.replace(/\d+/g, (m) => numberToZh(Number(m))) : heard;
}

/**
 * How each Han character sounds (toned pinyin, e.g. 买 → mǎi), from the app's annotations. A
 * recogniser picks one character among those that sound alike (他/她/它, 在/再, 的/得/地), so the
 * same sound counts as heard and the same syllable in another tone as half heard.
 */
export type Sounds = Record<string, string>;

/** Accents and apostrophes aside (Latin script): recognisers differ on è/e, perché/perche. */
const fold = (w: string) => w.normalize('NFD').replace(/[\u0300-\u036f'’]/g, '');

/** Comparison units: characters for Han, words for Latin script. */
function units(script: Script, s: string): string[] {
  const n = rulesFor(script).normalise(s);
  return script === 'han' ? Array.from(n) : n.split(' ').filter(Boolean).map(fold);
}

/** 1 for the same unit or sound, 0.5 for the same syllable in another tone, else 0. */
function likeness(a: string, b: string, sounds?: Sounds): number {
  if (a === b) return 1;
  const x = sounds?.[a];
  const y = sounds?.[b];
  if (!x || !y) return 0;
  if (x === y) return 1;
  return fold(x) === fold(y) ? 0.5 : 0;
}

/** Which target units appear, in order, in the heard units (a weighted common subsequence). */
function alignment(target: string[], heard: string[], sounds?: Sounds): number[] {
  const t = target.length;
  const h = heard.length;
  const dp: number[][] = Array.from({ length: t + 1 }, () => new Array<number>(h + 1).fill(0));
  for (let i = t - 1; i >= 0; i--)
    for (let j = h - 1; j >= 0; j--) {
      const w = likeness(target[i]!, heard[j]!, sounds);
      dp[i]![j] = Math.max(w ? dp[i + 1]![j + 1]! + w : 0, dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  const got = new Array<number>(t).fill(0);
  let i = 0;
  let j = 0;
  while (i < t && j < h) {
    const w = likeness(target[i]!, heard[j]!, sounds);
    if (w && dp[i]![j] === dp[i + 1]![j + 1]! + w) {
      got[i] = w;
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return got;
}

/** Display parts of the target: the target's own characters or words, each marked heard or not. */
function displayParts(script: Script, target: string, got: number[]): SpokenPart[] {
  const rules = rulesFor(script);
  const out: SpokenPart[] = [];
  let k = 0;
  const part = (text: string): SpokenPart => {
    const g = got[k++] ?? 0;
    return g === 1 ? { text, ok: true } : g > 0 ? { text, ok: false, close: true } : { text, ok: false };
  };
  if (script === 'han') {
    for (const ch of Array.from(target)) {
      // Punctuation and spaces are not spoken: shown, never marked.
      if (rules.normalise(ch) === '') out.push({ text: ch, ok: true });
      else out.push(part(ch));
    }
    return out;
  }
  for (const word of target.split(/(\s+)/)) {
    if (!word) continue;
    if (rules.normalise(word) === '') out.push({ text: word, ok: true });
    else out.push(part(word));
  }
  return out;
}

function compareOne(script: Script, target: string, heard: string, sounds?: Sounds): SpokenResult {
  const said = normaliseHeard(script, heard);
  const t = units(script, target);
  const h = units(script, said);
  const got = alignment(t, h, sounds);
  const right = got.reduce((a, b) => a + b, 0);
  return {
    heard: said,
    match: h.length > 0 && h.join(' ') === t.join(' '),
    score: t.length ? right / t.length : 0,
    parts: displayParts(script, target, got),
  };
}

/** Compare the recogniser's alternatives with the target and keep the closest. */
export function compareSpoken(script: Script, target: string, alternatives: string[], sounds?: Sounds): SpokenResult {
  const heard = alternatives.filter((a) => a.trim() !== '');
  if (!heard.length) return { heard: '', match: false, score: 0, parts: displayParts(script, target, []) };
  return heard
    .map((a) => compareOne(script, target, a, sounds))
    .reduce((best, r) => (r.match && !best.match ? r : r.match === best.match && r.score > best.score ? r : best));
}

/**
 * Recognisers mishear a word or two even when it was said right, so nearly all of it counts:
 * 90% or more is as good as a match.
 */
export const GOOD_ENOUGH = 0.9;
export const goodEnough = (r: SpokenResult) => r.match || r.score >= GOOD_ENOUGH;

/**
 * Whether `word` (as it appears in the target sentence) was heard, in the right tone or close to it.
 * A sentence understood around a missed word is not the word recalled.
 */
export function heardWord(r: SpokenResult, word: string): boolean {
  const sentence = r.parts.map((p) => p.text).join('');
  const start = sentence.indexOf(word);
  if (!word || start < 0) return true;
  const end = start + word.length;
  let at = 0;
  return r.parts.every((p) => {
    const from = at;
    at += p.text.length;
    return at <= start || from >= end || p.ok || !!p.close;
  });
}

/** Review rating suggested by how much was understood: nearly all Good, most Hard, else Pass. */
export function spokenRating(r: SpokenResult): 1 | 2 | 3 {
  if (goodEnough(r)) return 3;
  return r.score >= 0.6 ? 2 : 1;
}

/** Sounds of Han characters from annotation tokens (a word's pinyin, one syllable per character). */
export function soundsFrom(tokens: { text: string; pinyin?: string }[]): Sounds {
  const out: Sounds = {};
  for (const t of tokens) {
    const chars = Array.from(t.text);
    const syl = (t.pinyin ?? '').trim().split(/\s+/).filter(Boolean);
    if (syl.length === chars.length) chars.forEach((c, i) => (out[c] = syl[i]!.toLowerCase()));
  }
  return out;
}

/**
 * Whether `word` (as written in the target) is in what was said, anywhere: for a spoken answer
 * judged right in other words, whether it still used the word the card tests.
 */
export function saidWord(script: Script, heard: string, word: string): boolean {
  const w = units(script, word);
  const h = units(script, normaliseHeard(script, heard));
  if (!w.length) return true;
  if (script === 'han') return h.join('').includes(w.join(''));
  return w.every((x) => h.includes(x));
}

/**
 * A hint after a missed try at saying a sentence from its English: which of the target's parts
 * (the indexes of `SpokenResult.parts`) to show, the rest blanked. Parts said right in any try so
 * far show, and each miss uncovers about a third of the others still hidden (at least one), in
 * order. The tested word (`keep`) is never uncovered: it is the answer the card asks for, so it
 * shows only once said right.
 */
export function hintShown(script: Script, parts: SpokenPart[], shown: ReadonlySet<number>, keep?: string): Set<number> {
  const out = new Set(shown);
  parts.forEach((p, i) => {
    if (p.ok) out.add(i);
  });
  const tested = testedParts(script, parts, keep);
  const hidden = parts.map((_, i) => i).filter((i) => !out.has(i) && !tested.has(i));
  hidden.slice(0, Math.ceil(hidden.length / 3)).forEach((i) => out.add(i));
  return out;
}

/** The indexes of the parts that make up `keep` in the sentence: where it is written, else any part made of its units. */
function testedParts(script: Script, parts: SpokenPart[], keep?: string): Set<number> {
  const out = new Set<number>();
  if (!keep?.trim()) return out;
  const sentence = parts.map((p) => p.text).join('');
  const start = sentence.indexOf(keep.trim());
  if (start >= 0) {
    const end = start + keep.trim().length;
    let at = 0;
    parts.forEach((p, i) => {
      const from = at;
      at += p.text.length;
      if (at > start && from < end && units(script, p.text).length) out.add(i);
    });
    return out;
  }
  // Written in another form (an inflection): any part whose units are all the word's.
  const kept = units(script, keep);
  parts.forEach((p, i) => {
    const u = units(script, p.text);
    if (u.length && u.every((x) => kept.includes(x))) out.add(i);
  });
  return out;
}

/** A part as a hint shows it while hidden: a blank as long as the word (Latin) or one per character. */
export function blankPart(script: Script, text: string): string {
  if (script === 'han') return '＿';
  // Punctuation stuck to a word ("parco.") stays.
  return text.replace(/[\p{L}\p{N}'’]/gu, '_');
}
