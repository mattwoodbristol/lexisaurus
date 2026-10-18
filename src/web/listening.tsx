// Listening practice: a dialogue or story written for the learner's level, heard before it is
// read. Listen (replaying lines as often as needed), answer the questions, then see the
// transcript with pinyin, translations, and a mic to repeat each line.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, errorText, type ListeningDetail, type ListeningSummary } from './api';
import { LangContext, useStudyLang } from './lang';
import { PinyinToggle, Zh, usePinyinMode } from './ruby';
import { SPEECH_RATES, SpeakButton, playLines, speechRate, stopSpeaking, useCanSpeak } from './speech';
import { SayIt, speech } from './mic';
import { Lexi, useLexiStage } from './mascot/lexi';
import { getLanguage } from '../core/languages';
import { speakerVoices, type ListeningKind } from '../core/listening/types';
import type { Token } from '../core/pinyin/annotate';

const KIND_LABEL: Record<ListeningKind, string> = { dialogue: 'Dialogue', story: 'Story' };

const percent = (x: number | null) => (x === null ? null : `${Math.round(x * 100)}%`);

export function ListeningIndex({ onBack, onOpen }: { onBack: () => void; onOpen: (id: number) => void }) {
  const { lang, config } = useStudyLang();
  const { stage } = useLexiStage(lang);
  const [items, setItems] = useState<ListeningSummary[] | null>(null);
  const [busy, setBusy] = useState<ListeningKind | null>(null);
  const [err, setErr] = useState('');
  const canSpeak = useCanSpeak(config.ttsLang);

  useEffect(() => {
    setItems(null);
    api
      .listenings(lang)
      .then((r) => setItems(r.items))
      .catch((e) => setErr(errorText(e)));
  }, [lang]);

  async function make(kind: ListeningKind) {
    setBusy(kind);
    setErr('');
    try {
      onOpen((await api.newListening(lang, kind)).id);
    } catch (e) {
      setErr(errorText(e));
      setBusy(null);
    }
  }

  return (
    <LangContext.Provider value={lang}>
      <div class="row chat-header">
        <button class="secondary icon" onClick={onBack} aria-label="Back to home">
          ‹
        </button>
        <strong class="grow">Listening · {config.nativeName}</strong>
      </div>
      <div class="card">
        <p class="small">A short dialogue or story written for your level from words you are learning. Listen first, answer the questions, then read along.</p>
        {!canSpeak && <p class="error small">This device has no {config.name} voice installed, so the passage cannot be read aloud. Add one in the system text-to-speech settings.</p>}
        {busy ? (
          <div class="lexi-thinking">
            <Lexi stage={stage} mood="thinking" size={56} />
            <span class="muted">Writing a {busy}…</span>
          </div>
        ) : (
          <div class="row">
            <button onClick={() => make('dialogue')}>New dialogue</button>
            <button class="secondary" onClick={() => make('story')}>
              New story
            </button>
          </div>
        )}
      </div>
      {err && <p class="error">{err}</p>}
      {items && items.length > 0 && (
        <div class="card">
          <div class="muted small">Earlier</div>
          <ul class="list">
            {items.map((it) => (
              <li key={it.id}>
                <a href={`#/listen/${it.id}`}>
                  {it.title}{' '}
                  <span class="muted small">
                    · {KIND_LABEL[it.kind]} · {new Date(it.created_at).toLocaleDateString([], { dateStyle: 'medium' })}
                    {it.total ? ` · ${it.score}/${it.total}` : ' · not answered'}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </LangContext.Provider>
  );
}

export function ListeningPage({ id, onBack, onIndex }: { id: number; onBack: () => void; onIndex: () => void }) {
  const [d, setD] = useState<ListeningDetail | null>(null);
  const [ann, setAnn] = useState<Record<string, Token[]>>({});
  const [err, setErr] = useState('');
  const lang = d?.lang ?? 'zh';
  const config = getLanguage(lang) ?? getLanguage('zh')!;
  const [mode, cycleMode] = usePinyinMode(lang);
  const canSpeak = useCanSpeak(config.ttsLang);
  const [line, setLine] = useState<number | null>(null);
  const [rate, setRate] = useState<number>(() => speechRate());
  const [chosen, setChosen] = useState<(number | null)[]>([]);
  const [checked, setChecked] = useState(false);
  const [transcript, setTranscript] = useState(false);
  const [translations, setTranslations] = useState(false);
  const [shadow, setShadow] = useState(false);
  const stop = useRef<() => void>(() => {});

  useEffect(() => {
    setD(null);
    api
      .listening(id)
      .then((r) => {
        setD(r.listening);
        setAnn(r.annotations);
        setChosen(r.listening.questions.map(() => null));
        // Already answered: open with the transcript.
        const done = r.listening.total !== null;
        setChecked(done);
        setTranscript(done);
      })
      .catch((e) => setErr(errorText(e)));
    return () => stop.current();
  }, [id]);

  if (err) return <p class="error">{err}</p>;
  if (!d) return <p class="muted">Loading…</p>;
  const voices = speakerVoices(d.lines);
  const play = (from = 0, only = false) => {
    stop.current();
    const lines = d.lines.map((l, i) => ({ text: l.text, voice: voices[i] }));
    stop.current = playLines(only ? [lines[from]!] : lines.slice(from), config.ttsLang, { rate, onLine: (i) => setLine(i === null ? null : i + from) });
  };
  const playing = line !== null;
  const score = d.questions.filter((q, i) => chosen[i] === q.answer).length;

  async function check() {
    setChecked(true);
    setTranscript(true);
    try {
      await api.listeningResult(d!.id, score, d!.questions.length);
    } catch (e) {
      setErr(errorText(e));
    }
  }

  return (
    <LangContext.Provider value={lang}>
      <div class="listening">
        <div class="row chat-header">
          <button
            class="secondary icon"
            onClick={() => {
              stop.current();
              onBack();
            }}
            aria-label="Back"
          >
            ‹
          </button>
          <strong class="grow">{d.title}</strong>
          <PinyinToggle mode={mode} onCycle={cycleMode} />
        </div>
        <p class="muted small">
          {KIND_LABEL[d.kind]} · {d.lines.length} lines
          {d.knownShare !== null && ` · ${percent(d.knownShare)} of the words are ones you know`}
        </p>

        <section class="card">
          <h2>1 · Listen</h2>
          {!canSpeak ? (
            <p class="error small">No {config.name} voice on this device: read the transcript instead.</p>
          ) : (
            <>
              <div class="row">
                {playing ? (
                  <button
                    onClick={() => {
                      stop.current();
                      stopSpeaking();
                    }}
                  >
                    ■ Stop
                  </button>
                ) : (
                  <button onClick={() => play()}>▶ Play all</button>
                )}
                <div class="rate-pills" role="group" aria-label="Speed">
                  {SPEECH_RATES.map((r) => (
                    <button key={r.value} class={`chip ${rate === r.value ? 'on' : ''}`} aria-pressed={rate === r.value} onClick={() => setRate(r.value)}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <div class="line-chips" aria-label="Play one line">
                {d.lines.map((l, i) => (
                  <button key={i} class={`chip ${line === i ? 'on' : ''} ${d.kind === 'dialogue' ? `voice-${voices[i]}` : ''}`} onClick={() => play(i, true)} aria-label={`Play line ${i + 1}${l.speaker ? `, ${l.speaker}` : ''}`}>
                    {i + 1}
                  </button>
                ))}
              </div>
              <p class="muted small">Tap a number to hear one line again. Try the questions before reading the text.</p>
            </>
          )}
        </section>

        <section class="card">
          <h2>2 · Questions</h2>
          {d.questions.map((q, k) => (
            <div key={k} class="choice">
              <div class="choice-prompt">
                {k + 1}. {q.question}
              </div>
              {q.options.map((o, i) => {
                const state = !checked ? (chosen[k] === i ? 'picked' : '') : i === q.answer ? 'right' : chosen[k] === i ? 'wrong' : '';
                return (
                  <button key={i} class={`option ${state}`} disabled={checked} onClick={() => setChosen(chosen.map((c, n) => (n === k ? i : c)))}>
                    {o}
                  </button>
                );
              })}
            </div>
          ))}
          {checked ? (
            <div class="row">
              <strong class="grow">
                {d.total !== null && !chosen.some((c) => c !== null) ? `Last time: ${d.score} of ${d.total}` : `${score} of ${d.questions.length} right`}
              </strong>
              <button
                class="secondary"
                onClick={() => {
                  setChosen(d.questions.map(() => null));
                  setChecked(false);
                  setTranscript(false);
                }}
              >
                Try again
              </button>
            </div>
          ) : (
            <div class="row">
              <button class="next" disabled={chosen.some((c) => c === null)} onClick={check}>
                Check answers
              </button>
              <button class="secondary" onClick={() => setTranscript(!transcript)}>
                {transcript ? 'Hide text' : 'Show text'}
              </button>
            </div>
          )}
        </section>

        {transcript && (
          <section class="card">
            <h2>3 · Read along</h2>
            <div class="row">
              <button class={`chip ${translations ? 'on' : ''}`} aria-pressed={translations} onClick={() => setTranslations(!translations)}>
                Translations
              </button>
              {speech.supported(config.speechRecognitionLang) && (
                <button class={`chip ${shadow ? 'on' : ''}`} aria-pressed={shadow} onClick={() => setShadow(!shadow)}>
                  🎤 Repeat each line
                </button>
              )}
            </div>
            <ol class="transcript">
              {d.lines.map((l, i) => (
                <li key={i} class={line === i ? 'current' : ''}>
                  {l.speaker && <div class={`speaker voice-${voices[i]}`}>{l.speaker}</div>}
                  <div class="with-speak">
                    <Zh text={l.text} ann={ann} mode={mode} /> <SpeakButton text={l.text} small />
                  </div>
                  {translations && <div class="muted small">{l.translation}</div>}
                  {shadow && <SayIt target={l.text} label="Repeat it" />}
                </li>
              ))}
            </ol>
          </section>
        )}

        <div class="row nav">
          <button class="secondary" onClick={onIndex}>
            More listening
          </button>
        </div>
      </div>
    </LangContext.Provider>
  );
}
