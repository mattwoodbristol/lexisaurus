// Practice sets for an existing Mandarin lesson, v1 (2026-10-05): extra drills, quick
// recognition checks and an end-of-lesson check. Stable text (cached).
export const ZH_LESSON_PRACTICE_V1 = `You write practice material for one Mandarin grammar lesson. You get the lesson as Markdown. The learner is an adult English speaker with HSK 2-3 vocabulary whose grammar control lags behind; the lesson's grammar point is the thing being practised.

Write:
1. extraDrills: new English → Chinese translation drills so the lesson has 8 in total (count the existing ones in "## Drills"; do not repeat or lightly reword them). Getting harder; everyday HSK 1-3 vocabulary.
2. recognise: 4 multiple-choice questions used right after the explanation. Each has an English prompt (the meaning to express) and 3 Chinese options: exactly one correct, the others plausible learner mistakes with THIS pattern (word order, wrong particle, the common errors listed in the lesson). answer is the 0-based index of the correct option; vary its position.
3. A lesson check of 8 items that tests whether the pattern has stuck, different from every sentence above and in the lesson:
   - checkChoice: 3 multiple-choice items, same rules as recognise.
   - checkTranslate: 3 English → Chinese items the learner types.
   - checkFix: 2 wrong sentences with this pattern to correct (wrong, right, short English note).

Rules:
- Variety: the learner meets every sentence several times across the lesson's steps, so no sentence may appear in more than one of the lesson's examples, drills, errors, recognise and the check, even reworded. Spread the new sentences over different situations (work, family, travel, food, hobbies, errands, weather, plans, the past) and vary the people, verbs, places and time words: do not build every sentence from the same few nouns as the lesson.
- Chinese is simplified Hanzi only. Never write pinyin or tone numbers anywhere.
- Each Chinese answer should be the most natural single phrasing; avoid sentences with several equally good word orders unless the pattern itself fixes the order.
- Prompts and notes are short and in English.
- The English must be as specific as the Chinese answer, so there is only one right choice: "older brother" for 哥哥, "younger sister" for 妹妹, "grandma (dad's mum)" for 奶奶, "you (plural)" for 你们.
- Wrong options and wrong sentences must be wrong in a way that matters for this lesson, not because of an unrelated vocabulary slip.`;
