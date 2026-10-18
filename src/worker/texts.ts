// Short explanatory texts (chat hints, correction notes, marking feedback) written in the
// language being learnt: pinyin / tap-to-translate annotations, and the translate button.
import { Hono } from 'hono';
import type { Env } from './env';
import { callClaude, claudeErrorResponse } from './claude';
import { annotateStrings } from './annotate';
import { getLanguage } from '../core/languages';
import { DEFAULT_NATIVE, nativeLanguage } from '../core/languages/native';
import { getSetting } from './day';
import { explainFor } from './explain';
import { translatePrompt } from '../../prompts/translate.v1';
import { promptsFor } from '../../prompts/languages';

export const textRoutes = new Hono<{ Bindings: Env }>();

const texts = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 1000).slice(0, 50) : []);

/** Annotations (pinyin, tappable words) for texts in the language being learnt. */
textRoutes.post('/annotate', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { lang?: unknown; texts?: unknown };
  const lang = typeof body.lang === 'string' && getLanguage(body.lang) ? body.lang : null;
  if (!lang) return c.json({ error: 'unknown language' }, 400);
  return c.json({ annotations: await annotateStrings(c.env.DB, lang, texts(body.texts)) });
});

/** One short text into the learner's own language (cached). */
textRoutes.post('/translate', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { lang?: unknown; text?: unknown };
  const lang = typeof body.lang === 'string' && getLanguage(body.lang) ? body.lang : null;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!lang || !text || text.length > 1000) return c.json({ error: 'lang and text required' }, 400);
  const native = nativeLanguage(await getSetting<unknown>(c.env.DB, 'native_lang', DEFAULT_NATIVE));
  const hit = await c.env.DB.prepare('SELECT translation FROM text_translations WHERE text = ?1 AND to_lang = ?2').bind(text, native.code).first<{ translation: string }>();
  if (hit) return c.json({ translation: hit.translation, lang: native.code });
  try {
    const res = await callClaude(c.env, { role: 'chat', system: [translatePrompt(native.english, promptsFor(lang).name)], messages: [{ role: 'user', content: text }], maxTokens: 400 });
    const translation = res.text.trim();
    await c.env.DB.prepare('INSERT OR REPLACE INTO text_translations(text, to_lang, translation) VALUES (?1, ?2, ?3)').bind(text, native.code, translation).run();
    return c.json({ translation, lang: native.code });
  } catch (e) {
    const { status, body: err } = claudeErrorResponse(e);
    return c.json(err, status);
  }
});

/** Which language explanations are in for a study language (settings + level check). */
textRoutes.get('/explain', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  if (!getLanguage(lang)) return c.json({ error: 'unknown language' }, 400);
  const e = await explainFor(c.env.DB, lang);
  return c.json({ target: e.target, code: e.code });
});
