export type LanguageId = 'zh' | 'it' | 'es' | 'fr';

/** How the language is written: decides word splitting, answer comparison and what can be tapped. */
export type Script = 'han' | 'latin';

export interface LanguageConfig {
  id: LanguageId;
  name: string;
  /** The language's own name, for the language switcher (e.g. 中文, Italiano). */
  nativeName: string;
  script: Script;
  /**
   * Underline words that are not in the word list at all. Right for a beginner-to-intermediate
   * list (Mandarin); noise for an advanced learner whose list holds only harder words (Italian).
   */
  markUnknownWords: boolean;
  /** Add words met in chat that are not in the list as learning (needs reliable segmentation). */
  autoAddUnknownWords: boolean;
  /** Heading on the home screen. */
  todayTitle: string;
  /** Banner when the day's session is done, in the language. */
  doneTitle: string;
  /** Title of a chat with no topic. */
  freeChatTitle: string;
  /** Chat input placeholder ("say something"), in the language. */
  chatPlaceholder: string;
  /** BCP 47 tag for the browser SpeechRecognition API, e.g. 'zh-CN'. */
  speechRecognitionLang: string;
  /** BCP 47 tag for speechSynthesis voice selection. */
  ttsLang: string;
  /** True only for languages whose script needs a reading aid (zh -> pinyin). */
  hasRomanisation: boolean;
  /** Prompt fragment describing how the tutor should behave. */
  tutorStyle: string;
  /** Free-text level description passed to the model, e.g. 'HSK 2-3'. */
  userLevel: string;
  correctionStyle: 'inline-full-sentence' | 'end-of-turn' | 'none';
  /** Prompt fragment: which language the tutor speaks, and when it may switch. */
  conversationLanguageRule: string;
}
