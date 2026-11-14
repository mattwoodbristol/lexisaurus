// Themed vocabulary course, v2 (2026-11-13). The learner can get by in general conversation but
// cannot talk about a subject (the body, the home and its fittings, tennis...) in detail the way
// a native child can. A theme runs over a few days: the first call plans the days and writes
// day 1, later calls write one day each. Items carry an emoji; sections about physical things
// carry a schematic diagram the app draws, with markers on the named parts (used in quizzes).
export function themePrompt(o: { langName: string; nativeName: string; han: boolean; latin: boolean }): string {
  return `You write themed vocabulary in ${o.langName} for a single adult learner whose own language is ${o.nativeName}.

The learner can hold a general conversation, but cannot talk about a particular subject in detail: they lack the concrete, everyday words a native five-year-old knows (for the body: elbow, ankle, knee, nail, eyelash, "my tummy hurts", "I grazed my knee"; for the home: tap, plug socket, radiator, hinge, gutter, "the boiler has packed up"). Your job is to fill that gap for the theme in the request. These words are often outside graded level lists: that is expected and wanted. Do not leave out a common everyday word because it is "advanced"; leave out only rare or technical ones nobody says.

A theme is a short course over several days, about 15-25 new words and phrases a day. The request says whether to plan the course and write day 1, or to write a later day from the plan.

Choose what a native speaker actually says about the theme in daily life: the concrete nouns, the verbs that go with them, and the set phrases. Prefer the everyday word over the technical one. Go from the most basic to the more detailed across the days. Do not pad with words the learner certainly knows (for the body, "hand" and "head" at most once, as anchors).

For a day, write:
- sections: 2-3 sections, each a natural group (e.g. "The front of the house", "In the bathroom: fittings", "When things break"). heading in ${o.nativeName}. Each has 6-10 items:
  - kind "word": one vocabulary word.${o.latin ? " text gives a noun with its definite article (il rubinetto, l'unghia), a verb in the infinitive, an adjective in the masculine singular." : ''} lemma is the bare dictionary word only (${o.latin ? 'rubinetto, unghia, sbucciarsi' : o.han ? 'the Hanzi word' : 'no article'}), one word, no spaces.
  - kind "phrase": a useful set phrase or short sentence a native would say (2-8 words). lemma is null.
  - Roughly two thirds words, one third phrases.
  - text in ${o.langName}${o.han ? ', simplified Hanzi only. Never write pinyin or tone numbers; the app adds them' : ''}.
  - translation: natural ${o.nativeName}.
  - note: a few ${o.nativeName} words when something is worth knowing, else "".${o.latin ? " Always give irregular or changing plurals (il braccio, pl. le braccia), and gender when the article hides it (l'unghia, f.)." : ''} Also false friends, register (child's word, slang), or the verb it goes with.
  - emoji: one emoji that clearly pictures the item (🚿 shower, 🔌 plug, 🦶 foot), or "" when none really fits. Never a loose association.
  - diagram: for a section about a physical thing with parts (a body, a house front, a room, a bathroom, a bicycle, a tennis court), a labelled diagram; otherwise null. Draw at least one diagram every day whenever anything in the day can be seen (most themes: a house front, a room, an appliance, a body, a court), and at most 2. Arrange the day's sections so the visible parts are grouped where a diagram can show them. See below.
- grammar: 1 grammar point this day's words make you need, explained in ${o.nativeName} in 2-4 sentences, with 3-4 example sentences in ${o.langName} (with translation) using the day's words.${o.latin ? ' For example: irregular plurals of body parts; the article instead of a possessive with reflexive verbs (mi lavo le mani); "mi fa male / mi fanno male"; "si è rotto il rubinetto"; prepositions of place (sopra, sotto, accanto a).' : ''}

Diagrams: a simple, clear schematic line drawing, like a children's picture dictionary, on a canvas 400 wide and 300 high (x right, y down; keep 10 units from the edges).
- shapes: 10-40 SVG path strings ("d" attribute only: M L H V C Q A Z and numbers; no other markup) with a tone: "line" (outline only), "light", "mid", "dark" (filled, outlined) or "accent" (one highlight colour, sparingly). Draw big shapes first; later shapes go on top. Draw the thing so it is recognisable: real proportions, the named parts visibly present and separate.
- markers: for each item that is a visible part of the drawing (at least 3, at most one per item), item is its 0-based index in the section's items and x, y is a point exactly on that part. The app draws numbered dots there, so do not write any text or numbers in the shapes.

Every item must be unique across the whole theme. When the request lists items already covered, repeat none of them.`;
}

/** A handful of new theme ideas, suggested from what the learner has done and who they are. */
export function themeIdeasPrompt(o: { langName: string; nativeName: string }): string {
  return `Suggest themes for themed vocabulary courses in ${o.langName}. Each teaches, over a few days, the concrete everyday words, phrases and grammar needed to talk about one subject in detail, the way a native child can (the body, animals and their bodies, the home and its fittings, tennis...).

The request lists themes already done or offered and a little about the learner. Suggest 8 new themes, different from those: a mix of everyday life, hobbies and interests that fit the learner, and subjects people talk about. Each has a name (2-5 ${o.nativeName} words) and a hint (one ${o.nativeName} sentence on what it would go into, naming a few specific things).`;
}
