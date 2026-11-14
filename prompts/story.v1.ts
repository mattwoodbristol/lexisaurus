// Review story writer, v4 (2026-10-23): a review set's example sentences as one short story, with
// linking lines that test nothing. Stronger model, premise first; proofread afterwards. v4: target
// words come back in later lines, and the whole story borrows at most two words not yet learnt.
export const storyPrompt = (langName: string, latin: boolean) => `You write a short story for a ${langName} learner's vocabulary review. The review shows the story a line at a time, one card per target word: each card tests its word in that word's sentence, and shows the lines since the last card. The target words come from their word list, so they are usually unrelated to each other.

First, in "premise", plan the story in one or two English sentences: who it is about, where it happens and what happens, beginning to end. Choose a setting where as many of the words as possible naturally belong, and an order of the words that lets the plot move forward. A word that does not fit the plot can still come in naturally: something a character says, sees, remembers, wants or compares.

Then write the story as "lines", in order:
- A target line: ONE sentence for each target word, containing it${latin ? '. The word may appear inflected (conjugated, plural, feminine): put the exact form used in "form", spelled as in the sentence' : ' exactly as given'}, with "word" set to the target word copied exactly. Exactly one target line per target word.
- A linking line: a sentence that tests no word and only carries the story along (sets the scene, explains, says what happens between two target lines), with "word" set to ""${latin ? ' and "form" to ""' : ''}. Use them where the story needs them, at most two in a row and fewer than the target lines in all. A linking line uses only words the learner knows, earlier target words and names.
- Target words come back: the review is for practising them, so after its own target line each target word should appear again in at least one later line (a later target line or a linking line), and the words the plot turns on more often. Never before its own target line. Linking lines are the best place for this: build them from earlier target words and words the learner knows.
- The same one or two people and the same setting throughout. Each line follows on from the one before it (what happens next, why, how they feel about it), and the last one ends the story. Use simple linking words (then, but, so, because, later) where the learner knows them.
- A reader who sees all the lines in order must find the story sensible and easy to follow: no sudden jumps in place or time, no events that make no sense.
- The people may have names: short, common ${langName} first names, the same ones throughout. List every name used in "names" (empty if none); names do not count as new words. Never use a target word as a name: each target word is used in its ordinary meaning (朱 is not "Teacher Zhu").
- Each target line must still make sense on its own and make the meaning of its target word clear, because the learner may see it with the target word blanked out.
- In a target line, its target word must be the ONLY word the learner might not know. Apart from it, use only the words the request allows: the words they know and earlier target words. The words they will learn soon are a last resort: at most TWO of them in the whole story, and only where the story cannot do without. Never add any other less common word.
- 6 to 16 ${latin ? 'words' : 'Chinese characters'} per line.${latin ? '' : ' Hanzi only in the "zh" field: never pinyin or tone numbers.'}
- Put the ${langName} line in the "zh" field (the app's field for the target-language sentence) and its English translation in "en".
- "title": a short English title for the story, 2 to 5 words.`;
