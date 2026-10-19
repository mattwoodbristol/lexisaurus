// Proofreading generated material before a learner sees it: a second, careful pass by a stronger
// model, which corrects what the writer got wrong and changes nothing else.

/** Example sentences for vocabulary reviews (one per target word). */
export const proofreadSentencesPrompt = (langName: string, latin: boolean) => `You proofread example sentences written for a ${langName} learner's vocabulary reviews, before the learner sees them. In each item, "word" is the target word, "zh" the ${langName} sentence (whatever the language) and "en" its English translation${latin ? ', and "form" the target word exactly as it appears in the sentence' : ''}.

Check each item and correct it where needed:
- The ${langName} must be natural and grammatically correct, as a native speaker would say it.
- The English must be an accurate, natural translation of it.
- The target word must appear exactly as given${latin ? ' ("form" must match the sentence exactly)' : ''}, used in its common meaning, and the sentence must make that meaning clear.
- The target must be the ONLY word the learner might not know. Apart from it, the sentence may use only words from the list of words the learner knows (and the most basic words: pronouns, numbers, very common particles). Rewrite the sentence with known words if it uses any other word, including any listed as a problem.
- 6 to 16 ${latin ? 'words' : 'characters'}.${latin ? '' : ' Hanzi only: never pinyin or tone numbers.'}

Return every item, corrected or unchanged, with "word" copied exactly. Change only what is wrong.`;

/** A whole generated lesson, practice sets included. */
export const proofreadLessonPrompt = (langName: string) => `You proofread a ${langName} lesson written for one learner, before they see it. It is JSON. Fields named "zh" hold ${langName} (whatever the language) and "en" English; "wrong" holds a deliberately wrong ${langName} sentence and "right" its correction.

Check everything and correct what is wrong:
- Every ${langName} sentence (examples, drills, errors, options, check items) is natural and grammatically correct, except the "wrong" sentences, which must be wrong in exactly the way their note says, and the wrong options in multiple choice.
- Every translation is accurate.
- The examples and drills all actually use the lesson's pattern (the "pattern" field and the explanation). Replace any that do not.
- Multiple choice: exactly one option is correct, "answer" is its 0-based index, and the other options are wrong because of this lesson's point, not by accident.
- The explanation, key points and grammar summaries are accurate.

Keep the lesson's title, level, structure, item counts and style. Change only what is wrong, and return the whole lesson in the same shape, with "changes" listing each correction in a few words (empty if none).`;
