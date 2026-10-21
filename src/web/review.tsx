import { useEffect, useRef, useState } from 'preact/hooks';
import { SpeakButton, setAutoplay, speak, stopSpeaking, useAutoplay, useCanSpeak } from './speech';
import { SayIt } from './mic';
import { spokenRating } from '../core/speech/compare';
import { autoplayText } from '../core/review/autoplay';
import { api, errorText, type ReviewItem } from './api';
import type { StoryRecap } from '../core/review/story';
import { Zh, PinyinToggle, usePinyinMode } from './ruby';
import { BLANK, withFixedSentence } from '../core/review/exercise';
import { sameText } from '../core/text/rules';
import { LangContext, targetName, useStudyLang } from './lang';
import { QuizRun } from './lesson-steps';
import { quizRating } from '../core/lessons/mastery';
import { Lexi, useLexiStage } from './mascot/lexi';
import type { Token } from '../core/pinyin/annotate';
import { boardGloss } from '../core/assessment/sort-board';
import { MatchBoardView, useMatchBoard, type MatchWord } from './match-board';
import { FIXED_EVENT, useQueryContext, type AppliedFix } from './page-query';

type Rating = 1 | 2 | 3 | 4;
/** Words on a review matching board at once (plus one decoy meaning). */
const MATCH_BOARD = 5;
type MatchCard = MatchWord & { item: ReviewItem };

/** localStorage: show the English under review stories' lines. */
const STORY_EN = 'review.story_english';

const RATINGS: { r: Rating; label: string; cls: string }[] = [
  { r: 1, label: 'Pass', cls: 'again' },
  { r: 2, label: 'Hard', cls: 'hard' },
  { r: 3, label: 'Good', cls: 'good' },
  { r: 4, label: 'Easy', cls: 'easy' },
];

export function Review({ onBack, include }: { onBack: () => void; include?: number }) {
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [ann, setAnn] = useState<Record<string, Token[]>>({});
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState('');
  const [verdict, setVerdict] = useState<boolean | null>(null);
  /** The option picked on a multiple-choice card (-1: don't know). */
  const [chosen, setChosen] = useState<number | null>(null);
  /** Rating suggested by saying the answer aloud (Say it in Chinese/Italian cards). */
  const [spoken, setSpoken] = useState<Rating | null>(null);
  const [count, setCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const { lang, config } = useStudyLang();
  const [mode, cycleMode] = usePinyinMode(lang);
  const answered = useRef<number[]>([]);
  const pendingInclude = useRef<number | undefined>(include);
  const { stage } = useLexiStage(lang);
  const [cheer, setCheer] = useState(false);
  const cheerTimer = useRef<number | undefined>(undefined);
  /** Title of a grammar point whose quiz just counted as passing its lesson check. */
  const [passed, setPassed] = useState<string | null>(null);
  /** The story the current set tells, and the story on screen once its set is done. */
  const batchStory = useRef<StoryRecap | null>(null);
  const [recap, setRecap] = useState<StoryRecap | null>(null);
  /** English under the story's lines: hidden until asked for (remembered on this device). */
  const [storyEn, setStoryEn] = useState(() => {
    try {
      return localStorage.getItem(STORY_EN) === '1';
    } catch {
      return false;
    }
  });
  const toggleStoryEn = () => {
    const next = !storyEn;
    setStoryEn(next);
    try {
      localStorage.setItem(STORY_EN, next ? '1' : '0');
    } catch {
      // private window: the choice lasts this visit
    }
  };
  const enToggle = (
    <button type="button" class={`secondary icon tiny ${storyEn ? 'on' : ''}`} onClick={toggleStoryEn} aria-pressed={storyEn} aria-label={storyEn ? 'Hide English' : 'Show English'} title="English">
      EN
    </button>
  );

  /** Cards in this sitting: the "to do" count on the home screen when it opened (null: no limit). */
  const target = useRef<number | null>(null);
  const [setDone, setSetDone] = useState(false);
  const left = () => (target.current === null ? undefined : target.current - answered.current.length);

  async function fetchMore() {
    const want = left();
    if (want !== undefined && want <= 0) {
      setQueue([]);
      setSetDone(true);
      setFinished(true);
      return;
    }
    setLoading(true);
    try {
      const r = await api.reviewNext(lang, answered.current.slice(-60), pendingInclude.current, want);
      pendingInclude.current = undefined; // only the first batch forces the grammar point of the day
      setAnn((a) => ({ ...a, ...(r.annotations ?? {}) }));
      setNotice(r.notice);
      batchStory.current = r.story ?? null;
      if (r.items.length === 0) setFinished(true);
      setQueue(r.items);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    answered.current = [];
    batchStory.current = null;
    setRecap(null);
    setFinished(false);
    setSetDone(false);
    // Today's set: as many cards as the home screen says are left (today's grammar point at least).
    api
      .reviewSummary(lang)
      .then((s) => (target.current = Math.max(s.remaining_today, include ? 1 : 0)))
      .catch(() => (target.current = null))
      .finally(fetchMore);
  }, [lang]);
  function keepGoing() {
    target.current = null;
    setSetDone(false);
    setFinished(false);
    void fetchMore();
  } // the study language may load after the first render

  /** A set's cards are done: the whole story it told, if any, before the next set. */
  function endSet() {
    const story = batchStory.current;
    batchStory.current = null;
    if (!story) return fetchMore();
    setQueue([]);
    setRecap(story);
  }
  function afterRecap() {
    setRecap(null);
    void fetchMore();
  }

  const item = queue[0];
  const ex = item?.exercise;
  // "Something looks wrong?" can fix what this card shows: the lesson a grammar quiz comes from,
  // the word's meaning, the example sentence.
  useQueryContext({ lessonId: ex?.kind === 'quiz' ? ex.lessonId : undefined, wordId: item?.itemType === 'word' ? item.itemId : undefined, sentenceId: ex?.sentenceId });

  // A fix from "Something looks wrong?" shows in place, so the set and its story carry on.
  useEffect(() => {
    const onFix = (e: Event) => {
      const { sentence: s, word: w } = (e as CustomEvent<AppliedFix>).detail ?? {};
      if (!s && !w) return;
      e.preventDefault();
      setQueue((q) =>
        q.map((it) => ({
          ...it,
          ...(w && it.word && it.itemType === 'word' && it.itemId === w.id ? { word: { ...it.word, gloss: w.gloss } } : {}),
          exercise: s ? withFixedSentence(it.exercise, s) : it.exercise,
        })),
      );
      if (!s) return;
      const fixStory = (st: StoryRecap | null) => st && { ...st, sentences: st.sentences.map((x) => (x.id === s.id ? { ...x, zh: s.zh, en: s.en, target: s.target } : x)) };
      batchStory.current = fixStory(batchStory.current);
      setRecap(fixStory);
      api
        .annotateTexts(lang, [s.zh, s.zh.replace(s.target, BLANK)])
        .then((r) => setAnn((a) => ({ ...a, ...r.annotations })))
        .catch(() => {});
    };
    window.addEventListener(FIXED_EVENT, onFix);
    return () => window.removeEventListener(FIXED_EVENT, onFix);
  }, [lang]);

  /** Multiple choice marks itself: right is Good, wrong or "don't know" is Pass. */
  function choose(i: number) {
    setChosen(i);
    setVerdict(i >= 0 && ex?.choices?.[i] === ex?.choiceAnswer);
    setRevealed(true);
  }

  // The card on screen, for answers that arrive after it may have moved on.
  const onScreen = useRef<number | undefined>(undefined);
  onScreen.current = item?.cardId;
  /** Another answer judged right in a fill-in-the-blank (a synonym, another correct form). */
  const [alsoRight, setAlsoRight] = useState<string | null>(null);
  const [judging, setJudging] = useState(false);

  function reveal() {
    setRevealed(true);
    if (ex?.kind !== 'cloze' || !ex.answerZh) return;
    const exact = sameText(config.script, typed, ex.answerZh);
    setVerdict(exact);
    if (exact || !typed.trim()) return;
    // Not the key: Claude judges whether it is right too (a synonym, another correct form).
    const card = item?.cardId;
    setJudging(true);
    api
      .grade(0, 'cloze', `Sentence: ${ex.clozeZh} (English: ${ex.promptEn ?? ''})`, ex.answerZh, typed.trim(), lang)
      .then((g) => {
        if (onScreen.current !== card || !g.correct) return;
        setVerdict(true);
        setAlsoRight(g.feedback);
      })
      .catch(() => {})
      .finally(() => setJudging(false));
  }

  // One rating per card: a quick second tap (or a double tap) must not rate it again.
  const rating = useRef(false);
  async function rate(r: Rating, quiz?: { score: number; total: number }) {
    if (!item || rating.current) return;
    rating.current = true;
    try {
      const res = await api.answer(item.cardId, r, ex?.kind, ex?.sentenceId, quiz);
      if (res.lessonPassed) setPassed(item.grammar?.title ?? 'This grammar');
      if (r === 1) {
        // Pass: a short word of encouragement; the card comes back in a day or two, not today.
        setCheer(true);
        clearTimeout(cheerTimer.current);
        cheerTimer.current = window.setTimeout(() => setCheer(false), 2500);
      }
      answered.current.push(item.cardId);
      setCount((n) => n + 1);
      setRevealed(false);
      setTyped('');
      setVerdict(null);
      setAlsoRight(null);
      setChosen(null);
      setSpoken(null);
      const rest = queue.slice(1);
      if (rest.length === 0 || left() === 0) await endSet();
      else setQueue(rest);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      rating.current = false;
    }
  }

  // Tapping a word would give the answer away, so words become tappable once the answer shows.
  const intro = ex?.kind === 'intro';
  // An introduction without a test shows everything at once; other cards hide the answer until
  // revealed. With a test (choices), a new word's meaning shows once it has been answered.
  const shown = revealed || (intro && !ex?.choices);

  // Auto-play (setting review.autoplay): prompts as they appear, answers on reveal.
  const autoplay = useAutoplay() ?? false;
  const canSpeak = useCanSpeak(config.ttsLang);
  useEffect(() => {
    if (!autoplay || !canSpeak || !ex || !item) return;
    const text = autoplayText(ex, item.word, revealed);
    if (text) speak(text, config.ttsLang);
    return () => stopSpeaking();
  }, [item?.cardId, count, revealed, autoplay, canSpeak]);
  const toggleAutoplay = () => {
    const next = !autoplay;
    setAutoplay(next);
    if (!next) stopSpeaking();
    api.putSetting('review.autoplay', next).catch(() => {});
  };

  // Match cards: every match card in the batch goes on one board when the first one comes up.
  // A first-try match is Good, a match after a wrong try Hard, "?" or two wrong tries Pass.
  const onBoard = useRef<Set<number>>(new Set());
  const [matched, setMatched] = useState<{ item: ReviewItem; rating: Rating } | null>(null);
  const m = useMatchBoard<MatchCard>(MATCH_BOARD, ({ item: it }, known, strikes) => {
    const rating: Rating = !known ? 1 : strikes ? 2 : 3;
    api.answer(it.cardId, rating, 'match').catch((e) => setErr(errorText(e)));
    answered.current.push(it.cardId);
    setCount((n) => n + 1);
    setMatched({ item: it, rating });
    if (known && autoplay && canSpeak && it.word) speak(it.word.lemma, config.ttsLang);
  });
  const matching = ex?.kind === 'match';
  useEffect(() => {
    if (!matching || !item || onBoard.current.has(item.cardId)) return;
    const cards = queue.filter((q) => q.exercise.kind === 'match' && q.word?.gloss);
    onBoard.current = new Set(cards.map((q) => q.cardId));
    setMatched(null);
    // Decoys: meanings of the other words in this batch (more join from words matched earlier).
    const others = queue.filter((q) => q.exercise.kind !== 'match' && q.word?.gloss).map((q) => boardGloss(q.word!.gloss!));
    m.start(
      cards.map((q) => ({ id: q.cardId, lemma: q.word!.lemma, meaning: boardGloss(q.word!.gloss!), item: q })),
      others,
    );
  }, [item?.cardId, matching]);
  const boardDone = matching && !!m.board && m.board.words.length === 0 && onBoard.current.size > 0;
  useEffect(() => {
    if (!boardDone) return;
    const rest = queue.filter((q) => !onBoard.current.has(q.cardId));
    onBoard.current = new Set();
    if (rest.length && left() !== 0) setQueue(rest);
    else void endSet();
  }, [boardDone]);

  // Before the answer shows, every word can be tapped except the one being tested.
  const hidden = [ex?.target, item?.word?.lemma].filter((x): x is string => !!x).map((x) => x.toLowerCase());
  // Latin script compares whole words ("io" is not in "mio"; "accordo" is in "l'accordo");
  // Chinese has no spaces, so it compares characters.
  const latin = config.script === 'latin';
  const words = (s: string) => s.split(/[\s'’]+/).filter(Boolean);
  const sameWord = (w: string, h: string) => words(w).some((a) => words(h).includes(a));
  const tapBefore = (t: Token) => {
    const w = t.text.toLowerCase();
    return !hidden.some((h) => (latin ? sameWord(w, h) : h.includes(w) || w.includes(h)));
  };
  const z = (s: string, big = false) => <Zh text={s} ann={ann} mode={mode} big={big} tap={shown || tapBefore} />;
  /** The word being tested, picked out in its sentence. */
  const tested = (t: Token) => {
    const w = t.text.toLowerCase();
    return hidden.some((h) => (latin ? sameWord(w, h) : h === w || (w.length > 1 && h.includes(w)) || w.includes(h)));
  };
  /** A story sentence's target word, picked out like the tested word on a card. */
  const storyMark = (target: string) => (t: Token) => {
    const w = t.text.toLowerCase();
    const h = target.toLowerCase();
    return latin ? sameWord(w, h) : h === w || (w.length > 1 && h.includes(w)) || w.includes(h);
  };
  const suggested: Rating | null = spoken ?? (verdict === null ? null : verdict ? 3 : 1);

  return (
    <LangContext.Provider value={lang}>
    <div class="review">
      <div class="row chat-header">
        <button class="secondary icon" onClick={onBack} aria-label="Back to home">
          ‹
        </button>
        <strong class="grow">Review · {target.current ? `${Math.min(count, target.current)} of ${target.current}` : `${count} done`}</strong>
        {canSpeak && (
          <button class={`secondary icon autoplay ${autoplay ? 'on' : ''}`} onClick={toggleAutoplay} aria-label={autoplay ? 'Auto-play audio is on. Tap to turn off.' : 'Auto-play audio is off. Tap to turn on.'} title="Auto-play audio">
            {autoplay ? '🔊' : '🔇'}
          </button>
        )}
        <PinyinToggle mode={mode} onCycle={cycleMode} />
      </div>

      {err && <p class="error">{err}</p>}
      {notice && <p class="muted small">{notice}</p>}
      {passed && (
        <div class="card done-banner small" role="status">
          <strong>{passed}</strong>: lesson check passed with this quiz. The lesson is now Practised.
        </div>
      )}
      {loading && !item && (
        <div class="lexi-thinking">
          <Lexi stage={stage} mood="thinking" size={64} />
          <span class="muted">Preparing practice sentences…</span>
        </div>
      )}
      {recap && !item && (
        <div class="card story-recap">
          <div class="muted small">The whole story {enToggle}</div>
          <div class="with-speak">
            <strong>{recap.title}</strong> <SpeakButton text={recap.sentences.map((x) => x.zh).join(latin ? ' ' : '')} small />
          </div>
          <ol class="story-sentences">
            {recap.sentences.map((x, i) => (
              <li key={i}>
                <div class="with-speak">
                  <Zh text={x.zh} ann={ann} mode={mode} tap mark={x.target ? storyMark(x.target) : undefined} /> <SpeakButton text={x.zh} small />
                </div>
                {storyEn && <div class="muted small">{x.en}</div>}
              </li>
            ))}
          </ol>
          <button onClick={afterRecap}>Continue</button>
        </div>
      )}
      {finished && !item && setDone && (
        <div class="card">
          <Lexi stage={stage} mood="happy" size={96} />
          <br />
          <strong>Today's reviews are done.</strong>
          <p class="muted">{count ? `You reviewed ${count} card${count === 1 ? '' : 's'}.` : 'Nothing left in today\'s set.'}</p>
          <div class="row">
            <button onClick={onBack}>Home</button>
            <button class="secondary" onClick={keepGoing}>
              Keep going
            </button>
          </div>
        </div>
      )}
      {finished && !item && !setDone && (
        <div class="card">
          <Lexi stage={stage} mood="happy" size={96} />
          <br />
          <strong>Nothing more due right now.</strong>
          <p class="muted">{count ? `You reviewed ${count} card${count === 1 ? '' : 's'}.` : 'Come back later.'}</p>
          <button onClick={onBack}>Home</button>
        </div>
      )}

      {item && ex && (
        <div class="card review-card">
          <div class="muted small">
            {item.itemType === 'grammar_point' ? 'Grammar' : 'Word'} ·{' '}
            {{ cloze: 'Fill in the blank', zh_to_en: 'What does this mean?', en_to_zh: `Say it in ${targetName(config)}`, flash: ex.choices ? 'What does this mean?' : 'Do you know this?', match: 'Match each word to its meaning', intro: item.word?.status === 'known' ? 'First review' : 'New word', quiz: item.grammar?.title ?? 'Quiz' }[ex.kind]}
          </div>
          {ex.story && (
            <div class="muted small story-line">
              {ex.story.title} · {ex.story.part} of {ex.story.of}
              {ex.story.prev && enToggle}
              {/* The story so far: the lines since the last card, so the cards read as one story. */}
              {ex.story.prev && (
                <div class="story-prev">
                  {ex.story.prev.map((l, i) => (
                    <div key={i}>
                      <Zh text={l.zh} ann={ann} mode={mode} tap />
                      {storyEn && <span> {l.en}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {matching && (
            <>
              <MatchBoardView m={m} wordLang={config.id === 'zh' ? 'zh-Hans' : config.id} />
              <p class="muted small">One meaning is spare. Tap ? on a word you've forgotten: it comes back soon.</p>
            </>
          )}
          {matching && matched?.item.word && (
            <div class="with-speak small">
              <span>
                <Zh text={matched.item.word.lemma} ann={ann} mode={mode} force tap /> {config.script === 'latin' ? '' : matched.item.word.reading}
                {` · ${matched.item.word.gloss ?? ''} `}
                <span class={matched.rating === 1 ? 'muted' : 'match-ok'}>{({ 1: '· again soon', 2: '· hard', 3: '· good', 4: '· easy' } as const)[matched.rating]}</span>
              </span>{' '}
              <SpeakButton text={matched.item.word.lemma} small />
            </div>
          )}

          {ex.kind === 'quiz' && ex.quiz && (
            <QuizRun key={`${item.cardId}-${count}`} items={ex.quiz} lessonId={ex.lessonId ?? 0} ann={ann} mode={mode} onDone={(score, total) => rate(quizRating(score, total), { score, total })} />
          )}

          {ex.kind === 'cloze' && (
            <>
              {/* The blank hides the answer, so the rest of the sentence can be tapped straight away. */}
              <div class="prompt">
                <Zh text={ex.clozeZh!} ann={ann} mode={mode} big tap />
              </div>
              <div class="muted">{ex.promptEn}</div>
              {!revealed && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    reveal();
                  }}
                >
                  <input value={typed} placeholder="Type the missing word" autocomplete="off" onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
                </form>
              )}
            </>
          )}
          {ex.kind === 'zh_to_en' && (
            <div class="prompt with-speak">
              {z(ex.promptZh!, true)} <SpeakButton text={ex.promptZh!} />
            </div>
          )}
          {ex.kind === 'en_to_zh' && (
            <>
              <div class="prompt en">{ex.promptEn}</div>
              {/* Say the answer instead of thinking it: what was understood suggests the rating. */}
              <SayIt
                key={`${item.cardId}-${count}`}
                target={ex.answerZh!}
                label="Say it aloud"
                onResult={(r) => {
                  setSpoken(spokenRating(r));
                  setRevealed(true);
                }}
              />
            </>
          )}
          {ex.kind === 'flash' && (
            <div class="prompt">{item.word ? z(item.word.lemma, true) : <span class="big">{item.grammar?.title}</span>}</div>
          )}

          {intro && item.word && (
            <div class="intro">
              <div class="prompt">
                <Zh text={item.word.lemma} ann={ann} mode={mode} force big /> <SpeakButton text={item.word.lemma} />
              </div>
              {shown && <div>{item.word.gloss ?? <span class="muted">No meaning in your word list yet: tap the word.</span>}</div>}
              {/* Tested in its sentence: the English comes once answered. */}
              {(shown || ex.choices) && ex.promptZh && (
                <div class="intro-example">
                  <div class="with-speak">
                    <Zh text={ex.promptZh} ann={ann} mode={mode} tap={shown || tapBefore} mark={ex.choices ? tested : undefined} /> <SpeakButton text={ex.promptZh} small />
                  </div>
                  {shown && <div class="muted small">{ex.answerEn}</div>}
                </div>
              )}
              {ex.choices && !shown && (
                <p class="choice-prompt">
                  What does {item.word.lemma} mean{ex.promptZh ? ' in this sentence' : ''}?
                </p>
              )}
              {!ex.choices && <p class="muted small">Pass if it is new to you: it comes back in the next day or two. Good if you already know it.</p>}
            </div>
          )}

          {ex.choices && (
            <div class="choice">
              {ex.choices.map((o, i) => {
                const state = !revealed ? '' : o === ex.choiceAnswer ? 'right' : chosen === i ? 'wrong' : '';
                return (
                  <button key={i} class={`option ${state}`} disabled={revealed} onClick={() => choose(i)}>
                    {o}
                  </button>
                );
              })}
              {!revealed && (
                <button class="secondary" onClick={() => choose(-1)}>
                  Don't know
                </button>
              )}
            </div>
          )}

          {ex.kind === 'quiz' || matching ? null : shown ? (
            <div class="answer">
              {ex.kind === 'cloze' && (
                <div class={verdict ? 'right' : 'wrong'}>
                  {verdict ? '✓ ' : '✗ '}
                  {z(ex.answerZh!, true)} <SpeakButton text={ex.clozeZh!.replace(BLANK, ex.answerZh!)} small />
                  {!verdict && typed && <span class="muted small"> (you wrote {typed}{judging ? '; checking whether that is right too…' : ''})</span>}
                  {alsoRight && (
                    <div class="small">
                      Your answer, {typed}, is right too. <span class="muted">{alsoRight}</span>
                    </div>
                  )}
                </div>
              )}
              {ex.choices && <div class={verdict ? 'right' : intro ? 'muted' : 'wrong'}>{verdict ? (intro ? '✓ You know this one.' : '✓ Right') : intro ? 'New to you: it comes back in the next day or two.' : chosen === -1 ? 'It comes back soon.' : '✗ Not quite'}</div>}
              {ex.kind === 'zh_to_en' && !ex.choices && <div>{ex.answerEn}</div>}
              {/* Shadowing: repeat the sentence after hearing it. */}
              {(ex.kind === 'zh_to_en' || ex.kind === 'cloze') && (
                <SayIt key={`${item.cardId}-${count}`} target={ex.kind === 'cloze' ? ex.clozeZh!.replace(BLANK, ex.answerZh!) : ex.promptZh!} label="Repeat it" />
              )}
              {ex.kind === 'en_to_zh' && (
                <div class="with-speak">
                  {z(ex.answerZh!, true)} <SpeakButton text={ex.answerZh!} />
                </div>
              )}
              {ex.kind === 'flash' &&
                (item.word ? (
                  <div>
                    {item.word.reading} · {item.word.gloss ?? <span class="muted">no gloss yet</span>}
                  </div>
                ) : (
                  <div>{item.grammar?.summary}</div>
                ))}
              {item.word && ex.kind !== 'flash' && !intro && (
                <div class="muted small">
                  {item.word.lemma}
                  {item.word.reading ? ` · ${item.word.reading}` : ''}
                  {item.word.gloss ? ` · ${item.word.gloss}` : ''}
                </div>
              )}
              {item.grammar && ex.kind !== 'flash' && <div class="muted small">{item.grammar.title}: {item.grammar.summary}</div>}
              {ex.choices ? (
                <button class="next" onClick={() => rate(verdict ? 3 : 1)}>
                  Next
                </button>
              ) : (
                <div class="ratings">
                  {RATINGS.map(({ r, label, cls }) => (
                    <button key={r} class={`${cls} ${suggested === r ? 'suggested' : ''}`} onClick={() => rate(r)}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : ex.choices ? null : (
            <button class="reveal" onClick={reveal}>
              {ex.kind === 'cloze' ? 'Check' : 'Show answer'}
            </button>
          )}
        </div>
      )}
      {cheer && (
        <div class="lexi-toast" role="status">
          <Lexi stage={stage} mood="encouraging" size={48} />
          <span class="small">No problem. It will come back soon.</span>
        </div>
      )}
    </div>
    </LangContext.Provider>
  );
}
