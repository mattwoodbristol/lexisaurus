// How many new words a review may introduce today, given how the learner is getting on: new words
// wait while seen words pile up or are being missed, so the load does not snowball.

/** Seen cards due at once at which new words stop until they are worked down. */
export const BACKLOG_PAUSE = 20;
/** Recent reviews looked at for the miss rate (word cards, not first sightings). */
export const RECENT_REVIEWS = 30;
/** Fewer recent reviews than this say too little to go on. */
export const MIN_RECENT = 10;
/** Share of recent reviews passed (missed) at which new words stop, and at which they are halved. */
export const MISS_PAUSE = 0.4;
export const MISS_HALVE = 0.25;

export interface NewWordGate {
  /** New words allowed today (before those already introduced). */
  perDay: number;
  /** Why fewer than review.new_per_day, for the review's notice. */
  reason?: 'backlog' | 'misses' | 'slowed';
}

export function newWordGate(perDay: number, backlog: number, recent: { total: number; missed: number }): NewWordGate {
  if (perDay <= 0) return { perDay: 0 };
  if (backlog >= BACKLOG_PAUSE) return { perDay: 0, reason: 'backlog' };
  const rate = recent.total >= MIN_RECENT ? recent.missed / recent.total : 0;
  if (rate >= MISS_PAUSE) return { perDay: 0, reason: 'misses' };
  if (rate >= MISS_HALVE) return { perDay: Math.ceil(perDay / 2), reason: 'slowed' };
  return { perDay };
}

/** The review's notice for a gate that held new words back, or null. */
export function gateNotice(g: NewWordGate, backlog: number): string | null {
  if (g.reason === 'backlog') return `New words are paused while ${backlog} words wait for review. They start again below ${BACKLOG_PAUSE}.`;
  if (g.reason === 'misses') return 'New words are paused while you are missing a lot of recent reviews. They start again as more go right.';
  return null;
}
