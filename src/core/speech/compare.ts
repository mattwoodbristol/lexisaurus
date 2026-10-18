// Comparing what the speech recogniser heard with the sentence the learner meant to say.
// A recogniser is not a pronunciation grader: it returns the most likely sentence, so a wrong
// tone in a long sentence is often "fixed" from context. Marking each target character (or word)
// as heard or not still shows where it did not understand, which is what this reports.
import { rulesFor } from '../text/rules';
import type { Script } from '../languages/types';

export interface SpokenPart {
  /** A character of the target (Han) or a word (Latin), as written in the target. */
  text: string;
  /** Heard in the right place. */
  ok: boolean;
}

export interface SpokenResult {
  /** The recogniser's best guess that matches the target most closely. */
  heard: string;
  /** Target and heard are the same after normalising. */
  match: boolean;
  /** Share of the target's characters or words that were heard (0-1). */
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

/** Comparison units: characters for Han, words for Latin script. */
function units(script: Script, s: string): string[] {
  const n = rulesFor(script).normalise(s);
  return script === 'han' ? Array.from(n) : n.split(' ').filter(Boolean);
}

/** Which target units appear, in order, in the heard units (longest common subsequence). */
function alignment(target: string[], heard: string[]): boolean[] {
  const t = target.length;
  const h = heard.length;
  const dp: number[][] = Array.from({ length: t + 1 }, () => new Array<number>(h + 1).fill(0));
  for (let i = t - 1; i >= 0; i--)
    for (let j = h - 1; j >= 0; j--) dp[i]![j] = target[i] === heard[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const ok = new Array<boolean>(t).fill(false);
  let i = 0;
  let j = 0;
  while (i < t && j < h) {
    if (target[i] === heard[j]) {
      ok[i] = true;
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return ok;
}

/** Display parts of the target: the target's own characters or words, each marked heard or not. */
function displayParts(script: Script, target: string, ok: boolean[]): SpokenPart[] {
  const rules = rulesFor(script);
  const out: SpokenPart[] = [];
  let k = 0;
  if (script === 'han') {
    for (const ch of Array.from(target)) {
      // Punctuation and spaces are not spoken: shown, never marked.
      if (rules.normalise(ch) === '') out.push({ text: ch, ok: true });
      else out.push({ text: ch, ok: ok[k++] ?? false });
    }
    return out;
  }
  for (const word of target.split(/(\s+)/)) {
    if (!word) continue;
    if (rules.normalise(word) === '') out.push({ text: word, ok: true });
    else out.push({ text: word, ok: ok[k++] ?? false });
  }
  return out;
}

function compareOne(script: Script, target: string, heard: string): SpokenResult {
  const said = normaliseHeard(script, heard);
  const t = units(script, target);
  const ok = alignment(t, units(script, said));
  const right = ok.filter(Boolean).length;
  const n = rulesFor(script).normalise;
  return {
    heard: said,
    match: n(said) !== '' && n(said) === n(target),
    score: t.length ? right / t.length : 0,
    parts: displayParts(script, target, ok),
  };
}

/** Compare the recogniser's alternatives with the target and keep the closest. */
export function compareSpoken(script: Script, target: string, alternatives: string[]): SpokenResult {
  const heard = alternatives.filter((a) => a.trim() !== '');
  if (!heard.length) return { heard: '', match: false, score: 0, parts: displayParts(script, target, []) };
  return heard
    .map((a) => compareOne(script, target, a))
    .reduce((best, r) => (r.match && !best.match ? r : r.match === best.match && r.score > best.score ? r : best));
}

/** Review rating suggested by how much was understood: all of it Good, most of it Hard, else Pass. */
export function spokenRating(r: SpokenResult): 1 | 2 | 3 {
  if (r.match || r.score === 1) return 3;
  return r.score >= 0.75 ? 2 : 1;
}
