import { describe, it, expect } from 'vitest';
import { plecoStatus, type PlecoCard } from '../src/core/import/pleco';
import { kindFor, makeExercise } from '../src/core/review/exercise';
import { interleave } from '../src/core/review/queue';

const card = (over: Partial<PlecoCard>): PlecoCard => ({ simp: '保安', categories: [], ...over }) as PlecoCard;

describe('Pleco status (revised 2026-10-05)', () => {
  it('leaves never-reviewed personal-category words in the pool', () => {
    expect(plecoStatus(card({ categories: ['HSK 3.0/Level 3', 'Words'] }))).toBe('new');
    expect(plecoStatus(card({ categories: ['Duo Chars'] }))).toBe('new');
  });
  it('still treats reviewed words as learning and HSK 1-2 as known', () => {
    expect(plecoStatus(card({ categories: ['Words'], score: { score: 100, reviewed: 1 } as PlecoCard['score'] }))).toBe('learning');
    expect(plecoStatus(card({ categories: ['HSK 3.0/Level 2', 'Words'] }))).toBe('new'); // never reviewed
    expect(plecoStatus(card({ categories: ['HSK 3.0/Level 2'], score: { score: 300, reviewed: 2 } as PlecoCard['score'] }))).toBe('known');
  });
});

describe('new-word introduction', () => {
  it('introduces unseen word cards, then rotates', () => {
    const fresh = { reps: 0, stability: 0 };
    expect(kindFor(fresh, true, true)).toBe('intro');
    expect(kindFor(fresh, false, true)).toBe('intro');
    expect(kindFor({ reps: 1, stability: 2 }, true, true)).toBe('zh_to_en');
    expect(kindFor(fresh, true, false)).toBe('en_to_zh'); // grammar points are not introduced
  });
  it('carries an example sentence when there is one', () => {
    expect(makeExercise('intro', { id: 5, zh: '他是保安。', en: 'He is a security guard.' })).toEqual({
      kind: 'intro',
      sentenceId: 5,
      promptZh: '他是保安。',
      answerEn: 'He is a security guard.',
    });
    expect(makeExercise('intro', undefined)).toEqual({ kind: 'intro' });
  });
});

describe('interleave', () => {
  it('spreads new cards through the reviews and keeps everything', () => {
    const r = Array.from({ length: 10 }, (_, i) => `r${i}`);
    const out = interleave(r, ['n0', 'n1']);
    expect(out).toHaveLength(12);
    expect(out.indexOf('n0')).toBeGreaterThan(0);
    expect(out.indexOf('n1')).toBeGreaterThan(out.indexOf('n0') + 3);
    expect(out.indexOf('n1')).toBeLessThan(11);
    expect(out.filter((x) => x.startsWith('r'))).toEqual(r);
  });
  it('handles empty sides', () => {
    expect(interleave([], ['n'])).toEqual(['n']);
    expect(interleave(['r'], [])).toEqual(['r']);
    expect(interleave(['r'], ['n1', 'n2', 'n3'])).toHaveLength(4);
  });
});

import { themeSlots } from '../src/core/review/queue';
describe('theme words in a review set', () => {
  it('take up to a third of the set while other cards are due', () => {
    expect(themeSlots(30, 40, 20)).toBe(10);
    expect(themeSlots(10, 40, 20)).toBe(4);
  });
  it('fill the set when few other cards are due, and never exceed what waits', () => {
    expect(themeSlots(30, 5, 40)).toBe(25);
    expect(themeSlots(30, 5, 8)).toBe(8);
    expect(themeSlots(30, 40, 0)).toBe(0);
    expect(themeSlots(0, 0, 10)).toBe(0);
  });
});
