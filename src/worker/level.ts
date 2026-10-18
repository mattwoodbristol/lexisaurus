// The learner's measured level for a language (from the latest level check), for prompts and
// new-word order. Kept apart from assessment.ts to avoid an import cycle with lessons.ts.
import { getSetting } from './day';
import type { LevelResult } from '../core/assessment/levels';

export interface LevelCheck extends LevelResult {
  text: string;
}

export async function levelCheck(db: D1Database, lang: string): Promise<LevelCheck | null> {
  const v = await getSetting<LevelCheck | null>(db, `${lang}.level_check`, null);
  return v && typeof v === 'object' && typeof v.text === 'string' ? v : null;
}
