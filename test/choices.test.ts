import { describe, expect, it } from 'vitest';
import { withChoices, WRONG_CHOICES } from '../src/core/review/choices';

describe('withChoices', () => {
  const pool = ['to eat', 'house', 'to run', 'red', 'father', 'book'];

  it('puts the answer among wrong options', () => {
    const c = withChoices('dad; father', pool, 7)!;
    expect(c).toHaveLength(WRONG_CHOICES + 1);
    expect(c.filter((x) => x === 'dad; father')).toHaveLength(1);
    expect(new Set(c).size).toBe(c.length);
  });

  it('never offers a wrong option that could pass for the answer', () => {
    for (let seed = 1; seed < 30; seed++) expect(withChoices('dad; father', pool, seed)).not.toContain('father');
  });

  it('is the same for the same seed, and varies the answer position', () => {
    expect(withChoices('cat', pool, 3)).toEqual(withChoices('cat', pool, 3));
    const places = new Set(Array.from({ length: 30 }, (_, s) => withChoices('cat', pool, s + 1)!.indexOf('cat')));
    expect(places.size).toBeGreaterThan(1);
  });

  it('gives up when there are too few options to make a test', () => {
    expect(withChoices('cat', ['cat', 'dog'], 1)).toBeUndefined();
    expect(withChoices('cat', [], 1)).toBeUndefined();
    expect(withChoices('cat', ['dog', 'bird'], 1)).toHaveLength(3);
  });
});
