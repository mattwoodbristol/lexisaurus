// A review batch told as one short story: its example sentences follow on from one another.

/** Fewest sentence cards worth a story; with fewer, each word keeps its own sentence. */
export const MIN_STORY = 3;

/**
 * Order a batch around its story: cards that lead (a forced card, grammar points) keep their
 * order at the front, then the story's cards in story order, then the rest (the matching board,
 * flashcards) in their order.
 */
export function storyOrder<T>(cards: T[], storyPos: (c: T) => number | undefined, leads: (c: T) => boolean): T[] {
  const lead = cards.filter(leads);
  const story = cards
    .filter((c) => !leads(c) && storyPos(c) !== undefined)
    .sort((a, b) => storyPos(a)! - storyPos(b)!);
  const rest = cards.filter((c) => !leads(c) && storyPos(c) === undefined);
  return [...lead, ...story, ...rest];
}

/**
 * One line of a story: a target word's sentence (cached, with its id and the word it tests), or a
 * linking line that tests nothing and only carries the story along.
 */
export interface StoryLine {
  zh: string;
  en: string;
  id?: number;
  target?: string;
}

/** The whole story, shown once its set's cards are done. */
export interface StoryRecap {
  title: string;
  sentences: StoryLine[];
}

/**
 * The story so far on a card: the lines since the previous tested line (that line included), or
 * the opening lines before the first one. Without any line that holds the card's own answer.
 */
export function linesBefore(lines: StoryLine[], at: number, answer?: string): StoryLine[] {
  let from = at - 1;
  while (from >= 0 && lines[from]!.id === undefined) from--;
  const shown = lines.slice(Math.max(0, from), at);
  return answer ? shown.filter((l) => !l.zh.includes(answer)) : shown;
}

/**
 * The lines after the last tested line: linking lines that end the story. Shown on the last card
 * once it is answered, so the story reads to its end before the whole story is shown. Empty for any
 * other line (the lines after it open the next card instead).
 */
export function linesAfter(lines: StoryLine[], at: number): StoryLine[] {
  const rest = lines.slice(at + 1);
  return rest.some((l) => l.id !== undefined) ? [] : rest;
}

/**
 * The story as a set tells it: a tested line whose word has no card in the set (a story written
 * ahead for words not all due now) reads as a linking line, so the parts number only the set's
 * cards. `carded`: the sentence ids of the lines that are cards.
 */
export function tellable(lines: StoryLine[], carded: Set<number>): StoryLine[] {
  return lines.map((l) => (l.id === undefined || carded.has(l.id) ? l : { zh: l.zh, en: l.en }));
}

/** A tested line's part number: tested lines up to and including it. */
export function partAt(lines: StoryLine[], at: number): number {
  return lines.slice(0, at + 1).filter((l) => l.id !== undefined).length;
}
