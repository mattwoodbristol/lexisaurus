// Which language explanations are written in: grammar explanations, key points, error notes, chat
// hints, correction notes and marking feedback. Setting <lang>.explain_in:
//   auto    the language being learnt once the learner reaches EXPLAIN_FROM_BAND (B1 / HSK 3),
//           measured by the level check, else from the language's described level
//   target  always the language being learnt
//   native  always the learner's own language
// Example translations and drill prompts stay in the learner's own language either way; the app's
// translate (and pinyin) buttons cover the explanations.
import { bandLabel, parseBand } from './assessment/levels';
import type { Script } from './languages/types';

export type ExplainSetting = 'auto' | 'target' | 'native';
export const EXPLAIN_SETTINGS: ExplainSetting[] = ['auto', 'target', 'native'];
export const EXPLAIN_FROM_BAND = 3;
/** Chat corrections are read in the flow of a conversation, so they switch later (B2 / HSK 4). */
export const CORRECT_FROM_BAND = 4;

export function isExplainSetting(x: unknown): x is ExplainSetting {
  return typeof x === 'string' && (EXPLAIN_SETTINGS as string[]).includes(x);
}

/**
 * The learner's band for this decision. Reading an explanation needs the vocabulary as much as the
 * grammar, so the weaker of the two measured bands counts; without a level check, the described level.
 */
export function learnerBand(measured: { grammar: number | null; vocab: number | null } | null, describedLevel: string): number | null {
  const bands = [measured?.grammar, measured?.vocab].filter((b): b is number => typeof b === 'number');
  return bands.length ? Math.min(...bands) : parseBand(describedLevel);
}

export function explainInTarget(setting: unknown, band: number | null, fromBand = EXPLAIN_FROM_BAND): boolean {
  if (setting === 'target') return true;
  if (setting === 'native') return false;
  return band !== null && band >= fromBand;
}

export interface ExplainLanguage {
  /** True: explanations in the language being learnt. */
  target: boolean;
  /** Language code of explanations (target language id, or the native code). */
  code: string;
  /** English name of that language, for prompts. */
  name: string;
  /** The instruction for any prompt that writes explanations. */
  instruction: string;
}

export function explainLanguage(opts: {
  target: boolean;
  lang: string;
  langName: string;
  script: Script;
  band: number | null;
  nativeCode: string;
  nativeName: string;
}): ExplainLanguage {
  const { target, lang, langName, script, band, nativeCode, nativeName } = opts;
  if (!target)
    return { target, code: nativeCode, name: nativeName, instruction: `Explanation language: write explanations, notes and feedback in ${nativeName}.` };
  const level = band ? bandLabel(lang, band) : 'their level';
  const style =
    script === 'han'
      ? `simple ${langName} the learner can read at ${level}: short sentences and common words, simplified characters only and no pinyin (the app adds pinyin and translations). Short grammar terms are fine (动词, 形容词, 句子)`
      : `clear, natural ${langName} pitched at ${level}, using the usual ${langName} grammar terms (the app offers a translation)`;
  return {
    target,
    code: lang,
    name: langName,
    instruction: `Explanation language: write explanations, notes and feedback in ${style}. Keep translations of example sentences in ${nativeName}.`,
  };
}
