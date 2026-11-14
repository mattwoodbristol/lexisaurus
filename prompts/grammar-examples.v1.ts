// New example sentences for grammar cards in reviews, v1 (2026-10-30). Cheap model, batched,
// cached: a grammar card shows an example it has not shown before, so the review practises the
// point on new sentences rather than repeating the lesson's.
export const grammarExamplesPrompt = (langName: string, latin: boolean, perPoint: number) => `You write example sentences for a ${langName} learner's grammar reviews.

For each grammar point (its title and a summary are given), write ${perPoint} different natural sentences that use the point, each with its English translation in "en". Put the ${langName} sentence in the "zh" field (the app's field for the target-language sentence)${latin ? ', and in "form" the words that carry the point, as spelled in the sentence' : ''}.

Rules:
- The grammar point's own words (its particles, function words and pattern) are the only ones that may be new. Every other word must come from the list of words the learner knows (given with the points), or, where no list is given, the most common beginner words.
- ${latin ? '4 to 10 words' : '6 to 14 Chinese characters'}. Everyday situations; vary the topics and the sentence shapes, so the ${perPoint} sentences show the point in different uses.
- The sentence must show the point clearly: a reader should see how it works from the sentence and its English.
- The English must be a plain, literal translation.${latin ? '' : '\n- Hanzi only in the "zh" field. Never write pinyin or tone numbers.'}
- Return ${perPoint} items per grammar point, each with "word" set to the grammar point's title, copied exactly.`;
