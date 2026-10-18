import { describe, it, expect } from 'vitest';
import { explanationParts, sameShape, withParts, partsHash } from '../src/core/lessons/explanation-parts';
import type { LessonContent } from '../src/core/lessons/types';

const lesson: LessonContent = {
  title: 'Lesson 1: 比', level: 'HSK 3', pattern: 'A 比 B + adj',
  explanation: ['Use 比 to compare.'], examples: [{ zh: '我比你高。', en: 'I am taller than you.' }],
  keyPoints: ['No word for more.'], drills: [], errors: [{ wrong: '我比你很高', right: '我比你高', note: 'No 很 after 比.' }, { wrong: 'a', right: 'b' }],
  grammarPoints: [{ title: '比', summary: 'Comparisons with 比' }],
  check: [{ kind: 'translate', en: 'x', zh: 'y' }, { kind: 'fix', wrong: 'w', right: 'r', note: 'n' }],
};

describe('explanation parts', () => {
  it('round-trips and swaps only explanatory text', () => {
    const p = explanationParts(lesson);
    expect(p.errorNotes).toEqual(['No 很 after 比.', null]);
    expect(p.checkNotes).toEqual([null, 'n']);
    const zh = { explanation: ['用比来比较。'], keyPoints: ['不用"更"。'], errorNotes: ['比后面不用很。', null], grammarSummaries: ['用比比较'], checkNotes: [null, '注意'] };
    expect(sameShape(p, zh)).toBe(true);
    const out = withParts(lesson, zh);
    expect(out.explanation).toEqual(['用比来比较。']);
    expect(out.errors[0]!.note).toBe('比后面不用很。');
    expect(out.examples).toEqual(lesson.examples);
    expect(out.check![1]).toMatchObject({ kind: 'fix', note: '注意' });
  });
  it('rejects a translation with a different shape, and hashes changes', () => {
    const p = explanationParts(lesson);
    expect(sameShape(p, { ...p, explanation: ['a', 'b'] })).toBe(false);
    expect(partsHash(p)).not.toBe(partsHash({ ...p, keyPoints: ['changed'] }));
  });
});
