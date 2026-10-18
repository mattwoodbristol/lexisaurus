// pinyin-pro adapter: context-aware pinyin, one entry per code point ('' for non-Han).
import { pinyin } from 'pinyin-pro';

export function pinyinPerChar(text: string): string[] {
  return pinyin(text, { type: 'all' }).map((x) => (x.isZh ? x.pinyin : ''));
}

/** Pinyin for a single word on its own (used when adding a new word to the list). */
export function pinyinForWord(word: string): string {
  return pinyin(word, { type: 'array' }).join(' ');
}

// Warm pinyin-pro's dictionary at module load (Worker startup), not inside the first request:
// the first call costs ~15 ms of CPU against a 10 ms per-request limit on the free plan.
pinyin('中文', { type: 'array' });
