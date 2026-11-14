// Ordering a review session.

/** Spread new cards evenly through the reviews, so a session does not end on a block of new words. */
export function interleave<T>(reviews: T[], fresh: T[]): T[] {
  if (!fresh.length) return reviews;
  if (!reviews.length) return fresh;
  const out: T[] = [];
  const step = (reviews.length + fresh.length) / fresh.length;
  let r = 0;
  let f = 0;
  for (let i = 0; i < reviews.length + fresh.length; i++) {
    if (f < fresh.length && i >= Math.round(step * f + step / 2) - 1) out.push(fresh[f++]!);
    else if (r < reviews.length) out.push(reviews[r++]!);
    else out.push(fresh[f++]!);
  }
  return out;
}

/**
 * srs_cards.pinned for a theme word not reviewed yet: like a word-sheet pin (1) it skips the daily
 * new-word ration and the level reach, but it does not go to the front of the queue: theme words
 * are mixed into each set (themeShare), so a theme a day does not turn every review into it.
 */
export const THEME_PIN = 2;
/** At most this share of a set goes to theme words while other cards are due. */
export const THEME_SHARE = 1 / 3;

/**
 * How many theme cards a set of `take` cards gets: up to its share, or more when the other cards
 * due (`others`) do not fill the set; never more than are waiting (`waiting`).
 */
export function themeSlots(take: number, others: number, waiting: number): number {
  if (take <= 0 || waiting <= 0) return 0;
  return Math.min(waiting, take, Math.max(Math.ceil(take * THEME_SHARE), take - others));
}
