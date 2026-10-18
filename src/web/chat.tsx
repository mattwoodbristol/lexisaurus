import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { SpeakButton } from './speech';
import { MicButton, speech } from './mic';
import { api, errorText, type ChatCorrection, type ChatMessage, type ChatSummary, type ConversationDetail, type NewWord } from './api';
import { RubyText, PinyinToggle, usePinyinMode, useNativeLang, MODE_LABEL } from './ruby';
import { nextPinyinMode, type PinyinMode } from '../core/pinyin/annotate';
import { openWord } from './word-sheet';
import { LangContext } from './lang';
import { getLanguage } from '../core/languages';
import { Lexi, useLexiStage } from './mascot/lexi';
import { Explained } from './explained';

export function Chat({ id, onBack }: { id: number; onBack: () => void }) {
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conv0, setConv0] = useState<string>('zh'); // the conversation's language, once loaded
  const lang = conv0;
  const config = getLanguage(lang) ?? getLanguage('zh')!;
  const [mode, cycleMode] = usePinyinMode(lang);
  // Per-message pinyin: the 拼 button cycles Off, Smart, All from the page-wide mode.
  const [msgMode, setMsgMode] = useState<Record<number, PinyinMode>>({});
  // Translations by message, with the language they are in (shown only if it is the current one).
  const [translations, setTranslations] = useState<Record<number, { text: string; lang: string }>>({});
  const native = useNativeLang();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [newWords, setNewWords] = useState<NewWord[]>([]);
  const { stage } = useLexiStage(lang);
  const [summary, setSummary] = useState<ChatSummary | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    started.current = false;
    api
      .conversation(id)
      .then(async (r) => {
        setConv(r.conversation);
        setConv0(r.conversation.lang);
        setMessages(r.messages);
        const t: Record<number, { text: string; lang: string }> = {};
        for (const m of r.messages) if (m.translation) t[m.id] = { text: m.translation, lang: m.translationLang ?? 'en' };
        setTranslations(t);
        // A topic session with no messages yet: the tutor opens.
        if (r.messages.length === 0 && r.conversation.topic && !started.current) {
          started.current = true;
          setBusy(true);
          try {
            const s = await api.start(id);
            setMessages([s.assistant]);
            setNewWords(s.newWords);
          } catch (e) {
            setErr(errorText(e));
          } finally {
            setBusy(false);
          }
        }
      })
      .catch((e) => setErr(errorText(e)));
  }, [id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, translations, msgMode, busy, summary]);

  async function finish() {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      setSummary(await api.finish(id));
      setConv((c) => (c && !c.ended_at ? { ...c, ended_at: new Date().toISOString() } : c));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const hasLearnerMessage = messages.some((m) => m.role === 'user' && m.id > 0);
  // A clear end point: once the day's turns are done, offer to wrap up (the learner may carry on).
  const [keepGoing, setKeepGoing] = useState(false);
  const learnerTurns = messages.filter((m) => m.role === 'user' && m.id > 0).length;
  const enough = !!conv?.needed && learnerTurns >= conv.needed && !conv.ended_at && !summary && !busy && !keepGoing;

  // Speaking a reply fills the box, so it can be checked or edited before sending.
  const canListen = speech.supported(config.speechRecognitionLang);

  const lastTutor = [...messages].reverse().find((m) => m.role === 'assistant');

  const modeFor = (mid: number): PinyinMode => msgMode[mid] ?? mode;
  function cyclePinyinFor(mid: number) {
    setMsgMode((prev) => ({ ...prev, [mid]: nextPinyinMode(prev[mid] ?? mode) }));
  }
  const shown = (mid: number) => (translations[mid]?.lang === native.code ? translations[mid] : undefined);

  async function translateMessage(mid: number) {
    if (shown(mid)) {
      setTranslations(({ [mid]: _drop, ...rest }) => rest); // tap again to hide
      return;
    }
    try {
      const r = await api.translate(id, mid);
      setTranslations((t) => ({ ...t, [mid]: { text: r.translation, lang: r.lang } }));
    } catch (e) {
      setErr(errorText(e));
    }
  }

  async function submit(e: Event) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setErr('');
    // Shortcuts are intercepted here and never reach Claude.
    const key = t.toLowerCase();
    if ((key === 'p' && config.hasRomanisation) || key === 'e') {
      setText('');
      if (!lastTutor) return;
      if (key === 'p') cyclePinyinFor(lastTutor.id);
      else await translateMessage(lastTutor.id);
      return;
    }
    setBusy(true);
    setText('');
    const optimistic: ChatMessage = { id: -Date.now(), role: 'user', text: t, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    try {
      const r = await api.send(id, t);
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), r.user, r.assistant]);
      setNewWords(r.newWords);
    } catch (e) {
      setErr(errorText(e));
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setText(t);
    } finally {
      setBusy(false);
    }
  }

  return (
    <LangContext.Provider value={lang}>
    <div class="chat">
      <div class="row chat-header">
        <button class="secondary icon" onClick={onBack} aria-label="Back to home">
          ‹
        </button>
        <Lexi stage={stage} mood="talk" size={44} />
        <div class="grow">
          <strong>{conv?.topic ?? config.freeChatTitle}</strong>
          {conv?.scenario && <div class="muted small clamp">{conv.scenario}</div>}
        </div>
        {hasLearnerMessage && !summary && (
          <button class="secondary icon finish" onClick={finish} disabled={busy} title="Finish: see what to work on" aria-label="Finish the chat and see the summary">
            ✓
          </button>
        )}
        <PinyinToggle mode={mode} onCycle={cycleMode} />
      </div>

      <div class="messages">
        {messages.length === 0 && !busy && !err && <p class="muted">{`Say something in ${config.id === 'zh' ? 'Chinese' : config.name} or English to start. ${config.hasRomanisation ? 'Type p to cycle pinyin, e to translate. ' : 'Type e to translate. '}Tap any word for its meaning.`}</p>}
        {messages.map((m) => (
          <Fragment key={m.id}>
          <div class={`bubble ${m.role}`}>
            {m.role === 'assistant' && m.tokens ? <RubyText tokens={m.tokens} mode={modeFor(m.id)} /> : <span>{m.text}</span>}
            {m.role === 'assistant' && (
              <div class="bubble-tools">
                {config.hasRomanisation && (
                  <button
                    class={`icon pinyin-${modeFor(m.id)}`}
                    onClick={() => cyclePinyinFor(m.id)}
                    aria-label={`Pinyin for this message: ${MODE_LABEL[modeFor(m.id)]}. Tap to change.`}
                    title={`Pinyin: ${MODE_LABEL[modeFor(m.id)]}`}
                  >
                    拼
                  </button>
                )}
                <button
                  class={`icon ${shown(m.id) ? 'on' : ''}`}
                  onClick={() => translateMessage(m.id)}
                  aria-label={shown(m.id) ? `Hide ${native.english} translation` : `Translate into ${native.english}`}
                  title={native.english}
                >
                  {native.label}
                </button>
                <SpeakButton text={m.text} />
              </div>
            )}
            {m.role === 'assistant' && shown(m.id) && <div class="translation">{shown(m.id)!.text}</div>}
            {m.role === 'assistant' && m.hint && (
              <div class="hint">
                <span aria-hidden="true">💡</span>
                <span class="grow">
                  <Explained text={m.hint.text} lang={lang} mode={mode} />
                </span>
                {m.hint.lessonId && (
                  <a class="small" href={`#/lesson/${m.hint.lessonId}`}>
                    Lesson
                  </a>
                )}
              </div>
            )}
          </div>
          {m.role === 'user' && m.corrections?.filter((x) => x.shown).map((x, i) => <CorrectionLine key={`${m.id}-${i}`} c={x} lang={lang} mode={mode} />)}
          </Fragment>
        ))}
        {enough && (
          <div class="card chat-done" role="status">
            <strong>That’s today’s chat done.</strong>
            <div class="muted small">Finish to see your corrections and new words, or keep the conversation going.</div>
            <div class="row" style="margin-top:8px">
              <button onClick={finish}>Finish</button>
              <button class="secondary" onClick={() => setKeepGoing(true)}>
                Keep chatting
              </button>
            </div>
          </div>
        )}
        {summary && <SummaryCard summary={summary} lang={lang} onDone={onBack} />}
        {busy && (
          <div class="lexi-thinking" aria-live="polite">
            <Lexi stage={stage} mood="thinking" size={56} label="Lexisaurus is thinking" />
            <span class="muted">…</span>
          </div>
        )}
        {newWords.length > 0 && (
          <div class="muted small">
            New words added to your list:{' '}
            {newWords.map((w) => (
              <button key={w.id} class="chip tap" onClick={() => openWord({ lang, text: w.lemma, pinyin: w.pinyin, context: lastTutor?.text })}>
                {w.lemma} <span class="muted">{w.pinyin}</span>
              </button>
            ))}
          </div>
        )}
        {err && <p class="error">{err}</p>}
        <div ref={bottom} />
      </div>

      <form class={`composer ${canListen ? 'has-mic' : ''}`} onSubmit={submit}>
        <input
          type="text"
          value={text}
          placeholder={`${config.chatPlaceholder}  (${config.hasRomanisation ? 'p = pinyin, ' : ''}e = translate)`}
          autocomplete="off"
          autocapitalize="off"
          enterkeyhint="send"
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
        />
        {canListen && (
          <MicButton
            lang={config.speechRecognitionLang}
            label={`Speak ${config.id === 'zh' ? 'Chinese' : config.name}`}
            disabled={busy}
            onInterim={setText}
            onResult={(alts) => setText(alts[0] ?? '')}
          />
        )}
        <button disabled={busy || !text.trim()} aria-label="Send">
          ↑
        </button>
      </form>
    </div>
    </LangContext.Provider>
  );
}

function CorrectionLine({ c, lang, mode }: { c: ChatCorrection; lang: string; mode?: PinyinMode }) {
  return (
    <div class="correction" role="note">
      <span aria-hidden="true">✎ </span>
      <span class="wrong">{c.wrong}</span> <span aria-hidden="true">→</span> <span class="right">{c.right}</span>
      {c.note && (
        <span class="note">
          {' — '}
          <Explained text={c.note} lang={lang} mode={mode} />
        </span>
      )}
    </div>
  );
}

function SummaryCard({ summary, lang, onDone }: { summary: ChatSummary; lang: string; onDone: () => void }) {
  const { corrections, grammar, newWords } = summary;
  return (
    <div class="chat-summary">
      <h3>Chat summary</h3>
      {corrections.length ? (
        <>
          <div class="muted small">Worth another look (added to your mistakes list):</div>
          <ul>
            {corrections.map((c, i) => (
              <li key={i}>
                <CorrectionLine c={c} lang={lang} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div>No mistakes worth noting. Nice.</div>
      )}
      {grammar.length > 0 && (
        <div>
          <div class="muted small">Grammar you used:</div>
          <ul>
            {grammar.map((g) => (
              <li key={g.id}>
                {g.correct === g.total ? '✓' : '△'} {g.title} <span class="muted small">({g.correct}/{g.total} right)</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {newWords.length > 0 && (
        <div>
          <div class="muted small">New words from this chat:</div>
          {newWords.map((w) => (
            <button key={w.id} class="chip tap" onClick={() => openWord({ lang, text: w.lemma, pinyin: w.reading ?? undefined })}>
              {w.lemma} {w.gloss && <span class="muted">{w.gloss}</span>}
            </button>
          ))}
        </div>
      )}
      <div class="row">
        <button onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
