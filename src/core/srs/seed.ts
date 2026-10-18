// Seed FSRS card state from Pleco review history so imported words do not start cold.
import { createEmptyCard, State, type Card } from 'ts-fsrs';
import type { PlecoScore } from '../import/pleco';

const DAY = 86_400_000;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Pleco score 100 = new; it grows with each correct answer. We treat score/100 as a
 * stability in days (1..365). Difficulty leans on the error rate. Due = last review + stability.
 */
export function seedCardFromPleco(score: PlecoScore | undefined, now: Date): Card {
  const card = createEmptyCard(now);
  if (!score || score.reviewed <= 0 || !score.lastReviewedTime) return card;
  const last = new Date(score.lastReviewedTime * 1000);
  const stability = clamp(score.score / 100, 1, 365);
  const errRate = score.incorrect / Math.max(1, score.reviewed);
  const difficulty = clamp(4 + 6 * errRate, 1, 10);
  const due = new Date(last.getTime() + stability * DAY);
  return {
    ...card,
    due: due < now ? now : due,
    stability,
    difficulty,
    elapsed_days: Math.max(0, Math.floor((now.getTime() - last.getTime()) / DAY)),
    scheduled_days: Math.round(stability),
    reps: score.reviewed,
    lapses: score.incorrect,
    state: State.Review,
    last_review: last,
  };
}
