// Published releases are named by date, 2026.10.18, with .2, .3 for a second or third that day.

/** Whether release `b` is later than `a` ('dev' and unknown names are never compared). */
export function isNewer(a: string, b: string): boolean {
  const parse = (s: string) => (/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(s) ? s.split('.').map(Number) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 4; i++) {
    const d = (y[i] ?? 1) - (x[i] ?? 1);
    if (d) return d > 0;
  }
  return false;
}

/** The release after `last` for a release made on `today` (YYYY-MM-DD). */
export function nextRelease(last: string, today: string): string {
  const day = today.replace(/-/g, '.');
  if (!last.startsWith(day)) return day;
  const n = Number(last.slice(day.length + 1)) || 1;
  return `${day}.${n + 1}`;
}
