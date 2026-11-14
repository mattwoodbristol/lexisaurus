// Speaking sentences for "Say it" review cards, v1 (2026-10-24). Cheap model, batched, cached. The
// learner says the whole sentence from its English, so it must be short and simple: story lines
// were too long and held too many words still being learnt.
export const speakPrompt = (langName: string, latin: boolean) => `You write very short sentences for a ${langName} learner to say aloud. The review shows the English and the learner says the whole sentence in ${langName} from memory, so it must be easy to produce.

For each target word, write ONE sentence containing it${latin ? '; it may be inflected (conjugated, plural, feminine): put the exact form used in "form", spelled as in the sentence' : ' exactly as given'}, with "word" copied exactly, and its English translation in "en".

Rules:
- The target word is the ONLY word that may be hard. Every other word must come from the list of words the learner knows well (given with the targets), and from its simplest, most common words; where no list is given, only the most common beginner words.
- ${latin ? '3 to 7 words' : '4 to 10 Chinese characters'}. One short clause: no "because", "although", "if" or relative clauses, no lists, no names.
- The simplest grammar that is natural: something a person would really say in daily life, about themselves or someone near them.
- The English must be a plain, literal translation, so the learner can say the sentence from it.${latin ? '' : '\n- Hanzi only in the "zh" field. Never write pinyin or tone numbers.'}
- Put the ${langName} sentence in the "zh" field (the app's field for the target-language sentence).
- Return one item per target word.`;
