// The daily session, composed by code and done in this order: due reviews (within the daily cap),
// one grammar point, a step of the next lesson, a listening, and a conversation on the next topic.
import { Hono } from 'hono';
import type { Env } from './env';
import { dayStartIso, getSetting, localToday } from './day';
import { reviewedToday } from './review';
import { enterLearntGrammar } from './lessons';
import { suggestTopic } from './topics';
import { getLanguage } from '../core/languages';
import { sessionDone, type SessionState } from '../core/notify/schedule';
import { trackway, type Trackway } from '../core/trackway';

export interface DailySession {
  lang: string;
  reviews: { remaining: number; doneToday: number; due: number; limit: number; done: boolean };
  grammar: { cardId: number; pointId: number; title: string; summary: string | null; lessonId: number | null; done: boolean } | null;
  /** A step of a lesson done today; null when no lesson is left and none was worked on today. */
  lesson: { title: string | null; done: boolean } | null;
  /** A listening finished today. */
  listening: { done: boolean };
  conversation: { done: boolean; userTurnsToday: number; needed: number; topic: { id: number; name: string; scenario: string | null } | null; conversationId: number | null };
  done: boolean;
  /** Streak of days with any practice, across languages. */
  trackway: Trackway;
}

/** A print on the trackway: any practice today counts, in any language (idempotent). */
export async function recordStudyDay(db: D1Database, lang: string): Promise<void> {
  const today = (await localToday(db)).date;
  await db.prepare('INSERT OR IGNORE INTO study_days(day, lang) VALUES (?1, ?2)').bind(today, lang).run();
}

async function updateTrackway(db: D1Database, lang: string, practised: boolean): Promise<Trackway> {
  const today = (await localToday(db)).date;
  if (practised) await recordStudyDay(db, lang);
  const { results } = await db.prepare('SELECT DISTINCT day FROM study_days').all<{ day: string }>();
  return trackway(
    results.map((r) => r.day),
    today,
  );
}

export async function computeSession(db: D1Database, lang: string): Promise<DailySession> {
  const start = await dayStartIso(db);
  const now = new Date().toISOString();
  const limit = Number(await getSetting(db, 'review.daily_limit', 60)) || 60;
  const needed = Number(await getSetting(db, 'session.min_chat_turns', 3)) || 3;

  const due = (await db.prepare('SELECT COUNT(*) AS n FROM srs_cards WHERE lang = ?1 AND due_at <= ?2').bind(lang, now).first<{ n: number }>())?.n ?? 0;
  const doneToday = await reviewedToday(db, lang);
  const remaining = Math.max(0, Math.min(due, limit - doneToday));

  // Grammar point of the day: one already reviewed today, else the most overdue, else the
  // soonest due (pulled forward), so there is one every day once any lesson is marked done.
  const gSel = `SELECT s.id AS card_id, g.id AS point_id, g.title, g.summary, g.lesson_id FROM srs_cards s JOIN grammar_points g ON g.id = s.item_id WHERE s.item_type = 'grammar_point' AND s.lang = ?1`;
  const reviewedG = await db
    .prepare(`${gSel} AND EXISTS (SELECT 1 FROM reviews r WHERE r.card_id = s.id AND r.reviewed_at >= ?2) LIMIT 1`)
    .bind(lang, start)
    .first<{ card_id: number; point_id: number; title: string; summary: string | null; lesson_id: number | null }>();
  type GRow = { card_id: number; point_id: number; title: string; summary: string | null; lesson_id: number | null };
  const soonest = () => db.prepare(`${gSel} ORDER BY s.due_at LIMIT 1`).bind(lang).first<GRow>();
  let nextG = reviewedG ?? (await soonest());
  // No grammar in the reviews yet: bring in any lesson whose Learn step was done before that
  // started counting (a lesson in progress, check not yet taken).
  if (!nextG && (await enterLearntGrammar(db, lang))) nextG = await soonest();
  const grammar = nextG
    ? { cardId: nextG.card_id, pointId: nextG.point_id, title: nextG.title, summary: nextG.summary, lessonId: nextG.lesson_id, done: !!reviewedG }
    : null;

  // Lesson: any step saved, check taken or lesson marked done today counts.
  const lessonRow = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE l.lang = ?1 AND p.updated_at >= ?2)
           OR EXISTS (SELECT 1 FROM lesson_checks k JOIN lessons l ON l.id = k.lesson_id WHERE l.lang = ?1 AND k.created_at >= ?2)
           OR EXISTS (SELECT 1 FROM lessons WHERE lang = ?1 AND completed_at >= ?2) AS done,
         (SELECT title FROM lessons WHERE lang = ?1 AND course_no IS NOT NULL AND completed_at IS NULL ORDER BY course_no LIMIT 1) AS next`,
    )
    .bind(lang, start)
    .first<{ done: number; next: string | null }>();
  const lessonDone = !!lessonRow?.done;
  const lesson = lessonDone || lessonRow?.next ? { title: lessonRow?.next ?? null, done: lessonDone } : null;
  const listened = await db.prepare('SELECT 1 AS x FROM listenings WHERE lang = ?1 AND done_at >= ?2 LIMIT 1').bind(lang, start).first<{ x: number }>();

  const turns = await db
    .prepare(
      `SELECT c.id AS conversation_id, COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.lang = ?1 AND m.role = 'user' AND m.created_at >= ?2 GROUP BY c.id ORDER BY n DESC LIMIT 1`,
    )
    .bind(lang, start)
    .first<{ conversation_id: number; n: number }>();
  const userTurnsToday = turns?.n ?? 0;
  const convDone = userTurnsToday >= needed;
  const topic = convDone ? null : await suggestTopic(db, lang);

  const s: DailySession = {
    lang,
    reviews: { remaining, doneToday, due, limit, done: remaining === 0 },
    grammar,
    lesson,
    listening: { done: !!listened },
    conversation: {
      done: convDone,
      userTurnsToday,
      needed,
      topic: topic ? { id: topic.id, name: topic.name, scenario: topic.scenario } : null,
      conversationId: turns?.conversation_id ?? null,
    },
    done: false,
    trackway: { streak: 0, best: 0, todayDone: false, recent: [] },
  };
  s.done = sessionDone(toState(s));
  // One thing done today keeps the trackway going.
  const practised = s.reviews.doneToday > 0 || !!s.grammar?.done || !!s.lesson?.done || s.listening.done || s.conversation.done;
  s.trackway = await updateTrackway(db, lang, practised);
  return s;
}

export function toState(s: DailySession): SessionState {
  return {
    langName: getLanguage(s.lang)?.id === 'zh' ? '中文' : (getLanguage(s.lang)?.name ?? s.lang),
    reviews: { remaining: s.reviews.remaining, done: s.reviews.done },
    grammar: s.grammar ? { title: s.grammar.title, done: s.grammar.done } : null,
    lesson: s.lesson,
    listening: s.listening,
    conversation: { topic: s.conversation.topic?.name ?? null, done: s.conversation.done },
  };
}

export const sessionRoutes = new Hono<{ Bindings: Env }>();

sessionRoutes.get('/today', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  if (!getLanguage(lang)) return c.json({ error: 'unknown language' }, 400);
  return c.json(await computeSession(c.env.DB, lang));
});
