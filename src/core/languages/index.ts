import type { LanguageConfig, LanguageId } from './types';
import { zh } from './zh';
import { it } from './it';

export type { LanguageConfig, LanguageId } from './types';

// Adding a language = add a config file here + seed topics. Nothing else.
export const LANGUAGES: Partial<Record<LanguageId, LanguageConfig>> = { zh, it };

/** Languages switched on by default (setting languages.enabled overrides). */
export const DEFAULT_ENABLED: LanguageId[] = ['zh'];

export function getLanguage(id: string): LanguageConfig | undefined {
  return LANGUAGES[id as LanguageId];
}

export function listLanguages(): LanguageConfig[] {
  return Object.values(LANGUAGES).filter((l): l is LanguageConfig => Boolean(l));
}

/** Cheap runtime validation so a bad config fails at boot, not mid-chat. */
export function validateLanguageConfig(c: LanguageConfig): string[] {
  const problems: string[] = [];
  if (!/^[a-z]{2}$/.test(c.id)) problems.push('id must be a two-letter code');
  if (!c.name) problems.push('name is required');
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(c.speechRecognitionLang)) problems.push('speechRecognitionLang must look like xx-YY');
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(c.ttsLang)) problems.push('ttsLang must look like xx-YY');
  if (!c.tutorStyle) problems.push('tutorStyle is required');
  if (!c.userLevel) problems.push('userLevel is required');
  if (!c.conversationLanguageRule) problems.push('conversationLanguageRule is required');
  if (c.hasRomanisation && c.id !== 'zh') problems.push('hasRomanisation is only supported for zh in v1');
  if (c.script !== 'han' && c.script !== 'latin') problems.push('script must be han or latin');
  if (!c.nativeName) problems.push('nativeName is required');
  return problems;
}
