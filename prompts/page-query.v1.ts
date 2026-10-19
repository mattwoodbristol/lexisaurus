// "Query this page": the learner thinks something on a screen of the app is wrong. Checked with a
// stronger model; on a lesson it may rewrite the faulty sections.
export const pageQueryPrompt = (langName: string) => `A learner of ${langName} is using a language-learning app and thinks something on the screen they are looking at is wrong: incorrect ${langName}, a wrong translation or meaning, or content that does not fit what it claims to teach. Check it carefully and impartially.

You get the screen's name, the text on the screen, the learner's note on what looks wrong and, on a lesson, the lesson's full content as JSON. In that JSON the field "zh" holds ${langName} (whatever the language), and "en" holds English.

contentWrong: true only if there is a real problem a teacher would fix. Do not simply agree with the learner; if the content is right, say why.

explanation: two to four short sentences for the learner, in the explanation language given below, specific about the language point.

fix: only on a lesson, and only when contentWrong. Rewrite the sections that are at fault, each complete, so it can replace the original, and set the others to null:
- examples: at least 2 example sentences that all use the lesson's pattern, each with an English translation.
- drills: at least 8 translation drills (English prompt, ${langName} answer) that all practise the lesson's pattern.
- keyPoints, explanation: only if they are wrong themselves.
- errors (common errors: a wrong sentence, its correction and a note), recognise (quick multiple-choice questions) and check (the lesson check, which reviews also quiz from): when any item in one is faulty, return that whole list with the faulty items fixed and the rest unchanged, the same number of items. A "fix" item's wrong sentence must really contain the mistake the lesson is about; a choice item has exactly one correct option, and "answer" is its 0-based index. For check items, fill in the fields their kind uses (choice: prompt, options, answer; translate: en, zh; fix: wrong, right, note) and set the others to null.
On a review card you may also get the word being practised (with the meaning from the learner's word list) and the card's example sentence (its "target" is the word as it appears in the sentence, the answer a fill-in-the-blank card asks for):
- wordGloss: when the word's meaning is wrong or misleading for how it is used (for example only a rare sense, or the wrong part of speech), a short corrected meaning in English, most useful sense first, like a dictionary entry ("measure word for songs and poems; head"); otherwise null.
- sentence: when the example sentence is wrong, unnatural, mistranslated, uses the word in another sense than its meaning, or tests the wrong answer, a corrected sentence: "zh" the ${langName} sentence (whatever the language), "en" its translation, "target" the word exactly as it appears in it, the answer the blank asks for; otherwise null. Keep it short and simple, with the word as the only less common word.
Leave both null when there is no word or sentence, or nothing wrong with them.

Keep what was right in the original where you can, and keep the lesson's level. The ${langName} must be natural and correct. Never write romanisation (pinyin) in a ${langName} field. With no lesson, or nothing to rewrite, every fix field is null.`;
