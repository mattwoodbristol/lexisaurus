import type { ExplanationParts } from '../core/lessons/explanation-parts';
import type { Trackway } from '../core/trackway';
import type { NextLesson } from '../core/lessons/steps';
export type { NextLesson };
import type { Token } from '../core/pinyin/annotate';
import type { LessonContent } from '../core/lessons/types';
import type { StepKey, WarmupItem } from '../core/lessons/steps';
import type { Mastery } from '../core/lessons/mastery';
import type { Exercise } from '../core/review/exercise';
import type { ListeningContent, ListeningKind } from '../core/listening/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...init });
  if (!res.ok) {
    let msg = res.statusText;
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      msg = body.error ?? msg;
      detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg, detail);
  }
  return (await res.json()) as T;
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.message === 'budget') return 'Daily token budget reached. Reviews still work from cached sentences; chat resumes tomorrow.';
    if (e.message === 'not_configured') return 'The server has no Claude API key configured.';
    if (e.message === 'plan_failed') return 'Claude could not draft a usable plan this time. Try again, perhaps with simpler goals.';
    return e.detail ? `${e.message}: ${e.detail}` : e.message;
  }
  return String(e);
}

export interface LanguageSummary {
  id: string;
  name: string;
  problems: string[];
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  tokens?: Token[];
  translation?: string;
  /** Language code of the cached translation (setting native_lang when it was made). */
  translationLang?: string;
  /** Grammar nudge from a finished lesson, shown under the tutor's message. */
  hint?: { grammarPointId: number; text: string; title: string; lessonId: number | null };
  /** Mistakes in the learner's message; `shown` ones appear under it, the rest wait for the summary. */
  corrections?: ChatCorrection[];
}

export interface ChatCorrection {
  wrong: string;
  right: string;
  note: string;
  severity: 'meaning' | 'target' | 'minor';
  shown: boolean;
}

export interface ChatSummary {
  corrections: ChatCorrection[];
  newWords: { id: number; lemma: string; reading: string | null; gloss: string | null }[];
  grammar: { id: number; title: string; correct: number; total: number }[];
  messages: number;
}

export interface ConversationSummary {
  id: number;
  lang: string;
  title: string | null;
  topic: string | null;
  started_at: string;
  ended_at: string | null;
  message_count: number;
}

export interface ConversationDetail {
  id: number;
  lang: string;
  topic: string | null;
  scenario: string | null;
  started_at: string;
  ended_at: string | null;
  /** Learner turns that make the day's chat (setting session.min_chat_turns). */
  needed?: number;
}

export interface NewWord {
  id: number;
  lemma: string;
  pinyin: string;
}

export interface Topic {
  id: number;
  name: string;
  tags: string[];
  scenario: string | null;
}

export interface LessonListItem {
  id: number;
  title: string;
  level: string | null;
  course_no: number | null;
  source: string;
  completed_at: string | null;
  created_at: string;
  snippet?: string;
  mastery?: Mastery | null;
}

export interface LessonDetail {
  lesson: { id: number; lang: string; title: string; level: string | null; courseNo: number | null; source: string; completedAt: string | null; content: LessonContent; explainLang: string };
  annotations: Record<string, Token[]>;
  /** Which language to show explanations in, and the learner's own. */
  explain: { code: string; target: boolean; nativeCode: string };
  grammarPoints: { id: number; title: string; summary: string; due_at: string | null }[];
  nav: { prev: number | null; next: number | null } | null;
  state: { stepsDone: StepKey[]; checks: { score: number; total: number; passed: number; created_at: string }[]; passMark: number; mastery: Mastery | null };
}

export interface LessonTexts {
  lang: string;
  parts: ExplanationParts;
  annotations: Record<string, Token[]>;
}

export interface GradeResult {
  correct: boolean;
  feedback: string;
  corrected: string;
  judged: boolean;
}

export interface ListeningSummary {
  id: number;
  kind: ListeningKind;
  title: string;
  known_share: number | null;
  score: number | null;
  total: number | null;
  done_at: string | null;
  created_at: string;
}

export interface ListeningDetail extends ListeningContent {
  id: number;
  lang: string;
  score: number | null;
  total: number | null;
  doneAt: string | null;
  createdAt: string;
  /** Share of its words known now (0-1). */
  knownShare: number | null;
}

export interface CheckSubmitResult {
  score: number;
  total: number;
  percent: number;
  passed: boolean;
  passMark: number;
  done: { grammarCards: number; newWords: NewWord[]; promoted: number } | null;
  checkId: number | null;
}

/** This copy's release and the latest published one (Home shows a note when it is behind). */
export interface UpdateStatus {
  current: string;
  latest: string | null;
  available: boolean;
}

/** "Query this page": the check, and corrected lesson sections when it found a fault in a lesson. */
export interface PageQueryResult {
  id: number;
  contentWrong: boolean;
  explanation: string;
  fix: { explanation: string[] | null; examples: { zh: string; en: string }[] | null; drills: { zh: string; en: string }[] | null; keyPoints: string[] | null } | null;
}

export interface QueryContext {
  lessonId: number | null;
  place: string;
  kind: 'choice' | 'translate' | 'fix' | 'build';
  task: string;
  options?: string[];
  expected: string;
  answer: string;
  markedRight: boolean;
  checkId?: number;
  itemIndex?: number;
}

export interface QueryResult {
  learnerRight: boolean;
  keyWrong: boolean;
  explanation: string;
  betterKey: string;
  check: CheckSubmitResult | null;
}

export interface ReviewItem {
  cardId: number;
  itemType: 'word' | 'grammar_point';
  itemId: number;
  reps: number;
  word?: { lemma: string; reading: string | null; gloss: string | null; status: string };
  grammar?: { title: string; summary: string };
  exercise: Exercise;
}

export interface ReviewSummary {
  due: number;
  due_grammar: number;
  cards: number;
  reviewed_today: number;
  known: number;
  learning: number;
  pool: number;
  daily_limit: number;
  remaining_today: number;
}

export interface DailySession {
  lang: string;
  reviews: { remaining: number; doneToday: number; due: number; limit: number; done: boolean };
  grammar: { cardId: number; pointId: number; title: string; summary: string | null; lessonId: number | null; done: boolean } | null;
  lesson: { title: string | null; done: boolean } | null;
  listening: { done: boolean };
  conversation: { done: boolean; userTurnsToday: number; needed: number; topic: Topic | null; conversationId: number | null };
  done: boolean;
  trackway: Trackway;
}

export interface WordLookup {
  text: string;
  /** Latin-script languages: the dictionary form the tapped form belongs to (parlava -> parlare). */
  lemma: string | null;
  reading: string | null;
  status: 'known' | 'learning' | 'new' | 'unknown';
  wordId: number | null;
  gloss: string | null;
  glossSource: 'list' | 'claude' | null;
  glossError?: string;
  chars: { char: string; reading: string | null; gloss: string | null }[];
}

export interface PushStatus {
  configured: boolean;
  subscriptions: { endpoint: string; created_at: string; last_status: number | null; last_sent_at: string | null }[];
  recent: { lang: string; local_date: string; slot: string; title: string; body: string; sent_to: number; created_at: string }[];
}

export const api = {
  health: () => request<{ ok: boolean; app: string; time: string; db: string; claude: string }>('/api/health'),
  me: () => request<{ authenticated: boolean }>('/api/auth/me'),
  login: (passphrase: string) => request<{ ok: true }>('/api/auth/login', post({ passphrase })),
  logout: () => request<{ ok: true }>('/api/auth/logout', post()),
  settings: () => request<Record<string, unknown>>('/api/settings'),
  putSetting: (key: string, value: unknown) => request('/api/settings/' + key, { method: 'PUT', body: JSON.stringify({ value }) }),
  languages: () => request<{ languages: LanguageSummary[] }>('/api/languages'),

  suggestTopic: (lang: string, exclude: number[] = []) => request<{ topic: Topic | null }>(`/api/topics/suggest?lang=${lang}&exclude=${exclude.join(',')}`),

  conversations: (lang: string) => request<{ conversations: ConversationSummary[] }>(`/api/chat/conversations?lang=${lang}`),
  newConversation: (lang: string, opts: { topicId?: number; customTopic?: string; lessonId?: number } = {}) => request<{ id: number }>('/api/chat/conversations', post({ lang, ...opts })),
  conversation: (id: number) => request<{ conversation: ConversationDetail; messages: ChatMessage[] }>(`/api/chat/conversations/${id}`),
  start: (id: number) => request<{ assistant: ChatMessage; newWords: NewWord[] }>(`/api/chat/conversations/${id}/start`, post()),
  send: (id: number, text: string) => request<{ user: ChatMessage; assistant: ChatMessage; newWords: NewWord[] }>(`/api/chat/conversations/${id}/messages`, post({ text })),
  finish: (id: number) => request<ChatSummary>(`/api/chat/conversations/${id}/finish`, post()),
  translate: (id: number, mid: number) => request<{ translation: string; lang: string; cached: boolean }>(`/api/chat/conversations/${id}/messages/${mid}/translate`, post()),
  usage: () => request<{ date: string; budget: number | null; usage: { model: string; input_tokens: number; output_tokens: number }[] }>('/api/chat/usage'),

  lessons: (lang: string, q = '') =>
    request<{ lessons: LessonListItem[]; nextLesson: NextLesson | null; nextToGenerate: { title: string; courseNo: number } | null }>(
      `/api/lessons?lang=${lang}&q=${encodeURIComponent(q)}`,
    ),
  lesson: (id: number) => request<LessonDetail>(`/api/lessons/${id}`),
  lessonTexts: (id: number, to: string) => request<LessonTexts>(`/api/lessons/${id}/texts`, post({ to })),
  explainStatus: (lang: string) => request<{ target: boolean; code: string }>(`/api/text/explain?lang=${lang}`),
  annotateTexts: (lang: string, texts: string[]) => request<{ annotations: Record<string, Token[]> }>('/api/text/annotate', post({ lang, texts })),
  translateText: (lang: string, text: string) => request<{ translation: string; lang: string }>('/api/text/translate', post({ lang, text })),
  lessonDone: (id: number) => request<{ ok: true; grammarCards: number; newWords: NewWord[]; promoted: number }>(`/api/lessons/${id}/done`, post()),
  lessonUndone: (id: number) => request<{ ok: true }>(`/api/lessons/${id}/undone`, post()),
  lessonStep: (id: number, step: StepKey) => request<{ ok: true; stepsDone: StepKey[] }>(`/api/lessons/${id}/progress`, post({ step })),
  warmup: (id: number) => request<{ items: (WarmupItem & { lessonId: number; lessonTitle: string })[]; annotations: Record<string, Token[]> }>(`/api/lessons/${id}/warmup`),
  grade: (lessonId: number, kind: 'translate' | 'fix', task: string, expected: string, answer: string) =>
    request<GradeResult>('/api/lessons/grade', post({ lessonId, kind, task, expected, answer })),
  queryMark: (ctx: QueryContext & { note?: string }) => request<QueryResult>('/api/lessons/query', post(ctx)),
  updates: () => request<UpdateStatus>('/api/updates'),
  queryPage: (q: { lang: string; screen: string; lessonId?: number; text: string; note: string }) => request<PageQueryResult>('/api/query-page', post(q)),
  applyPageFix: (id: number) => request<{ ok: true }>(`/api/query-page/${id}/apply`, post()),
  submitCheck: (id: number, results: { kind: string; right: boolean; answer: string }[]) => request<CheckSubmitResult>(`/api/lessons/${id}/check`, post({ results })),
  generateLesson: (lang: string, title?: string) => request<{ id: number; title: string }>('/api/lessons/generate', post({ lang, ...(title ? { title } : {}) })),

  reviewSummary: (lang: string) => request<ReviewSummary>(`/api/review/summary?lang=${lang}`),
  knownCount: (lang: string) => request<{ known: number }>(`/api/review/known?lang=${lang}`),
  reviewNext: (lang: string, skip: number[] = [], include?: number) =>
    request<{ items: ReviewItem[]; annotations?: Record<string, Token[]>; notice: string | null; limitReached?: boolean }>(
      `/api/review/next?lang=${lang}&skip=${skip.join(',')}${include ? `&include=${include}` : ''}`,
    ),
  answer: (cardId: number, rating: 1 | 2 | 3 | 4, kind?: string, exerciseId?: number, quiz?: { score: number; total: number }) =>
    request<{ due: string; status: string | null; statusChanged: boolean; lessonPassed?: boolean }>(`/api/review/${cardId}`, post({ rating, kind, exerciseId, quiz })),

  lookup: (lang: string, text: string, context = '') =>
    request<WordLookup>(`/api/words/lookup?lang=${lang}&text=${encodeURIComponent(text)}&context=${encodeURIComponent(context.slice(0, 300))}`),

  learnWord: (lang: string, text: string, form?: string) => request<{ ok: true; wordId: number; status: 'learning' }>('/api/words/learn', post({ lang, text, form })),

  session: (lang: string) => request<DailySession>(`/api/session/today?lang=${lang}`),
  vapidKey: () => request<{ publicKey: string }>('/api/push/vapid-key'),
  subscribe: (endpoint: string, keys: Record<string, string>) => request<{ ok: true }>('/api/push/subscribe', post({ endpoint, keys })),
  unsubscribe: (endpoint: string) => request<{ ok: true }>('/api/push/unsubscribe', post({ endpoint })),
  pushStatus: () => request<PushStatus>('/api/push/status'),
  testPush: () => request<{ ok: true; sent: number; removed: number; statuses: number[] }>('/api/push/test', post()),
  courseFiles: (lang: string) => request<{ files: Record<string, string> }>(`/api/course/${lang}/files`),
  courseSync: (lang: string, files: Record<string, string>, apply: boolean) => request<CourseSyncResult>(`/api/course/${lang}/sync`, post({ files, apply })),
  listenings: (lang: string) => request<{ items: ListeningSummary[] }>(`/api/listening?lang=${lang}`),
  newListening: (lang: string, kind: ListeningKind) => request<{ id: number }>('/api/listening/generate', post({ lang, kind })),
  listening: (id: number) => request<{ listening: ListeningDetail; annotations: Record<string, Token[]> }>(`/api/listening/${id}`),
  listeningResult: (id: number, score: number, total: number) => request<{ ok: true }>(`/api/listening/${id}/result`, post({ score, total })),
  coursePlan: (lang: string, goals: string, count: number, topics: boolean) => request<CoursePlan>(`/api/course/${lang}/plan`, post({ goals, count, topics })),
};

export type CourseSyncResult = { ok: false; problems: string[] } | { ok: true; whole: boolean; applied: boolean; lines: string[] };

export interface CoursePlan {
  title: string;
  planned: { id: string; title: string; level: string; focus: string }[];
  topics: { name: string; tags: string[]; scenario: string }[] | null;
}

// Level check and word sorting
export interface AssessWord {
  wordId: number | null;
  word: string;
  band: number;
  gloss: string | null;
  pseudo: boolean;
}
export interface GrammarItem {
  id: number;
  band: number;
  prompt: string;
  options: string[];
  answer: number;
  topic: string;
}
export interface LevelLabels {
  vocab: string | null;
  grammar: string | null;
  writing: string | null;
}
export interface LevelCheckInfo {
  date: string;
  vocab: number | null;
  grammar: number | null;
  writing: number | null;
  weak: string[];
  text: string;
}
/** One level's unsorted words: Sort my words goes a pile at a time, a round at a time. */
export interface SortPile {
  /** When the pile started: a new id means a new pile. */
  id: string;
  band: number | null;
  label: string;
  left: number;
  size: number;
  /** Unsorted words at this level in all (this pile and the ones after it). */
  levelLeft: number;
}

export interface SortWord {
  id: number;
  lemma: string;
  reading: string | null;
  /** Always set: words without a meaning are left out of a round. */
  gloss: string;
  level: number | null;
  levelLabel: string | null;
}

export const levelApi = {
  start: (lang: string) => request<{ assessmentId: number; words: AssessWord[] }>('/api/assessment/start', post({ lang })),
  words: (id: number, answers: (AssessWord & { known: boolean })[]) =>
    request<{ band: number; label: string; perBand: Record<number, number>; falseAlarm: number }>(`/api/assessment/${id}/words`, post({ answers })),
  bank: (lang: string) => request<{ items: GrammarItem[] }>(`/api/assessment/grammar?lang=${lang}`),
  grammar: (id: number, answers: { band: number; right: boolean; topic: string }[]) =>
    request<{ band: number; label: string; weak: string[]; writingPrompt: string }>(`/api/assessment/${id}/grammar`, post({ answers })),
  writing: (id: number, text: string, prompt: string) =>
    request<{ band: number; label: string; comment: string; errors: { wrong: string; right: string; note: string }[] }>(`/api/assessment/${id}/writing`, post({ text, prompt })),
  finish: (id: number) => request<{ check: LevelCheckInfo; labels: LevelLabels; offered: { id: number; title: string; level: string | null }[] }>(`/api/assessment/${id}/finish`, post()),
  skipLessons: (lessonIds: number[]) => request<{ ok: true; done: number }>('/api/assessment/skip-lessons', post({ lessonIds })),
  status: (lang: string) => request<{ check: LevelCheckInfo | null; labels: LevelLabels | null; unsorted: number; pile: SortPile | null }>(`/api/assessment/status?lang=${lang}`),
  sortNext: (lang: string, limit: number) =>
    request<{ words: SortWord[]; decoys: string[]; left: number; pile: SortPile | null }>(`/api/assessment/sort?lang=${lang}&limit=${limit}`),
  sortOne: (lang: string, id: number, known: boolean) => request<{ ok: true }>('/api/assessment/sort', post({ lang, id, known })),
  sortUndo: (lang: string, id: number) => request<{ ok: true }>('/api/assessment/sort/undo', post({ lang, id })),
};
