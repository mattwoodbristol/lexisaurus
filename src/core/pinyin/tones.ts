// Convert tone-numbered pinyin (Pleco style, e.g. "Zhong1guo2", "nv3", "lu:4") to tone marks.

const MARKS: Record<string, string[]> = {
  a: ['ā', 'á', 'ǎ', 'à'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
  A: ['Ā', 'Á', 'Ǎ', 'À'],
  E: ['Ē', 'É', 'Ě', 'È'],
  I: ['Ī', 'Í', 'Ǐ', 'Ì'],
  O: ['Ō', 'Ó', 'Ǒ', 'Ò'],
  U: ['Ū', 'Ú', 'Ǔ', 'Ù'],
  Ü: ['Ǖ', 'Ǘ', 'Ǚ', 'Ǜ'],
};

/** Mark one syllable: letters (may contain v or u: for ü) + tone digit 1-5 (5 or 0 = neutral). */
export function markSyllable(letters: string, tone: number): string {
  const s = letters.replace(/u:/g, 'ü').replace(/U:/g, 'Ü').replace(/v/g, 'ü').replace(/V/g, 'Ü');
  if (tone < 1 || tone > 4) return s;
  // Placement rule: a or e take the mark; otherwise in "ou" the o; otherwise the last vowel.
  const lower = s.toLowerCase();
  let idx = -1;
  if (lower.includes('a')) idx = lower.indexOf('a');
  else if (lower.includes('e')) idx = lower.indexOf('e');
  else if (lower.includes('ou')) idx = lower.indexOf('o');
  else {
    for (let i = s.length - 1; i >= 0; i--) {
      if ('iouüIOUÜ'.includes(s[i] ?? '')) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) return s;
  const ch = s[idx] ?? '';
  const marked = MARKS[ch]?.[tone - 1];
  return marked ? s.slice(0, idx) + marked + s.slice(idx + 1) : s;
}

/**
 * Convert a tone-numbered string to marked pinyin with one space between syllables.
 * "Zhong1guo2" -> "Zhōng guó"; "ni3 hao3" -> "nǐ hǎo"; "xin1sheng1'er2" -> "xīn shēng ér".
 * Input that carries no tone digits is returned trimmed and unchanged.
 */
export function numberedToMarked(input: string): string {
  const out: string[] = [];
  const re = /([A-Za-züÜ:]+)([0-5])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) out.push(markSyllable(m[1] ?? '', Number(m[2])));
  return out.length > 0 ? out.join(' ') : input.trim();
}
