// Local-time helpers. The Worker runs in UTC; "today", reminder times and quiet hours are in the
// learner's time zone (default Europe/London), so everything goes through Intl.

export const DEFAULT_TZ = 'Europe/London';

export interface LocalParts {
  date: string; // YYYY-MM-DD
  minutes: number; // minutes since local midnight
  hhmm: string;
}

export function localParts(now: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const h = Number(get('hour')) % 24;
  const m = Number(get('minute'));
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: h * 60 + m, hhmm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
}

/** Offset of the zone from UTC at `at`, in minutes (Europe/London in summer = +60). */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const p = localParts(at, tz);
  const [y, mo, d] = p.date.split('-').map(Number) as [number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, Math.floor(p.minutes / 60), p.minutes % 60);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** UTC instant of local midnight at the start of the local day containing `now`. */
export function startOfLocalDay(now: Date, tz: string): Date {
  const p = localParts(now, tz);
  const [y, mo, d] = p.date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, mo - 1, d);
  return new Date(guess - tzOffsetMinutes(new Date(guess), tz) * 60000);
}

export function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "07:30" -> 450; invalid -> null. */
export function parseHHMM(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
