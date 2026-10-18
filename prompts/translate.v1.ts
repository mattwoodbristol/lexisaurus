// One-shot translation prompt for the translate button / 'e' shortcut, into the learner's own
// language (setting native_lang, default English).
export const TRANSLATE_V1 = `Translate the following Mandarin Chinese message into natural English for a learner. Output only the English translation, nothing else. Keep any English that is already in the message as it is.`;

/** @param source English name of the language being learned (default Mandarin Chinese). */
export function translatePrompt(targetEnglishName: string, source = 'Mandarin Chinese'): string {
  if (targetEnglishName === 'English' && source === 'Mandarin Chinese') return TRANSLATE_V1;
  if (targetEnglishName === 'English')
    return `Translate the following ${source} message into natural English for a learner. Output only the English translation, nothing else. Keep any English that is already in the message as it is.`;
  return `Translate the following ${source} message into natural ${targetEnglishName} for a learner. Output only the ${targetEnglishName} translation, nothing else. Translate any English in the message into ${targetEnglishName} too.`;
}
