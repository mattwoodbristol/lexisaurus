import { describe, it, expect } from 'vitest';
import { boardGloss, newBoard, removeWord, returnWord, tooSimilar } from '../src/core/assessment/sort-board';

const w = (id: number, meaning: string) => ({ id, meaning });
const QUEUE = [w(1, 'to eat'), w(2, 'teacher'), w(3, 'because'), w(4, 'big'), w(5, 'water'), w(6, 'tomorrow'), w(7, 'cat')];
const DECOYS = ['dog', 'red', 'to drink'];

describe('board meanings', () => {
  it('shortens list glosses to the first senses', () => {
    expect(boardGloss('to eat; to have a meal; to eat (a particular type of food); to receive (a blow)')).toBe('to eat; to have a meal');
    expect(boardGloss('(verb) to eat')).toBe('to eat');
    expect(boardGloss('think; believe; consider [usually erroneously]')).toBe('think; believe; consider');
    expect(boardGloss('we or us [including both the speaker and the pers…')).toBe('we or us');
    expect(boardGloss('good (opp.…')).toBe('good (opp.');
    expect(boardGloss('a very long single sense that goes on well past what fits on a small tile')).toMatch(/…$/);
  });
  it('treats overlapping meanings as the same', () => {
    expect(tooSimilar('dad; father', 'father')).toBe(true);
    expect(tooSimilar('to look', 'look (at)')).toBe(true);
    expect(tooSimilar('to look', 'to see')).toBe(false);
  });
});

describe('board', () => {
  it('shows a few words, their meanings and one decoy', () => {
    const b = newBoard(QUEUE, 5, DECOYS, 1);
    expect(b.words.map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
    expect(b.queue).toHaveLength(2);
    expect(b.meanings).toHaveLength(6);
    expect(DECOYS).toContain(b.decoy);
    expect([...b.meanings].sort()).toEqual([...b.words.map((x) => x.meaning), b.decoy!].sort());
  });
  it('never uses a decoy a board word could be matched with', () => {
    for (let seed = 1; seed < 30; seed++) expect(newBoard(QUEUE, 5, ['to eat', 'eat', 'dog'], seed).decoy).toBe('dog');
    expect(newBoard(QUEUE, 5, ['to eat'], 1).decoy).toBeNull();
  });
  it('keeps the shown words and meanings in place as words leave', () => {
    const b = newBoard(QUEUE, 5, DECOYS, 3);
    const next = removeWord(b, 2, 5, DECOYS, 4);
    expect(next.words.map((x) => x.id)).toEqual([1, 3, 4, 5]);
    expect(next.queue).toHaveLength(2);
    const kept = b.meanings.filter((m) => m !== 'teacher' && m !== b.decoy);
    expect(next.meanings.filter((m) => kept.includes(m))).toEqual(kept);
    expect(next.meanings).toHaveLength(5);
  });
  it('keeps the decoy in its place as words leave', () => {
    const b = newBoard(QUEUE, 5, DECOYS, 3);
    const next = removeWord(b, 2, 5, DECOYS, 4);
    expect(next.decoy).toBe(b.decoy);
    expect(next.meanings).toEqual(b.meanings.filter((m) => m !== 'teacher'));
  });
  it('brings on the next set once the board is clear', () => {
    let b = newBoard(QUEUE, 5, DECOYS, 3);
    for (const id of [1, 2, 3, 4]) b = removeWord(b, id, 5, DECOYS, id);
    expect(b.words.map((x) => x.id)).toEqual([5]);
    expect(b.meanings).toHaveLength(2);
    b = removeWord(b, 5, 5, DECOYS, 9);
    expect(b.words.map((x) => x.id)).toEqual([6, 7]);
    expect(b.queue).toEqual([]);
    expect(b.meanings).toHaveLength(3);
  });
  it('empties at the end of the round', () => {
    let b = newBoard(QUEUE.slice(0, 2), 5, DECOYS, 1);
    b = removeWord(b, 1, 5, DECOYS, 2);
    b = removeWord(b, 2, 5, DECOYS, 3);
    expect(b.words).toEqual([]);
    expect(b.meanings).toEqual([]);
  });
  it('takes an undone word back', () => {
    const b = newBoard(QUEUE.slice(0, 5), 5, DECOYS, 1);
    const back = returnWord(b, w(9, 'moon'), 5, DECOYS, 2);
    expect(back.words).toHaveLength(6);
    expect(back.meanings).toContain('moon');
    expect(back.meanings).toHaveLength(7);
  });
});
