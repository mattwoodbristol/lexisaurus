// Script-dependent text handling in one place: what counts as target-language text, how text is
// split into words, how typed answers are compared, and what a tap can look up. Mandarin keeps
// its original behaviour exactly; Latin-script languages (Italian) get word-based equivalents.
import { annotate, type Token, type WordInfo } from '../pinyin/annotate';
import type { Script } from '../languages/types';

const HAN = /[㐀-䶿一-鿿]/;
const HAN_ONLY = /^[㐀-䶿一-鿿]+$/;
const LETTER = /\p{L}/u;
/** A Latin-script word, with an elided article or preposition kept as its own word: l' + acqua. */
const LATIN_WORD = /[\p{L}\p{M}]+(?:['’](?=[\p{L}\p{M}]))?|[\p{L}\p{M}]+/gu;

export interface TextRules {
  script: Script;
  /** Does the string contain target-language text worth annotating? */
  hasTarget(s: string): boolean;
  /** Canonical form for comparing a typed answer with the key. */
  normalise(s: string): string;
  /** Key under which a word is stored and looked up in the word list. */
  key(word: string): string;
  /** Can this tapped text be looked up as one word? */
  isLookup(text: string): boolean;
  /** Split text into display tokens; word tokens carry a status from the dictionary. */
  tokenize(text: string, dict: Map<string, WordInfo>, readingFor?: (text: string) => string[]): Token[];
}

/** Mandarin: segmentation and pinyin, exactly as before. */
const han: TextRules = {
  script: 'han',
  hasTarget: (s) => HAN.test(s),
  normalise: (s) =>
    s
      .normalize('NFKC')
      .replace(/[\s\p{P}\p{S}]/gu, '')
      .trim(),
  key: (w) => w,
  isLookup: (t) => {
    const n = Array.from(t).length;
    return n > 0 && n <= 12 && HAN_ONLY.test(t);
  },
  tokenize: (text, dict, readingFor) => annotate(text, dict, readingFor ?? ((t) => Array.from(t).map(() => ''))),
};

/** Latin script: words between spaces and punctuation, matched case-insensitively. */
const latin: TextRules = {
  script: 'latin',
  hasTarget: (s) => LETTER.test(s),
  normalise: (s) =>
    s
      .normalize('NFC')
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/[^\p{L}\p{M}\p{N}'\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .replace(/' /g, "'") // an elided word runs on: l' accordo is l'accordo
      .trim(),
  key: (w) => w.normalize('NFC').toLowerCase().replace(/[’']$/, '').replace(/’/g, "'"),
  isLookup: (t) => {
    const w = t.replace(/[’']$/, '');
    return w.length > 0 && w.length <= 40 && /^[\p{L}\p{M}'’-]+$/u.test(w);
  },
  tokenize: (text, dict) => {
    const out: Token[] = [];
    let last = 0;
    for (const m of text.matchAll(LATIN_WORD)) {
      const start = m.index!;
      if (start > last) out.push({ text: text.slice(last, start) });
      const word = m[0];
      const info = dict.get(latin.key(word));
      out.push({ text: word, status: info?.status ?? 'unknown', ...(info ? { wordId: info.id } : {}) });
      last = start + word.length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  },
};

export function rulesFor(script: Script): TextRules {
  return script === 'han' ? han : latin;
}

/** Same answer after normalising (punctuation, spacing; case too for Latin scripts). */
export function sameText(script: Script, a: string, b: string): boolean {
  const r = rulesFor(script);
  return r.normalise(a) !== '' && r.normalise(a) === r.normalise(b);
}
