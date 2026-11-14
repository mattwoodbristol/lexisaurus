// Pure helpers for tap-to-translate word lookups.

const HAN = /[㐀-䶿一-鿿]/;
const HAN_ONLY = /^[㐀-䶿一-鿿]+$/;
export const MAX_LOOKUP_CHARS = 12;

/** A lookup target must be a short run of Hanzi (one segmented word). */
export function isLookupText(lang: string, text: string): boolean {
  const n = Array.from(text).length;
  if (n === 0 || n > MAX_LOOKUP_CHARS) return false;
  return lang === 'zh' ? HAN_ONLY.test(text) : true;
}

/** Tidy a model-written gloss: one line, no wrapping quotes or labels, capped length. */
export function cleanGloss(raw: string): string {
  let s = raw.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
  s = s.replace(/^(gloss|meaning|english)\s*:\s*/i, '');
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  return s.length > 160 ? s.slice(0, 157).trimEnd() + '…' : s;
}

/**
 * A dictionary cross-reference whose target (a Hanzi headword) was cut off on import, leaving
 * only its label: "variant of", "old variant of", "same as", "abbr. for". ("see" alone is not
 * matched: it is also a real meaning.)
 */
const VARIANT = String.raw`(?:(?:old|erhua|archaic|ancient|japanese|taiwan|literary|non-standard|traditional)\s+)?variant\s+of|same\s+as|abbr(?:\.|eviation)?\s+(?:for|of)`;
// "abbreviation = 化学肥料" (Pleco), or "= 化学肥料" once "abbreviation" is taken as a part of speech.
const EQUALS = String.raw`(?:abbreviation|abbr\.?)?\s*=`;
const XREF_ONLY = new RegExp(String.raw`^(?:${VARIANT}|${EQUALS}|abbreviation|abbr\.?|see\s+also|used\s+in|also\s+written)$`, 'i');
const XREF_TRAILING = new RegExp(String.raw`[;,]\s*(?:also\s+)?(?:${VARIANT})(?:\s+[㐀-䶿一-鿿|]+[^;,]*)?$`, 'i');

const XREF_TO = new RegExp(String.raw`^(?:${VARIANT}|${EQUALS}|see\s+also|used\s+in|also\s+written)\s*([㐀-䶿一-鿿|]+)`, 'i');

/**
 * Pleco's export marks a link to another entry with private-use characters around the entry's id
 * ("\uEAB8\uEABB22930176\uEABC化学肥料"). Drop the marks and the id, keeping any text.
 */
export function stripPlecoMarkup(g: string): string {
  return g
    .replace(/[\uE000-\uF8FF]+\d+[\uE000-\uF8FF]+/g, ' ')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The headword a cross-reference gloss points to ("variant of 這|这 zhè" → ["这", "這"]), or null
 * when the gloss is a meaning. Simplified first: CC-CEDICT writes "trad|simp".
 */
export function xrefTarget(g: string): string[] | null {
  const m = XREF_TO.exec(g.trim());
  return m ? (m[1] ?? '').split('|').filter(Boolean).reverse() : null;
}

/** Drop a dangling cross-reference label: the whole gloss ("variant of" → "") or its tail. */
export function dropXrefLabel(g: string): string {
  const s = g.trim().replace(/[;,\s]+$/, '');
  if (XREF_ONLY.test(s)) return '';
  return s.replace(XREF_TRAILING, '').trim();
}

/**
 * Word-list glosses were cut at 120 characters on import, sometimes mid-bracket ("good (opp.").
 * Drop an unclosed trailing bracket and mark the cut with an ellipsis.
 */
export function tidyListGloss(g: string): string | null {
  // Pleco's "(-//-)" marker and "variant of" (with or without its headword) carry no meaning.
  g = stripPlecoMarkup(g);
  if (xrefTarget(g)) return null;
  const orig = dropXrefLabel(g.trim().replace(/^\(-\/\/-\)\s*/, ''));
  let s = orig;
  const cut = g.length >= 115;
  const lastOpen = Math.max(s.lastIndexOf('('), s.lastIndexOf('['));
  const lastClose = Math.max(s.lastIndexOf(')'), s.lastIndexOf(']'));
  if (lastOpen > lastClose) s = s.slice(0, lastOpen).trim();
  s = s.replace(/[;,]\s*$/, '').trim();
  // Nothing left, or only a label and a sense number ("auxiliary 1"): not a usable meaning.
  if (!s || /^[a-z]+(\s+\d+)?$/i.test(s) && s.split(/\s+/).length <= 2 && /\d/.test(s)) return null;
  return cut || s !== orig ? `${s}…` : s;
}

/** Distinct characters of a multi-character word, in order, for the character breakdown. */
export function wordChars(text: string): string[] {
  const chars = Array.from(text).filter((c) => HAN.test(c));
  return chars.length > 1 ? [...new Set(chars)] : [];
}

/** Trim the context sentence sent to the model to a window around the word. */
export function contextWindow(context: string | undefined, word: string, radius = 60): string {
  if (!context) return '';
  const c = context.replace(/\s+/g, ' ').trim();
  if (c.length <= radius * 2) return c;
  const i = c.indexOf(word);
  const start = i < 0 ? 0 : Math.max(0, i - radius);
  return c.slice(start, start + radius * 2);
}

/** A word compared loosely: no spaces, punctuation or brackets, lower case. */
function wordKey(w: string): string {
  return w.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

/**
 * Pair the meanings Claude wrote with the words asked for. Claude is asked to echo each word
 * exactly but sometimes tidies it (a space, brackets, one form of "哪儿/哪里"): such a word is
 * matched loosely, then by its place in the list when the answer has one entry per word.
 */
export function pairMeanings(asked: string[], answer: { word: string; meaning: string }[]): Map<string, string> {
  const exact = new Map(answer.map((a) => [a.word.trim(), a.meaning]));
  const loose = new Map(answer.map((a) => [wordKey(a.word), a.meaning]));
  const out = new Map<string, string>();
  asked.forEach((w, i) => {
    const forms = w.split(/[/|,;、]/).map(wordKey).filter(Boolean);
    const m =
      exact.get(w) ??
      loose.get(wordKey(w)) ??
      forms.map((f) => loose.get(f)).find((x) => x !== undefined) ??
      (answer.length === asked.length ? answer[i]!.meaning : undefined);
    if (m?.trim()) out.set(w, m);
  });
  return out;
}

/** One sense that is only a person's name: "Zhu (surname)", "surname Zhu", "Li (given name)". */
const NAME_SENSE = /^(?:[\p{L}'’ -]{1,30}\s*\((?:surname|family name|given name|first name|personal name|person's name|name)\)|(?:surname|family name|given name|first name)\s+[\p{L}'’ -]{1,30}|(?:a\s+)?(?:surname|family name|given name)|[\p{L}'’ -]{1,30},\s+(?:a\s+)?(?:surname|family name|given name))$/iu;

/**
 * Is every sense of the gloss a person's name? Such a word cannot be tested: in "Teacher Zhu" any
 * character read zhu fits the blank. A word with another sense too ("vermilion; surname Zhu") is not.
 */
export function isNameGloss(gloss: string | null | undefined): boolean {
  const senses = (gloss ?? '')
    .split(/[;；]/)
    .map((s) => s.trim().replace(/[.。]$/, ''))
    .filter(Boolean);
  return senses.length > 0 && senses.every((s) => NAME_SENSE.test(s));
}
