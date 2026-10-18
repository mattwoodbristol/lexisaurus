// The explanation language for a study language, from settings and the level check.
import { CORRECT_FROM_BAND, explainInTarget, explainLanguage, learnerBand, type ExplainLanguage } from '../core/explain';
import { getLanguage } from '../core/languages';
import { DEFAULT_NATIVE, nativeLanguage } from '../core/languages/native';
import { getSetting } from './day';
import { levelCheck } from './level';

/** The explanation language, plus the one for chat corrections (which switch to the target later). */
export async function explainFor(db: D1Database, lang: string): Promise<ExplainLanguage & { corrections: ExplainLanguage }> {
  const config = getLanguage(lang) ?? getLanguage('zh')!;
  const [setting, measured, nativeCode] = await Promise.all([getSetting<unknown>(db, `${lang}.explain_in`, 'auto'), levelCheck(db, lang), getSetting<unknown>(db, 'native_lang', DEFAULT_NATIVE)]);
  const band = learnerBand(measured, config.userLevel);
  const native = nativeLanguage(nativeCode);
  const common = { lang, langName: config.name, script: config.script, band, nativeCode: native.code, nativeName: native.english };
  return {
    ...explainLanguage({ target: explainInTarget(setting, band), ...common }),
    corrections: explainLanguage({ target: explainInTarget(setting, band, CORRECT_FROM_BAND), ...common }),
  };
}
