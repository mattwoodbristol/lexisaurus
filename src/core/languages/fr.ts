import type { LanguageConfig } from './types';

export const fr: LanguageConfig = {
  id: 'fr',
  name: 'French',
  nativeName: 'Français',
  script: 'latin',
  markUnknownWords: false,
  autoAddUnknownWords: false,
  todayTitle: "Aujourd'hui · Today",
  doneTitle: "C'est fait pour aujourd'hui !",
  freeChatTitle: 'Discussion libre',
  chatPlaceholder: 'Écris quelque chose…',
  speechRecognitionLang: 'fr-FR',
  ttsLang: 'fr-FR',
  hasRomanisation: false,
  // Until a level check is taken (it then replaces this line in every prompt).
  userLevel:
    'Not yet assessed; assume a lower-intermediate adult learner (about A2-B1) until a level check is taken. ' +
    'Keep to common vocabulary and present, passé composé and near-future tenses unless the learner shows more.',
  tutorStyle:
    "Friendly, relaxed French conversation partner. Natural spoken French pitched just above the learner's level, " +
    'everyday expressions where they fit, and clear, gentle corrections.',
  correctionStyle: 'inline-full-sentence',
  conversationLanguageRule:
    'Speak French throughout. Brief English only if the learner asks for an explanation of a grammar point or expression.',
};
