import { describe, expect, it } from 'vitest';
import { BACKLOG_PAUSE, gateNotice, newWordGate } from '../src/core/review/new-words';
import { shuffleChoices, shuffleOptions } from '../src/core/lessons/steps';

describe('newWordGate', () => {
  const fine = { total: 30, missed: 3 };
  it('allows the full allowance while things go well', () => {
    expect(newWordGate(10, 5, fine)).toEqual({ perDay: 10 });
    expect(newWordGate(10, 0, { total: 4, missed: 4 })).toEqual({ perDay: 10 }); // too few to judge
  });
  it('pauses new words while seen cards pile up', () => {
    const g = newWordGate(10, BACKLOG_PAUSE, fine);
    expect(g).toEqual({ perDay: 0, reason: 'backlog' });
    expect(gateNotice(g, 25)).toContain('25 words');
  });
  it('halves them when a quarter are missed, and pauses at two in five', () => {
    expect(newWordGate(10, 0, { total: 20, missed: 5 })).toEqual({ perDay: 5, reason: 'slowed' });
    expect(newWordGate(10, 0, { total: 20, missed: 8 })).toEqual({ perDay: 0, reason: 'misses' });
    expect(gateNotice(newWordGate(10, 0, { total: 20, missed: 5 }), 0)).toBeNull();
  });
  it('leaves a zero allowance alone', () => {
    expect(newWordGate(0, 50, fine)).toEqual({ perDay: 0 });
  });
});

describe('shuffled options', () => {
  const q = { prompt: 'Which?', options: ['a', 'b', 'c', 'd'], answer: 2 };
  it('keeps the answer on its option', () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = shuffleOptions(q, seed);
      expect([...s.options].sort()).toEqual(q.options);
      expect(s.options[s.answer]).toBe('c');
    }
  });
  it('moves the answer about between showings', () => {
    const places = new Set(Array.from({ length: 40 }, (_, k) => shuffleOptions(q, k + 1).answer));
    expect(places.size).toBeGreaterThan(2);
  });
  it('shuffles only the multiple-choice items of a mixed list', () => {
    const items = [{ kind: 'choice' as const, ...q }, { kind: 'translate' as const, en: 'x', zh: 'y' }];
    const out = shuffleChoices(items, 9);
    expect(out[1]).toBe(items[1]);
    expect(out[0]!.kind === 'choice' && out[0]!.options[out[0]!.answer]).toBe('c');
  });
});
