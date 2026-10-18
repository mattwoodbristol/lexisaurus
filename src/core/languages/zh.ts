import type { LanguageConfig } from './types';

export const zh: LanguageConfig = {
  id: 'zh',
  name: 'Mandarin Chinese',
  nativeName: '中文',
  script: 'han',
  markUnknownWords: true,
  autoAddUnknownWords: true,
  todayTitle: '今天 · Today',
  doneTitle: '今天的练习完成了！',
  freeChatTitle: '自由聊天',
  chatPlaceholder: '说点什么…',
  speechRecognitionLang: 'zh-CN',
  ttsLang: 'zh-CN',
  hasRomanisation: true,
  userLevel: 'HSK 2-3 vocabulary; grammar is the gap. Re-running the 20-lesson grammar course from Lesson 1.',
  tutorStyle:
    'Patient, natural Mandarin tutor. Lesson format is grammar, then drills, then conversation. ' +
    'Keep sentences level-appropriate and recycle vocabulary the learner already knows.',
  correctionStyle: 'end-of-turn',
  conversationLanguageRule:
    'Speak Mandarin (simplified Hanzi only). Never write pinyin or romanisation of any kind; the app adds it. ' +
    'Grammar explanations follow the explanation language given below.',
};
