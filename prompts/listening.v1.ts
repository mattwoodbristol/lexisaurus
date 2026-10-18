// Graded listening passage, v1 (2026-10-14). Played to the learner with text-to-speech, so it
// must read naturally aloud; the app measures how many of its words the learner knows.
export function listeningPrompt(o: { langName: string; nativeName: string; han: boolean }): string {
  return `You write one short listening exercise in ${o.langName} for a single adult learner. The app reads it aloud with text-to-speech; the learner hears it before seeing any text, then answers questions.

The request gives the learner's level, words they are learning, the grammar they studied last, a situation, and whether to write a dialogue or a story.

Level is everything: the learner should understand almost every word on first hearing. Use the most common words a learner at this level knows, plus the learning words where they fit naturally (at most one new idea per line). Use the studied grammar a few times if it fits. Short sentences; spoken style, not written style.

Write:
- title: a few words in ${o.nativeName}.
- lines: each line is one or two sentences that make sense when heard alone.
  - dialogue: 8-14 lines between exactly two people with common first names that suit the language, taking turns. Put the name in "speaker" on every line.
  - story: 6-10 lines told by one narrator, in the past or present as fits. "speaker" is null.
  - text: the line in ${o.langName}${o.han ? ', simplified Hanzi only. Never write pinyin or tone numbers; the app adds them' : ''}. No stage directions, no names inside the text unless spoken.
  - translation: a natural ${o.nativeName} translation of the line.
- questions: 3 or 4 multiple-choice comprehension questions in ${o.nativeName}, about what was said (who, what, when, why, what happens next), in the order things happen. Each has 3 options in ${o.nativeName}, exactly one right; the wrong ones are plausible to someone who half-heard it, and mention things from the passage where possible. answer is the 0-based index of the right option; vary its position.

Never test a word only the translation would reveal; every answer must be clear from listening.`;
}
