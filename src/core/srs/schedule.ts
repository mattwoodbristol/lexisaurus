// FSRS scheduling plus the word graduation rule (learning <-> known).
import { fsrs, generatorParameters, Rating, type Card, type Grade } from 'ts-fsrs';
import type { StoredStatus } from '../pinyin/annotate';

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export type ReviewRating = 1 | 2 | 3 | 4; // Pass (FSRS Again), Hard, Good, Easy
export const RATING_LABEL: Record<ReviewRating, string> = { 1: 'Pass', 2: 'Hard', 3: 'Good', 4: 'Easy' };

export function isRating(x: unknown): x is ReviewRating {
  return x === 1 || x === 2 || x === 3 || x === 4;
}

/** Revive a card stored as JSON (dates become strings). */
export function parseCard(json: string): Card {
  const c = JSON.parse(json) as Card & { due: string | Date; last_review?: string | Date };
  return { ...c, due: new Date(c.due), ...(c.last_review ? { last_review: new Date(c.last_review) } : {}) } as Card;
}

export function reviewCard(card: Card, rating: ReviewRating, now: Date): Card {
  const next = scheduler.next(card, now, rating as unknown as Grade).card;
  if (rating !== Rating.Again) return capYoung(next, now);
  // A word still being learnt that is passed comes back the next day, not one to three days out.
  return card.reps < YOUNG_STEPS_DAYS.length ? { ...next, due: new Date(now.getTime() + DAY_MS - EARLY_MS) } : spreadAfterPass(next, now);
}

const DAY_MS = 86_400_000;

/**
 * A new word comes back soon while it is being learnt, whatever FSRS says (it leaves a word rated
 * Easy on first sight for eight days): at most 1, 2, 4 and 7 days after its first four reviews.
 */
export const YOUNG_STEPS_DAYS = [1, 2, 4, 7];
/** Due a few hours short of the day, so the word is ready by that day's sitting whatever its time. */
const EARLY_MS = 8 * 3_600_000;

/** Bring a young card's due date forward to its step (YOUNG_STEPS_DAYS), if FSRS put it later. */
export function capYoung(card: Card, now: Date): Card {
  const days = YOUNG_STEPS_DAYS[card.reps - 1];
  if (days === undefined) return card;
  const cap = now.getTime() + days * DAY_MS - EARLY_MS;
  return card.due.getTime() > cap ? { ...card, due: new Date(cap) } : card;
}

/**
 * A passed card does not come back the same day: FSRS would ask again within minutes, which makes
 * a sitting drag. Instead it is due one to three days out, so passed words are mixed into the
 * following days rather than piling up on one.
 */
export function spreadAfterPass(card: Card, now: Date, rnd = Math.random()): Card {
  return { ...card, due: new Date(now.getTime() + (1 + rnd * 2) * DAY_MS) };
}

/** Default graduation threshold: a word is "known" once FSRS stability reaches this many days. */
export const DEFAULT_GRADUATE_DAYS = 21;

/**
 * Deterministic status change after a review of a word card:
 * - learning/new -> known once stability >= threshold;
 * - known -> learning on a failed review (Pass, FSRS Again), so pinyin comes back.
 */
export function statusAfterReview(status: StoredStatus, card: Card, rating: ReviewRating, graduateDays = DEFAULT_GRADUATE_DAYS): StoredStatus {
  if (status === 'known') return rating === Rating.Again ? 'learning' : 'known';
  return card.stability >= graduateDays ? 'known' : 'learning';
}
