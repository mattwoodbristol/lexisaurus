import { isExplainSetting, type ExplainSetting } from '../core/explain';
import { bandLabel } from '../core/assessment/levels';
import { resetExplainStatus } from './explained';
import { DEFAULT_CORRECTION_LEVEL, isCorrectionLevel, type CorrectionLevel } from '../core/chat/corrections';
import { useEffect, useState } from 'preact/hooks';
import { api, errorText, levelApi, type PushStatus } from './api';
import { enablePush, disablePush, pushState, type PushState } from './push';
import { iosNeedsInstall } from './install';
import { MODE_LABEL } from './ruby';
import { isPinyinMode, type PinyinMode } from '../core/pinyin/annotate';
import { NATIVE_LANGUAGES } from '../core/languages/native';
import { DEFAULT_NOTIFY_TIMES } from '../core/notify/schedule';
import { stepCounts } from '../core/lessons/steps';
import { allLanguages, setEnabledLanguages, useStudyLang } from './lang';
import { DEFAULT_RATE, SPEECH_RATES, setAutoplay, setSpeechRate, speak } from './speech';

interface Form {
  enabled: boolean;
  quietStart: string;
  quietEnd: string;
  tz: string;
  dailyLimit: number;
  newPerDay: number;
  hintEvery: number;
  corrections: CorrectionLevel;
  about: string;
  nativeLang: string;
  speechRate: number;
  autoplay: boolean;
  budget: number;
  graduateDays: number;
  chatTurns: number;
  recogniseCount: number;
  buildCount: number;
  produceCount: number;
}

const IOS_PUSH_LABEL = 'On iPhone and iPad, reminders work once Lexisaurus is on your Home Screen: tap Share, then “Add to Home Screen”, and open it from there.';

const PUSH_LABEL: Record<PushState, string> = {
  unsupported: 'This browser cannot receive notifications. On Android, install the app from Chrome first.',
  denied: 'Notifications are blocked for this site. Allow them in the browser’s site settings, then come back.',
  off: 'Notifications are off on this device.',
  on: 'Notifications are on for this device.',
};

/** The latest level check for the study language, with links to retake it and to sort words. */
function LevelCard() {
  const { lang, config } = useStudyLang();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof levelApi.status>> | null>(null);
  useEffect(() => {
    levelApi
      .status(lang)
      .then(setInfo)
      .catch(() => {});
  }, [lang]);
  const l = info?.labels;
  return (
    <div class="card settings">
      <strong>Level · {config.nativeName}</strong>
      {info?.check ? (
        <p class="small">
          {[l?.vocab && `Vocabulary ${l.vocab}`, l?.grammar && `grammar ${l.grammar}`, l?.writing && `writing ${l.writing}`].filter(Boolean).join(', ')}{' '}
          <span class="muted">({info.check.date})</span>
        </p>
      ) : (
        <p class="muted small">No level check yet.</p>
      )}
      <div class="row">
        <a class="button-link" href="#/level-check">
          {info?.check ? 'Take it again' : 'Take the level check'}
        </a>
        <a class="button-link secondary" href="#/sort-words">
          Sort my words{info?.pile ? ` (${info.pile.label}: ${info.pile.left.toLocaleString()})` : ''}
        </a>
      </div>
    </div>
  );
}

/** Which languages are switched on (home switcher, reminders), and each one's own settings. Saved straight away. */
function LanguagesCard() {
  const { lang: studyLang, enabled } = useStudyLang();
  const on = new Set<string>(enabled.map((l) => l.id));
  const [picked, setPicked] = useState(studyLang);
  const [err, setErr] = useState('');
  const shown = enabled.find((l) => l.id === picked) ?? enabled.find((l) => l.id === studyLang) ?? enabled[0];
  async function toggle(id: string) {
    const next = on.has(id) ? [...on].filter((x) => x !== id) : [...on, id];
    if (!next.length) return setErr('Keep at least one language on.');
    setErr('');
    await setEnabledLanguages(next).catch((e) => setErr(errorText(e)));
  }
  return (
    <div class="card settings">
      <strong>Languages</strong>
      <p class="muted small">Switched-on languages appear on the home screen and get reminders.</p>
      {allLanguages().map((l) => (
        <label key={l.id} class="check">
          <input type="checkbox" checked={on.has(l.id)} onChange={() => toggle(l.id)} /> {l.nativeName} <span class="muted small">{l.name}</span>
        </label>
      ))}
      {err && <p class="error small">{err}</p>}
      {shown && (
        <>
          <label class="lang-pick">
            <div class="label">Settings for</div>
            <select value={shown.id} onChange={(e) => setPicked((e.target as HTMLSelectElement).value)}>
              {enabled.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nativeName} ({l.name})
                </option>
              ))}
            </select>
          </label>
          <div class="lang-settings" key={shown.id}>
            <ExplainSelect lang={shown.id} name={shown.nativeName} />
            <PoolBandSelect lang={shown.id} name={shown.nativeName} />
            <ReminderTimes lang={shown.id} />
            {shown.hasRomanisation && <PinyinSelect lang={shown.id} />}
          </div>
        </>
      )}
    </div>
  );
}

/** A language's daily reminder times (<lang>.notify_times). */
function ReminderTimes({ lang }: { lang: string }) {
  const [times, setTimes] = useState<string[] | null>(null);
  useEffect(() => {
    api
      .settings()
      .then((s) => setTimes(Array.isArray(s[`${lang}.notify_times`]) ? (s[`${lang}.notify_times`] as string[]) : DEFAULT_NOTIFY_TIMES))
      .catch(() => {});
  }, [lang]);
  if (!times) return null;
  async function save(next: string[]) {
    setTimes(next);
    await api.putSetting(`${lang}.notify_times`, [...new Set(next.filter((t) => /^\d{2}:\d{2}$/.test(t)))].sort()).catch(() => {});
  }
  return (
    <div>
      <div class="label">Reminder times</div>
      {times.map((t, i) => (
        <div class="row" key={i}>
          <input type="time" value={t} onChange={(e) => save(times.map((x, j) => (j === i ? (e.target as HTMLInputElement).value : x)))} />
          <button type="button" class="secondary icon" aria-label="Remove time" onClick={() => save(times.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <div>
        <button type="button" class="secondary" onClick={() => save([...times, '12:30'])}>
          Add a time
        </button>
      </div>
    </div>
  );
}

/** Reading aid for languages that have one (zh: pinyin). */
function PinyinSelect({ lang }: { lang: string }) {
  const [value, setValue] = useState<PinyinMode>('smart');
  useEffect(() => {
    api
      .settings()
      .then((s) => isPinyinMode(s[`${lang}.pinyin_mode`]) && setValue(s[`${lang}.pinyin_mode`] as PinyinMode))
      .catch(() => {});
  }, [lang]);
  async function change(v: PinyinMode) {
    setValue(v);
    await api.putSetting(`${lang}.pinyin_mode`, v).catch(() => {});
  }
  return (
    <label>
      <div class="label">Pinyin mode</div>
      <select value={value} onChange={(e) => change((e.target as HTMLSelectElement).value as PinyinMode)}>
        {(['off', 'smart', 'all'] as PinyinMode[]).map((m) => (
          <option key={m} value={m}>
            {MODE_LABEL[m]}
          </option>
        ))}
      </select>
    </label>
  );
}

function ExplainSelect({ lang, name }: { lang: string; name: string }) {
  const [value, setValue] = useState<ExplainSetting>('auto');
  useEffect(() => {
    api
      .settings()
      .then((s) => isExplainSetting(s[`${lang}.explain_in`]) && setValue(s[`${lang}.explain_in`] as ExplainSetting))
      .catch(() => {});
  }, [lang]);
  async function change(v: ExplainSetting) {
    setValue(v);
    await api.putSetting(`${lang}.explain_in`, v).catch(() => {});
    resetExplainStatus();
  }
  return (
    <label>
      <div class="label">Explanations for {name}</div>
      <select value={value} onChange={(e) => change((e.target as HTMLSelectElement).value as ExplainSetting)}>
        <option value="auto">Auto (in {name} from B1 / HSK 3)</option>
        <option value="target">Always in {name}</option>
        <option value="native">Always in my language</option>
      </select>
      <div class="muted small">Explanations cover lessons, hints, corrections and marking. Auto writes them in {name} from B1 / HSK 3 (judged by the weaker of your grammar and vocabulary), with a button to see them in your own language. Chat corrections and practice marking switch later, from B2 / HSK 4.</div>
    </label>
  );
}

/** Highest band the pool introduces (and asks to sort) for a language; harder words wait. */
function PoolBandSelect({ lang, name }: { lang: string; name: string }) {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    api
      .settings()
      .then((s) => {
        const v = s[`${lang}.pool_max_band`];
        setValue(typeof v === 'number' && v >= 1 && v <= 6 ? v : null);
      })
      .catch(() => {});
  }, [lang]);
  async function change(raw: string) {
    const v = raw === '' ? null : Number(raw);
    setValue(v);
    await api.putSetting(`${lang}.pool_max_band`, v).catch(() => {});
  }
  return (
    <label>
      <div class="label">New words for {name} up to</div>
      <select value={value === null ? '' : String(value)} onChange={(e) => change((e.target as HTMLSelectElement).value)}>
        <option value="">Any level</option>
        {[1, 2, 3, 4, 5, 6].map((b) => (
          <option key={b} value={String(b)}>
            {bandLabel(lang, b)}
          </option>
        ))}
      </select>
      <div class="muted small">Harder words stay out of reviews and sorting until you raise this.</div>
    </label>
  );
}

export function Settings({ onBack, onCourse }: { onBack: () => void; onCourse: () => void }) {
  const [form, setForm] = useState<Form | null>(null);
  const [push, setPush] = useState<PushState>('off');
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const loadStatus = () => api.pushStatus().then(setStatus).catch(() => {});
  useEffect(() => {
    api
      .settings()
      .then((s) => {
        const q = (s['notify.quiet'] as { start?: string; end?: string } | undefined) ?? {};
        setForm({
          enabled: s['notify.enabled'] !== false,
          quietStart: q.start ?? '22:00',
          quietEnd: q.end ?? '07:00',
          tz: typeof s['tz'] === 'string' ? (s['tz'] as string) : 'Europe/London',
          dailyLimit: Number(s['review.daily_limit'] ?? 60),
          newPerDay: Number(s['review.new_per_day'] ?? 10),
          hintEvery: Number(s['chat.hint_every'] ?? 4),
          about: typeof s['learner.about'] === 'string' ? (s['learner.about'] as string) : '',
          corrections: isCorrectionLevel(s['chat.corrections']) ? s['chat.corrections'] : DEFAULT_CORRECTION_LEVEL,
          nativeLang: typeof s['native_lang'] === 'string' ? (s['native_lang'] as string) : 'en',
          speechRate: Number(s['speech.rate'] ?? DEFAULT_RATE) || DEFAULT_RATE,
          autoplay: s['review.autoplay'] !== false,
          budget: Number(s['daily_token_budget'] ?? 200000),
          graduateDays: Number(s['srs.graduate_days'] ?? 21),
          chatTurns: Number(s['session.min_chat_turns'] ?? 3),
          recogniseCount: stepCounts(s).recognise,
          buildCount: stepCounts(s).build,
          produceCount: stepCounts(s).produce,
        });
      })
      .catch((e) => setErr(errorText(e)));
    pushState().then(setPush);
    loadStatus();
  }, []);

  if (!form) return <p class="muted">{err || 'Loading…'}</p>;
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });

  async function save(e: Event) {
    e.preventDefault();
    setErr('');
    setMsg('');
    const f = form!;
    try {
      await Promise.all([
        api.putSetting('notify.enabled', f.enabled),
        api.putSetting('notify.quiet', { start: f.quietStart, end: f.quietEnd }),
        api.putSetting('tz', f.tz.trim() || 'Europe/London'),
        api.putSetting('review.daily_limit', Math.max(1, Math.round(f.dailyLimit))),
        api.putSetting('review.new_per_day', Math.max(0, Math.round(f.newPerDay))),
        api.putSetting('chat.hint_every', Math.max(0, Math.round(f.hintEvery))),
        api.putSetting('chat.corrections', f.corrections),
        api.putSetting('learner.about', f.about.trim().slice(0, 1000)),
        api.putSetting('native_lang', f.nativeLang),
        api.putSetting('speech.rate', f.speechRate),
        api.putSetting('review.autoplay', f.autoplay),
        api.putSetting('daily_token_budget', Math.max(1000, Math.round(f.budget))),
        api.putSetting('srs.graduate_days', Math.max(1, Math.round(f.graduateDays))),
        api.putSetting('session.min_chat_turns', Math.max(1, Math.round(f.chatTurns))),
        api.putSetting('lesson.recognise_count', Math.max(1, Math.round(f.recogniseCount))),
        api.putSetting('lesson.build_count', Math.max(1, Math.round(f.buildCount))),
        api.putSetting('lesson.produce_count', Math.max(1, Math.round(f.produceCount))),
      ]);
      setSpeechRate(f.speechRate);
      setAutoplay(f.autoplay);
      setMsg('Saved.');
    } catch (e) {
      setErr(errorText(e));
    }
  }

  async function togglePush() {
    setBusy(true);
    setErr('');
    try {
      setPush(push === 'on' ? await disablePush() : await enablePush());
      await loadStatus();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const r = await api.testPush();
      setMsg(r.sent ? `Test sent to ${r.sent} device${r.sent === 1 ? '' : 's'}. It should arrive within a few seconds.` : `Not delivered (push service replied ${r.statuses.join(', ') || 'nothing'}).`);
      await loadStatus();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const num = (v: number, k: keyof Form) => (
    <input type="number" inputMode="numeric" value={v} onInput={(e) => set({ [k]: Number((e.target as HTMLInputElement).value) } as Partial<Form>)} />
  );

  return (
    <>
      <div class="row">
        <button class="secondary icon" onClick={onBack} aria-label="Back to home">
          ‹
        </button>
        <h1 class="grow">Settings</h1>
      </div>

      <div class="card">
        <strong>Reminders on this device</strong>
        <p class="muted small">{iosNeedsInstall() ? IOS_PUSH_LABEL : PUSH_LABEL[push]}</p>
        <div class="row">
          {!iosNeedsInstall() && push !== 'unsupported' && push !== 'denied' && (
            <button onClick={togglePush} disabled={busy}>
              {push === 'on' ? 'Turn off on this device' : 'Turn on notifications'}
            </button>
          )}
          {push === 'on' && (
            <button class="secondary" onClick={test} disabled={busy}>
              Send a test
            </button>
          )}
        </div>
      </div>

      <LanguagesCard />
      <LevelCard />

      <div class="card row">
        <div class="grow small">
          <strong>Course</strong>
          <div class="muted">Plan the next lessons with Claude, or download and upload the course as files to edit it.</div>
        </div>
        <button class="secondary" onClick={onCourse}>
          Open
        </button>
      </div>

      <form class="card settings" onSubmit={save}>
        <label class="check">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: (e.target as HTMLInputElement).checked })} /> Send daily reminders
        </label>
        <p class="muted small">Reminder times are set for each language under Languages.</p>
        <div>
          <div class="label">Quiet hours (no reminders)</div>
          <div class="row">
            <input type="time" value={form.quietStart} onInput={(e) => set({ quietStart: (e.target as HTMLInputElement).value })} />
            <span>to</span>
            <input type="time" value={form.quietEnd} onInput={(e) => set({ quietEnd: (e.target as HTMLInputElement).value })} />
          </div>
        </div>
        <label>
          <div class="label">Time zone</div>
          <input value={form.tz} onInput={(e) => set({ tz: (e.target as HTMLInputElement).value })} />
        </label>
        <label>
          <div class="label">About you (optional): where you live, work, interests, people in your life. Lessons use it for examples and the tutor for chat topics.</div>
          <textarea rows={3} maxLength={1000} value={form.about} onInput={(e) => set({ about: (e.target as HTMLTextAreaElement).value })} />
        </label>
        <label>
          <div class="label">Your language (the translate button, e.g. EN, translates into it)</div>
          <select value={form.nativeLang} onChange={(e) => set({ nativeLang: (e.target as HTMLSelectElement).value })}>
            {NATIVE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name} ({l.code.toUpperCase()})
              </option>
            ))}
          </select>
        </label>
        <label>
          <div class="label">Audio speed (the 🔊 buttons)</div>
          <div class="row">
            <select value={String(form.speechRate)} onChange={(e) => set({ speechRate: Number((e.target as HTMLSelectElement).value) })}>
              {SPEECH_RATES.map((r) => (
                <option key={r.value} value={String(r.value)}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              class="secondary"
              onClick={() => {
                setSpeechRate(form.speechRate);
                speak('你好，我们今天一起练习中文吧。');
              }}
            >
              Try it
            </button>
          </div>
        </label>
        <label class="check">
          <input type="checkbox" checked={form.autoplay} onChange={(e) => set({ autoplay: (e.target as HTMLInputElement).checked })} /> Auto-play: say answers as they are revealed, in reviews and lessons
        </label>
        <label>
          <div class="label">Reviews per day (all cards, new words included)</div>
          {num(form.dailyLimit, 'dailyLimit')}
        </label>
        <label>
          <div class="label">New words per day (cards you have not seen before; 0 = none)</div>
          {num(form.newPerDay, 'newPerDay')}
        </label>
        <label>
          <div class="label">Corrections in chat (everything is listed when you tap Finish; lesson practice chats are always Strict)</div>
          <select value={form.corrections} onChange={(e) => set({ corrections: (e.target as HTMLSelectElement).value as CorrectionLevel })}>
            <option value="light">Light: only mistakes that change your meaning</option>
            <option value="balanced">Balanced: the most important one, not on every message</option>
            <option value="strict">Strict: up to three per message</option>
          </select>
        </label>
        <label>
          <div class="label">Grammar hints in chat: at most one every this many tutor replies (0 = off)</div>
          {num(form.hintEvery, 'hintEvery')}
        </label>
        <label>
          <div class="label">Chat turns that count as today’s conversation</div>
          {num(form.chatTurns, 'chatTurns')}
        </label>
        <div>
          <div class="label">Lesson questions per step (at most; a lesson may have fewer)</div>
          <div class="row">
            <label>
              <div class="muted small">Recognise</div>
              {num(form.recogniseCount, 'recogniseCount')}
            </label>
            <label>
              <div class="muted small">Build</div>
              {num(form.buildCount, 'buildCount')}
            </label>
            <label>
              <div class="muted small">Produce</div>
              {num(form.produceCount, 'produceCount')}
            </label>
          </div>
        </div>
        <label>
          <div class="label">A word becomes known when its next review is this many days away</div>
          {num(form.graduateDays, 'graduateDays')}
        </label>
        <label>
          <div class="label">Daily Claude token budget</div>
          {num(form.budget, 'budget')}
        </label>
        <button>Save settings</button>
        {msg && <p class="muted small">{msg}</p>}
        {err && <p class="error">{err}</p>}
      </form>

      {status && status.recent.length > 0 && (
        <div class="card">
          <strong>Recent reminders</strong>
          <ul class="list small">
            {status.recent.map((r, i) => (
              <li key={i}>
                {r.local_date} {r.slot} · {r.body} <span class="muted">· {r.sent_to} device(s)</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div class="card">
        <strong>Back up</strong>
        <p class="muted small">
          Download all your data (words, reviews, lessons, chats, mistakes, settings) as one file. Cloudflare also keeps 30 days of database history
          (D1 Time Travel) that can restore the whole database to an earlier point.
        </p>
        <a class="button-link secondary" href="/api/settings/export" download>
          Download backup
        </a>
      </div>
    </>
  );
}
