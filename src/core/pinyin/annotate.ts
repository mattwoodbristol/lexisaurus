// The deterministic pinyin rule. Code decides; Claude never does.
import { isHanChar, segmentChinese } from './segment';

export type StoredStatus = 'known' | 'learning' | 'new';
/** 'unknown' = not in the words table at all. */
export type WordStatus = StoredStatus | 'unknown';
export type PinyinMode = 'off' | 'smart' | 'all';

export interface WordInfo {
  id: number;
  status: StoredStatus;
  /** Tone-marked reading from the word list, if any. Preferred over generated pinyin. */
  reading?: string | null;
}

export interface Token {
  text: string;
  /** Present for Han segments only. */
  pinyin?: string;
  status?: WordStatus;
  wordId?: number;
}

export const PINYIN_MODES: PinyinMode[] = ['off', 'smart', 'all'];

export function isPinyinMode(x: unknown): x is PinyinMode {
  return typeof x === 'string' && (PINYIN_MODES as string[]).includes(x);
}

export function nextPinyinMode(mode: PinyinMode): PinyinMode {
  return PINYIN_MODES[(PINYIN_MODES.indexOf(mode) + 1) % PINYIN_MODES.length] ?? 'smart';
}

/** The rule: Off never; All always; Smart only for words not yet known. */
export function showPinyin(token: Token, mode: PinyinMode): boolean {
  if (!token.pinyin || !token.status) return false;
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return token.status !== 'known';
}

/**
 * @param dict       learner's word list, keyed by lemma
 * @param pinyinFor  context-aware pinyin for a run of text, one entry per code point
 *                   (non-Han code points may return '')
 */
export function annotate(text: string, dict: Map<string, WordInfo>, pinyinFor: (text: string) => string[]): Token[] {
  const segs = segmentChinese(text, (s) => dict.has(s));
  const perChar = pinyinFor(text);
  const tokens: Token[] = [];
  let pos = 0; // code point index into text
  for (const seg of segs) {
    const len = Array.from(seg.text).length;
    if (!seg.isHan) {
      tokens.push({ text: seg.text });
      pos += len;
      continue;
    }
    const info = dict.get(seg.text);
    const generated = perChar
      .slice(pos, pos + len)
      .filter((p) => p)
      .join(' ');
    tokens.push({
      text: seg.text,
      pinyin: info?.reading || generated,
      status: info?.status ?? 'unknown',
      ...(info ? { wordId: info.id } : {}),
    });
    pos += len;
  }
  return tokens;
}

/** Han words in the text that are not in the learner's list (candidates to add as learning). */
export function unknownWords(tokens: Token[]): string[] {
  const seen = new Set<string>();
  for (const t of tokens) if (t.status === 'unknown' && t.pinyin) seen.add(t.text);
  return [...seen];
}

/** All Han substrings up to maxLen, for a single IN (...) lookup against the words table. */
export function candidateLemmas(text: string, maxLen = 6): string[] {
  const chars = Array.from(text);
  const out = new Set<string>();
  for (let i = 0; i < chars.length; i++) {
    if (!isHanChar(chars[i] ?? '')) continue;
    let s = '';
    for (let len = 1; len <= maxLen && i + len <= chars.length; len++) {
      const ch = chars[i + len - 1] ?? '';
      if (!isHanChar(ch)) break;
      s += ch;
      out.add(s);
    }
  }
  return [...out];
}
