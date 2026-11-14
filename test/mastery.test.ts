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
    recognise: [
      { prompt: 'r', options: ['丙', '丁'], answer: 1 },
      { prompt: 's', options: ['戊', '己'], answer: 0 },
    ],
    drills: [
      { en: 'd', zh: '文' },
      { en: 'f', zh: '字' },
    ],
    errors: [],
  };
  it("keeps the lesson check's own questions out while the practice has that kind", () => {
    const all = [0, 1, 2, 3].flatMap((seed) => quizItems(c, seed, 10));
    expect(all.some((i) => c.check.slice(0, 2).includes(i as never))).toBe(false);
    // No errors to fix in the practice: the check's fix is the only one there is.
    expect(all.filter((i) => i.kind === 'fix')).toEqual([c.check[2], c.check[2], c.check[2], c.check[2]]);
    // A practice question that repeats a check question counts as the check's.
    const copied = { ...c, recognise: [{ prompt: 'p', options: ['甲', '乙'], answer: 0 }] };
    expect(quizItems(copied, 0)[0]).toBe(copied.check[0]);
  });
  it('picks a choice, a translation and a fix, rotating with the seed', () => {
    expect(quizItems(c, 0).map((i) => i.kind)).toEqual(['choice', 'translate', 'fix']);
    expect(quizItems(c, 1)[0]).not.toEqual(quizItems(c, 0)[0]);
  });
  it('falls back to another choice when there is nothing to fix', () => {
    expect(quizItems({ ...c, check: c.check.slice(0, 2) }, 0).map((i) => i.kind)).toEqual(['choice', 'translate', 'choice']);
  });
  it('asks more questions when set, without repeating any, up to what the lesson has', () => {
    const more = quizItems(c, 0, 5);
    expect(more).toHaveLength(5);
    expect(new Set(more).size).toBe(5);
    expect(more.slice(0, 3)).toEqual(quizItems(c, 0));
    expect(quizItems(c, 0, 10)).toHaveLength(5);
    expect(quizItems(c, 0, 1)).toHaveLength(1);
  });
  it('asks different questions in the next quiz, and all of them before any comes back', () => {
    const many = {
      ...c,
      recognise: Array.from({ length: 6 }, (_, i) => ({ prompt: `r${i}`, options: ['甲', '乙'], answer: 0 })),
      drills: Array.from({ length: 6 }, (_, i) => ({ en: `d${i}`, zh: `中${i}` })),
      errors: Array.from({ length: 6 }, (_, i) => ({ wrong: `w${i}`, right: `r${i}` })),
    };
    for (const salt of [1, 2, 3, 40]) {
      const quizzes = Array.from({ length: 12 }, (_, r) => quizItems(many, r, 3, salt));
      for (let r = 1; r < quizzes.length; r++) for (const q of quizzes[r]!) expect(quizzes[r - 1]).not.toContain(q);
      // The first six quizzes go through all six of each kind.
      expect(new Set(quizzes.slice(0, 6).flat()).size).toBe(18);
    }
    // Different cards take the lesson's questions in different orders.
    const firsts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((salt) => quizItems(many, 0, 3, salt)[0]));
    expect(firsts.size).toBeGreaterThan(1);
  });
  it('never repeats a question within a quiz', () => {
    for (let r = 0; r < 10; r++) {
      const q = quizItems(c, r, 5, 9);
      expect(new Set(q).size).toBe(q.length);
    }
  });
  it('turns a score into a review rating', () => {
    expect([3, 2, 1, 0].map((s) => quizRating(s, 3))).toEqual([3, 2, 1, 1]);
  });
});
