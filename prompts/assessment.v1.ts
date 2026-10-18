// Level check prompts, v1 (2026-10-06). Generic: the language and its band names are filled in.

/** Bands as the model should read them: "1 = HSK 1 ... 6 = HSK 6 or above" or CEFR A1..C2. */
export function bandScale(lang: string): string {
  return lang === 'zh'
    ? 'bands 1-6 = HSK 1, HSK 2, HSK 3, HSK 4, HSK 5, HSK 6 and above'
    : 'bands 1-6 = CEFR A1, A2, B1, B2, C1, C2';
}

export function assessWordsPrompt(language: string, lang: string): string {
  return `You prepare the vocabulary part of a level check for a learner of ${language} (${bandScale(lang)}).

1. pseudowords: exactly the number asked for of made-up items that LOOK like real ${language} words of mid difficulty but are not words in ${language}${lang === 'zh' ? ' (two simplified characters that do not form a word)' : ' (plausible spelling and endings, not a real word or a typo of one)'}. They catch guessing, so they must not be real words.
2. fillers: for each band asked for, the number of common, unambiguous ${language} words typical of that band, each with a short English gloss (at most 6 words). For bands 5-6, choose words an educated native speaker uses (literary, formal or idiomatic), never technical, scientific or specialist terms. Avoid the excluded words.${lang === 'zh' ? ' Simplified characters only, no pinyin.' : ' Dictionary form.'}`;
}

export function grammarBankPrompt(language: string, lang: string): string {
  return `You write the grammar part of an adaptive level check for an adult English-speaking learner of ${language} (${bandScale(lang)}).

Write 6 multiple-choice questions for each band 1 to 6 (36 in all). Each question:
- prompt: an English meaning to express, or a ${language} sentence with a gap shown as ___ followed by its English meaning in brackets.
- options: 3 ${language} answers (whole sentences, or the word or phrase for the gap). Exactly one is correct; the others are mistakes a learner at that band typically makes with that structure.
- answer: 0-based index of the correct option; vary its position.
- topic: the grammar point in two or three English words (e.g. "past perfect", "measure words", "subjunctive").
Each band tests structures typical of that band, harder than the band below, with vocabulary from that band or below so grammar is what is tested.${lang === 'zh' ? ' Chinese in simplified characters only, never pinyin.' : ''}`;
}

export function writingPrompt(lang: string, band: number): string {
  if (band <= 2) return 'Describe your home and the people you live with.';
  if (band <= 4) return 'Tell me about a trip or a weekend you enjoyed: where you went, what happened, and why you liked it.';
  return 'Some people think working from home is better than working in an office. What do you think, and why?';
}

export function assessWritingPrompt(language: string, lang: string): string {
  return `You assess a short piece of writing by an adult learner of ${language} for a level check (${bandScale(lang)}).

Return:
- band: the band (1-6) this writing shows, judging grammar range and accuracy, vocabulary and fluency together. Short but accurate writing at a level still counts for that level.
- comment: two short English sentences addressed to the learner as "you": what the writing shows you can do, and the main thing holding it back.
- errors: up to 6 real mistakes, each with the learner's wrong phrase, the right version and a short English note. Ignore typos${lang === 'zh' ? '' : ' and missing accents'}.`;
}


/** Sort my words: meanings for list words that have none, so they can go on the matching board. */
export function sortGlossPrompt(language: string): string {
  return `You give short English meanings for ${language} dictionary words, for a matching game. For each word, return the word exactly as given and its most common meaning in at most 5 English words (e.g. "to eat", "teacher", "because"). No pinyin, no quotes, no grammar labels. For a name, say so (e.g. "Beijing (city)").`;
}

/** Second opinion on made-up words: any that are real get dropped, so knowing them never counts against the learner. */
export function pseudoCheckPrompt(language: string): string {
  return `You check a list of supposedly made-up words for a ${language} vocabulary test. Return in "real" every item that you are sure IS a real ${language} word or a real form of one (inflected forms, rare or old-fashioned words, abbreviations and proper names count). Do not include items that only look or sound like real words.`;
}
