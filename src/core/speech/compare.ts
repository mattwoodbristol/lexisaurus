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
