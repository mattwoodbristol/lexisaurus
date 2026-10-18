// When to send a reminder, and what it says. Pure functions; the cron calls them every 15 min.
import { parseHHMM } from '../time';

export interface QuietHours {
  start: string; // "22:00"
  end: string; // "07:00"; may wrap past midnight
}

export const DEFAULT_NOTIFY_TIMES = ['07:30', '19:30'];
export const DEFAULT_QUIET: QuietHours = { start: '22:00', end: '07:00' };
/** A slot missed by a skipped cron tick is still sent within this window, never later. */
export const CATCH_UP_MINUTES = 120;

export function inQuietHours(minutes: number, quiet: QuietHours | null | undefined): boolean {
  if (!quiet) return false;
  const s = parseHHMM(quiet.start);
  const e = parseHHMM(quiet.end);
  if (s === null || e === null || s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

export interface DueInput {
  /** Local minutes since midnight. */
  nowMinutes: number;
  times: unknown; // validated here: array of "HH:MM"
  quiet: QuietHours | null;
  /** Slots ("HH:MM") already sent today for this language. */
  sentToday: string[];
  sessionDone: boolean;
}

/** The slot to send now, or null. At most one per tick (the latest due slot). */
export function dueSlot(i: DueInput): string | null {
  if (i.sessionDone) return null;
  if (inQuietHours(i.nowMinutes, i.quiet)) return null;
  const times = Array.isArray(i.times) ? i.times : [];
  let best: { slot: string; m: number } | null = null;
  for (const t of times) {
    const m = parseHHMM(t);
    if (m === null) continue;
    const slot = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    if (i.sentToday.includes(slot)) continue;
    if (i.nowMinutes < m || i.nowMinutes >= m + CATCH_UP_MINUTES) continue;
    if (!best || m > best.m) best = { slot, m };
  }
  return best?.slot ?? null;
}

export interface SessionState {
  langName: string;
  reviews: { remaining: number; done: boolean };
  grammar: { title: string | null; done: boolean } | null;
  /** Today's lesson step: null when there is no lesson left to work on. */
  lesson?: { title: string | null; done: boolean } | null;
  listening?: { done: boolean };
  conversation: { topic: string | null; done: boolean };
}

export function sessionDone(s: SessionState): boolean {
  return s.reviews.done && (s.grammar?.done ?? true) && (s.lesson?.done ?? true) && (s.listening?.done ?? true) && s.conversation.done;
}

/** Notification text listing only what is left. */
export function composeReminder(s: SessionState, slot: string): { title: string; body: string } {
  const left: string[] = [];
  if (!s.reviews.done && s.reviews.remaining > 0) left.push(`${s.reviews.remaining} review${s.reviews.remaining === 1 ? '' : 's'}`);
  if (s.grammar && !s.grammar.done && s.grammar.title) left.push(`grammar: ${s.grammar.title}`);
  if (s.lesson && !s.lesson.done) left.push(s.lesson.title ? `lesson: ${s.lesson.title}` : 'a lesson step');
  if (s.listening && !s.listening.done) left.push('listening');
  if (!s.conversation.done) left.push(s.conversation.topic ? `chat: ${s.conversation.topic}` : 'a short chat');
  const evening = (parseHHMM(slot) ?? 0) >= 15 * 60;
  const title = `${s.langName} · ${evening ? 'still to do today' : "today's practice"}`;
  return { title, body: left.length ? left.join(' · ') : 'All done for today.' };
}
