import { Hono } from 'hono';
import type Anthropic from '@anthropic-ai/sdk';
import type { Env } from './env';
import { z } from 'zod';
import { callClaude, callStructured, claudeErrorResponse } from './claude';
import { acceptUses, MAX_STUDIED, usageInstruction, type AcceptedUse, type StudiedPoint } from '../core/chat/usage';
import { acceptHint, DEFAULT_HINT_EVERY, hintInstruction, pickCandidates, shouldOfferHint, type HintCandidate, type MessageHint } from '../core/chat/hints';
import { getDict, recordExposures, targetWords } from './words';
import { pinyinPerChar } from './pinyin';
import { markTopicUsed } from './topics';
import { annotate, type Token } from '../core/pinyin/annotate';
import { stripPinyin } from '../core/pinyin/strip';
import { getLanguage, type LanguageConfig } from '../core/languages';
import { promptsFor, translatePrompt } from '../../prompts';
import { rulesFor } from '../core/text/rules';
import { acceptCorrections, chooseShown, correctorSystem, DEFAULT_CORRECTION_LEVEL, TUTOR_NO_CORRECTIONS, type Correction, isCorrectionLevel, shownKeys, summariseCorrections, type CorrectionLevel, type ShownCorrection } from '../core/chat/corrections';
import { getSetting } from './day';
import { learnerProfile } from './learner';
import { explainFor } from './explain';
import { levelCheck } from './level';
import { DEFAULT_NATIVE, nativeLanguage } from '../core/languages/native';
import { saveStep } from './lessons';

export const chatRoutes = new Hono<{ Bindings: Env }>();

const HISTORY_TURNS = 20;
/** Stand-in first user turn when the tutor opens the conversation (the API needs user first). */
const OPENING_CUE = '（请开始。）';

interface MessageRow {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant';
  text: string;
  created_at: string;
  tokens_json: string | null;
  translation: string | null;
  hint_json: string | null;
  translation_lang: string | null;
  corrections_json: string | null;
}

interface ConvRow {
  id: number;
  lang: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  topic_id: number | null;
  custom_topic: string | null;
  lesson_id: number | null;
  topic_name: string | null;
  scenario: string | null;
}

function toMessage(r: MessageRow) {
  return {
    id: r.id,
    role: r.role,
    text: r.text,
    createdAt: r.created_at,
    tokens: r.tokens_json ? (JSON.parse(r.tokens_json) as Token[]) : undefined,
    translation: r.translation ?? undefined,
    translationLang: r.translation ? (r.translation_lang ?? 'en') : undefined,
    hint: r.hint_json ? (JSON.parse(r.hint_json) as MessageHint) : undefined,
    corrections: r.corrections_json ? (JSON.parse(r.corrections_json) as ShownCorrection[]) : undefined,
  };
}

/**
 * A chat started from a lesson's "Use it" step ticks that step off once it has the day's chat
 * turns (session.min_chat_turns), or when it is finished with at least one learner turn.
 */
async function tickUseStep(db: D1Database, convId: number, lessonId: number, finishing: boolean): Promise<void> {
  const n = (await db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?1 AND role = 'user'").bind(convId).first<{ n: number }>())?.n ?? 0;
  const needed = finishing ? 1 : Number(await getSetting(db, 'session.min_chat_turns', 3)) || 3;
  if (n >= needed) await saveStep(db, lessonId, 'use');
}

async function loadConv(db: D1Database, id: number): Promise<ConvRow | null> {
  return db
    .prepare(
      `SELECT c.id, c.lang, c.title, c.started_at, c.ended_at, c.topic_id, c.custom_topic, c.lesson_id, t.name AS topic_name, t.scenario_seed AS scenario
       FROM conversations c LEFT JOIN topics t ON t.id = c.topic_id WHERE c.id = ?1`,
    )
    .bind(id)
    .first<ConvRow>();
}

function topicLine(conv: ConvRow): string {
  const name = conv.topic_name ?? conv.custom_topic;
  if (!name) return 'Topic: none assigned. Follow the learner wherever the conversation goes.';
  const scen = conv.scenario ? ` Scenario: ${conv.scenario}` : '';
  return `Topic for this session: ${name}.${scen} Stay on this topic and do not steer the conversation to a different one. If the learner changes the subject, go along with them.`;
}

function sessionFragment(lang: LanguageConfig, conv: ConvRow, targets: string[], measured: string | null = null): string {
  // A level check, when taken, replaces the hand-written level description.
  const parts = [`Language: ${lang.name}.`, `Learner level: ${measured ?? lang.userLevel}`, `Tutor style: ${lang.tutorStyle}`, `Language rule: ${lang.conversationLanguageRule}`, topicLine(conv)];
  if (targets.length) parts.push(`Target words to use naturally if they fit: ${targets.join('、')}.`);
  return parts.join('\n');
}

async function history(db: D1Database, id: number): Promise<Anthropic.MessageParam[]> {
  const { results } = await db
    .prepare('SELECT role, text FROM messages WHERE conversation_id = ?1 ORDER BY id DESC LIMIT ?2')
    .bind(id, HISTORY_TURNS)
    .all<{ role: 'user' | 'assistant'; text: string }>();
  const msgs: Anthropic.MessageParam[] = results.reverse().map((m) => ({ role: m.role, content: m.text }));
  if (msgs[0]?.role === 'assistant') msgs.unshift({ role: 'user', content: OPENING_CUE });
  return msgs;
}

const TutorStructured = z.object({
  reply: z.string(),
  hint: z.object({ grammarPointId: z.number().int(), text: z.string() }).nullable(),
  used: z.array(z.object({ grammarPointId: z.number().int(), correct: z.boolean(), quote: z.string() })),
});

const CheckResult = z.object({
  corrections: z.array(z.object({ wrong: z.string(), right: z.string(), note: z.string(), severity: z.enum(['meaning', 'target', 'minor']) })),
});

/**
 * Check the learner's message for mistakes (runs alongside the tutor's reply). A failed check
 * costs the learner nothing: the chat carries on without corrections.
 */
async function checkMessage(env: Env, conv: ConvRow, previousTutor: string | null, learnerText: string, practising: string | null, explain: string): Promise<Correction[]> {
  try {
    const recurring = await recentMistakes(env.DB, conv.lang);
    const context = previousTutor ? `The tutor had said: ${previousTutor}

` : '';
    const out = await callStructured(env, {
      role: 'checking',
      system: [correctorSystem(promptsFor(conv.lang).name, recurring, practising, explain)],
      messages: [{ role: 'user', content: `${context}The learner's message to check:
${learnerText}` }],
      maxTokens: 1000,
      effort: 'low',
      schema: CheckResult,
    });
    return acceptCorrections(out.corrections, learnerText);
  } catch {
    return [];
  }
}

/** The learner's most recent recurring mistakes, so the tutor can rate a repeat as on target. */
async function recentMistakes(db: D1Database, lang: string): Promise<{ wrong: string; right: string }[]> {
  const { results } = await db.prepare('SELECT wrong, right FROM mistakes WHERE lang = ?1 ORDER BY id DESC LIMIT 12').bind(lang).all<{ wrong: string; right: string }>();
  return results;
}

/** Grammar points to offer as a hint on this reply, or none (see core/chat/hints.ts). */
async function hintCandidates(db: D1Database, conv: ConvRow): Promise<HintCandidate[]> {
  const setting = await db.prepare("SELECT value FROM settings WHERE key = 'chat.hint_every'").first<{ value: string }>();
  const every = setting ? Number(JSON.parse(setting.value)) : DEFAULT_HINT_EVERY;
  const { results: replies } = await db
    .prepare("SELECT hint_json FROM messages WHERE conversation_id = ?1 AND role = 'assistant' ORDER BY id")
    .bind(conv.id)
    .all<{ hint_json: string | null }>();
  const lastHint = replies.map((r) => !!r.hint_json).lastIndexOf(true);
  const offer = shouldOfferHint({
    every: Number.isFinite(every) ? every : DEFAULT_HINT_EVERY, // 0 = hints off
    tutorRepliesSoFar: replies.length,
    repliesSinceHint: lastHint < 0 ? null : replies.length - 1 - lastHint,
  });
  if (!offer) return [];
  const hinted = new Set(replies.flatMap((r) => (r.hint_json ? [(JSON.parse(r.hint_json) as MessageHint).grammarPointId] : [])));
  const { results: points } = await db
    .prepare(
      `SELECT g.id, g.title, g.summary, g.lesson_id AS lessonId, s.due_at AS dueAt
       FROM grammar_points g JOIN lessons l ON l.id = g.lesson_id
       LEFT JOIN srs_cards s ON s.item_type = 'grammar_point' AND s.item_id = g.id
       WHERE g.lang = ?1 AND l.completed_at IS NOT NULL`,
    )
    .bind(conv.lang)
    .all<HintCandidate>();
  return pickCandidates(points, hinted);
}

/** Ask the tutor, then enforce the rules in code and store the annotated reply. */
/** Grammar points from finished lessons: the ones whose use in chat is noticed. */
async function studiedPoints(db: D1Database, lang: string): Promise<StudiedPoint[]> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.title, g.summary FROM grammar_points g JOIN lessons l ON l.id = g.lesson_id
       WHERE g.lang = ?1 AND (l.completed_at IS NOT NULL OR EXISTS (SELECT 1 FROM lesson_checks k WHERE k.lesson_id = l.id AND k.passed = 1))
       ORDER BY l.course_no DESC LIMIT ?2`,
    )
    .bind(lang, MAX_STUDIED)
    .all<StudiedPoint>();
  return results;
}

/**
 * Ask the tutor, then enforce the rules in code and store the annotated reply. When the learner
 * has just written something (`learner`), the reply also reports any studied grammar they used.
 */
async function tutorReply(env: Env, conv: ConvRow, lang: LanguageConfig, messages: Anthropic.MessageParam[], learner: { id: number; text: string } | null = null) {
  const targets = await targetWords(env.DB, conv.lang);
  const measured = (await levelCheck(env.DB, conv.lang))?.text ?? null;
  const [profile, explain] = await Promise.all([learnerProfile(env.DB, conv.lang), explainFor(env.DB, conv.lang)]);
  const system = [promptsFor(conv.lang).tutor, sessionFragment(lang, conv, targets, measured) + (profile ? `
About the learner (for topics and follow-up questions; use lightly): ${profile}` : '') + `\n${explain.instruction}`];
  const candidates = await hintCandidates(env.DB, conv);
  const studied = learner ? await studiedPoints(env.DB, conv.lang) : [];
  let text: string;
  let hint: MessageHint | null = null;
  let uses: AcceptedUse[] = [];
  let corrections: ShownCorrection[] = [];
  if (learner || candidates.length || studied.length) {
    // Structured output so the hint, grammar-use and corrections reports arrive separately from the
    // conversation (the reply itself stays pure conversation).
    const practising = conv.custom_topic?.startsWith('Practise ') ? conv.custom_topic.slice(9, 120) : null;
    const previousTutor = [...messages].reverse().find((m) => m.role === 'assistant');
    const checking = learner ? checkMessage(env, conv, typeof previousTutor?.content === 'string' ? previousTutor.content : null, learner.text, practising, explain.corrections.instruction) : Promise.resolve([]);
    const extra = [
      candidates.length ? hintInstruction(candidates, explain.instruction) : 'No grammar hint on this reply: set "hint" to null.',
      studied.length ? usageInstruction(studied) : 'Set "used" to an empty list.',
      ...(learner ? [TUTOR_NO_CORRECTIONS] : []),
    ];
    const [out, found] = await Promise.all([callStructured(env, { role: 'chat', system: [...system, ...extra], messages, maxTokens: 800, schema: TutorStructured }), checking]);
    text = out.reply;
    hint = candidates.length ? acceptHint(out.hint, candidates) : null;
    if (learner) {
      // Which corrections to show now: the setting, Strict in a lesson's practice chat, never the
      // same one as under the learner's previous message.
      const setting = await getSetting<unknown>(env.DB, 'chat.corrections', DEFAULT_CORRECTION_LEVEL);
      const level: CorrectionLevel = practising ? 'strict' : isCorrectionLevel(setting) ? setting : DEFAULT_CORRECTION_LEVEL;
      const prevUser = await env.DB.prepare("SELECT corrections_json FROM messages WHERE conversation_id = ?1 AND role = 'user' AND id < ?2 ORDER BY id DESC LIMIT 1")
        .bind(conv.id, learner.id)
        .first<{ corrections_json: string | null }>();
      const last = shownKeys(prevUser?.corrections_json ? (JSON.parse(prevUser.corrections_json) as ShownCorrection[]) : []);
      corrections = chooseShown(found, level, last);
      if (corrections.length) await env.DB.prepare('UPDATE messages SET corrections_json = ?1 WHERE id = ?2').bind(JSON.stringify(corrections), learner.id).run();
    }
    if (learner && studied.length) {
      const prev = await env.DB.prepare("SELECT hint_json FROM messages WHERE conversation_id = ?1 AND role = 'assistant' AND id < ?2 ORDER BY id DESC LIMIT 1")
        .bind(conv.id, learner.id)
        .first<{ hint_json: string | null }>();
      const prevHint = prev?.hint_json ? (JSON.parse(prev.hint_json) as MessageHint).grammarPointId : null;
      uses = acceptUses(out.used, studied, learner.text, prevHint);
      if (uses.length)
        await env.DB.batch(
          uses.map((u) =>
            env.DB.prepare('INSERT OR IGNORE INTO chat_uses(grammar_point_id, message_id, correct, prompted, quote) VALUES (?1, ?2, ?3, ?4, ?5)').bind(
              u.grammarPointId,
              learner.id,
              u.correct ? 1 : 0,
              u.prompted ? 1 : 0,
              u.quote,
            ),
          ),
        );
    }
  } else {
    text = (await callClaude(env, { role: 'chat', system, messages, maxTokens: 600 })).text;
  }
  const clean = lang.hasRomanisation ? stripPinyin(text) : text;
  let tokens: Token[] | undefined;
  let added: { id: number; lemma: string; pinyin: string }[] = [];
  {
    // Every language is split into words, so any word in a reply can be tapped.
    const dict = await getDict(env.DB, conv.lang);
    const rec = await recordExposures(env.DB, conv.lang, conv.id, rulesFor(lang.script).tokenize(clean, dict, pinyinPerChar));
    tokens = rec.tokens;
    added = rec.added;
  }
  const row = await env.DB.prepare('INSERT INTO messages(conversation_id, role, text, tokens_json, hint_json) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *')
    .bind(conv.id, 'assistant', clean, tokens ? JSON.stringify(tokens) : null, hint ? JSON.stringify(hint) : null)
    .first<MessageRow>();
  return { row, added, corrections };
}

chatRoutes.get('/conversations', async (c) => {
  const lang = c.req.query('lang') ?? 'zh';
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.lang, c.title, c.started_at, c.ended_at, COALESCE(t.name, c.custom_topic) AS topic,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
     FROM conversations c LEFT JOIN topics t ON t.id = c.topic_id WHERE c.lang = ?1 ORDER BY c.started_at DESC LIMIT 30`,
  )
    .bind(lang)
    .all();
  return c.json({ conversations: results });
});

chatRoutes.post('/conversations', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { lang?: string; topicId?: unknown; customTopic?: unknown; lessonId?: unknown };
  const lang = body.lang ?? 'zh';
  if (!getLanguage(lang)) return c.json({ error: 'unknown language' }, 400);
  const topicId = Number.isInteger(body.topicId) ? (body.topicId as number) : null;
  const custom = typeof body.customTopic === 'string' && body.customTopic.trim() ? body.customTopic.trim().slice(0, 200) : null;
  if (topicId) {
    const t = await c.env.DB.prepare('SELECT id FROM topics WHERE id = ?1 AND lang = ?2').bind(topicId, lang).first();
    if (!t) return c.json({ error: 'unknown topic' }, 400);
  }
  const lessonId = Number.isInteger(body.lessonId) ? (body.lessonId as number) : null;
  const row = await c.env.DB.prepare(
    'INSERT INTO conversations(lang, topic_id, custom_topic, lesson_id) VALUES (?1, ?2, ?3, (SELECT id FROM lessons WHERE id = ?4)) RETURNING id, lang, started_at',
  )
    .bind(lang, topicId, custom, lessonId)
    .first();
  if (topicId) await markTopicUsed(c.env.DB, topicId);
  return c.json(row, 201);
});

chatRoutes.get('/conversations/:id{[0-9]+}', async (c) => {
  const conv = await loadConv(c.env.DB, Number(c.req.param('id')));
  if (!conv) return c.json({ error: 'not found' }, 404);
  const { results } = await c.env.DB.prepare('SELECT * FROM messages WHERE conversation_id = ?1 ORDER BY id').bind(conv.id).all<MessageRow>();
  // How many learner turns make the day's chat: the chat screen offers to wrap up at that point.
  const needed = Number(await getSetting(c.env.DB, 'session.min_chat_turns', 3)) || 3;
  return c.json({
    conversation: { id: conv.id, lang: conv.lang, title: conv.title, started_at: conv.started_at, ended_at: conv.ended_at, topic: conv.topic_name ?? conv.custom_topic, scenario: conv.scenario, needed },
    messages: results.map(toMessage),
  });
});

/** The tutor opens the conversation on the session topic. */
chatRoutes.post('/conversations/:id{[0-9]+}/start', async (c) => {
  const conv = await loadConv(c.env.DB, Number(c.req.param('id')));
  if (!conv) return c.json({ error: 'not found' }, 404);
  const lang = getLanguage(conv.lang);
  if (!lang) return c.json({ error: 'unknown language' }, 400);
  const existing = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?1').bind(conv.id).first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) return c.json({ error: 'conversation already started' }, 409);
  try {
    const { row, added } = await tutorReply(c.env, conv, lang, [{ role: 'user', content: OPENING_CUE }]);
    if (!row) return c.json({ error: 'write failed' }, 500);
    return c.json({ assistant: toMessage(row), newWords: added });
  } catch (e) {
    const { status, body } = claudeErrorResponse(e);
    return c.json(body, status);
  }
});

chatRoutes.post('/conversations/:id{[0-9]+}/messages', async (c) => {
  const conv = await loadConv(c.env.DB, Number(c.req.param('id')));
  if (!conv) return c.json({ error: 'not found' }, 404);
  const lang = getLanguage(conv.lang);
  if (!lang) return c.json({ error: 'unknown language' }, 400);

  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'text required' }, 400);
  if (text.length > 2000) return c.json({ error: 'too long' }, 400);

  const messages = await history(c.env.DB, conv.id);
  messages.push({ role: 'user', content: text });
  const userRow = await c.env.DB.prepare('INSERT INTO messages(conversation_id, role, text) VALUES (?1, ?2, ?3) RETURNING *').bind(conv.id, 'user', text).first<MessageRow>();

  try {
    const { row, added, corrections } = await tutorReply(c.env, conv, lang, messages, userRow ? { id: userRow.id, text } : null);
    if (!userRow || !row) return c.json({ error: 'write failed' }, 500);
    if (conv.lesson_id) await tickUseStep(c.env.DB, conv.id, conv.lesson_id, false);
    return c.json({ user: { ...toMessage(userRow), corrections: corrections.length ? corrections : undefined }, assistant: toMessage(row), newWords: added });
  } catch (e) {
    const { status, body: err } = claudeErrorResponse(e);
    return c.json({ ...err, user: userRow ? toMessage(userRow) : undefined }, status);
  }
});

/**
 * Finish a chat: the summary (mistakes, new words, grammar used) and the mistakes go into the
 * mistakes list so later chats and reviews can target them. Safe to call again.
 */
chatRoutes.post('/conversations/:id{[0-9]+}/finish', async (c) => {
  const conv = await loadConv(c.env.DB, Number(c.req.param('id')));
  if (!conv) return c.json({ error: 'not found' }, 404);
  const db = c.env.DB;
  const [msgs, words, uses] = await Promise.all([
    db.prepare("SELECT corrections_json FROM messages WHERE conversation_id = ?1 AND role = 'user' ORDER BY id").bind(conv.id).all<{ corrections_json: string | null }>(),
    db
      .prepare(
        `SELECT w.id, w.lemma, w.reading, w.gloss FROM exposures e JOIN words w ON w.id = e.word_id
         WHERE e.conversation_id = ?1 AND w.created_at >= ?2 ORDER BY e.seen_at LIMIT 30`,
      )
      .bind(conv.id, conv.started_at)
      .all<{ id: number; lemma: string; reading: string | null; gloss: string | null }>(),
    db
      .prepare(
        `SELECT g.id, g.title, SUM(u.correct) AS correct, COUNT(*) AS total FROM chat_uses u
         JOIN messages m ON m.id = u.message_id JOIN grammar_points g ON g.id = u.grammar_point_id
         WHERE m.conversation_id = ?1 GROUP BY g.id ORDER BY MIN(u.id)`,
      )
      .bind(conv.id)
      .all<{ id: number; title: string; correct: number; total: number }>(),
  ]);
  const corrections = summariseCorrections(msgs.results.map((m) => (m.corrections_json ? (JSON.parse(m.corrections_json) as ShownCorrection[]) : null)));
  const writes = corrections.map((m) =>
    db.prepare("INSERT OR IGNORE INTO mistakes(lang, wrong, right, note, source) VALUES (?1, ?2, ?3, ?4, 'conversation')").bind(conv.lang, m.wrong, m.right, m.note || null),
  );
  if (conv.lesson_id) await tickUseStep(db, conv.id, conv.lesson_id, true);
  writes.push(db.prepare("UPDATE conversations SET ended_at = COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?1").bind(conv.id));
  await db.batch(writes);
  return c.json({
    corrections,
    newWords: words.results,
    grammar: uses.results.map((u) => ({ id: u.id, title: u.title, correct: u.correct, total: u.total })),
    messages: msgs.results.length,
  });
});

chatRoutes.post('/conversations/:id{[0-9]+}/messages/:mid{[0-9]+}/translate', async (c) => {
  const id = Number(c.req.param('id'));
  const mid = Number(c.req.param('mid'));
  const row = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?1 AND conversation_id = ?2').bind(mid, id).first<MessageRow>();
  const convLang = (await c.env.DB.prepare('SELECT lang FROM conversations WHERE id = ?1').bind(id).first<{ lang: string }>())?.lang ?? 'zh';
  if (!row) return c.json({ error: 'not found' }, 404);
  // Into the learner's own language; a cached translation in another language is redone.
  const setting = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'native_lang'").first<{ value: string }>();
  const native = nativeLanguage(setting ? JSON.parse(setting.value) : DEFAULT_NATIVE);
  if (row.translation && (row.translation_lang ?? 'en') === native.code) return c.json({ translation: row.translation, lang: native.code, cached: true });
  try {
    const res = await callClaude(c.env, { role: 'chat', system: [translatePrompt(native.english, promptsFor(convLang).name)], messages: [{ role: 'user', content: row.text }], maxTokens: 400 });
    await c.env.DB.prepare('UPDATE messages SET translation = ?1, translation_lang = ?2 WHERE id = ?3').bind(res.text, native.code, mid).run();
    return c.json({ translation: res.text, lang: native.code, cached: false });
  } catch (e) {
    const { status, body } = claudeErrorResponse(e);
    return c.json(body, status);
  }
});

chatRoutes.get('/usage', async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const { results } = await c.env.DB.prepare('SELECT model, input_tokens, output_tokens FROM usage_log WHERE date = ?1').bind(today).all();
  const budget = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'daily_token_budget'").first<{ value: string }>();
  return c.json({ date: today, budget: budget ? JSON.parse(budget.value) : null, usage: results });
});
