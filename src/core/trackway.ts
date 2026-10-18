// Trackway: the streak of days with any practice, shown as a line of footprints.
// Pure: takes the set of practised days (YYYY-MM-DD, any order, any language) and local today.

export interface Trackway {
  /** Consecutive finished days ending today or yesterday (today need not be done yet). */
  streak: number;
  /** Longest run ever. */
  best: number;
  todayDone: boolean;
  /** The last `window` days, oldest first, with today last. */
  recent: { date: string; done: boolean }[];
}

export const TRACKWAY_WINDOW = 7;

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function trackway(days: Iterable<string>, today: string, window = TRACKWAY_WINDOW): Trackway {
  const set = new Set(days);
  const todayDone = set.has(today);

  let streak = 0;
  for (let d = todayDone ? today : addDays(today, -1); set.has(d); d = addDays(d, -1)) streak++;

  let best = 0;
  for (const d of set) {
    if (set.has(addDays(d, -1))) continue; // only count runs from their first day
    let n = 0;
    for (let e = d; set.has(e); e = addDays(e, 1)) n++;
    best = Math.max(best, n);
  }

  const recent: Trackway['recent'] = [];
  for (let i = window - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    recent.push({ date, done: set.has(date) });
  }
  return { streak, best: Math.max(best, streak), todayDone, recent };
}
