import { describe, it, expect } from 'vitest';
import { createEmptyCard, State } from 'ts-fsrs';
import { reviewCard, spreadAfterPass } from '../src/core/srs/schedule';

const DAY = 86_400_000;

describe('a passed card comes back on a later day', () => {
  const now = new Date('2026-10-09T10:00:00Z');

  it('spreads the due date over the next one to three days', () => {
    const card = createEmptyCard(now);
    expect(spreadAfterPass(card, now, 0).due.getTime()).toBe(now.getTime() + DAY);
    expect(spreadAfterPass(card, now, 1).due.getTime()).toBe(now.getTime() + 3 * DAY);
  });

  it('applies to Pass on a word already learnt; Good keeps the FSRS schedule', () => {
    const learnt = { ...createEmptyCard(now), reps: 6, stability: 30, difficulty: 5, state: State.Review, last_review: new Date(now.getTime() - 30 * DAY) };
    const passed = reviewCard(learnt, 1, now);
    expect(passed.due.getTime()).toBeGreaterThanOrEqual(now.getTime() + DAY);
    expect(passed.due.getTime()).toBeLessThanOrEqual(now.getTime() + 3 * DAY);
    const good = reviewCard(createEmptyCard(now), 3, now);
    expect(good.due.getTime()).toBeLessThan(now.getTime() + DAY); // a first Good is a learning step, minutes away
  });
});

describe('a new word comes back soon while it is being learnt', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  const hours = (c: { due: Date }, from = now) => (c.due.getTime() - from.getTime()) / 3_600_000;

  it('passed on first sight: back the next day', () => {
    expect(hours(reviewCard(createEmptyCard(now), 1, now))).toBe(16);
  });

  it('Easy on first sight: back the next day, not in eight days', () => {
    expect(hours(reviewCard(createEmptyCard(now), 4, now))).toBe(16);
  });

  it('steps out over 1, 2, 4 and 7 days, then FSRS takes over', () => {
    let c = createEmptyCard(now);
    let t = now;
    const gaps: number[] = [];
    for (let i = 0; i < 6; i++) {
      c = reviewCard(c, 4, t);
      gaps.push(hours(c, t));
      t = c.due;
    }
    expect(gaps.slice(0, 4)).toEqual([16, 40, 88, 160]);
    expect(gaps[5]).toBeGreaterThan(160);
  });
});
