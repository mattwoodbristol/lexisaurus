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
