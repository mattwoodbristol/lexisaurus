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
Keep what was right in the original where you can, and keep the lesson's level. The ${langName} must be natural and correct. Never write romanisation (pinyin) in a ${langName} field. With no lesson, or nothing to rewrite, every fix field is null.`;
