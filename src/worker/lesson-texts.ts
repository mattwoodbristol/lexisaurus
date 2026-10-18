// A lesson's explanations in another language: the language being learnt (setting
// <lang>.explain_in) or the learner's own (the translate button). Written once with Sonnet and
// stored in lesson_texts until the lesson's text changes.
import { z } from 'zod';
import type { Env } from './env';
import { callStructured } from './claude';
import { annotateStrings } from './annotate';
import { explainFor } from './explain';
import { getLanguage } from '../core/languages';
import { nativeLanguage } from '../core/languages/native';
import { stripPinyin } from '../core/pinyin/strip';
import { explanationParts, partStrings, partsHash, sameShape, type ExplanationParts } from '../core/lessons/explanation-parts';
import type { LessonContent } from '../core/lessons/types';
import type { Token } from '../core/pinyin/annotate';

const Parts = z.object({
  explanation: z.array(z.string()),
  keyPoints: z.array(z.string()),
  errorNotes: z.array(z.string().nullable()),
  grammarSummaries: z.array(z.string()),
  checkNotes: z.array(z.string().nullable()),
});

export interface LessonTexts {
  lang: string;
  parts: ExplanationParts;
  annotations: Record<string, Token[]>;
}

/** The language a lesson's explanations were written in (all lessons before 0019: English). */
export const originalExplainLang = (row: { explain_lang?: string | null }) => row.explain_lang ?? 'en';

export async function lessonTextsIn(env: Env, row: { id: number; lang: string; content_json: string; explain_lang?: string | null }, to: string): Promise<LessonTexts> {
  const content = JSON.parse(row.content_json) as LessonContent;
  const original = explanationParts(content);
  const language = getLanguage(row.lang) ?? getLanguage('zh')!;
  const annotate = async (p: ExplanationParts) => (to === row.lang ? annotateStrings(env.DB, row.lang, partStrings(p)) : {});
  if (to === originalExplainLang(row)) return { lang: to, parts: original, annotations: await annotate(original) };

  const hash = partsHash(original);
  const cached = await env.DB.prepare('SELECT parts_json, source_hash FROM lesson_texts WHERE lesson_id = ?1 AND lang = ?2').bind(row.id, to).first<{ parts_json: string; source_hash: string }>();
  if (cached && cached.source_hash === hash) {
    const parts = JSON.parse(cached.parts_json) as ExplanationParts;
    return { lang: to, parts, annotations: await annotate(parts) };
  }

  const fromName = originalExplainLang(row) === row.lang ? language.name : nativeLanguage(originalExplainLang(row)).english;
  const shape = 'Return the same structure: the same number of items in each list, in the same order, null where the original is null. Keep every quoted example word or sentence in the language being learnt exactly as it is.';
  const system =
    to === row.lang
      ? `You rewrite the explanatory text of a ${language.name} grammar lesson (written in ${fromName}) in ${language.name}, for the learner to read. ${(await explainFor(env.DB, row.lang)).instruction} Say the same things; do not add or drop points. ${shape}`
      : `You translate the explanatory text of a ${language.name} grammar lesson from ${fromName} into ${nativeLanguage(to).english}, plainly and accurately. ${shape}`;
  const out = await callStructured(env, {
    role: 'checking',
    effort: 'low',
    system: [system],
    messages: [{ role: 'user', content: JSON.stringify(original) }],
    maxTokens: 6000,
    schema: Parts,
    extraCheck: (v) => (sameShape(original, v) ? [] : ['the lists must have the same lengths as the original, with nulls in the same places']),
  });
  const clean = (s: string | null) => (s === null || s === '' ? null : to === 'zh' && language.hasRomanisation ? stripPinyin(s).trim() : s.trim());
  const parts: ExplanationParts = {
    explanation: out.explanation.map((s) => clean(s) ?? ''),
    keyPoints: out.keyPoints.map((s) => clean(s) ?? ''),
    errorNotes: out.errorNotes.map(clean),
    grammarSummaries: out.grammarSummaries.map((s) => clean(s) ?? ''),
    checkNotes: out.checkNotes.map(clean),
  };
  await env.DB.prepare(
    'INSERT INTO lesson_texts(lesson_id, lang, source_hash, parts_json) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(lesson_id, lang) DO UPDATE SET source_hash = excluded.source_hash, parts_json = excluded.parts_json',
  )
    .bind(row.id, to, hash, JSON.stringify(parts))
    .run();
  return { lang: to, parts, annotations: await annotate(parts) };
}
