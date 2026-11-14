// The daily session, composed by code and done in this order: due reviews (within the daily cap),
// grammar points (session.grammar_per_day), a step of the next lesson, a listening, and a conversation on the next topic.
import { Hono } from 'hono';
import type { Env } from './env';
import { dayStartIso, getSetting, localToday } from './day';
import { dueNow, reviewedToday } from './review';
import { enterLearntGrammar } from './lessons';
import { suggestTopic } from './topics';
import { getLanguage } from '../core/languages';
import { sessionDone, type SessionState } from '../core/notify/schedule';
import { trackway, type Trackway } from '../core/trackway';

export interface DailySession {
  lang: string;
  reviews: { remaining: number; doneToday: number; due: number; dueGrammar: number; limit: number; done: boolean };
  grammar: {
    cardId: number;
    pointId: number;
    title: string;
    summary: string | null;
    lessonId: number | null;
    done: boolean;
    /** Grammar points reviewed today, of session.grammar_per_day. */
    doneToday: number;
    perDay: number;
  } | null;
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

  const due = await dueNow(db, lang);
  // Of those, grammar cards (the rest are words): practising them first takes them out of Review.
  const dueGrammar =
    (await db.prepare(`SELECT COUNT(*) AS n FROM srs_cards WHERE lang = ?1 AND item_type = 'grammar_point' AND due_at <= ?2`).bind(lang, now).first<{ n: number }>())?.n ?? 0;
  const doneToday = await reviewedToday(db, lang);
  const remaining = Math.max(0, Math.min(due, limit - doneToday));

  // Grammar of the day: a quiz of session.grammar_per_day examples (default 1), taken in turns from
  // the grammar points, most overdue first (2026-11-04). Done once that many are answered today
  // from its Practise; a grammar card met in the day's reviews does not count. Shows the point it
  // starts with, or once done the last one practised.
  const perDay = Math.max(1, Math.round(Number(await getSetting(db, 'session.grammar_per_day', 1)) || 1));
  type GRow = { card_id: number; point_id: number; title: string; summary: string | null; lesson_id: number | null };
  const gSel = `SELECT s.id AS card_id, g.id AS point_id, g.title, g.summary, g.lesson_id FROM srs_cards s JOIN grammar_points g ON g.id = s.item_id WHERE s.item_type = 'grammar_point' AND s.lang = ?1`;
  const grammarDoneRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM reviews r JOIN srs_cards s ON s.id = r.card_id
       WHERE s.item_type = 'grammar_point' AND s.lang = ?1 AND r.reviewed_at >= ?2 AND r.via = 'practise'`,
    )
    .bind(lang, start)
    .first<{ n: number }>();
  const grammarDoneToday = grammarDoneRow?.n ?? 0;
  // Grammar from every previous lesson is in the reviews: bring in any not yet there (a lesson
  // learnt before that started counting, or completed without its Learn step).
  await enterLearntGrammar(db, lang);
  const grammarDone = grammarDoneToday >= perDay;
  const gRow = grammarDone
    ? await db
        .prepare(`${gSel} ORDER BY (SELECT MAX(r.reviewed_at) FROM reviews r WHERE r.card_id = s.id AND r.via = 'practise' AND r.reviewed_at >= ?2) DESC LIMIT 1`)
        .bind(lang, start)
        .first<GRow>()
    : await db.prepare(`${gSel} ORDER BY s.due_at LIMIT 1`).bind(lang).first<GRow>();
  const grammar = gRow
    ? {
        cardId: gRow.card_id,
        pointId: gRow.point_id,
        title: gRow.title,
        summary: gRow.summary,
        lessonId: gRow.lesson_id,
        done: grammarDone,
        doneToday: grammarDoneToday,
        perDay,
      }
    : null;

  // Lesson: any step saved, check taken or lesson marked done today counts (a review quiz passing
  // a lesson check, or lessons skipped after the level check, do not).
  const lessonRow = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE l.lang = ?1 AND p.updated_at >= ?2)
           OR EXISTS (SELECT 1 FROM lesson_checks k JOIN lessons l ON l.id = k.lesson_id WHERE l.lang = ?1 AND k.created_at >= ?2)
           AS done,
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
    reviews: { remaining, doneToday, due, dueGrammar, limit, done: remaining === 0 },
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
