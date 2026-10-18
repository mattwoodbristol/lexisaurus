// Annotate several strings at once for display (lessons, review cards). Read-only: viewing
// study material does not change word statuses.
import type { Token } from '../core/pinyin/annotate';
import { getLanguage } from '../core/languages';
import { rulesFor } from '../core/text/rules';
import { stripPinyin } from '../core/pinyin/strip';
import { getDict } from './words';
import { pinyinPerChar } from './pinyin';

export async function annotateStrings(db: D1Database, lang: string, strings: string[]): Promise<Record<string, Token[]>> {
  const out: Record<string, Token[]> = {};
  const rules = rulesFor(getLanguage(lang)?.script ?? 'han');
  const todo = [...new Set(strings.filter((s) => s && rules.hasTarget(s)))];
  if (todo.length === 0) return out;
  const dict = await getDict(db, lang);
  for (const s of todo) out[s] = rules.tokenize(s, dict, pinyinPerChar);
  return out;
}

/** Hanzi-only clean-up for model output that will be shown with app-generated pinyin. */
export function cleanZh(s: string): string {
  return stripPinyin(s);
}
