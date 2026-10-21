import { useEffect, useState } from 'preact/hooks';
import { api, ApiError, errorText, levelApi, type ConversationSummary, type DailySession, type NextLesson, type SortPile, type Topic, type UpdateStatus } from './api';
import { PageQuery } from './page-query';
import { Chat } from './chat';
import { LessonsIndex, LessonPage } from './lessons';
import { Review } from './review';
import { Settings } from './settings';
import { KeyboardTest } from './keyboard-test';
import { Lexi, ProgressCard, useLexiStage, useStageUp } from './mascot/lexi';
import { LangContext, useStudyLang } from './lang';
import { LevelCheck, SortWords } from './level-check';
import { Welcome } from './welcome';
import { IosInstallCard } from './install';
import { Course } from './course';
import { ListeningIndex, ListeningPage } from './listening';
import { TrackwayCard } from './trackway';
import { pushState, enablePush, type PushState } from './push';

type Auth = 'checking' | 'out' | 'in';
type Route =
  | { name: 'home' }
  | { name: 'chat'; id: number }
  | { name: 'lessons' }
  | { name: 'lesson'; id: number }
  | { name: 'review'; include?: number }
  | { name: 'settings' }
  | { name: 'course' }
  | { name: 'listen' }
  | { name: 'listening'; id: number }
  | { name: 'keyboard-test' }
  | { name: 'level-check' }
  | { name: 'sort-words' };

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

function parseRoute(hash: string): Route {
  let m = /^#\/chat\/(\d+)$/.exec(hash);
  if (m) return { name: 'chat', id: Number(m[1]) };
  m = /^#\/lesson\/(\d+)$/.exec(hash);
  if (m) return { name: 'lesson', id: Number(m[1]) };
  m = /^#\/review(?:\/(\d+))?$/.exec(hash);
  if (m) return m[1] ? { name: 'review', include: Number(m[1]) } : { name: 'review' };
  m = /^#\/listen\/(\d+)$/.exec(hash);
  if (m) return { name: 'listening', id: Number(m[1]) };
  if (hash === '#/listen') return { name: 'listen' };
  if (hash === '#/lessons') return { name: 'lessons' };
  if (hash === '#/settings') return { name: 'settings' };
  if (hash === '#/course') return { name: 'course' };
  if (hash === '#/keyboard-test') return { name: 'keyboard-test' };
  if (hash === '#/level-check') return { name: 'level-check' };
  if (hash === '#/sort-words') return { name: 'sort-words' };
  return { name: 'home' };
}

function href(r: Route): string {
  switch (r.name) {
    case 'chat':
      return `#/chat/${r.id}`;
    case 'lesson':
      return `#/lesson/${r.id}`;
    case 'lessons':
      return '#/lessons';
    case 'review':
      return r.include ? `#/review/${r.include}` : '#/review';
    case 'settings':
      return '#/settings';
    case 'course':
      return '#/course';
    case 'listen':
      return '#/listen';
    case 'listening':
      return `#/listen/${r.id}`;
    case 'level-check':
      return '#/level-check';
    case 'sort-words':
      return '#/sort-words';
    default:
      return '#/';
  }
}

// Where a lesson's back button goes: the screen the lesson was opened from (home or the lessons
// list). Moving between lessons, or out to a practice chat and back, keeps it. Kept for the tab
// so a reload does not change it.
const LESSON_BACK_KEY = 'lesson_back';
function lessonBack(): 'home' | 'lessons' {
  try {
    return sessionStorage.getItem(LESSON_BACK_KEY) === 'home' ? 'home' : 'lessons';
  } catch {
    return 'lessons';
  }
}
function noteLessonEntry(from: Route, to: Route) {
  if (to.name !== 'lesson' || (from.name !== 'home' && from.name !== 'lessons')) return;
  try {
    sessionStorage.setItem(LESSON_BACK_KEY, from.name);
  } catch {
    // no storage: back goes to the lessons list
  }
}

function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const onHash = () =>
      setRoute((prev) => {
        const next = parseRoute(location.hash);
        noteLessonEntry(prev, next);
        return next;
      });
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [route, (r: Route) => (location.hash = href(r))];
}

/** Build date and commit, set at build time (vite.config.ts). */
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export function App() {
  const [auth, setAuth] = useState<Auth>('checking');
  const [route, go] = useRoute();
  // First run: the welcome wizard until setting setup.done (null = not known yet).
  const [setupDone, setSetupDone] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .me()
      .then((r) => setAuth(r.authenticated ? 'in' : 'out'))
      .catch(() => setAuth('out'));
  }, []);
  useEffect(() => {
    if (auth !== 'in') return;
    api
      .settings()
      .then((s) => setSetupDone(s['setup.done'] === true))
      .catch(() => setSetupDone(true)); // never block the app on this
  }, [auth]);

  // Diagnostics page: works without signing in.
  if (route.name === 'keyboard-test') return <KeyboardTest />;
  if (auth === 'checking') return <p class="muted">Loading…</p>;
  if (auth === 'out') return <Login onDone={() => setAuth('in')} />;
  if (setupDone === null) return <p class="muted">Loading…</p>;
  if (!setupDone)
    return (
      <Welcome
        onDone={(check) => {
          setSetupDone(true);
          go(check ? { name: 'level-check' } : { name: 'home' });
        }}
      />
    );
  const home = () => go({ name: 'home' });
  return (
    <>
      {screen()}
      <PageQuery key={href(route)} screen={route.name} lessonId={route.name === 'lesson' ? route.id : undefined} />
      <footer class="app-version">Version {APP_VERSION}</footer>
    </>
  );

  function screen() {
    switch (route.name) {
      case 'chat':
        return <Chat id={route.id} onBack={home} />;
      case 'lessons':
        return <LessonsIndex onOpen={(id) => go({ name: 'lesson', id })} onBack={home} onCourse={() => go({ name: 'course' })} />;
      case 'lesson':
        return (
          <LessonPage
            id={route.id}
            onBack={() => go({ name: lessonBack() })}
            onOpen={(id) => go({ name: 'lesson', id })}
            onPractise={(id) => go({ name: 'chat', id })}
          />
        );
      case 'review':
        return <Review onBack={home} include={route.include} />;
      case 'settings':
        return <Settings onBack={home} onCourse={() => go({ name: 'course' })} />;
      case 'course':
        return <Course onBack={() => history.back()} onLessons={() => go({ name: 'lessons' })} />;
      case 'listen':
        return <ListeningIndex onBack={home} onOpen={(id) => go({ name: 'listening', id })} />;
      case 'listening':
        return <ListeningPage id={route.id} onBack={() => history.back()} onIndex={() => go({ name: 'listen' })} />;
      case 'level-check':
        return <LevelCheck onBack={home} onSortWords={() => go({ name: 'sort-words' })} />;
      case 'sort-words':
        return <SortWords onBack={home} />;
      default:
        return <Home onLogout={() => setAuth('out')} go={go} />;
    }
  }
}

function Login({ onDone }: { onDone: () => void }) {
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.login(pass);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div class="login-brand">
        <Lexi stage="adult" size={72} />
        <h1>Lexisaurus</h1>
      </div>
      <form onSubmit={submit}>
        <input
          type="password"
          autocomplete="current-password"
          placeholder="Passphrase"
          value={pass}
          onInput={(e) => setPass((e.target as HTMLInputElement).value)}
        />
        <button disabled={busy || !pass}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {err && <p class="error">{err}</p>}
      </form>
      <IosInstallCard dismissible={false} />
    </>
  );
}

function Tick({ done }: { done: boolean }) {
  return (
    <span class={`tick ${done ? 'done' : ''}`} aria-label={done ? 'done' : 'to do'}>
      {done ? '✓' : ''}
    </span>
  );
}

/** A new release is out and this copy has not taken it yet (it normally does so within a day). */
function UpdateNotice() {
  const [u, setU] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    api
      .updates()
      .then(setU)
      .catch(() => {});
  }, []);
  if (!u?.available) return null;
  return (
    <div class="card small" role="status">
      <strong>A new version is out ({u.latest}).</strong> Your app updates itself within a day. If this note stays, see “Updates” in the getting-started guide.
    </div>
  );
}

function Home({ onLogout, go }: { onLogout: () => void; go: (r: Route) => void }) {
  const [session, setSession] = useState<DailySession | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [nextLesson, setNextLesson] = useState<NextLesson | null | undefined>(undefined);
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [push, setPush] = useState<PushState | null>(null);
  const [usage, setUsage] = useState('');
  const [err, setErr] = useState('');
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const { lang, config, enabled, setLang } = useStudyLang();
  const { known, stage } = useLexiStage(lang);
  const stageUp = useStageUp(known, lang);
  const [level, setLevel] = useState<{ taken: boolean; unsorted: number; pile: SortPile | null } | null>(null);

  useEffect(() => {
    // Everything below is per language: reload when the study language changes.
    setSession(null);
    setTopic(null);
    setSkipped([]);
    setNextLesson(undefined);
    setConvs([]);
    setLevel(null);
    levelApi
      .status(lang)
      .then((r) => setLevel({ taken: !!r.check, unsorted: r.unsorted, pile: r.pile }))
      .catch(() => {});
    // The next review's story is written in the background, so the review opens straight away.
    api.prepareReview(lang).catch(() => {});
    api
      .session(lang)
      .then((s) => {
        setSession(s);
        setTopic(s.conversation.topic);
      })
      .catch((e) => setErr(errorText(e)));
    api
      .lessons(lang)
      .then((r) => setNextLesson(r.nextLesson))
      .catch(() => {});
    api
      .conversations(lang)
      .then((r) => setConvs(r.conversations))
      .catch(() => {});
    pushState().then(setPush);
    api
      .usage()
      .then((u) => {
        const used = u.usage.reduce((n, r) => n + r.input_tokens + r.output_tokens, 0);
        setUsage(u.budget ? `${used.toLocaleString()} / ${Number(u.budget).toLocaleString()} tokens today` : `${used} tokens today`);
      })
      .catch(() => {});
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [lang]);

  async function skip() {
    if (!topic) return;
    const ex = [...skipped, topic.id];
    setSkipped(ex);
    try {
      setTopic((await api.suggestTopic(lang, ex)).topic);
    } catch (e) {
      setErr(errorText(e));
    }
  }

  async function start(opts: { topicId?: number; customTopic?: string }) {
    try {
      const r = await api.newConversation(lang, opts);
      go({ name: 'chat', id: r.id });
    } catch (e) {
      setErr(errorText(e));
    }
  }

  async function turnOnPush() {
    try {
      setPush(await enablePush());
    } catch (e) {
      setErr(errorText(e));
    }
  }

  async function logout() {
    await api.logout();
    onLogout();
  }

  const s = session;
  return (
    <LangContext.Provider value={lang}>
      <div class="row">
        <h1 class="grow">{config.todayTitle}</h1>
        {installEvent && (
          <button class="secondary" onClick={() => installEvent.prompt()}>
            Install
          </button>
        )}
        <button class="secondary icon" onClick={() => go({ name: 'settings' })} aria-label="Settings">
          ⚙
        </button>
      </div>

      {enabled.length > 1 && (
        <div class="lang-switch" role="tablist" aria-label="Language">
          {enabled.map((l) => (
            <button key={l.id} role="tab" aria-selected={l.id === lang} aria-label={l.nativeName} class={`lang-pill ${l.id === lang ? 'on' : ''}`} onClick={() => setLang(l.id)}>
              {/* 中文 is already short; Latin-script languages show their code (IT, ES, FR). */}
              {l.script === 'han' ? l.nativeName : l.id.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      <IosInstallCard />
      <UpdateNotice />

      {known !== null && <ProgressCard known={known} lang={lang} celebrating={stageUp} />}

      {s && <TrackwayCard t={s.trackway} />}

      {level && !level.taken && (
        <div class="card row">
          <div class="grow small">
            <strong>Take the level check</strong>
            <div class="muted">About 10 minutes. It sets the level Lexi and lessons aim at, and sorts your words.</div>
          </div>
          <button onClick={() => go({ name: 'level-check' })}>Start</button>
        </div>
      )}
      {level && level.taken && level.pile && level.unsorted >= 20 && (
        <div class="card row">
          <div class="grow small">
            <strong>
              {level.pile.label} pile: {level.pile.left.toLocaleString()} words to sort
            </strong>
            <div class="muted">Easiest level first, up to 250 at a time. Know it or not: a few minutes clears hundreds from your pool.</div>
          </div>
          <button class="secondary" onClick={() => go({ name: 'sort-words' })}>
            Sort
          </button>
        </div>
      )}

      {push === 'off' && (
        <div class="card row">
          <div class="grow small">Get a reminder when today’s practice is waiting.</div>
          <button onClick={turnOnPush}>Turn on reminders</button>
        </div>
      )}

      {s?.done && (
        <div class="card done-banner lexi-moment">
          <Lexi stage={stage} mood="happy" size={64} />
          <div>
            <strong>{config.doneTitle}</strong> <span class="muted small">Today’s session is done.</span>
          </div>
        </div>
      )}

      {/* 1. Reviews */}
      <div class="card row">
        <Tick done={!!s?.reviews.done} />
        <div class="grow">
          <div class="muted small">1 · Reviews</div>
          {s ? (
            s.reviews.done ? (
              <strong>{s.reviews.doneToday ? `${s.reviews.doneToday} reviewed today` : 'Nothing due'}</strong>
            ) : (
              <strong>{s.reviews.remaining} to do</strong>
            )
          ) : (
            <span class="muted">…</span>
          )}
          {s && <div class="muted small">{s.reviews.due} due in total · cap {s.reviews.limit} a day</div>}
        </div>
        {s && !s.reviews.done && <button onClick={() => go({ name: 'review' })}>Review</button>}
      </div>

      {/* 2. Grammar point of the day */}
      <div class="card">
        <div class="row">
          <Tick done={!!s?.grammar?.done || (!!s && !s.grammar)} />
          <div class="grow">
            <div class="muted small">2 · Grammar of the day</div>
            {s?.grammar ? (
              <>
                <strong>{s.grammar.title}</strong>
                {s.grammar.summary && <div class="muted small">{s.grammar.summary}</div>}
              </>
            ) : (
              <span class="muted small">{s ? 'Finish the Learn step of a lesson to start grammar reviews.' : '…'}</span>
            )}
          </div>
        </div>
        {s?.grammar && (!s.grammar.done || s.grammar.lessonId) && (
          <div class="row" style="margin-top:10px">
            {!s.grammar.done && <button onClick={() => go({ name: 'review', include: s.grammar!.cardId })}>Practise</button>}
            {s.grammar.lessonId && (
              <button class="secondary" onClick={() => go({ name: 'lesson', id: s.grammar!.lessonId! })}>
                Lesson
              </button>
            )}
          </div>
        )}
      </div>

      {/* 3. A step of the next lesson */}
      <div class="card">
        <div class="row">
          <Tick done={!!s?.lesson?.done} />
          <div class="grow">
            <div class="muted small">3 · Lesson</div>
            <strong>{nextLesson === undefined ? '…' : (nextLesson?.title ?? 'All lessons done')}</strong>
            {s?.lesson?.done ? (
              <div class="muted small">A step done today{nextLesson?.step ? ` · next: ${nextLesson.step}` : ''}</div>
            ) : (
              nextLesson?.step && <div class="muted small">{nextLesson.started ? `Carry on at ${nextLesson.step}` : `Starts with ${nextLesson.step}`}</div>
            )}
          </div>
        </div>
        <div class="row" style="margin-top:10px">
          {nextLesson && (
            <button class={s?.lesson?.done ? 'secondary' : ''} onClick={() => go({ name: 'lesson', id: nextLesson.id })}>
              {nextLesson.started ? 'Continue' : 'Open'}
            </button>
          )}
          <button class="secondary" onClick={() => go({ name: 'lessons' })}>
            All lessons
          </button>
        </div>
      </div>

      {/* 4. Listening */}
      <div class="card row">
        <Tick done={!!s?.listening.done} />
        <div class="grow">
          <div class="muted small">4 · Listening</div>
          {s?.listening.done ? <strong>Done for today</strong> : <div class="small">A dialogue or story at your level, heard before you read it.</div>}
        </div>
        <button class={s?.listening.done ? 'secondary' : ''} onClick={() => go({ name: 'listen' })}>
          Listen
        </button>
      </div>

      {/* 5. Conversation */}
      <div class="card">
        <div class="row">
          <Tick done={!!s?.conversation.done} />
          <div class="grow">
            <div class="muted small">
              5 · Conversation{s && !s.conversation.done && s.conversation.userTurnsToday > 0 ? ` · ${s.conversation.userTurnsToday}/${s.conversation.needed} turns` : ''}
            </div>
            {s?.conversation.done ? (
              <strong>Done for today</strong>
            ) : topic ? (
              <>
                <div class="topic-name">{topic.name}</div>
                {topic.scenario && <div class="muted small">{topic.scenario}</div>}
              </>
            ) : (
              <span class="muted">…</span>
            )}
          </div>
        </div>
        {s && !s.conversation.done && (
          <div class="row" style="margin-top:10px">
            {s.conversation.conversationId ? (
              <button onClick={() => go({ name: 'chat', id: s.conversation.conversationId! })}>Continue today’s chat</button>
            ) : (
              topic && <button onClick={() => start({ topicId: topic.id })}>Start</button>
            )}
            <button class="secondary" onClick={skip}>
              {s.conversation.conversationId ? 'New topic' : 'Skip'}
            </button>
          </div>
        )}
        {s?.conversation.conversationId && !s.conversation.done && topic && skipped.length > 0 && (
          <button style="margin-top:8px" onClick={() => start({ topicId: topic.id })}>
            Start “{topic.name}”
          </button>
        )}
      </div>

      {convs.length > 0 && (
        <div class="card">
          <div class="muted small">Recent conversations</div>
          <ul class="list">
            {convs.slice(0, 6).map((c) => (
              <li key={c.id}>
                <a href={`#/chat/${c.id}`}>
                  {c.topic ?? config.freeChatTitle}{' '}
                  <span class="muted small">
                    · {new Date(c.started_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {c.message_count} msgs
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <button class="secondary" onClick={() => start({})}>
            Free chat (no topic)
          </button>
        </div>
      )}

      <div class="row muted small">
        <span class="grow">{usage}</span>
        <button class="secondary" onClick={logout}>
          Sign out
        </button>
      </div>
      {err && <p class="error">{err}</p>}
    </LangContext.Provider>
  );
}
