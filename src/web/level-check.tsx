// The level check: words (know / don't know, with made-up words and meaning spot-checks),
// adaptive grammar, optional writing, then the result and an offer to skip lessons below it.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { errorText, levelApi, type AssessWord, type GrammarItem, type LevelLabels, type SortPile, type SortWord } from './api';
import { LangContext, useStudyLang } from './lang';
import { Lexi, useLexiStage } from './mascot/lexi';
import { GRAMMAR_MAX_ITEMS, GRAMMAR_START, nextGrammarBand, seededShuffle } from '../core/assessment/levels';
import { boardGloss } from '../core/assessment/sort-board';
import { MatchBoardView, useMatchBoard } from './match-board';

type Stage = 'intro' | 'words' | 'grammar' | 'writing' | 'results';
/** Every third "I know it" on a real word gets a quick meaning question. */
const SPOT_CHECK_EVERY = 3;

interface Spot {
  options: string[];
  answer: number;
}

function WordsPart({ words, onDone }: { words: AssessWord[]; onDone: (answers: (AssessWord & { known: boolean })[]) => void }) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<(AssessWord & { known: boolean })[]>([]);
  const [knownCount, setKnownCount] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);
  const item = words[i];
  const glosses = useMemo(() => words.filter((w) => w.gloss).map((w) => w.gloss!), [words]);

  const record = (known: boolean) => {
    const next = [...answers, { ...item!, known }];
    setAnswers(next);
    setSpot(null);
    if (i + 1 >= words.length) onDone(next);
    else setI(i + 1);
  };
  const claim = () => {
    if (!item) return;
    const n = knownCount + 1;
    setKnownCount(n);
    if (!item.pseudo && item.gloss && n % SPOT_CHECK_EVERY === 0) {
      const others = seededShuffle(
        glosses.filter((g) => g !== item.gloss),
        i + 7,
      ).slice(0, 3);
      const options = seededShuffle([item.gloss, ...others], i + 11);
      setSpot({ options, answer: options.indexOf(item.gloss) });
      return;
    }
    record(true);
  };
  if (!item) return null;
  return (
    <div class="lc-part">
      <div class="lc-progress">
        <span style={{ width: `${(i / words.length) * 100}%` }} />
      </div>
      <p class="muted small">
        Word {i + 1} of {words.length}. Some words are made up: only say you know a word if you do.
      </p>
      <div class="lc-word" lang={/[一-鿿]/.test(item.word) ? 'zh-Hans' : undefined}>
        {item.word}
      </div>
      {spot ? (
        <div class="choice">
          <div class="choice-prompt">What does it mean?</div>
          {spot.options.map((o, k) => (
            <button key={k} class="option" onClick={() => record(k === spot.answer)}>
              {o}
            </button>
          ))}
        </div>
      ) : (
        <div class="lc-buttons">
          <button onClick={claim}>I know it</button>
          <button class="secondary" onClick={() => record(false)}>
            Don't know
          </button>
        </div>
      )}
    </div>
  );
}

function GrammarPart({ bank, onDone }: { bank: GrammarItem[]; onDone: (answers: { band: number; right: boolean; topic: string }[]) => void }) {
  const [band, setBand] = useState<number>(GRAMMAR_START);
  const [used, setUsed] = useState<Set<number>>(new Set());
  const [answers, setAnswers] = useState<{ band: number; right: boolean; topic: string }[]>([]);
  const [pair, setPair] = useState<boolean[]>([]);
  const finished = useRef(false);
  const complete = (all: { band: number; right: boolean; topic: string }[]) => {
    if (finished.current) return; // one submission, whichever way the part ends
    finished.current = true;
    onDone(all);
  };
  // The next unused question at the current band, or the nearest band that still has one.
  const item = useMemo(() => {
    for (const d of [0, 1, -1, 2, -2, 3, -3]) {
      const found = bank.find((q) => q.band === band + d && !used.has(q.id));
      if (found) return found;
    }
    return null;
  }, [bank, band, used]);
  const answer = (k: number) => {
    if (!item) return;
    const right = k === item.answer;
    const next = [...answers, { band: item.band, right, topic: item.topic }];
    setAnswers(next);
    setUsed(new Set([...used, item.id]));
    const p = [...pair, right];
    if (p.length === 2) {
      setBand(nextGrammarBand(band, p));
      setPair([]);
    } else setPair(p);
    if (next.length >= GRAMMAR_MAX_ITEMS) complete(next);
  };
  // Out of questions before the maximum (a small bank): finish with what was answered.
  useEffect(() => {
    if (!item && answers.length) complete(answers);
  }, [item]);
  if (!item) return null;
  return (
    <div class="lc-part">
      <div class="lc-progress">
        <span style={{ width: `${(answers.length / GRAMMAR_MAX_ITEMS) * 100}%` }} />
      </div>
      <p class="muted small">
        Question {answers.length + 1} of {GRAMMAR_MAX_ITEMS}. It gets harder or easier as you go.
      </p>
      <div class="choice">
        <div class="choice-prompt">{item.prompt}</div>
        {item.options.map((o, k) => (
          <button key={`${item.id}-${k}`} class="option" onClick={() => answer(k)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

export function LevelCheck({ onBack, onSortWords }: { onBack: () => void; onSortWords: () => void }) {
  const { lang, config } = useStudyLang();
  const { stage: lexiStage } = useLexiStage(lang);
  const [stage, setStage] = useState<Stage>('intro');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [assessmentId, setId] = useState<number | null>(null);
  const [words, setWords] = useState<AssessWord[]>([]);
  const [bank, setBank] = useState<GrammarItem[]>([]);
  const [writingTask, setWritingTask] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ labels: LevelLabels; weak: string[]; offered: { id: number; title: string; level: string | null }[]; comment?: string } | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [skipped, setSkipped] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  // One request for the grammar bank, shared by the background load and the end of the word part
  // (the first time, the bank is being written and two requests would write it twice).
  const bankLoad = useRef<Promise<GrammarItem[]> | null>(null);
  const loadBank = () => (bankLoad.current ??= levelApi.bank(lang).then((b) => b.items));

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const start = () =>
    run('Choosing words…', async () => {
      const s = await levelApi.start(lang);
      setId(s.assessmentId);
      setWords(s.words);
      setStage('words');
      loadBank()
        .then(setBank)
        .catch(() => {
          bankLoad.current = null; // retried at the end of the word part
        }); // written while the word part runs (first time only)
    });

  const wordsDone = (answers: (AssessWord & { known: boolean })[]) =>
    run('Saving…', async () => {
      await levelApi.words(assessmentId!, answers);
      if (!bank.length) {
        setBusy('Preparing the grammar questions (first time only, about a minute)…');
        setBank(await loadBank());
      }
      setStage('grammar');
    });

  const grammarDone = (answers: { band: number; right: boolean; topic: string }[]) =>
    run('Saving…', async () => {
      const g = await levelApi.grammar(assessmentId!, answers);
      setWritingTask(g.writingPrompt);
      setStage('writing');
    });

  const finish = () =>
    run('Working out your level…', async () => {
      const f = await levelApi.finish(assessmentId!);
      setResult({ labels: f.labels, weak: f.check.weak, offered: f.offered, comment });
      setSkip(new Set(f.offered.map((o) => o.id)));
      setStage('results');
    });

  const submitWriting = () =>
    run('Reading your writing…', async () => {
      const w = await levelApi.writing(assessmentId!, text, writingTask);
      setComment(w.comment);
      const f = await levelApi.finish(assessmentId!);
      setResult({ labels: f.labels, weak: f.check.weak, offered: f.offered, comment: w.comment });
      setSkip(new Set(f.offered.map((o) => o.id)));
      setStage('results');
    });

  const skipLessons = () =>
    run('Marking lessons…', async () => {
      const r = await levelApi.skipLessons([...skip]);
      setSkipped(r.done);
    });

  return (
    <LangContext.Provider value={lang}>
      <div class="row chat-header">
        <button class="secondary icon" onClick={onBack} aria-label="Back to home">
          ‹
        </button>
        <strong class="grow">Level check · {config.nativeName}</strong>
      </div>

      {stage === 'intro' && (
        <div class="card lexi-moment">
          <Lexi stage={lexiStage} mood="talk" size={72} />
          <div>
            <p>
              About 10 minutes, in three parts: <strong>words</strong> (do you know them?), <strong>grammar</strong> (multiple choice that adapts to you) and an optional short{' '}
              <strong>piece of writing</strong>.
            </p>
            <p class="muted small">
              It sets the level Lexi and new lessons aim at, sorts the words it asks about, and decides which new words come first. You can take it again any time from Settings.
            </p>
            <button onClick={start} disabled={!!busy}>
              Start
            </button>
          </div>
        </div>
      )}

      {stage === 'words' && !busy && <WordsPart words={words} onDone={wordsDone} />}
      {stage === 'grammar' && !busy && <GrammarPart bank={bank} onDone={grammarDone} />}

      {stage === 'writing' && !busy && (
        <div class="lc-part">
          <p>
            Write three to five sentences in {config.id === 'zh' ? 'Chinese' : config.name}:
          </p>
          <p class="choice-prompt">{writingTask}</p>
          <textarea class="lc-text" rows={6} value={text} lang={config.id === 'zh' ? 'zh-Hans' : config.id} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
          <div class="row">
            <button onClick={submitWriting} disabled={text.trim().length < 10}>
              Submit
            </button>
            <button class="secondary" onClick={finish}>
              Skip this part
            </button>
          </div>
        </div>
      )}

      {stage === 'results' && result && (
        <div class="lc-results">
          <div class="card lexi-moment">
            <Lexi stage={lexiStage} mood="celebrating" size={72} />
            <div class="lc-levels">
              {result.labels.vocab && (
                <div>
                  <span class="muted small">Vocabulary</span> <strong>{result.labels.vocab}</strong>
                </div>
              )}
              {result.labels.grammar && (
                <div>
                  <span class="muted small">Grammar</span> <strong>{result.labels.grammar}</strong>
                  {result.weak.length > 0 && <div class="muted small">Weaker: {result.weak.join(', ')}</div>}
                </div>
              )}
              {result.labels.writing && (
                <div>
                  <span class="muted small">Writing</span> <strong>{result.labels.writing}</strong>
                </div>
              )}
            </div>
          </div>
          {result.comment && <p class="small">{result.comment}</p>}
          <p class="muted small">Lexi and new lessons now aim at this level, and new words come in from your level up.</p>

          {result.offered.length > 0 && skipped === null && (
            <div class="card">
              <strong>Lessons below your level</strong>
              <p class="muted small">Mark them as Practised so they don't hold you up? Their grammar still comes back in reviews.</p>
              {result.offered.map((l) => (
                <label key={l.id} class="check">
                  <input
                    type="checkbox"
                    checked={skip.has(l.id)}
                    onChange={() => {
                      const n = new Set(skip);
                      if (n.has(l.id)) n.delete(l.id);
                      else n.add(l.id);
                      setSkip(n);
                    }}
                  />{' '}
                  {l.title} <span class="muted small">{l.level}</span>
                </label>
              ))}
              <div class="row">
                <button onClick={skipLessons} disabled={!skip.size || !!busy}>
                  Mark {skip.size} as Practised
                </button>
                <button class="secondary" onClick={() => setSkipped(0)}>
                  No thanks
                </button>
              </div>
            </div>
          )}
          {skipped !== null && skipped > 0 && <p class="small">✓ {skipped} lesson(s) marked as Practised.</p>}

          <div class="row">
            <button onClick={onSortWords}>Sort my words</button>
            <button class="secondary" onClick={onBack}>
              Home
            </button>
          </div>
        </div>
      )}

      {busy && <p class="muted">{busy}</p>}
      {err && <p class="error">{err}</p>}
    </LangContext.Provider>
  );
}

/** Words per round: a round is one sitting, with a summary and a natural place to stop. */
const SORT_ROUND = 20;
/** Words on the board at once (plus one decoy meaning). */
const SORT_BOARD = 5;

type BoardWord = SortWord & { meaning: string };
type Round = { words: SortWord[]; decoys: string[]; left: number; pile: SortPile | null };
interface Sorted {
  word: BoardWord;
  known: boolean;
  /** Matched, but after a wrong try. */
  slip: boolean;
}

/**
 * "Sort my words": a matching board. A few unsorted words, their meanings and one decoy; matching
 * a word first time proves it is known (out of the pool). "?", or a wrong match (the right one is
 * then easy to guess), leaves it in the pool.
 * Rounds of SORT_ROUND words from the current pile (one level), each ending in a summary.
 */
export function SortWords({ onBack }: { onBack: () => void }) {
  const { lang, config } = useStudyLang();
  const [pile, setPile] = useState<SortPile | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [roundSize, setRoundSize] = useState(0);
  const [sorted, setSorted] = useState<Sorted[]>([]);
  // The next round, fetched while the summary shows (a new pile is announced there).
  const [next, setNext] = useState<Round | null>(null);
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(false);
  // Answers and undos are saved in order, and before the next round is fetched (or a word just
  // sorted could come round again).
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const save = <T,>(call: () => Promise<T>) => {
    const p = saving.current.then(call);
    saving.current = p.catch(() => undefined);
    return p;
  };

  /** A word leaves the board: known (matched first time) or not (a wrong try, or sent off). */
  const m = useMatchBoard<BoardWord>(SORT_BOARD, (word, matched, strikes) => {
    const known = matched && !strikes;
    save(() => levelApi.sortOne(lang, word.id, known)).catch((e) => setErr(errorText(e)));
    setSorted((s) => [...s, { word, known, slip: matched && !known }]);
    setLeft((n) => (n === null ? n : n - 1));
    setPile((p) => (p ? { ...p, left: Math.max(0, p.left - 1) } : p));
  });
  const board = m.board;

  const startRound = (r: Round) => {
    const words = r.words.map((w) => ({ ...w, meaning: boardGloss(w.gloss) }));
    setPile(r.pile);
    setLeft(r.left);
    setRoundSize(words.length);
    setSorted([]);
    setNext(null);
    m.start(words, r.decoys.map(boardGloss));
    setLoaded(true);
  };
  useEffect(() => {
    setLoaded(false);
    setRoundSize(0);
    void levelApi
      .sortNext(lang, SORT_ROUND)
      .then(startRound)
      .catch((e) => setErr(errorText(e)));
  }, [lang]);

  const roundOver = !!board && board.words.length === 0 && roundSize > 0;
  useEffect(() => {
    if (roundOver && !next)
      void save(() => levelApi.sortNext(lang, SORT_ROUND))
        .then(setNext)
        .catch((e) => setErr(errorText(e)));
  }, [roundOver, next]);

  /** Undo the last word sorted (an accidental tap): back to unsorted, and back on the board. */
  const undoing = useRef(false);
  const undo = async () => {
    const last = sorted[sorted.length - 1];
    if (!last || m.flash || undoing.current) return;
    undoing.current = true;
    try {
      await save(() => levelApi.sortUndo(lang, last.word.id));
    } catch (e) {
      return setErr(errorText(e));
    } finally {
      undoing.current = false;
    }
    setSorted((s) => s.slice(0, -1));
    setLeft((n) => (n === null ? n : n + 1));
    setPile((p) => (p ? { ...p, left: p.left + 1 } : p));
    setNext(null);
    m.putBack(last.word);
  };

  const last = sorted[sorted.length - 1];
  const known = sorted.filter((s) => s.known).length;
  const toLearn = sorted.filter((s) => !s.known);
  const wordLang = config.id === 'zh' ? 'zh-Hans' : config.id;
  return (
    <LangContext.Provider value={lang}>
      <div class="row chat-header">
        <button class="secondary icon" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <strong class="grow">Sort my words · {config.nativeName}</strong>
        <span class="muted small">{pile ? `${pile.label}: ${pile.left.toLocaleString()} left` : ''}</span>
      </div>
      {board && !roundOver && roundSize > 0 && (
        <div class="lc-part">
          <div class="lc-progress">
            <span style={{ width: `${(sorted.length / roundSize) * 100}%` }} />
          </div>
          <p class="muted small">
            Match each word to its meaning (one meaning is spare). Tap ? on a word you don't know. Words matched first time leave your pool; the
            others come in first as new words.
          </p>
          <MatchBoardView m={m} wordLang={wordLang} />
          {last && (
            <div class="row">
              <span class="grow small">
                <span lang={wordLang}>{last.word.lemma}</span>
                {last.word.reading ? ` ${last.word.reading}` : ''}: {last.word.gloss}{' '}
                <span class="muted">{last.known ? '· known' : last.slip ? '· not first time, stays in your pool' : '· stays in your pool'}</span>
              </span>
              <button class="secondary small" onClick={undo}>
                Undo
              </button>
            </div>
          )}
        </div>
      )}
      {roundOver && (
        <div class="card lc-part">
          <strong>
            Round done: {known} known, {toLearn.length} to learn.
          </strong>
          {toLearn.length > 0 && (
            <div class="sort-learn">
              <span class="muted small">Coming up as new words:</span>
              {toLearn.map((s) => (
                <div key={s.word.id} class="small">
                  <span lang={wordLang} class="sort-learn-word">
                    {s.word.lemma}
                  </span>
                  {s.word.reading ? ` ${s.word.reading}` : ''} · {s.word.gloss}
                </div>
              ))}
            </div>
          )}
          {!next ? (
            <p class="muted small">Loading…</p>
          ) : next.words.length ? (
            <>
              {pile && next.pile?.id !== pile.id && (
                <p class="small">
                  {pile.label} pile sorted. Next pile: <strong>{next.pile?.label}</strong>, {next.pile?.left.toLocaleString()} words.
                </p>
              )}
              <div class="row">
                <button onClick={() => startRound(next)}>Another round</button>
                <button class="secondary" onClick={onBack}>
                  Stop here
                </button>
              </div>
            </>
          ) : (
            <>
              <p class="small">{next.left ? "Couldn't get meanings for the next words just now. Try again later." : 'All sorted: nothing left in your pool.'}</p>
              <button onClick={onBack}>Done</button>
            </>
          )}
          <button class="link small query" onClick={undo}>
            Undo the last word ({last?.word.lemma})
          </button>
        </div>
      )}
      {loaded && roundSize === 0 && (
        <p>{left ? "Couldn't get meanings for these words just now. Try again later." : 'All sorted. Nothing left in your pool to sort.'}</p>
      )}
      {!loaded && !err && <p class="muted">Loading…</p>}
      {err && <p class="error">{err}</p>}
    </LangContext.Provider>
  );
}
