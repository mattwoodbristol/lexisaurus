// Background job: give words with no difficulty band (words.level) one, a batch per cron run, so
// the review pool can introduce easier words first and the level check can use them. Cheap
// (Haiku); words the model will not band are remembered and not asked about again.
import { z } from 'zod';
import type { Env } from './env';
import { callStructured } from './claude';
import { getSetting } from './day';
import { bandScale } from '../../prompts/assessment.v1';
import { promptsFor } from '../../prompts/languages';

const BATCH = 60;
const SKIP_KEY = 'word_levels.skipped';

const Bands = z.object({ levels: z.array(z.object({ word: z.string(), band: z.number().int() })) });

export function wordLevelsPrompt(language: string, lang: string): string {
  return `You give ${language} words a difficulty band (${bandScale(lang)}): the band at which a learner would typically meet the word. For a phrase or set expression, the band of the phrase as a whole. Return every word exactly as given, with its band.`;
}

/** Band one batch of unbanded words; returns a log line, or null when there is nothing to do. */
export async function tagWordLevels(env: Env): Promise<string | null> {
  const skipped = await getSetting<number[]>(env.DB, SKIP_KEY, []);
  const skip = new Set(Array.isArray(skipped) ? skipped : []);
  const { results } = await env.DB.prepare(
    `SELECT id, lang, lemma, gloss FROM words WHERE level IS NULL
     ORDER BY CASE status WHEN 'learning' THEN 0 WHEN 'new' THEN 1 ELSE 2 END, id LIMIT ?1`,
  )
    .bind(BATCH + skip.size)
    .all<{ id: number; lang: string; lemma: string; gloss: string | null }>();
  const todo = results.filter((w) => !skip.has(w.id));
  if (!todo.length) return null;
  const lang = todo[0]!.lang; // one language per run keeps the prompt simple
  const batch = todo.filter((w) => w.lang === lang).slice(0, BATCH);
  const out = await callStructured(env, {
    role: 'exercises',
    system: [wordLevelsPrompt(promptsFor(lang).name, lang)],
    messages: [{ role: 'user', content: batch.map((w) => (w.gloss ? `${w.lemma} (${w.gloss})` : w.lemma)).join('\n') }],
    maxTokens: 2000,
    schema: Bands,
  });
  const byWord = new Map(out.levels.map((l) => [l.word.trim(), l.band]));
  const writes = [];
  const missed: number[] = [];
  for (const w of batch) {
    const band = byWord.get(w.lemma) ?? byWord.get(w.gloss ? `${w.lemma} (${w.gloss})` : w.lemma);
    if (band === undefined || band < 1 || band > 6) missed.push(w.id);
    else writes.push(env.DB.prepare('UPDATE words SET level = ?1 WHERE id = ?2 AND level IS NULL').bind(band, w.id));
  }
  if (missed.length) writes.push(env.DB.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?1, ?2)').bind(SKIP_KEY, JSON.stringify([...skip, ...missed])));
  if (writes.length) await env.DB.batch(writes);
  return `word levels: ${lang} ${batch.length - missed.length} banded, ${missed.length} skipped`;
}
