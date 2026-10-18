import type { LanguageConfig } from './types';

export const it: LanguageConfig = {
  id: 'it',
  name: 'Italian',
  nativeName: 'Italiano',
  script: 'latin',
  markUnknownWords: false,
  autoAddUnknownWords: false,
  todayTitle: 'Oggi · Today',
  doneTitle: 'Fatto per oggi!',
  freeChatTitle: 'Chiacchierata libera',
  chatPlaceholder: 'Scrivi qualcosa…',
  speechRecognitionLang: 'it-IT',
  ttsLang: 'it-IT',
  hasRomanisation: false,
  // Until a level check is taken (it then replaces this line in every prompt).
  userLevel:
    'Upper-intermediate (about B1-B2): finished a 20-lesson grammar course and 8 of 20 advanced lessons on idioms, ' +
    "family and children's language. Recurring slips: articles and gender, prepositions, the position of anche, " +
    'stare + gerundio, participle agreement with object pronouns. Has imported C1-C2 material (collocations, subjunctive, implicit clauses) to work towards.',
  tutorStyle:
    "Warm, quick-witted Italian conversation partner. Natural speech pitched just above the learner's level, " +
    'idioms and register where they fit, and gentle precision about nuance.',
  correctionStyle: 'inline-full-sentence',
  conversationLanguageRule:
    'Speak Italian throughout. Brief English only if the learner asks for an explanation of a grammar point or idiom.',
};
