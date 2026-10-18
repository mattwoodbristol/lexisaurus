import { useEffect, useState } from 'preact/hooks';
import { SpeakButton } from './speech';
import { SteppedLesson } from './lesson-steps';
import { LangContext, targetName, useStudyLang } from './lang';
import { getLanguage } from '../core/languages';
import { isSectioned } from '../core/lessons/types';
import { CHAT_USES_NEEDED, MASTERY_LABEL, QUIZZES_NEEDED, type Mastery } from '../core/lessons/mastery';
import { api, errorText, type LessonDetail, type LessonListItem, type LessonTexts } from './api';
import { explanationParts, withParts, type ExplanationParts } from '../core/lessons/explanation-parts';
import { Zh, PinyinToggle, usePinyinMode, useNativeLang } from './ruby';

/** Learning / Practised / Embedded, as a small coloured label. */
function MasteryBadge({ m }: { m: Mastery }) {
  return <span class={`mastery m-${m.level}`}>{MASTERY_LABEL[m.level]}</span>;
}

/** The level plus what is still needed to reach Embedded. */
function MasteryLine({ m }: { m: Mastery }) {
  const hint =
    m.level === 'learning'
      ? 'Pass the lesson check, or a grammar quiz in your reviews, to reach Practised.'
      : m.level === 'practised'
        ? `To embed it: grammar quizzes on different days ${Math.min(m.quizDays, QUIZZES_NEEDED)}/${QUIZZES_NEEDED}, unprompted correct use in chat ${Math.min(m.chatUses, CHAT_USES_NEEDED)}/${CHAT_USES_NEEDED}.`
        : 'Embedded: you use this grammar reliably.';
  return (
    <p class="mastery-line small">
      <MasteryBadge m={m} /> {hint}
    </p>
  );
}

export function LessonsIndex({ onOpen, onBack, onCourse }: { onOpen: (id: number) => void; onBack: () => void; onCourse: () => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<LessonListItem[]>([]);
  const [nextGen, setNextGen] = useState<{ title: string; courseNo: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { lang } = useStudyLang();

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .lessons(lang, q)
        .then((r) => {
          setItems(r.lessons);
          setNextGen(r.nextToGenerate);
        })
        .catch((e) => setErr(errorText(e)));
    }, 250); // debounce typing
    return () => clearTimeout(t);
  }, [q]);

  async function generate() {
    setBusy(true);
    setErr('');
    try {
      const r = await api.generateLesson(lang);
      onOpen(r.id);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <LangContext.Provider value={lang}>
      <div class="row">
        <button class="secondary icon" onClick={onBack} aria-label="Back to home">
          ‹
        </button>
        <h1 class="grow">Lessons</h1>
      </div>
      <input type="search" placeholder="Search lessons (English or 中文)" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      <ul class="list lesson-list">
        {items.map((l) => (
          <li key={l.id}>
            <a href={`#/lesson/${l.id}`}>
              <span class={`dot ${l.completed_at ? 'done' : ''}`} aria-label={l.completed_at ? 'done' : 'not done'} />
              <span class="grow">
                {l.title}
                {l.snippet && <div class="muted small">{l.snippet}</div>}
              </span>
              {l.mastery && l.mastery.level !== 'new' ? <MasteryBadge m={l.mastery} /> : <span class="muted small">{l.level}</span>}
            </a>
          </li>
        ))}
        {items.length === 0 && <li class="muted">No lessons match.</li>}
      </ul>
      {!q && nextGen && (
        <div class="card">
          <div class="muted small">Next in the curriculum</div>
          <strong>
            Lesson {nextGen.courseNo}: {nextGen.title}
          </strong>
          <div class="row" style="margin-top:8px">
            <button onClick={generate} disabled={busy}>
              {busy ? 'Writing the lesson… (about 15 s)' : 'Generate this lesson'}
            </button>
          </div>
        </div>
      )}
      {!q && !nextGen && (
        <div class="card row">
          <div class="grow small">
            <strong>No more lessons planned</strong>
            <div class="muted">Tell Claude what you want to learn next and it plans the following lessons.</div>
          </div>
          <button onClick={onCourse}>Plan lessons</button>
        </div>
      )}
      {!q && (
        <p class="small">
          <a href="#/course">Plan, download or upload the course</a>
        </p>
      )}
      {err && <p class="error">{err}</p>}
    </LangContext.Provider>
  );
}

export function LessonPage({ id, onBack, onOpen, onPractise }: { id: number; onBack: () => void; onOpen: (id: number) => void; onPractise: (convId: number) => void }) {
  const [d, setD] = useState<LessonDetail | null>(null);
  const lessonLang = d?.lesson.lang ?? 'zh';
  const [mode, cycleMode] = usePinyinMode(lessonLang);
  const [showAnswers, setShowAnswers] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  // Explanations in the language being learnt (texts) and, for the translate buttons, in the
  // learner's own language (native, fetched on first use when the lesson was not written in it).
  const [texts, setTexts] = useState<LessonTexts | null>(null);
  const [textsNote, setTextsNote] = useState('');
  const [native, setNative] = useState<ExplanationParts | null>(null);
  const [openNative, setOpenNative] = useState<Set<string>>(new Set());
  const nativeLabelText = useNativeLang().label;

  useEffect(() => {
    setTexts(null);
    setNative(null);
    setOpenNative(new Set());
    setTextsNote('');
    if (!d || d.lesson.id !== id || !d.explain.target) return;
    let live = true;
    if (d.lesson.explainLang !== d.explain.code) setTextsNote('Writing the explanations in your study language…');
    api
      .lessonTexts(id, d.explain.code)
      .then((t) => live && (setTexts(t), setTextsNote('')))
      .catch(() => live && setTextsNote('Could not write the explanations in your study language; showing the original.'));
    return () => {
      live = false;
    };
  }, [d?.lesson.id, d?.explain.code, d?.explain.target]);

  const load = () =>
    api
      .lesson(id)
      .then(setD)
      .catch((e) => setErr(errorText(e)));
  useEffect(() => {
    setD(null);
    setShowAnswers(new Set());
    setMsg('');
    load();
    window.scrollTo(0, 0);
  }, [id]);

  if (err) return <p class="error">{err}</p>;
  if (!d) return <p class="muted">Loading…</p>;
  const { lesson } = d;
  const ann = texts ? { ...d.annotations, ...texts.annotations } : d.annotations;
  const c = texts ? withParts(lesson.content, texts.parts) : lesson.content;
  const z = (s: string) => <Zh text={s} ann={ann} mode={mode} />;
  // Explanatory text: in the study language it gets a button that shows it in the learner's own.
  const bilingual = !!texts && texts.lang === lesson.lang;
  function toggleNative(key: string) {
    setOpenNative((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
    if (native) return;
    if (lesson.explainLang === d!.explain.nativeCode) setNative(explanationParts(lesson.content));
    else
      api
        .lessonTexts(lesson.id, d!.explain.nativeCode)
        .then((t) => setNative(t.parts))
        .catch(() => setErr('Could not translate the explanation.'));
  }
  const x = (list: 'explanation' | 'keyPoints' | 'errorNotes', i: number, s: string) => {
    const key = `${list}.${i}`;
    return (
      <>
        {z(s)}
        {bilingual && (
          <>
            {' '}
            <button type="button" class={`secondary icon tiny ${openNative.has(key) ? 'on' : ''}`} onClick={() => toggleNative(key)} aria-label="Show in your language">
              {nativeLabelText}
            </button>
            {openNative.has(key) && <span class="explained-translation">{native ? native[list][i] : '…'}</span>}
          </>
        )}
      </>
    );
  };

  async function toggleDone() {
    try {
      if (lesson.completedAt) {
        await api.lessonUndone(lesson.id);
        setMsg('');
      } else {
        const r = await api.lessonDone(lesson.id);
        setMsg(`Done. ${r.grammarCards} grammar point(s) added to reviews${r.newWords.length + r.promoted ? `, ${r.newWords.length + r.promoted} word(s) now tracked` : ''}.`);
      }
      load();
    } catch (e) {
      setErr(errorText(e));
    }
  }

  async function practise() {
    try {
      const pattern = c.grammarPoints[0]?.title ?? c.pattern;
      const r = await api.newConversation(lesson.lang, { customTopic: `Practise ${pattern} (${c.pattern}). ${c.chatPrompt ?? ''}`.trim(), lessonId: lesson.id });
      onPractise(r.id);
    } catch (e) {
      setErr(errorText(e));
    }
  }

  const header = (
    <>
      <div class="row chat-header">
        <button class="secondary icon" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <span class="grow muted small">{lesson.level}</span>
        <PinyinToggle mode={mode} onCycle={cycleMode} />
      </div>
      <h1>{z(lesson.title)}</h1>
      <div class="card pattern">{z(c.pattern)}</div>
    </>
  );

  // Lessons with practice sets run as steps ending in a scored check.
  if (isSectioned(c)) {
    const learn = (
      <div class="lesson">
        {textsNote && <p class="muted small">{textsNote}</p>}
        {c.explanation.map((p, i) => (
          <p key={i}>{x('explanation', i, p)}</p>
        ))}
        {c.examples.length > 0 && (
          <ul class="examples">
            {c.examples.map((e, i) => (
              <li key={i}>
                <div class="with-speak">{z(e.zh)} <SpeakButton text={e.zh} small /></div>
                <div class="muted small">{e.en}</div>
              </li>
            ))}
          </ul>
        )}
        {c.keyPoints.length > 0 && (
          <>
            <h3>Key points</h3>
            <ul>
              {c.keyPoints.map((k, i) => (
                <li key={i}>{x('keyPoints', i, k)}</li>
              ))}
            </ul>
          </>
        )}
        {/* The common errors are the Fix step's material: shown there, not here, so the learner
            meets them as a puzzle rather than reading the answers first. */}
        {c.errors.length > 0 && <p class="muted small">Common mistakes with this pattern come up in the Fix step.</p>}
      </div>
    );
    return (
      <LangContext.Provider value={lesson.lang}>
      <article class="lesson">
        {header}
        {d.state.mastery && d.state.mastery.level !== 'new' && <MasteryLine m={d.state.mastery} />}
        <SteppedLesson d={{ ...d, lesson: { ...lesson, content: c }, annotations: ann }} ann={ann} mode={mode} reload={load} onPractise={practise} onOpen={onOpen} learn={learn} />
      </article>
      </LangContext.Provider>
    );
  }

  return (
    <LangContext.Provider value={lesson.lang}>
    <article class="lesson">
      {header}

      <h2>Grammar</h2>
      {textsNote && <p class="muted small">{textsNote}</p>}
      {c.explanation.map((p, i) => (
        <p key={i}>{x('explanation', i, p)}</p>
      ))}
      {c.examples.length > 0 && (
        <ul class="examples">
          {c.examples.map((e, i) => (
            <li key={i}>
              <div class="with-speak">{z(e.zh)} <SpeakButton text={e.zh} small /></div>
              <div class="muted small">{e.en}</div>
            </li>
          ))}
        </ul>
      )}
      {c.keyPoints.length > 0 && (
        <>
          <h3>Key points</h3>
          <ul>
            {c.keyPoints.map((k, i) => (
              <li key={i}>{x('keyPoints', i, k)}</li>
            ))}
          </ul>
        </>
      )}

      <h2>Drills</h2>
      <p class="muted small">Say or write each one in {targetName(getLanguage(lesson.lang) ?? getLanguage('zh')!)}, then tap to check.</p>
      <ol class="drills">
        {c.drills.map((dr, i) => (
          <li key={i}>
            <button
              class="drill"
              onClick={() =>
                setShowAnswers((s) => {
                  const n = new Set(s);
                  if (n.has(i)) n.delete(i);
                  else n.add(i);
                  return n;
                })
              }
            >
              <div>{dr.en}</div>
              {showAnswers.has(i) ? <div class="answer with-speak">{z(dr.zh)} <SpeakButton text={dr.zh} small auto /></div> : <div class="muted small">tap to show answer</div>}
            </button>
          </li>
        ))}
      </ol>

      {c.errors.length > 0 && (
        <>
          <h2>Common errors</h2>
          <ul class="errors">
            {c.errors.map((e, i) => (
              <li key={i}>
                <div class="wrong">✗ {z(e.wrong)}</div>
                <div class="right with-speak">✓ {z(e.right)} <SpeakButton text={e.right} small /></div>
                {e.note && <div class="muted small">{x('errorNotes', i, e.note)}</div>}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Conversation</h2>
      {c.chatPrompt && <p>{z(c.chatPrompt)}</p>}
      <div class="row">
        <button onClick={practise}>Practise in a chat</button>
        <button class="secondary" onClick={toggleDone}>
          {lesson.completedAt ? 'Mark as not done' : 'Mark lesson done'}
        </button>
      </div>
      {msg && <p class="muted small">{msg}</p>}

      <div class="row nav">
        {d.nav?.prev ? (
          <button class="secondary" onClick={() => onOpen(d.nav!.prev!)}>
            ‹ Previous
          </button>
        ) : (
          <span />
        )}
        <span class="spacer" />
        {d.nav?.next && (
          <button class="secondary" onClick={() => onOpen(d.nav!.next!)}>
            Next ›
          </button>
        )}
      </div>
    </article>
    </LangContext.Provider>
  );
}
