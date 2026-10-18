import { describe, it, expect } from 'vitest';
import { dayIn, mastery, quizItems, quizRating } from '../src/core/lessons/mastery';

const day = dayIn('Europe/London');

describe('mastery levels', () => {
  const passedAt = '2026-10-05T09:00:00Z';
  const base = { started: true, passedAt, quizzes: [], chatUses: [], dayOf: day };
  it('is learning until the check is passed', () => {
    expect(mastery({ ...base, passedAt: null }).level).toBe('learning');
    expect(mastery({ ...base, started: false, passedAt: null }).level).toBe('new');
    expect(mastery(base).level).toBe('practised');
  });
  it('needs two passed quizzes on different later days and two unprompted chat uses', () => {
    const quizzes = [
      { at: '2026-10-05T18:00:00Z', score: 3, total: 3 }, // same day as passing: does not count
      { at: '2026-10-06T08:00:00Z', score: 2, total: 3 },
      { at: '2026-10-06T19:00:00Z', score: 3, total: 3 }, // same day again
      { at: '2026-10-09T08:00:00Z', score: 1, total: 3 }, // failed
      { at: '2026-10-12T08:00:00Z', score: 3, total: 3 },
    ];
    const uses = [
      { at: '2026-10-06T10:00:00Z', correct: true, prompted: false },
      { at: '2026-10-07T10:00:00Z', correct: true, prompted: true }, // hinted: does not count
      { at: '2026-10-08T10:00:00Z', correct: false, prompted: false },
    ];
    expect(mastery({ ...base, quizzes, chatUses: uses })).toEqual({ level: 'practised', quizDays: 2, chatUses: 1 });
    const more = [...uses, { at: '2026-10-10T10:00:00Z', correct: true, prompted: false }];
    expect(mastery({ ...base, quizzes, chatUses: more })).toEqual({ level: 'embedded', quizDays: 2, chatUses: 2 });
  });
  it('ignores evidence from before the check was passed', () => {
    const early = [{ at: '2026-10-01T10:00:00Z', correct: true, prompted: false }];
    expect(mastery({ ...base, chatUses: early }).chatUses).toBe(0);
  });
});

describe('grammar quizzes', () => {
  const c = {
    check: [
      { kind: 'choice' as const, prompt: 'p', options: ['甲', '乙'], answer: 0 },
      { kind: 'translate' as const, en: 'e', zh: '中' },
      { kind: 'fix' as const, wrong: '错', right: '对' },
    ],
    recognise: [{ prompt: 'r', options: ['丙', '丁'], answer: 1 }],
    drills: [{ en: 'd', zh: '文' }],
    errors: [],
  };
  it('picks a choice, a translation and a fix, rotating with the seed', () => {
    expect(quizItems(c, 0).map((i) => i.kind)).toEqual(['choice', 'translate', 'fix']);
    expect(quizItems(c, 1)[0]).not.toEqual(quizItems(c, 0)[0]);
  });
  it('falls back to another choice when there is nothing to fix', () => {
    expect(quizItems({ ...c, check: c.check.slice(0, 2) }, 0).map((i) => i.kind)).toEqual(['choice', 'translate', 'choice']);
  });
  it('turns a score into a review rating', () => {
    expect([3, 2, 1, 0].map((s) => quizRating(s, 3))).toEqual([3, 2, 1, 1]);
  });
});
