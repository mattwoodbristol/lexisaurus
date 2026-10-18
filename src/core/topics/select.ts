// Topic rotation: code chooses the conversation topic, never Claude.
//
// Rule set (SPEC 8.2):
//   1. Never repeat a topic used in the last K sessions (hard rule).
//   2. Prefer the least recently used topic.
//   3. Penalise tags that dominated the recent sessions, so subjects stay varied.
//   4. Add a little random jitter so the order is not mechanical.

export interface TopicCandidate {
  id: number;
  name: string;
  tags: string[];
  /** ISO timestamp of last use, or null if never used. */
  lastUsedAt: string | null;
}

export interface PickOptions {
  /** Topic ids of recent sessions, most recent first (custom-topic sessions omitted). */
  recentTopicIds: number[];
  /** Ids the user just skipped in this sitting. */
  exclude?: number[];
  now?: Date;
  /** Returns [0, 1). Injected for deterministic tests. */
  rng?: () => number;
  /** No-repeat window (K). */
  noRepeatWindow?: number;
  /** How many recent sessions count towards the tag penalty. */
  tagWindow?: number;
}

const DAY = 86_400_000;
export const DEFAULT_NO_REPEAT = 8;

export function scoreTopic(t: TopicCandidate, recentTagCounts: Map<string, number>, now: Date, jitter: number): number {
  const days = t.lastUsedAt ? Math.max(0, (now.getTime() - new Date(t.lastUsedAt).getTime()) / DAY) : 365;
  const age = Math.min(days, 365) + 1;
  // Mean (not product) of per-tag penalties, so topics with more tags are not starved.
  const tagFactor = t.tags.length ? t.tags.reduce((sum, tag) => sum + 1 / (1 + (recentTagCounts.get(tag) ?? 0)), 0) / t.tags.length : 1;
  // Age is squared so least-recently-used dominates; tags and jitter only reorder near-ties.
  return age * age * tagFactor * jitter;
}

export function pickTopic(topics: TopicCandidate[], opts: PickOptions): TopicCandidate | null {
  const now = opts.now ?? new Date();
  const rng = opts.rng ?? Math.random;
  const K = opts.noRepeatWindow ?? DEFAULT_NO_REPEAT;
  const tagWindow = opts.tagWindow ?? 5;
  const exclude = new Set(opts.exclude ?? []);
  const byId = new Map(topics.map((t) => [t.id, t]));

  const recentTagCounts = new Map<string, number>();
  for (const id of opts.recentTopicIds.slice(0, tagWindow)) {
    for (const tag of byId.get(id)?.tags ?? []) recentTagCounts.set(tag, (recentTagCounts.get(tag) ?? 0) + 1);
  }

  // The window shrinks only if it would leave nothing to choose from (fewer topics than K).
  let pool: TopicCandidate[] = [];
  for (let k = Math.min(K, topics.length); k >= 1 && pool.length === 0; k--) {
    const blocked = new Set(opts.recentTopicIds.slice(0, k));
    pool = topics.filter((t) => !blocked.has(t.id) && !exclude.has(t.id));
  }
  if (pool.length === 0) pool = topics.filter((t) => !exclude.has(t.id));
  if (pool.length === 0) return null;

  let best: TopicCandidate | null = null;
  let bestScore = -Infinity;
  for (const t of pool) {
    const s = scoreTopic(t, recentTagCounts, now, 0.8 + 0.4 * rng());
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return best;
}

/** Small seeded PRNG (mulberry32) for tests and reproducible simulations. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
