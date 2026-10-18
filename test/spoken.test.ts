import { describe, it, expect } from 'vitest';
import { compareSpoken, numberToZh, spokenRating } from '../src/core/speech/compare';

describe('numbers the recogniser writes as digits', () => {
  it('writes small numbers as Chinese numerals', () => {
    expect(numberToZh(3)).toBe('三');
    expect(numberToZh(10)).toBe('十');
    expect(numberToZh(15)).toBe('十五');
    expect(numberToZh(20)).toBe('二十');
    expect(numberToZh(105)).toBe('一百零五');
    expect(numberToZh(2026)).toBe('二千零二十六');
  });
});

describe('comparing speech with the target (Mandarin)', () => {
  it('matches ignoring punctuation', () => {
    const r = compareSpoken('han', '我想买三本书。', ['我想买三本书']);
    expect(r.match).toBe(true);
    expect(r.score).toBe(1);
    expect(r.parts.at(-1)).toEqual({ text: '。', ok: true });
  });
  it('treats digits as the numerals they stand for', () => {
    expect(compareSpoken('han', '我有三个苹果', ['我有3个苹果']).match).toBe(true);
  });
  it('marks the characters that were heard as something else', () => {
    const r = compareSpoken('han', '我想卖书', ['我想买书']);
    expect(r.match).toBe(false);
    expect(r.parts.map((p) => p.ok)).toEqual([true, true, false, true]);
    expect(r.score).toBe(0.75);
  });
  it('keeps the closest of several alternatives', () => {
    const r = compareSpoken('han', '他去过北京', ['他去过背景', '他去过北京']);
    expect(r.match).toBe(true);
    expect(r.heard).toBe('他去过北京');
  });
  it('handles nothing heard', () => {
    const r = compareSpoken('han', '你好', ['']);
    expect(r.match).toBe(false);
    expect(r.parts).toEqual([
      { text: '你', ok: false },
      { text: '好', ok: false },
    ]);
  });
});

describe('comparing speech with the target (Italian)', () => {
  it('ignores case and punctuation', () => {
    expect(compareSpoken('latin', 'Vorrei un caffè, per favore.', ['vorrei un caffè per favore']).match).toBe(true);
  });
  it('marks missed words and keeps the spacing', () => {
    const r = compareSpoken('latin', 'Ci vediamo domani', ['ci vedremo domani']);
    expect(r.parts).toEqual([
      { text: 'Ci', ok: true },
      { text: ' ', ok: true },
      { text: 'vediamo', ok: false },
      { text: ' ', ok: true },
      { text: 'domani', ok: true },
    ]);
  });
});

describe('suggested rating', () => {
  it('Good when understood, Hard when nearly, Pass otherwise', () => {
    expect(spokenRating(compareSpoken('han', '我想买书', ['我想买书']))).toBe(3);
    expect(spokenRating(compareSpoken('han', '我想买书', ['我想卖书']))).toBe(2);
    expect(spokenRating(compareSpoken('han', '我想买书', ['你好']))).toBe(1);
  });
});
