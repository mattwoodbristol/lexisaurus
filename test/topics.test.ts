import { describe, it, expect } from 'vitest';
import { pickTopic, seededRng, type TopicCandidate } from '../src/core/topics/select';
import { ZH_TOPICS } from '../src/core/languages/zh.topics';

const DAY = 86_400_000;

function fixture(): TopicCandidate[] {
  return ZH_TOPICS.map((t, i) => ({ id: i + 1, name: t.name, tags: t.tags, lastUsedAt: null }));
}

/** Run N sessions the way the app does: pick, then mark used and push onto history. */
function simulate(n: number, seed: number, K = 8) {
  const topics = fixture();
  const rng = seededRng(seed);
  const history: number[] = [];
  let now = new Date('2026-10-04T08:00:00Z').getTime();
  for (let i = 0; i < n; i++) {
    const t = pickTopic(topics, { recentTopicIds: history, rng, now: new Date(now), noRepeatWindow: K })!;
    history.unshift(t.id);
    t.lastUsedAt = new Date(now).toISOString();
    now += DAY / 2; // two sessions a day
  }
  return { topics, history: [...history].reverse() };
}

describe('topic seeds', () => {
  it('has about 40 unique topics, each tagged and with a scenario', () => {
    expect(ZH_TOPICS.length).toBeGreaterThanOrEqual(38);
    expect(new Set(ZH_TOPICS.map((t) => t.name)).size).toBe(ZH_TOPICS.length);
    for (const t of ZH_TOPICS) {
      expect(t.tags.length).toBeGreaterThan(0);
      expect(t.scenario.length).toBeGreaterThan(10);
    }
  });
});

describe('topic rotation', () => {
  it('never repeats a topic within the last K sessions (300 sessions, 5 seeds)', () => {
    for (const seed of [1, 2, 3, 42, 2026]) {
      const { history } = simulate(300, seed);
      for (let i = 0; i < history.length; i++) {
        const window = history.slice(Math.max(0, i - 8), i);
        expect(window).not.toContain(history[i]);
      }
    }
  });

  it('never repeats back to back even with a tiny window', () => {
    const { history } = simulate(200, 7, 1);
    for (let i = 1; i < history.length; i++) expect(history[i]).not.toBe(history[i - 1]);
  });

  it('uses every topic in the first cycle and never leaves one waiting more than 1.5 cycles', () => {
    const n = ZH_TOPICS.length;
    for (const seed of [11, 12, 13]) {
      const { history } = simulate(n * 6, seed);
      expect(new Set(history.slice(0, n)).size).toBe(n); // first cycle covers everything
      const last = new Map<number, number>();
      let maxGap = 0;
      history.forEach((id, i) => {
        if (last.has(id)) maxGap = Math.max(maxGap, i - last.get(id)!);
        last.set(id, i);
      });
      expect(maxGap).toBeLessThanOrEqual(Math.ceil(n * 1.5));
    }
  });

  it('keeps tags varied: no tag in more than 3 of any 5 consecutive sessions', () => {
    const { topics, history } = simulate(150, 5);
    const tagsOf = new Map(topics.map((t) => [t.id, t.tags]));
    for (let i = 0; i + 5 <= history.length; i++) {
      const counts = new Map<string, number>();
      for (const id of history.slice(i, i + 5)) for (const tag of tagsOf.get(id)!) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
    }
  });

  it('respects skips (exclude) and returns null only when nothing is left', () => {
    const topics = fixture().slice(0, 3);
    const t1 = pickTopic(topics, { recentTopicIds: [], exclude: [1, 2], rng: seededRng(1) });
    expect(t1?.id).toBe(3);
    expect(pickTopic(topics, { recentTopicIds: [], exclude: [1, 2, 3] })).toBeNull();
  });

  it('shrinks the window rather than failing when there are fewer topics than K', () => {
    const topics = fixture().slice(0, 3);
    const t = pickTopic(topics, { recentTopicIds: [3, 2, 1], noRepeatWindow: 8, rng: seededRng(3) });
    expect(t).not.toBeNull();
    expect(t!.id).not.toBe(3); // still never the most recent
  });

  it('prefers the least recently used topic', () => {
    const now = new Date('2026-10-04T00:00:00Z');
    const topics: TopicCandidate[] = [
      { id: 1, name: 'a', tags: ['x'], lastUsedAt: new Date(now.getTime() - 2 * DAY).toISOString() },
      { id: 2, name: 'b', tags: ['y'], lastUsedAt: new Date(now.getTime() - 60 * DAY).toISOString() },
    ];
    for (const seed of [1, 2, 3, 4, 5]) expect(pickTopic(topics, { recentTopicIds: [], now, rng: seededRng(seed) })!.id).toBe(2);
  });
});
