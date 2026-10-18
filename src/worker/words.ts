// Word list access and the word lifecycle (unknown -> learning with an SRS card).
import { createEmptyCard } from 'ts-fsrs';
import { type Token, type WordInfo } from '../core/pinyin/annotate';
import { pinyinForWord } from './pinyin';
import { getLanguage } from '../core/languages';
import { rulesFor } from '../core/text/rules';

// The whole word list (~11k rows) is cached per isolate and refreshed after writes, so annotation
// needs one read instead of dozens of IN (...) queries. Other isolates see changes within the TTL.
const DICT_TTL_MS = 60_000;
const dictCache = new Map<string, { at: number; dict: Map<string, WordInfo> }>();

export function invalidateDict(lang: string): void {
  dictCache.delete(lang);
}

export async function getDict(db: D1Database, lang: string): Promise<Map<string, WordInfo>> {
  const hit = dictCache.get(lang);
  if (hit && Date.now() - hit.at < DICT_TTL_MS) return hit.dict;
  const { results } = await db
    .prepare('SELECT id, lemma, status, reading FROM words WHERE lang = ?1')
    .bind(lang)
    .all<{ id: number; lemma: string; status: WordInfo['status']; reading: string | null }>();
  const language = getLanguage(lang);
  const rules = rulesFor(language?.script ?? 'han');
  const dict = new Map<string, WordInfo>();
  for (const r of results) dict.set(rules.key(r.lemma), { id: r.id, status: r.status, reading: r.reading });
  if (language?.script === 'latin') {
    // Inflected forms point at their dictionary word (parlava -> parlare).
    const { results: forms } = await db.prepare('SELECT form, lemma FROM word_forms WHERE lang = ?1').bind(lang).all<{ form: string; lemma: string }>();
    for (const f of forms) {
      const info = dict.get(rules.key(f.lemma));
      if (info && !dict.has(f.form)) dict.set(f.form, info);
    }
  }
  dictCache.set(lang, { at: Date.now(), dict });
  return dict;
}

/** Kept for call sites written against Phase 1; the text argument is no longer needed. */
export async function lookupDict(db: D1Database, lang: string, _text?: string): Promise<Map<string, WordInfo>> {
  return getDict(db, lang);
}

async function addCard(db: D1Database, lang: string, wordId: number, now: Date): Promise<void> {
  const card = createEmptyCard(now);
  await db
    .prepare(`INSERT OR IGNORE INTO srs_cards(item_type, item_id, lang, fsrs_state_json, due_at) VALUES ('word', ?1, ?2, ?3, ?4)`)
    .bind(wordId, lang, JSON.stringify(card), card.due.toISOString())
    .run();
}

/**
 * Start tracking the words in a piece of text the learner has met in use:
 * unknown words are added as `learning`; pool words (`new`) are promoted to `learning`.
 * Both get an SRS card. Returns tokens updated with ids/statuses.
 */
export async function trackWords(
  db: D1Database,
  lang: string,
  tokens: Token[],
  source: 'conversation' | 'lesson',
  now = new Date(),
): Promise<{ tokens: Token[]; added: { id: number; lemma: string; pinyin: string }[]; promoted: number[]; ids: Map<string, number> }> {
  const added: { id: number; lemma: string; pinyin: string }[] = [];
  const ids = new Map<string, number>();
  for (const t of tokens) if (t.wordId) ids.set(t.text, t.wordId);

  // Only languages with reliable word splitting add unseen words automatically (Mandarin).
  const autoAdd = getLanguage(lang)?.autoAddUnknownWords ?? true;
  const unknown = autoAdd ? [...new Set(tokens.filter((t) => t.status === 'unknown' && t.pinyin).map((t) => t.text))] : [];
  for (const lemma of unknown) {
    const reading = pinyinForWord(lemma);
    const ins = await db
      .prepare(
        `INSERT INTO words(lang, lemma, reading, gloss, source, status) VALUES (?1, ?2, ?3, NULL, ?4, 'learning')
         ON CONFLICT(lang, lemma) DO UPDATE SET lemma = excluded.lemma RETURNING id`,
      )
      .bind(lang, lemma, reading, source)
      .first<{ id: number }>();
    if (!ins) continue;
    ids.set(lemma, ins.id);
    added.push({ id: ins.id, lemma, pinyin: reading });
    await addCard(db, lang, ins.id, now);
  }

  const promoted = [...new Set(tokens.filter((t) => t.status === 'new' && t.wordId).map((t) => t.wordId!))];
  const card = createEmptyCard(now);
  const stmts: D1PreparedStatement[] = [];
  for (const id of promoted) {
    stmts.push(db.prepare("UPDATE words SET status = 'learning' WHERE id = ?1 AND status = 'new'").bind(id));
    stmts.push(
      db
        .prepare(`INSERT OR IGNORE INTO srs_cards(item_type, item_id, lang, fsrs_state_json, due_at) VALUES ('word', ?1, ?2, ?3, ?4)`)
        .bind(id, lang, JSON.stringify(card), card.due.toISOString()),
    );
  }
  if (stmts.length) await db.batch(stmts);
  if (added.length || promoted.length) invalidateDict(lang);

  const promotedSet = new Set(promoted);
  const out = tokens.map((t) => {
    if (t.status === 'new' && t.wordId && promotedSet.has(t.wordId)) return { ...t, status: 'learning' as const };
    if (t.status !== 'unknown') return t;
    const id = ids.get(t.text);
    return id ? { ...t, status: 'learning' as const, wordId: id } : t;
  });
  return { tokens: out, added, promoted, ids };
}

/** Conversation variant: track words and record exposures for every listed word in the message. */
export async function recordExposures(
  db: D1Database,
  lang: string,
  conversationId: number,
  tokens: Token[],
  now = new Date(),
): Promise<{ tokens: Token[]; added: { id: number; lemma: string; pinyin: string }[]; promoted: number[] }> {
  const r = await trackWords(db, lang, tokens, 'conversation', now);
  const stmts = [...new Set(r.ids.values())].map((id) =>
    db.prepare('INSERT OR IGNORE INTO exposures(word_id, conversation_id) VALUES (?1, ?2)').bind(id, conversationId),
  );
  if (stmts.length) await db.batch(stmts);
  return { tokens: r.tokens, added: r.added, promoted: r.promoted };
}

/** A few learning words, soonest due first, for the tutor to weave in. */
export async function targetWords(db: D1Database, lang: string, limit = 5): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT w.lemma FROM words w JOIN srs_cards s ON s.item_type = 'word' AND s.item_id = w.id
       WHERE w.lang = ?1 AND w.status = 'learning' ORDER BY s.due_at ASC LIMIT ?2`,
    )
    .bind(lang, limit)
    .all<{ lemma: string }>();
  return results.map((r) => r.lemma);
}
