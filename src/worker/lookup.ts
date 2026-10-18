// Tap-to-translate: look up one word for the popup. The word list's own gloss wins; otherwise
// Claude writes a short gloss once and it is stored (on the word, or in gloss_cache).
// Looking a word up does not change its status.
//
// Mandarin: the tapped text is the word (segmentation already chose it), with a character breakdown.
// Latin-script languages (Italian): the tapped text is a form (parlava); it is resolved to its
// dictionary word (parlare) once, with Claude, and the mapping kept in word_forms.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import { callClaude, callStructured, claudeErrorResponse } from './claude';
import { pinyinForWord } from './pinyin';
import { invalidateDict } from './words';
import { createEmptyCard } from 'ts-fsrs';
import { cleanGloss, contextWindow, tidyListGloss, wordChars } from '../core/words/gloss';
import { getLanguage, type LanguageConfig } from '../core/languages';
import { rulesFor } from '../core/text/rules';
import { promptsFor } from '../../prompts';

export const lookupRoutes = new Hono<{ Bindings: Env }>();

const tidy = (g: string | null | undefined) => (g ? tidyListGloss(g) : null);

interface WordRow {
  id: number;
  lemma: string;
  reading: string | null;
  gloss: string | null;
  status: 'known' | 'learning' | 'new';
}

const LemmaGloss = z.object({ lemma: z.string(), gloss: z.string() });

function languageOf(lang: string): LanguageConfig | null {
  return getLanguage(lang) ?? null;
}

/**
 * "Don't know this" from the word sheet: the word becomes learning and gets a review card that
 * skips the daily new-word ration (pinned). Words not in the list are added first. For Latin
 * scripts the client sends the dictionary form (text) and the form tapped (form).
 */
lookupRoutes.post('/learn', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { lang?: string; text?: unknown; form?: unknown };
  const lang = body.lang ?? 'zh';
  const language = languageOf(lang);
  if (!language) return c.json({ error: 'unknown language' }, 400);
  const rules = rulesFor(language.script);
  const rawText = typeof body.text === 'string' ? body.text.trim() : '';
  if (!rules.isLookup(rawText)) return c.json({ error: 'not a word' }, 400);
  const text = rules.key(rawText);
  const form = typeof body.form === 'string' && rules.isLookup(body.form.trim()) ? rules.key(body.form.trim()) : null;
  const db = c.env.DB;
  let word = await db.prepare('SELECT id, status FROM words WHERE lang = ?1 AND lemma = ?2').bind(lang, text).first<{ id: number; status: string }>();
  if (!word) {
    const cached = await db.prepare('SELECT gloss FROM gloss_cache WHERE lang = ?1 AND lemma = ?2').bind(lang, form ?? text).first<{ gloss: string }>();
    word = await db
      .prepare(`INSERT INTO words(lang, lemma, reading, gloss, source, status) VALUES (?1, ?2, ?3, ?4, 'manual', 'learning') RETURNING id, status`)
      .bind(lang, text, language.hasRomanisation ? pinyinForWord(text) : null, cached?.gloss ?? null)
      .first<{ id: number; status: string }>();
    if (!word) return c.json({ error: 'write failed' }, 500);
  }
  const now = new Date();
  const card = createEmptyCard(now);
  const stmts = [
    db.prepare("UPDATE words SET status = 'learning' WHERE id = ?1").bind(word.id),
    // A new card, due now and pinned. An existing card (e.g. a known word's) is made due now.
    db
      .prepare(
        `INSERT INTO srs_cards(item_type, item_id, lang, fsrs_state_json, due_at, pinned) VALUES ('word', ?1, ?2, ?3, ?4, 1)
         ON CONFLICT(item_type, item_id) DO UPDATE SET due_at = MIN(due_at, excluded.due_at), pinned = 1`,
      )
      .bind(word.id, lang, JSON.stringify(card), now.toISOString()),
  ];
  if (form && form !== text) stmts.push(db.prepare('INSERT OR IGNORE INTO word_forms(lang, form, lemma) VALUES (?1, ?2, ?3)').bind(lang, form, text));
  await db.batch(stmts);
  invalidateDict(lang);
  return c.json({ ok: true, wordId: word.id, status: 'learning' });
});

lookupRoutes.get('/lookup', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const language = languageOf(lang);
  if (!language) return c.json({ error: 'unknown language' }, 400);
  const rules = rulesFor(language.script);
  const raw = (c.req.query('text') ?? '').trim();
  if (!rules.isLookup(raw)) return c.json({ error: 'not a word' }, 400);
  return language.script === 'han' ? lookupHan(c, lang, raw) : lookupLatin(c, language, rules.key(raw));
});

type Ctx = Context<{ Bindings: Env }>;

/** Mandarin (unchanged): the word itself, its pinyin, gloss and a character breakdown. */
async function lookupHan(c: Ctx, lang: string, text: string) {
  const db = c.env.DB;
  const word = await db.prepare('SELECT id, lemma, reading, gloss, status FROM words WHERE lang = ?1 AND lemma = ?2').bind(lang, text).first<WordRow>();
  const chars = wordChars(text);
  const charRows = chars.length
    ? (
        await db
          .prepare(`SELECT lemma, reading, gloss FROM words WHERE lang = ?1 AND lemma IN (${chars.map((_, i) => `?${i + 2}`).join(',')})`)
          .bind(lang, ...chars)
          .all<{ lemma: string; reading: string | null; gloss: string | null }>()
      ).results
    : [];
  const byChar = new Map(charRows.map((r) => [r.lemma, r]));
  const base = {
    text,
    lemma: null,
    reading: word?.reading || pinyinForWord(text),
    status: word?.status ?? 'unknown',
    wordId: word?.id ?? null,
    chars: chars.map((ch) => ({ char: ch, reading: byChar.get(ch)?.reading || pinyinForWord(ch), gloss: tidy(byChar.get(ch)?.gloss) })),
  };

  // A list gloss cut off at import (e.g. only a bracketed usage note) counts as missing.
  const listGloss = word?.gloss ? tidyListGloss(word.gloss) : null;
  if (listGloss) return c.json({ ...base, gloss: listGloss, glossSource: 'list' });
  const cached = await db.prepare('SELECT gloss FROM gloss_cache WHERE lang = ?1 AND lemma = ?2').bind(lang, text).first<{ gloss: string }>();
  if (cached) return c.json({ ...base, gloss: cached.gloss, glossSource: 'claude' });

  const ctx = contextWindow(c.req.query('context'), text);
  try {
    const res = await callClaude(c.env, {
      role: 'chat',
      system: [promptsFor(lang).gloss],
      messages: [{ role: 'user', content: ctx && ctx !== text ? `Word: ${text}\nSentence: ${ctx}` : `Word: ${text}` }],
      maxTokens: 60,
    });
    const gloss = cleanGloss(res.text);
    if (!gloss) return c.json({ ...base, gloss: null, glossSource: null });
    // Replaces a missing or unusable list gloss, so the next lookup (and review cards) use it.
    if (word) await db.prepare('UPDATE words SET gloss = ?1 WHERE id = ?2').bind(gloss, word.id).run();
    else await db.prepare('INSERT OR IGNORE INTO gloss_cache(lang, lemma, gloss) VALUES (?1, ?2, ?3)').bind(lang, text, gloss).run();
    return c.json({ ...base, gloss, glossSource: 'claude' });
  } catch (e) {
    // Still show pinyin and the character breakdown when Claude is unavailable.
    const { body } = claudeErrorResponse(e);
    return c.json({ ...base, gloss: null, glossSource: null, glossError: body.error });
  }
}

/** Latin script: resolve the form to its dictionary word, then give that word's status and gloss. */
async function lookupLatin(c: Ctx, language: LanguageConfig, form: string) {
  const db = c.env.DB;
  const lang = language.id;
  const wordFor = (lemma: string) => db.prepare('SELECT id, lemma, reading, gloss, status FROM words WHERE lang = ?1 AND lemma = ?2').bind(lang, lemma).first<WordRow>();
  const reply = (lemma: string, word: WordRow | null, gloss: string | null, glossSource: 'list' | 'claude' | null, extra: object = {}) =>
    c.json({ text: form, lemma, reading: null, status: word?.status ?? 'unknown', wordId: word?.id ?? null, chars: [], gloss, glossSource, ...extra });

  // 1. The form is itself a dictionary word in the list.
  const direct = await wordFor(form);
  const directGloss = direct?.gloss ? tidyListGloss(direct.gloss) : null;
  if (directGloss) return reply(form, direct, directGloss, 'list');

  // 2. A form met before: its dictionary word, and the gloss written for the form.
  const cached = await db.prepare('SELECT gloss, base FROM gloss_cache WHERE lang = ?1 AND lemma = ?2').bind(lang, form).first<{ gloss: string; base: string | null }>();
  const mapped = await db.prepare('SELECT lemma FROM word_forms WHERE lang = ?1 AND form = ?2').bind(lang, form).first<{ lemma: string }>();
  const knownLemma = mapped?.lemma ?? cached?.base ?? null;
  if (knownLemma) {
    const w = await wordFor(knownLemma);
    const listGloss = w?.gloss ? tidyListGloss(w.gloss) : null;
    if (cached) return reply(knownLemma, w, cached.gloss, 'claude');
    if (listGloss) return reply(knownLemma, w, listGloss, 'list');
  }

  // 3. New form: Claude names the dictionary word and glosses it in context, once.
  const ctx = contextWindow(c.req.query('context'), form);
  try {
    const out = await callStructured(c.env, {
      role: 'chat',
      system: [promptsFor(lang).gloss],
      messages: [{ role: 'user', content: ctx && ctx !== form ? `Word: ${form}\nSentence: ${ctx}` : `Word: ${form}` }],
      maxTokens: 300,
      schema: LemmaGloss,
    });
    const rules = rulesFor(language.script);
    const lemma = rules.isLookup(out.lemma.trim()) ? rules.key(out.lemma.trim()) : form;
    const gloss = cleanGloss(out.gloss);
    await db.batch([
      // gloss_cache is keyed by the form looked up; base is its dictionary word.
      db.prepare('INSERT INTO gloss_cache(lang, lemma, gloss, base) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(lang, lemma) DO UPDATE SET gloss = excluded.gloss, base = excluded.base').bind(lang, form, gloss || '—', lemma),
      ...(lemma !== form ? [db.prepare('INSERT OR IGNORE INTO word_forms(lang, form, lemma) VALUES (?1, ?2, ?3)').bind(lang, form, lemma)] : []),
    ]);
    const w = await wordFor(lemma);
    if (w && lemma !== form) invalidateDict(lang); // the form now resolves in annotations
    return reply(lemma, w, gloss || null, gloss ? 'claude' : null);
  } catch (e) {
    const { body } = claudeErrorResponse(e);
    return reply(form, direct, null, null, { glossError: body.error });
  }
}
