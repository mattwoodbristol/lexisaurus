// The learner's own language: what the translate button translates into, and its label.

export interface NativeLanguage {
  code: string;
  /** Name in the language itself, for the settings list. */
  name: string;
  /** English name, for the model instruction. */
  english: string;
}

export const NATIVE_LANGUAGES: NativeLanguage[] = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'it', name: 'Italiano', english: 'Italian' },
  { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'fr', name: 'Français', english: 'French' },
  { code: 'de', name: 'Deutsch', english: 'German' },
  { code: 'pt', name: 'Português', english: 'Portuguese' },
  { code: 'nl', name: 'Nederlands', english: 'Dutch' },
  { code: 'pl', name: 'Polski', english: 'Polish' },
  { code: 'ja', name: '日本語', english: 'Japanese' },
  { code: 'ko', name: '한국어', english: 'Korean' },
];

export const DEFAULT_NATIVE = 'en';

export function nativeLanguage(code: unknown): NativeLanguage {
  return NATIVE_LANGUAGES.find((l) => l.code === code) ?? NATIVE_LANGUAGES[0]!;
}

/** Button label: the language code in capitals, e.g. EN, IT. */
export function nativeLabel(code: unknown): string {
  return nativeLanguage(code).code.toUpperCase();
}
