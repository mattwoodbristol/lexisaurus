import { describe, it, expect } from 'vitest';
import { trackway } from '../src/core/trackway';

describe('trackway', () => {
  it('counts consecutive finished days ending today', () => {
    const t = trackway(['2026-10-05', '2026-10-06', '2026-10-07'], '2026-10-07');
    expect(t.streak).toBe(3);
    expect(t.todayDone).toBe(true);
    expect(t.best).toBe(3);
  });

  it('keeps the streak alive while today is still unfinished', () => {
    const t = trackway(['2026-10-05', '2026-10-06'], '2026-10-07');
    expect(t.streak).toBe(2);
    expect(t.todayDone).toBe(false);
  });

  it('breaks after a missed day, but remembers the best run', () => {
    const t = trackway(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05'], '2026-10-06');
    expect(t.streak).toBe(1);
    expect(t.best).toBe(3);
  });

  it('is zero after two quiet days, and a day each language finished counts once', () => {
    expect(trackway(['2026-10-01'], '2026-10-04').streak).toBe(0);
    expect(trackway(['2026-10-03', '2026-10-03', '2026-10-04'], '2026-10-04').streak).toBe(2);
  });

  it('lists the last seven days oldest first, across a month boundary', () => {
    const t = trackway(['2026-09-30', '2026-10-01'], '2026-10-03');
    expect(t.recent.map((r) => r.date)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(t.recent.map((r) => r.done)).toEqual([false, false, false, true, true, false, false]);
  });
});
