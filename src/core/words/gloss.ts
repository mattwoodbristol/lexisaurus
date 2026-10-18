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
 * Word-list glosses were cut at 120 characters on import, sometimes mid-bracket ("good (opp.").
 * Drop an unclosed trailing bracket and mark the cut with an ellipsis.
 */
export function tidyListGloss(g: string): string | null {
  const orig = g.trim().replace(/^\(-\/\/-\)\s*/, ''); // Pleco's "(-//-)" marker carries no meaning
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
