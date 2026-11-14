// Themed vocabulary: pick a theme (a suggestion, Claude's ideas, or your own) and work through a
// short course over a few days: each day a set of everyday words and phrases (with pictures and
// labelled diagrams) and a grammar point, then a quiz that also brings back earlier days.
// Finishing a day adds its words to reviews; a theme followed daily shows on the home screen.
import { useEffect, useState } from 'preact/hooks';
import { api, errorText, type ThemeDetail, type ThemeSummary, type WordStatus } from './api';
import { LangContext, useLangConfig, useStudyLang } from './lang';
import { PinyinToggle, Zh, usePinyinMode } from './ruby';
import { SpeakButton, setAutoplay, speak, stopSpeaking, useAutoplay, useCanSpeak } from './speech';
import { Lexi, useLexiStage } from './mascot/lexi';
import { getLanguage } from '../core/languages';
import { rulesFor } from '../core/text/rules';
import {
  DAY_LIMITS,
  DIAGRAM_SIZE,
  cleanEmoji,
  currentDay,
  dayOf,
  dayWritten,
  themeDays,
  themeLemmas,
  themeQuiz,
  type QuizQuestion,
  type ThemeDiagram,
  type ThemeItem,
} from '../core/themes/types';
import type { ThemeIdea } from '../core/themes/suggestions';
import type { PinyinMode, Token } from '../core/pinyin/annotate';

export function ThemesIndex({ onBack, onOpen }: { onBack: () => void; onOpen: (id: number) => void }) {
  const { lang, config } = useStudyLang();
  const { stage } = useLexiStage(lang);
  const [items, setItems] = useState<ThemeSummary[] | null>(null);
  const [ideas, setIdeas] = useState<ThemeIdea[]>([]);
  const [name, setName] = useState('');
  const [days, setDays] = useState(DAY_LIMITS.default);
  const [daily, setDaily] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setItems(null);
    setIdeas([]);
    api
      .themes(lang)
      .then((r) => {
        setItems(r.items);
        setIdeas(r.ideas);
      })
      .catch((e) => setErr(errorText(e)));
  }, [lang]);

  async function make(theme: string, hint?: string) {
    if (!theme.trim()) return;
    setBusy(theme.trim());
    setErr('');
    try {
      onOpen((await api.newTheme(lang, theme.trim(), { hint, days, daily })).id);
    } catch (e) {
      setErr(errorText(e));
      setBusy(null);
    }
  }

  async function suggest() {
    setSuggesting(true);
    setErr('');
    try {
      const r = await api.themeIdeas(lang);
      const have = new Set(ideas.map((i) => i.name.toLowerCase()));
      setIdeas([...r.ideas.filter((i) => !have.has(i.name.toLowerCase())), ...ideas]);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setSuggesting(false);
    }
  }

  const dayChoices = Array.from({ length: DAY_LIMITS.max - DAY_LIMITS.min + 1 }, (_, i) => DAY_LIMITS.min + i);
  return (
    <LangContext.Provider value={lang}>
      <div class="row chat-header">
        <button class="secondary icon" onClick={onBack} aria-label="Back to home">
          ‹
        </button>
        <strong class="grow">Themes · {config.nativeName}</strong>
      </div>
      <div class="card">
        <p class="small">
          The everyday words, phrases and grammar to talk about one subject in detail, the way a native child can: the body, the home and its fittings, tennis. A theme runs over a few days, with pictures and
          labelled diagrams. Pick an idea below or name your own.
        </p>
        {busy ? (
          <div class="lexi-thinking">
            <Lexi stage={stage} mood="thinking" size={56} />
            <span class="muted">Planning “{busy}” and writing day 1… this takes a minute or two.</span>
          </div>
        ) : (
          <>
            <form
              class="row"
              onSubmit={(e) => {
                e.preventDefault();
                make(name);
              }}
            >
              <input class="grow" placeholder="Your theme, e.g. horses, sailing, my car" value={name} maxLength={120} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
              <button disabled={!name.trim()}>Write it</button>
            </form>
            <div class="row theme-options">
              <span class="small muted">Days</span>
              <div class="rate-pills" role="group" aria-label="Number of days">
                {dayChoices.map((n) => (
                  <button key={n} type="button" class={`chip ${days === n ? 'on' : ''}`} aria-pressed={days === n} onClick={() => setDays(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <label class="small row theme-daily">
                <input type="checkbox" checked={daily} onChange={(e) => setDaily((e.target as HTMLInputElement).checked)} /> A day at a time on the home screen
              </label>
            </div>
          </>
        )}
      </div>
      {err && <p class="error">{err}</p>}

      {items && items.length > 0 && (
        <div class="card">
          <div class="muted small">Your themes</div>
          <ul class="list">
            {items.map((it) => (
              <li key={it.id}>
                <a href={`#/themes/${it.id}`}>
                  {it.title}{' '}
                  <span class="muted small">
                    · {it.days_done >= it.days ? `all ${it.days} days done` : `day ${it.days_done} of ${it.days} done`} · {it.items} words and phrases
                    {it.daily && it.days_done < it.days ? ' · on home' : ''}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div class="card">
        <div class="row">
          <div class="muted small grow">Ideas</div>
          <button class="secondary" disabled={suggesting || !!busy} onClick={suggest}>
            {suggesting ? 'Thinking…' : 'Suggest more'}
          </button>
        </div>
        {items === null ? (
          <p class="muted">Loading…</p>
        ) : (
          <ul class="theme-ideas">
            {ideas.map((i) => (
              <li key={i.name}>
                <button class="option" disabled={!!busy} onClick={() => make(i.name, i.hint)}>
                  <strong>{i.name}</strong>
                  <div class="muted small">{i.hint}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </LangContext.Provider>
  );
}

const STATUS_LABEL: Record<WordStatus, string> = { known: 'known', learning: 'in reviews', new: '', unknown: '' };

type Quiz = { questions: QuizQuestion[]; day: number | null };

export function ThemePage({ id, onBack, onIndex, onChat }: { id: number; onBack: () => void; onIndex: () => void; onChat: (id: number) => void }) {
  const [d, setD] = useState<ThemeDetail | null>(null);
  const [ann, setAnn] = useState<Record<string, Token[]>>({});
  const [statuses, setStatuses] = useState<Record<string, WordStatus>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<'write' | 'learn' | 'chat' | null>(null);
  const [note, setNote] = useState('');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const lang = d?.lang ?? 'zh';
  const config = getLanguage(lang) ?? getLanguage('zh')!;
  const rules = rulesFor(config.script);
  const [mode, cycleMode] = usePinyinMode(lang);
  const { stage } = useLexiStage(lang);

  function load() {
    return api.theme(id).then((r) => {
      setD(r.theme);
      setAnn(r.annotations);
      setStatuses(r.statuses);
      return r.theme;
    });
  }

  useEffect(() => {
    setD(null);
    setQuiz(null);
    setDay(null);
    setNote('');
    load()
      .then((t) => setDay((cur) => cur ?? (t.doneToday ? Math.max(1, t.daysDone) : currentDay(t.daysDone, themeDays(t)))))
      .catch((e) => setErr(errorText(e)));
  }, [id]);

  // A day not written yet is written when opened (normally it was written ahead in the background).
  useEffect(() => {
    if (d && day && !dayWritten(d, day) && dayWritten(d, day - 1) && !busy && !err) write(day);
  }, [d, day]);

  if (!d || !day) return err ? <p class="error">{err}</p> : <p class="muted">Loading…</p>;
  const days = themeDays(d);
  const written = dayWritten(d, day);
  const plan = d.days?.[day - 1];
  const sections = d.sections.map((s, i) => ({ s, i })).filter(({ s }) => dayOf(s) === day);
  const grammar = d.grammar.filter((g) => dayOf(g) === day);
  const lemmas = themeLemmas(d, rules.key, day);
  const known = lemmas.filter((l) => statuses[l] === 'known').length;
  const reviewing = lemmas.filter((l) => statuses[l] === 'learning').length;
  const dayDone = d.daysDone >= day;
  const allDone = d.daysDone >= days;

  async function write(n: number) {
    setBusy('write');
    setErr('');
    try {
      await api.themeDay(id, n);
      await load();
      setDay(n);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function learn(only: string) {
    setBusy('learn');
    setErr('');
    try {
      await api.themeLearn(id, [only]);
      await load();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function finished(score: number, total: number, quizDay: number | null) {
    try {
      if (quizDay === null) {
        await api.themeResult(id, score, total);
        await load();
        return;
      }
      const r = await api.themeDayDone(id, quizDay, score, total);
      await load();
      const next = quizDay < days ? ` Day ${quizDay + 1} will be ready tomorrow.` : ' That was the last day: well done!';
      setNote(`Day ${quizDay} done.${r.added ? ` ${r.added} words added to your reviews.` : ''}${next}`);
    } catch (e) {
      setErr(errorText(e));
    }
  }

  async function chat() {
    setBusy('chat');
    try {
      const words = d!.sections.filter((s) => dayOf(s) <= day!).flatMap((s) => s.items.filter((it) => it.kind === 'word').map((it) => it.lemma ?? it.text));
      const sample = words.sort(() => Math.random() - 0.5).slice(0, 8).join(', ');
      const topic = `${d!.title}: talk about it in detail, using words like ${sample}`.slice(0, 200);
      onChat((await api.newConversation(lang, { customTopic: topic })).id);
    } catch (e) {
      setErr(errorText(e));
      setBusy(null);
    }
  }

  async function follow(on: boolean) {
    try {
      await api.themeDaily(id, on);
      setD({ ...d!, daily: on });
    } catch (e) {
      setErr(errorText(e));
    }
  }

  async function remove() {
    if (!confirm(`Delete “${d!.title}”? Words already added to reviews stay there.`)) return;
    try {
      await api.deleteTheme(id);
      onIndex();
    } catch (e) {
      setErr(errorText(e));
    }
  }

  return (
    <LangContext.Provider value={lang}>
      <div class="theme">
        <div class="row chat-header">
          <button class="secondary icon" onClick={quiz ? () => setQuiz(null) : onBack} aria-label="Back">
            ‹
          </button>
          <strong class="grow">{d.title}</strong>
          <PinyinToggle mode={mode} onCycle={cycleMode} />
        </div>

        {quiz ? (
          <QuizView
            quiz={quiz}
            theme={d}
            ann={ann}
            mode={mode}
            onDone={(score, total) => finished(score, total, quiz.day)}
            onAgain={() => setQuiz({ ...quiz, questions: themeQuiz(d, quiz.day ? { day: quiz.day } : { n: 20 }) })}
            onClose={() => setQuiz(null)}
          />
        ) : (
          <>
            {days > 1 && (
              <div class="theme-days" role="tablist" aria-label="Days">
                {Array.from({ length: days }, (_, i) => i + 1).map((n) => (
                  <button key={n} role="tab" aria-selected={n === day} class={`chip ${n === day ? 'on' : ''}`} onClick={() => setDay(n)} disabled={!!busy}>
                    {d.daysDone >= n ? '✓ ' : ''}Day {n}
                  </button>
                ))}
              </div>
            )}

            <div class="card">
              {day === 1 && d.intro && <p class="small">{d.intro}</p>}
              <div class="muted small">
                Day {day} of {days}
                {dayDone ? ' · done' : ''}
              </div>
              {plan && <strong>{plan.title}</strong>}
              {written && (
                <p class="muted small">
                  {lemmas.length} words today: {known} known, {reviewing} in your reviews
                </p>
              )}
              {d.doneToday && !dayDone && day === d.daysDone + 1 && <p class="small">You finished day {d.daysDone} today. Coming back tomorrow helps it stick, but you can start now.</p>}
              {written && (
                <div class="row">
                  <button class={dayDone ? 'secondary' : ''} onClick={() => setQuiz({ questions: themeQuiz(d, { day }), day })}>
                    {dayDone ? 'Quiz again' : `Day ${day} quiz`}
                  </button>
                  <button class="secondary" disabled={!!busy} onClick={chat}>
                    {busy === 'chat' ? 'Starting…' : 'Chat about it'}
                  </button>
                </div>
              )}
              {!dayDone && written && <p class="muted small">Finishing the quiz completes the day and adds its words to your reviews.</p>}
              {note && <p class="small">{note}</p>}
              {err && <p class="error">{err}</p>}
            </div>

            {!written &&
              (busy === 'write' ? (
                <div class="card lexi-thinking">
                  <Lexi stage={stage} mood="thinking" size={48} />
                  <span class="muted">Writing day {day}… this takes a minute or two.</span>
                </div>
              ) : (
                <div class="card">
                  {dayWritten(d, day - 1) ? (
                    <button onClick={() => write(day)}>Write day {day}</button>
                  ) : (
                    <p class="small muted">Do day {day - 1} first.</p>
                  )}
                </div>
              ))}

            {sections.map(({ s, i }) => (
              <Section key={i} heading={s.heading} items={s.items} diagram={s.diagram ?? null} ann={ann} mode={mode} statuses={statuses} rkey={rules.key} busy={!!busy} onLearn={learn} />
            ))}

            {grammar.map((g, i) => (
              <section key={i} class="card">
                <div class="muted small">Grammar</div>
                <h2>{g.title}</h2>
                <p class="small">{g.explanation}</p>
                <ul class="theme-items">
                  {g.examples.map((e, j) => (
                    <li key={j}>
                      <div class="with-speak">
                        <Zh text={e.text} ann={ann} mode={mode} /> <SpeakButton text={e.text} small />
                      </div>
                      <div class="muted small">{e.translation}</div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <div class="card">
              <label class="small row theme-daily">
                <input type="checkbox" checked={d.daily} onChange={(e) => follow((e.target as HTMLInputElement).checked)} /> A day at a time on the home screen
              </label>
              <div class="row" style="margin-top:10px">
                {d.daysDone > 0 && (
                  <button class="secondary" onClick={() => setQuiz({ questions: themeQuiz(d, { n: 20 }), day: null })}>
                    Quiz on the whole theme
                  </button>
                )}
                {allDone && dayWritten(d, days) && (
                  <button class="secondary" disabled={!!busy} onClick={() => write(days + 1)}>
                    {busy === 'write' ? 'Writing…' : 'Add another day'}
                  </button>
                )}
                <button class="secondary" onClick={onIndex}>
                  All themes
                </button>
                <button class="secondary" onClick={remove}>
                  Delete
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </LangContext.Provider>
  );
}

function Section({
  heading,
  items,
  diagram,
  ann,
  mode,
  statuses,
  rkey,
  busy,
  onLearn,
}: {
  heading: string;
  items: ThemeItem[];
  diagram: ThemeDiagram | null;
  ann: Record<string, Token[]>;
  mode: PinyinMode;
  statuses: Record<string, WordStatus>;
  rkey: (w: string) => string;
  busy: boolean;
  onLearn: (lemma: string) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  // Markers are numbered in item order, so the numbers read down the list.
  const numbers = new Map((diagram?.markers ?? []).map((m) => m.item).sort((a, b) => a - b).map((item, k) => [item, k + 1]));
  return (
    <section class="card">
      <h2>{heading}</h2>
      {diagram && (
        <>
          <Diagram diagram={diagram} numbers={numbers} picked={picked} onPick={setPicked} />
          {picked !== null && items[picked] && (
            <div class="with-speak theme-picked">
              <strong>{numbers.get(picked)}</strong> <Zh text={items[picked]!.text} ann={ann} mode={mode} /> <SpeakButton text={items[picked]!.text} small /> <span class="muted small">{items[picked]!.translation}</span>
            </div>
          )}
        </>
      )}
      <ul class="theme-items">
        {items.map((it, j) => (
          <Item
            key={j}
            item={it}
            number={numbers.get(j)}
            picked={picked === j}
            onPick={numbers.has(j) ? () => setPicked(picked === j ? null : j) : undefined}
            ann={ann}
            mode={mode}
            status={it.lemma ? (statuses[rkey(it.lemma)] ?? 'unknown') : null}
            busy={busy}
            onLearn={() => onLearn(rkey(it.lemma!))}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * A theme diagram: the model's shapes (path data only, checked on the server) in theme colours,
 * with the app's own numbered markers. `focus` (quiz) shows one marker, unnumbered, and no others.
 */
function Diagram({ diagram, numbers, picked, onPick, focus }: { diagram: ThemeDiagram; numbers?: Map<number, number>; picked?: number | null; onPick?: (item: number) => void; focus?: number }) {
  return (
    <svg class="theme-diagram" viewBox={`0 0 ${DIAGRAM_SIZE.w} ${DIAGRAM_SIZE.h}`} role="img" aria-label="Labelled diagram">
      {diagram.shapes.map((s, i) => (
        <path key={i} d={s.d} class={`dg-${s.tone}`} />
      ))}
      {diagram.markers
        .filter((m) => focus === undefined || m.item === focus)
        .map((m) => {
          const on = focus !== undefined || picked === m.item;
          return (
            <g key={m.item} class={`dg-marker${on ? ' on' : ''}`} onClick={onPick ? () => onPick(m.item) : undefined} role={onPick ? 'button' : undefined} aria-label={onPick ? `Part ${numbers?.get(m.item)}` : undefined}>
              {focus !== undefined && <circle cx={m.x} cy={m.y} r={20} class="dg-ring" />}
              <circle cx={m.x} cy={m.y} r={on ? 13 : 11} />
              {focus === undefined && (
                <text x={m.x} y={m.y} dy="0.35em" text-anchor="middle">
                  {numbers?.get(m.item)}
                </text>
              )}
            </g>
          );
        })}
    </svg>
  );
}

function Item({
  item,
  number,
  picked,
  onPick,
  ann,
  mode,
  status,
  busy,
  onLearn,
}: {
  item: ThemeItem;
  number?: number;
  picked: boolean;
  onPick?: () => void;
  ann: Record<string, Token[]>;
  mode: PinyinMode;
  status: WordStatus | null;
  busy: boolean;
  onLearn: () => void;
}) {
  const emoji = cleanEmoji(item.emoji);
  return (
    <li class={`theme-item ${item.kind}${picked ? ' picked' : ''}`}>
      <div class="row">
        {number !== undefined ? (
          <button class="theme-num" onClick={onPick} aria-label={`Show ${number} on the diagram`}>
            {number}
          </button>
        ) : (
          emoji && (
            <span class="theme-emoji" aria-hidden="true">
              {emoji}
            </span>
          )
        )}
        <div class="grow">
          <div class="with-speak">
            <Zh text={item.text} ann={ann} mode={mode} /> <SpeakButton text={item.text} small />
            {number !== undefined && emoji && <span aria-hidden="true"> {emoji}</span>}
          </div>
          <div class="muted small">
            {item.translation}
            {item.note && <span class="theme-note"> · {item.note}</span>}
          </div>
        </div>
        {status &&
          (status === 'known' || status === 'learning' ? (
            <span class={`chip small theme-status ${status}`}>{STATUS_LABEL[status]}</span>
          ) : (
            <button class="secondary small" disabled={busy} onClick={onLearn} aria-label={`Add ${item.lemma} to reviews`}>
              + Learn
            </button>
          ))}
      </div>
    </li>
  );
}

const QUESTION_LABEL: Record<QuizQuestion['kind'], string> = { say: 'How do you say it?', meaning: 'What does it mean?', picture: 'What is this?', diagram: 'What is this part?' };

function QuizView({
  quiz,
  theme,
  ann,
  mode,
  onDone,
  onAgain,
  onClose,
}: {
  quiz: Quiz;
  theme: ThemeDetail;
  ann: Record<string, Token[]>;
  mode: PinyinMode;
  onDone: (score: number, total: number) => void;
  onAgain: () => void;
  onClose: () => void;
}) {
  const { questions } = quiz;
  const config = useLangConfig();
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  useEffect(() => {
    setAt(0);
    setPicked(null);
    setScore(0);
  }, [questions]);
  // Auto-play (setting review.autoplay, as in reviews): a prompt in the language being learnt as
  // it appears, and the right answer once one is chosen.
  const autoplay = useAutoplay() ?? false;
  const canSpeak = useCanSpeak(config.ttsLang);
  const current = questions[at];
  useEffect(() => {
    if (!autoplay || !canSpeak || !current) return;
    const text = picked !== null ? current.text : current.kind === 'meaning' ? current.prompt : null;
    if (!text) return;
    speak(text, config.ttsLang);
    return () => stopSpeaking();
  }, [current, picked !== null, autoplay, canSpeak]);
  const toggleAutoplay = () => {
    const next = !autoplay;
    setAutoplay(next);
    if (!next) stopSpeaking();
    api.putSetting('review.autoplay', next).catch(() => {});
  };

  if (!questions.length) return <p class="muted">Nothing to quiz yet.</p>;
  if (at >= questions.length)
    return (
      <div class="card">
        <h2>
          {score} of {questions.length} right
        </h2>
        {quiz.day && <p class="small">Day {quiz.day} is done.</p>}
        <div class="row">
          <button onClick={onAgain}>Another round</button>
          <button class="secondary" onClick={onClose}>
            Back to the theme
          </button>
        </div>
      </div>
    );
  const q = questions[at]!;
  const diagram = q.kind === 'diagram' && q.section !== undefined ? theme.sections[q.section]?.diagram : null;
  function choose(i: number) {
    if (picked !== null) return;
    setPicked(i);
    if (i === q.answer) setScore(score + 1);
  }
  function next() {
    const n = at + 1;
    if (n >= questions.length) onDone(score, questions.length);
    setAt(n);
    setPicked(null);
  }
  return (
    <div class="card">
      <div class="row">
        <div class="muted small grow">
          {at + 1} of {questions.length} · {QUESTION_LABEL[q.kind]}
        </div>
        {canSpeak && (
          <button class={`secondary icon autoplay ${autoplay ? 'on' : ''}`} onClick={toggleAutoplay} aria-label={autoplay ? 'Auto-play audio is on. Tap to turn off.' : 'Auto-play audio is off. Tap to turn on.'} title="Auto-play audio">
            {autoplay ? '🔊' : '🔇'}
          </button>
        )}
      </div>
      <div class="choice">
        {q.kind === 'diagram' && diagram ? (
          <Diagram diagram={diagram} focus={q.item} />
        ) : q.kind === 'picture' ? (
          <div class="theme-quiz-emoji" aria-label="Picture">
            {q.prompt}
          </div>
        ) : (
          <div class="choice-prompt with-speak">
            {q.kind === 'meaning' ? (
              <>
                <Zh text={q.prompt} ann={ann} mode={mode} /> <SpeakButton text={q.prompt} small />
              </>
            ) : (
              q.prompt
            )}
          </div>
        )}
        {q.options.map((o, i) => {
          const state = picked === null ? '' : i === q.answer ? 'right' : picked === i ? 'wrong' : '';
          return (
            <button key={i} class={`option ${state}`} disabled={picked !== null} onClick={() => choose(i)}>
              {o}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div class="row" style="margin-top:10px">
          <span class="grow with-speak">
            <SpeakButton text={q.text} small /> {picked === q.answer ? 'Right!' : 'Not quite.'}
          </span>
          <button class="next" onClick={next}>
            {at + 1 < questions.length ? 'Next' : 'Finish'}
          </button>
        </div>
      )}
    </div>
  );
}

