// Review story writer, v3 (2026-10-21): a review set's example sentences as one short story, with
// linking lines that test nothing. Stronger model, premise first; proofread afterwards.
export const storyPrompt = (langName: string, latin: boolean) => `You write a short story for a ${langName} learner's vocabulary review. The review shows the story a line at a time, one card per target word: each card tests its word in that word's sentence, and shows the lines since the last card. The target words come from their word list, so they are usually unrelated to each other.

First, in "premise", plan the story in one or two English sentences: who it is about, where it happens and what happens, beginning to end. Choose a setting where as many of the words as possible naturally belong, and an order of the words that lets the plot move forward. A word that does not fit the plot can still come in naturally: something a character says, sees, remembers, wants or compares.

Then write the story as "lines", in order:
- A target line: ONE sentence for each target word, containing it${latin ? '. The word may appear inflected (conjugated, plural, feminine): put the exact form used in "form", spelled as in the sentence' : ' exactly as given'}, with "word" set to the target word copied exactly. Exactly one target line per target word.
- A linking line: a sentence that tests no word and only carries the story along (sets the scene, explains, says what happens between two target lines), with "word" set to ""${latin ? ' and "form" to ""' : ''}. Use them where the story needs them, at most two in a row and fewer than the target lines in all. A linking line uses only words the learner knows (and names).
- Words may come back: a target word may appear again in a later line (never before its own target line), and words the learner knows or will learn soon may be used as often as the story needs.
- The same one or two people and the same setting throughout. Each line follows on from the one before it (what happens next, why, how they feel about it), and the last one ends the story. Use simple linking words (then, but, so, because, later) where the learner knows them.
- A reader who sees all the lines in order must find the story sensible and easy to follow: no sudden jumps in place or time, no events that make no sense.
- The people may have names: short, common ${langName} first names, the same ones throughout. List every name used in "names" (empty if none); names do not count as new words.
- Each target line must still make sense on its own and make the meaning of its target word clear, because the learner may see it with the target word blanked out.
- In a target line, its target word must be the ONLY word the learner might not know. Apart from it, use only the words the request allows: the words they know, earlier target words, and at most one word per line from the words they will learn soon, which give the story more to work with. Never add any other less common word.
- 6 to 16 ${latin ? 'words' : 'Chinese characters'} per line.${latin ? '' : ' Hanzi only in the "zh" field: never pinyin or tone numbers.'}
- Put the ${langName} line in the "zh" field (the app's field for the target-language sentence) and its English translation in "en".
- "title": a short English title for the story, 2 to 5 words.`;
