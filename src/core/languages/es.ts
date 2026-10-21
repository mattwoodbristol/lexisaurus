import type { LanguageConfig } from './types';

export const es: LanguageConfig = {
  id: 'es',
  name: 'Spanish',
  nativeName: 'Español',
  script: 'latin',
  markUnknownWords: false,
  autoAddUnknownWords: false,
  todayTitle: 'Hoy · Today',
  doneTitle: '¡Listo por hoy!',
  freeChatTitle: 'Charla libre',
  chatPlaceholder: 'Escribe algo…',
  speechRecognitionLang: 'es-ES',
  ttsLang: 'es-ES',
  hasRomanisation: false,
  // Until a level check is taken (it then replaces this line in every prompt).
  userLevel:
    'Not yet assessed; assume a lower-intermediate adult learner (about A2-B1) until a level check is taken. ' +
    'Keep to common vocabulary and present, past and near-future tenses unless the learner shows more.',
  tutorStyle:
    "Friendly, relaxed Spanish conversation partner. Natural speech pitched just above the learner's level, " +
    'everyday expressions where they fit, and clear, gentle corrections.',
  correctionStyle: 'inline-full-sentence',
  conversationLanguageRule:
    'Speak Spanish (European Spanish by default; follow the learner if they use Latin American forms) throughout. ' +
    'Brief English only if the learner asks for an explanation of a grammar point or expression.',
};
