// Multiple choice for review cards that used to ask "do you know this?": the right answer and a
// few wrong ones from other words and sentences. Pure; the worker supplies the pool.
import { tooSimilar } from '../assessment/sort-board';

/** Wrong options shown with the answer. */
export const WRONG_CHOICES = 3;

function rng(seed: number): () => number {
  let t = seed >>> 0 || 1;
  return () => {
    t = (t * 1664525 + 1013904223) >>> 0;
    return t / 4294967296;
  };
}

/**
 * The answer among up to WRONG_CHOICES wrong options from `pool`, in an order set by `seed`. A
 * wrong option is never one that could pass for the answer. Undefined when the pool has fewer
 * than two usable options: the card stays self-rated.
 */
export function withChoices(answer: string, pool: string[], seed: number): string[] | undefined {
  const rnd = rng(seed);
  const wrong: string[] = [];
  const shuffled = [...new Set(pool.map((x) => x.trim()).filter(Boolean))]
    .map((x) => ({ x, k: rnd() }))
    .sort((a, b) => a.k - b.k)
    .map(({ x }) => x);
  for (const x of shuffled) {
    if (wrong.length >= WRONG_CHOICES) break;
    if (!tooSimilar(answer, x) && !wrong.some((w) => tooSimilar(w, x))) wrong.push(x);
  }
  if (wrong.length < 2) return undefined;
  const out = [...wrong];
  out.splice(Math.floor(rnd() * (out.length + 1)), 0, answer);
  return out;
}
