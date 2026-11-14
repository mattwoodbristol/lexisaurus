// The learner's "today", in their time zone (setting `tz`, default Europe/London).
import { DEFAULT_TZ, isValidTz, startOfLocalDay, localParts } from '../core/time';
import { DEFAULT_ENABLED, getLanguage } from '../core/languages';

export async function getSetting<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?1').bind(key).first<{ value: string }>();
  try {
    return row ? (JSON.parse(row.value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function userTz(db: D1Database): Promise<string> {
  const tz = await getSetting<string>(db, 'tz', DEFAULT_TZ);
  return typeof tz === 'string' && isValidTz(tz) ? tz : DEFAULT_TZ;
}

/** ISO timestamp of local midnight today; compare against stored UTC ISO timestamps. */
export async function dayStartIso(db: D1Database, now = new Date()): Promise<string> {
  return startOfLocalDay(now, await userTz(db)).toISOString();
}

export async function localToday(db: D1Database, now = new Date()) {
  return localParts(now, await userTz(db));
}

/**
 * Highest difficulty band (1-6) the pool introduces and asks to sort for a language (setting
 * <lang>.pool_max_band); null for no limit. Harder words wait until the learner raises it.
 */
export async function poolMaxBand(db: D1Database, lang: string): Promise<number | null> {
  const v = await getSetting<unknown>(db, `${lang}.pool_max_band`, null);
  return typeof v === 'number' && v >= 1 && v <= 6 ? Math.round(v) : null;
}

/** Languages switched on (setting languages.enabled; Mandarin only by default). */
export async function enabledLanguages(db: D1Database): Promise<string[]> {
  const list = await getSetting<unknown>(db, 'languages.enabled', DEFAULT_ENABLED);
  const ids = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && !!getLanguage(x)) : [];
  return ids.length ? ids : [...DEFAULT_ENABLED];
}

/**
 * Background jobs that call Claude (every cron run) wait after a run that got nothing done, so a
 * job that keeps failing does not spend the day's token budget. The time of that run is kept in
 * the setting `key`.
 */
export async function heldBack(db: D1Database, key: string, ms: number): Promise<boolean> {
  const at = Date.parse(await getSetting<string>(db, key, ''));
  return Date.now() - at < ms;
}

export async function holdBack(db: D1Database, key: string, idle: boolean): Promise<void> {
  if (idle) await db.prepare('INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, JSON.stringify(new Date().toISOString())).run();
  else await db.prepare('DELETE FROM settings WHERE key = ?1').bind(key).run();
}
