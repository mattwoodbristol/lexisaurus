import { describe, it, expect } from 'vitest';
import { linesAfter, linesBefore, partAt, storyOrder, tellable } from '../src/core/review/story';
import { makeExercise, storyKind, withFixedSentence } from '../src/core/review/exercise';
import { reachBand, starterBands } from '../src/core/assessment/levels';
import { storyPrompt, proofreadSentencesPrompt } from '../prompts';

type Card = { id: number; grammar?: boolean; part?: number };
const ids = (cs: Card[]) => cs.map((c) => c.id);

describe('review story order', () => {
  it('puts grammar first, then the story in order, then the rest', () => {
    const cards: Card[] = [{ id: 1, part: 3 }, { id: 2 }, { id: 3, grammar: true }, { id: 4, part: 1 }, { id: 5 }, { id: 6, part: 2 }];
    expect(ids(storyOrder(cards, (c) => c.part, (c) => !!c.grammar))).toEqual([3, 4, 6, 1, 2, 5]);
  });
  it('keeps a leading card first even when it is in the story', () => {
    const cards: Card[] = [{ id: 1, part: 2 }, { id: 2, part: 1 }];
    expect(ids(storyOrder(cards, (c) => c.part, (c) => c.id === 1))).toEqual([1, 2]);
  });
});

describe('story prompts', () => {
  it('asks Latin-script languages for the form used', () => {
    expect(storyPrompt('Italian', true)).toContain('"form"');
    expect(storyPrompt('Mandarin Chinese', false)).not.toContain('"form"');
  });
  it('tells the proofreader to keep a story in order, and says nothing of it otherwise', () => {
    expect(proofreadSentencesPrompt('Italian', true, 'At the market')).toContain('in this order (At the market)');
    expect(proofreadSentencesPrompt('Italian', true)).not.toContain('story');
  });
});

describe('new words within reach', () => {
  it('reaches one band above the measured vocabulary', () => {
    expect(reachBand(0)).toBe(1);
    expect(reachBand(2)).toBe(3);
    expect(reachBand(6)).toBe(6);
  });
  it('fills a starter pool at the measured band and the next', () => {
    expect(starterBands(0)).toEqual([1, 2]);
    expect(starterBands(3)).toEqual([3, 4]);
    expect(starterBands(6)).toEqual([6]);
  });
});

describe('a fixed sentence on a review card', () => {
  const s = { id: 7, zh: 'Compro il pane.', en: 'I buy the bread.', target: 'pane' };
  it('rebuilds the card from the corrected sentence, keeping its story', () => {
    const ex = makeExercise('cloze', { id: 7, zh: 'Compro la pane.', en: 'I buys bread.', target: 'pane' });
    const fixed = withFixedSentence({ ...ex, story: { title: 'T', part: 2, of: 5 } }, s);
    expect(fixed.clozeZh).toBe('Compro il ＿＿.');
    expect(fixed.promptEn).toBe('I buy the bread.');
    expect(fixed.story?.part).toBe(2);
  });
  it('swaps the old meaning for the new one among the options', () => {
    const ex = { ...makeExercise('zh_to_en', { id: 7, zh: 'x pane', en: 'old', target: 'pane' }), choices: ['a', 'old', 'b'], choiceAnswer: 'old' };
    const fixed = withFixedSentence(ex, s);
    expect(fixed.choices).toEqual(['a', 'I buy the bread.', 'b']);
    expect(fixed.choiceAnswer).toBe('I buy the bread.');
  });
  it('updates the story so far, and leaves other cards alone', () => {
    const ex = { ...makeExercise('zh_to_en', { id: 8, zh: 'y', en: 'z' }), story: { title: 'T', part: 3, of: 5, prev: [{ id: 7, zh: 'old', en: 'old' }, { zh: 'link', en: 'link' }] } };
    expect(withFixedSentence(ex, s).story?.prev).toEqual([{ id: 7, zh: s.zh, en: s.en }, { zh: 'link', en: 'link' }]);
    const other = makeExercise('en_to_zh', { id: 9, zh: 'q', en: 'r' });
    expect(withFixedSentence(other, s)).toBe(other);
  });
});

describe('the story so far on a card', () => {
  const lines = [{ zh: 'open', en: 'o' }, { id: 1, zh: 'a pane', en: 'a' }, { zh: 'link', en: 'l' }, { id: 2, zh: 'b', en: 'b' }, { id: 3, zh: 'c pane', en: 'c' }];
  it('shows the opening lines before the first card', () => {
    expect(linesBefore(lines, 1).map((l) => l.zh)).toEqual(['open']);
  });
  it('shows the previous tested line and the linking lines after it', () => {
    expect(linesBefore(lines, 3).map((l) => l.zh)).toEqual(['a pane', 'link']);
    expect(linesBefore(lines, 4).map((l) => l.zh)).toEqual(['b']);
  });
  it('leaves out a line holding the answer', () => {
    expect(linesBefore(lines, 3, 'pane').map((l) => l.zh)).toEqual(['link']);
  });
});

describe('story endings and kinds', () => {
  const lines = [
    { zh: 'A', en: 'a' },
    { id: 1, zh: 'B', en: 'b' },
    { zh: 'C', en: 'c' },
    { id: 2, zh: 'D', en: 'd' },
    { zh: 'E', en: 'e' },
    { zh: 'F', en: 'f' },
  ];
  it('gives the last tested line the linking lines that end the story', () => {
    expect(linesAfter(lines, 3).map((l) => l.zh)).toEqual(['E', 'F']);
  });
  it('gives other tested lines nothing: what follows them opens the next card', () => {
    expect(linesAfter(lines, 1)).toEqual([]);
  });
  it('keeps a story word on a kind that shows its line', () => {
    const solid = { reps: 3, stability: 30 };
    for (const k of ['intro', 'cloze', 'zh_to_en'] as const) expect(storyKind(k, solid, 7)).toBe(k);
    for (const k of ['match', 'en_to_zh', 'flash'] as const) expect(['cloze', 'zh_to_en']).toContain(storyKind(k, solid, 7));
    // A shaky word keeps to the meaning of its line.
    for (const k of ['match', 'flash'] as const) expect(storyKind(k, { reps: 3, stability: 1 }, 7)).toBe('zh_to_en');
  });
});

describe('story parts', () => {
  const lines = [
    { id: 1, zh: 'A', en: 'a' },
    { zh: 'B', en: 'b' },
    { id: 2, zh: 'C', en: 'c', target: 'C' },
    { id: 3, zh: 'D', en: 'd' },
    { id: 4, zh: 'E', en: 'e' },
  ];
  it("numbers only the set's cards: a line without one reads as a linking line", () => {
    const told = tellable(lines, new Set([1, 3, 4]));
    expect(told[2]).toEqual({ zh: 'C', en: 'c' });
    expect([0, 3, 4].map((i) => partAt(told, i))).toEqual([1, 2, 3]);
    expect(told.filter((l) => l.id !== undefined)).toHaveLength(3);
  });
  it('shows that line before the next card, and ends the story after the last', () => {
    const told = tellable(lines, new Set([1, 2, 3]));
    expect(linesBefore(told, 3).map((l) => l.zh)).toEqual(['C']);
    expect(linesAfter(told, 3).map((l) => l.zh)).toEqual(['E']);
  });
});
