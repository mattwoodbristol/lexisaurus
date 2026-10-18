// About the learner: the general "about you" text (Settings) and this language's notes (from the
// course pack). Given to lesson generation and the chat tutor; both are optional.
import { getSetting } from './day';

export async function learnerProfile(db: D1Database, lang: string): Promise<string | null> {
  const [about, notes] = await Promise.all([getSetting<unknown>(db, 'learner.about', ''), getSetting<unknown>(db, `${lang}.learner_notes`, '')]);
  const parts = [about, notes].filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
  return parts.length ? parts.join(' ') : null;
}
