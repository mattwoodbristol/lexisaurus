// Hybrid word segmentation: longest match against the learner's own word list first,
// then ICU (Intl.Segmenter) for anything the list does not cover.

export interface Segment {
  text: string;
  /** True when the segment is Han text (gets a pinyin decision). */
  isHan: boolean;
}

const HAN = /[㐀-䶿一-鿿豈-﫿]/;

export function isHanChar(ch: string): boolean {
  return HAN.test(ch);
}

let segmenter: Intl.Segmenter | undefined;
function icu(): Intl.Segmenter {
  return (segmenter ??= new Intl.Segmenter('zh', { granularity: 'word' }));
}

/**
 * @param hasWord returns true if the string is a word in the learner's list (any status)
 * @param maxLen  longest dictionary word to try
 */
export function segmentChinese(text: string, hasWord: (s: string) => boolean, maxLen = 6): Segment[] {
  const out: Segment[] = [];
  const chars = Array.from(text); // code points, not UTF-16 units
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i] ?? '';
    if (!isHanChar(ch)) {
      // Gather a run of non-Han characters.
      let j = i + 1;
      while (j < chars.length && !isHanChar(chars[j] ?? '')) j++;
      out.push({ text: chars.slice(i, j).join(''), isHan: false });
      i = j;
      continue;
    }
    // Longest dictionary match, down to a single character. A word the learner's list
    // knows always beats ICU's guess (ICU merges e.g. 也来 into one "word").
    let matched = 0;
    for (let len = Math.min(maxLen, chars.length - i); len >= 1; len--) {
      const slice = chars.slice(i, i + len);
      if (!slice.every(isHanChar)) continue;
      if (hasWord(slice.join(''))) {
        matched = len;
        break;
      }
    }
    if (matched === 0) {
      // ICU's first segment of the remainder, truncated to Han characters only.
      const rest = chars.slice(i).join('');
      const first = icu().segment(rest)[Symbol.iterator]().next().value as Intl.SegmentData | undefined;
      const seg = Array.from(first?.segment ?? ch);
      let len = 0;
      while (len < seg.length && isHanChar(seg[len] ?? '')) len++;
      matched = Math.max(1, len);
    }
    out.push({ text: chars.slice(i, i + matched).join(''), isHan: true });
    i += matched;
  }
  return out;
}
