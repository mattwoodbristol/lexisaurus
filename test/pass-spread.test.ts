import { describe, it, expect } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { reviewCard, spreadAfterPass } from '../src/core/srs/schedule';

const DAY = 86_400_000;

describe('a passed card comes back on a later day', () => {
  const now = new Date('2026-10-09T10:00:00Z');

  it('spreads the due date over the next one to three days', () => {
    const card = createEmptyCard(now);
    expect(spreadAfterPass(card, now, 0).due.getTime()).toBe(now.getTime() + DAY);
    expect(spreadAfterPass(card, now, 1).due.getTime()).toBe(now.getTime() + 3 * DAY);
  });

  it('applies to Pass only; Good keeps the FSRS schedule', () => {
    const card = createEmptyCard(now);
    const passed = reviewCard(card, 1, now);
    expect(passed.due.getTime()).toBeGreaterThanOrEqual(now.getTime() + DAY);
    expect(passed.due.getTime()).toBeLessThanOrEqual(now.getTime() + 3 * DAY);
    const good = reviewCard(card, 3, now);
    expect(good.due.getTime()).toBeLessThan(now.getTime() + DAY); // a first Good is a learning step, minutes away
  });
});
