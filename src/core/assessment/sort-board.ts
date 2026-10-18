// Sort my words as a matching board: a few words and their meanings plus one decoy, so the last
// pair is never free. Matching a word proves it is known; the learner sends off the words they
// don't know. Pure functions; the app holds the board.

/** A short meaning for a board tile: the first senses of a list gloss, within about 36 characters. */
export function boardGloss(gloss: string): string {
  // Usage notes in square brackets ("[usually erroneously]") are left for the full meaning.
  const whole = gloss.trim().replace(/…$/, '').replace(/\s*\[[^\]]*\]?/g, '').trim() || gloss.trim();
  const s = whole.replace(/^\([^)]*\)\s*/, '') || whole; // a leading label: "(verb) to eat"
  const senses = s.split(/\s*;\s*/).filter(Boolean);
  let out = senses[0] ?? s;
  for (const x of senses.slice(1)) {
    if (out.length + x.length + 2 > 36) break;
    out += `; ${x}`;
  }
  return out.length > 48 ? `${out.slice(0, 46).replace(/[\s,]+\S*$/, '')}…` : out;
}

/** The senses of a meaning, compared loosely: lower case, no brackets, no leading "to" or article. */
function senseKeys(meaning: string): string[] {
  return meaning
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]|…/g, ' ')
    .split(/[;,/]/)
    .map((x) => x.trim().replace(/^(to|a|an|the)\s+/, '').replace(/\s+/g, ' '))
    .filter((x) => x.length > 1);
}

/**
 * Two meanings a learner could not tell apart on the board ("dad; father" and "father"). A word
 * matched with either counts as right, and a decoy is never one of these.
 */
export function tooSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  const keys = new Set(senseKeys(a));
  return senseKeys(b).some((k) => keys.has(k));
}

export interface BoardItem {
  id: number;
  meaning: string;
}

export interface Board<T extends BoardItem> {
  /** On the board, in the order shown. */
  words: T[];
  /** Still to come this round. */
  queue: T[];
  /** The words' meanings and the decoy, in the order shown. */
  meanings: string[];
  decoy: string | null;
}

function rng(seed: number): () => number {
  let t = seed >>> 0 || 1;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function newBoard<T extends BoardItem>(queue: T[], size: number, decoys: string[], seed: number): Board<T> {
  return settle({ words: [], queue, meanings: [], decoy: null }, size, decoys, seed);
}

/** Take a word off the board (matched or sent off). Once the board is clear, the next set comes on. */
export function removeWord<T extends BoardItem>(b: Board<T>, id: number, size: number, decoys: string[], seed: number): Board<T> {
  const words = b.words.filter((w) => w.id !== id);
  if (!words.length) return newBoard(b.queue, size, decoys, seed);
  return settle({ ...b, words }, words.length, decoys, seed);
}

/** Put a word back on the board (an undo), over the usual size for now. */
export function returnWord<T extends BoardItem>(b: Board<T>, word: T, size: number, decoys: string[], seed: number): Board<T> {
  return settle({ ...b, words: [...b.words.filter((w) => w.id !== word.id), word] }, Math.max(size, b.words.length + 1), decoys, seed);
}

/**
 * Fill the board from the queue and bring the meanings in line with the words. Meanings already
 * shown keep their places (no reshuffle under the learner's finger), the decoy too while it still
 * cannot be matched with a board word; new ones and a fresh decoy
 * go into the places just freed, at random, or at random places when there are none. The decoy
 * is never one a board word could be matched with.
 */
export function settle<T extends BoardItem>(b: Board<T>, size: number, decoys: string[], seed: number): Board<T> {
  const words = [...b.words];
  const queue = [...b.queue];
  while (words.length < size && queue.length) words.push(queue.shift()!);
  const wanted = words.map((w) => w.meaning);
  // The decoy stays where it is while no word on the board could be matched with it.
  const keepDecoy = b.decoy !== null && words.length > 0 && !words.some((w) => tooSimilar(w.meaning, b.decoy!));
  // Shown meanings that stay, with null for the places freed.
  const slots: (string | null)[] = [];
  let decoySkipped = false;
  for (const m of b.meanings) {
    if (!decoySkipped && m === b.decoy) {
      decoySkipped = true;
      slots.push(keepDecoy ? m : null);
      continue;
    }
    const k = wanted.indexOf(m);
    if (k < 0) {
      slots.push(null);
      continue;
    }
    slots.push(m);
    wanted.splice(k, 1);
  }
  const rnd = rng(seed);
  const pool = decoys.filter((d) => !words.some((w) => tooSimilar(w.meaning, d)));
  const decoy = keepDecoy ? b.decoy : words.length && pool.length ? pool[Math.floor(rnd() * pool.length)]! : null;
  for (const m of decoy === null || keepDecoy ? wanted : [...wanted, decoy]) {
    const free = slots.flatMap((x, i) => (x === null ? [i] : []));
    if (free.length) slots[free[Math.floor(rnd() * free.length)]!] = m;
    else slots.splice(Math.floor(rnd() * (slots.length + 1)), 0, m);
  }
  return { words, queue, meanings: slots.filter((x): x is string => x !== null), decoy };
}
