// Cron job (every 15 min): for each language, send the reminder whose slot has come, unless it is
// quiet hours, the slot was already sent today, or today's session is already done.
import type { Env } from './env';
import { listLanguages } from '../core/languages';
import { dueSlot, composeReminder, DEFAULT_NOTIFY_TIMES, DEFAULT_QUIET, type QuietHours } from '../core/notify/schedule';
import { getSetting, localToday, enabledLanguages } from './day';
import { computeSession, toState } from './session';
import { sendNotice } from './push';

export async function runReminders(env: Env, now = new Date()): Promise<string[]> {
  const log: string[] = [];
  if (!(await getSetting(env.DB, 'notify.enabled', true))) return ['disabled'];
  const subs = (await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>())?.n ?? 0;
  if (subs === 0) return ['no subscriptions'];

  const today = await localToday(env.DB, now);
  const quiet = await getSetting<QuietHours | null>(env.DB, 'notify.quiet', DEFAULT_QUIET);
  // Only languages switched on get reminders (an empty course should not nag).
  const enabled = new Set(await enabledLanguages(env.DB));
  for (const lang of listLanguages().filter((l) => enabled.has(l.id))) {
    const times = await getSetting<unknown>(env.DB, `${lang.id}.notify_times`, DEFAULT_NOTIFY_TIMES);
    const { results } = await env.DB.prepare('SELECT slot FROM notifications_log WHERE lang = ?1 AND local_date = ?2').bind(lang.id, today.date).all<{ slot: string }>();
    // Cheap check first; only compute the session when a slot is actually due.
    const candidate = dueSlot({ nowMinutes: today.minutes, times, quiet, sentToday: results.map((r) => r.slot), sessionDone: false });
    if (!candidate) continue;
    const session = await computeSession(env.DB, lang.id);
    if (session.done) {
      log.push(`${lang.id} ${candidate}: session done, skipped`);
      continue;
    }
    const msg = composeReminder(toState(session), candidate);
    const r = await sendNotice(env, { lang: lang.id, slot: candidate, title: msg.title, body: msg.body, url: '/#/' });
    log.push(`${lang.id} ${candidate}: sent to ${r.sent}, removed ${r.removed} (${msg.body})`);
  }
  return log;
}
