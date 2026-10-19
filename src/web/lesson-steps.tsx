// A sectioned lesson: warm-up, learn, recognise, build, produce, fix, use it, lesson check.
// Each step unlocks the next; finished steps are saved, so a lesson can span several sittings.
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, errorText, type CheckSubmitResult, type GradeResult, type LessonDetail, type QueryContext, type QueryResult } from './api';
import { Zh } from './ruby';
import { SpeakButton, useAutoSpeak } from './speech';
import { MicButton, SayIt } from './mic';
import { LangContext, useLangConfig, useTargetName } from './lang';
import { Explained } from './explained';
import { sameText } from '../core/text/rules';

/** Answer comparison for the language on screen (punctuation and spacing; case for Latin scripts). */
function useSameText(): (a: string, b: string) => boolean {
  const script = useLangConfig().script;
  return (a, b) => sameText(script, a, b);
}
import { Lexi, useLexiStage } from './mascot/lexi';
import { DEFAULT_STEP_COUNTS, STEP_LABEL, joinTiles, moveTile, shuffle, splitDrills, stepCounts, stepsFor, tilesFor, type StepCounts, type StepKey, type WarmupItem } from '../core/lessons/steps';
import type { LessonCheckItem, LessonChoice } from '../core/lessons/types';
import type { PinyinMode, Token } from '../core/pinyin/annotate';
import { quizRating } from '../core/lessons/mastery';

type Ann = Record<string, Token[]>;
interface ZhProps {
  ann: Ann;
  mode: PinyinMode;
}

function Choice({ item, ann, mode, chosen, reveal, onChoose }: ZhProps & { item: LessonChoice; chosen: number | null; reveal: boolean; onChoose: (i: number) => void }) {
  return (
    <div class="choice">
      <div class="choice-prompt">{item.prompt}</div>
      {item.options.map((o, i) => {
        const state = !reveal ? (chosen === i ? 'picked' : '') : i === item.answer ? 'right' : chosen === i ? 'wrong' : '';
        return (
          <button key={i} class={`option ${state}`} disabled={reveal} onClick={() => onChoose(i)}>
            <Zh text={o} ann={ann} mode={mode} tap={reveal} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Query this mark": a stronger model re-checks the marking. If the learner was right the mark
 * flips (onRight); a wrong answer key is logged so the lesson can be corrected.
 */
export function QueryButton({ ctx, ann, mode, onRight }: ZhProps & { ctx: QueryContext; onRight?: (r: QueryResult) => void }) {
  const lang = useContext(LangContext);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<QueryResult | null>(null);
  const [err, setErr] = useState('');
  async function send() {
    setBusy(true);
    setErr('');
    try {
      const r = await api.queryMark({ ...ctx, note: note.trim() || undefined });
      setRes(r);
      if (r.learnerRight && !ctx.markedRight) onRight?.(r);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (res)
    return (
      <div class="query-result">
        <strong>{res.learnerRight ? (ctx.markedRight ? 'Your answer is right.' : 'You were right: marked correct.') : 'The mark stands.'}</strong>
        <div class="small">
          <Explained text={res.explanation} lang={lang} />
        </div>
        {res.keyWrong && (
          <div class="small">
            {res.keyFixed ? 'The answer key was wrong and has been corrected in the lesson' : 'The answer key looks wrong and has been noted (see Settings → Flagged)'}
            {res.betterKey ? ': ' : '.'}
            {res.betterKey && <Zh text={res.betterKey} ann={ann} mode={mode} />}
          </div>
        )}
      </div>
    );
  if (!open)
    return (
      <button type="button" class="link small query" onClick={() => setOpen(true)}>
        Query this mark
      </button>
    );
  return (
    <div class="query-form">
      <input value={note} placeholder="Why do you think it's right? (optional)" onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
      <div class="row">
        <button type="button" disabled={busy} onClick={send}>
          {busy ? 'Checking…' : 'Send query'}
        </button>
        <button type="button" class="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {err && <p class="error small">{err}</p>}
    </div>
  );
}

/** Multiple choice with feedback after each answer (recognise, warm-up). */
function ChoiceRun({
  items,
  ann,
  mode,
  onDone,
  intro,
  lessonId,
  place,
}: ZhProps & { items: (LessonChoice & { note?: string; lessonId?: number })[]; onDone: () => void; intro: string; lessonId: number; place: string }) {
  const [i, setI] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [right, setRight] = useState(0);
  const item = items[i];
  useAutoSpeak(item && chosen !== null ? item.options[item.answer] : null);
  if (!item)
    return (
      <div class="step-end">
        <p>
          {right} of {items.length} right.
        </p>
        <button onClick={onDone}>Continue</button>
      </div>
    );
  return (
    <div>
      <p class="muted small">
        {intro} · {i + 1} of {items.length}
        {item.note ? ` · ${item.note}` : ''}
      </p>
      <Choice
        item={item}
        ann={ann}
        mode={mode}
        chosen={chosen}
        reveal={chosen !== null}
        onChoose={(k) => {
          setChosen(k);
          if (k === item.answer) setRight((n) => n + 1);
        }}
      />
      {chosen !== null && (
        <>
          <QueryButton
            key={i}
            ann={ann}
            mode={mode}
            ctx={{
              lessonId: item.lessonId ?? lessonId,
              place: `${place} ${i + 1}`,
              kind: 'choice',
              task: item.prompt,
              options: item.options,
              expected: item.options[item.answer]!,
              answer: item.options[chosen]!,
              markedRight: chosen === item.answer,
            }}
            onRight={() => setRight((n) => n + 1)}
          />
          <button
            class="next"
            onClick={() => {
              setChosen(null);
              setI(i + 1);
            }}
          >
            Next
          </button>
        </>
      )}
    </div>
  );
}

/** Put word tiles in order. */
function BuildRun({ drills, ann, mode, onDone, lessonId }: ZhProps & { drills: { en: string; zh: string }[]; onDone: () => void; lessonId: number }) {
  const sameZh = useSameText(); // compares by the lesson language's rules
  const latin = useLangConfig().script === 'latin';
  const usable = useMemo(
    () =>
      drills.flatMap((d, k) => {
        const t = ann[d.zh] ? tilesFor(ann[d.zh]!) : null;
        return t ? [{ ...d, ...t, order: shuffle(t.tiles.map((_, j) => j), k + 3) }] : [];
      }),
    [drills, ann],
  );
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number[]>([]);
  const [checked, setChecked] = useState<boolean | null>(null);
  // Placed words: tap one to take it back, or drag it to a new place.
  const line = useRef<HTMLDivElement>(null);
  const drag = useRef<{ k: number; x: number; y: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  /** The placed tile nearest the pointer (rows count more than columns). */
  const slotAt = (x: number, y: number) => {
    let best = -1;
    let bestD = Infinity;
    line.current?.querySelectorAll<HTMLElement>('.tile[data-k]').forEach((el) => {
      const r = el.getBoundingClientRect();
      const d = (x - (r.left + r.width / 2)) ** 2 + 4 * (y - (r.top + r.height / 2)) ** 2;
      if (d < bestD) [best, bestD] = [Number(el.dataset.k), d];
    });
    return best;
  };
  const endDrag = (tap: boolean) => {
    const d = drag.current;
    drag.current = null;
    setDragging(null);
    if (d && tap && !d.moved) setPicked((p) => p.filter((_, n) => n !== d.k));
  };
  const item = usable[i];
  if (!item)
    return (
      <div class="step-end">
        <button onClick={onDone}>Continue</button>
      </div>
    );
  const built = joinTiles(picked.map((j) => item.tiles[j]!), latin);
  return (
    <div>
      <p class="muted small">
        Put the words in order · {i + 1} of {usable.length}
        {picked.length > 1 && checked === null ? ' · drag a word to move it' : ''}
      </p>
      <div class="choice-prompt">{item.en}</div>
      <div class="tiles answer-line" aria-label="Your sentence" ref={line}>
        {picked.map((j, k) => (
          <button
            key={k}
            data-k={k}
            class={`tile placed${dragging === k ? ' dragging' : ''}`}
            disabled={checked !== null}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { k, x: e.clientX, y: e.clientY, moved: false };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8)) return;
              d.moved = true;
              const to = slotAt(e.clientX, e.clientY);
              if (to >= 0 && to !== d.k) {
                setPicked((p) => moveTile(p, d.k, to));
                d.k = to;
              }
              setDragging(d.k);
            }}
            onPointerUp={() => endDrag(true)}
            onPointerCancel={() => endDrag(false)}
            // Keyboard: Enter or Space takes the word back.
            onClick={(e) => e.detail === 0 && setPicked(picked.filter((_, n) => n !== k))}
          >
            {item.tiles[j]}
          </button>
        ))}
        {picked.length === item.tiles.length && <span class="tile-end">{item.ending}</span>}
      </div>
      <div class="tiles">
        {item.order.map((j) =>
          picked.includes(j) ? (
            <span key={j} class="tile ghost" />
          ) : (
            <button key={j} class="tile" disabled={checked !== null} onClick={() => setPicked([...picked, j])}>
              {item.tiles[j]}
            </button>
          ),
        )}
      </div>
      {checked === null ? (
        <button class="next" disabled={picked.length !== item.tiles.length} onClick={() => setChecked(sameZh(built, item.zh))}>
          Check
        </button>
      ) : (
        <>
          <div class={checked ? 'right' : 'wrong'}>
            {checked ? '✓ ' : '✗ '}
            <Zh text={item.zh} ann={ann} mode={mode} /> <SpeakButton text={item.zh} small auto />
          </div>
          {!checked && (
            <QueryButton
              key={i}
              ann={ann}
              mode={mode}
              ctx={{ lessonId, place: `build ${i + 1}`, kind: 'build', task: item.en, expected: item.zh, answer: built + item.ending, markedRight: false }}
              onRight={() => setChecked(true)}
            />
          )}
          <button
            class="next"
            onClick={() => {
              setPicked([]);
              setChecked(null);
              setI(i + 1);
            }}
          >
            Next
          </button>
        </>
      )}
    </div>
  );
}

interface TypedItem {
  kind: 'translate' | 'fix';
  /** English to translate, or the wrong sentence to fix. */
  task: string;
  expected: string;
  note?: string;
}

function Feedback({ g, expected, ann, mode, auto = true }: ZhProps & { g: GradeResult; expected: string; /** Say the model answer as it appears (auto-play). */ auto?: boolean }) {
  const lang = useContext(LangContext);
  const sameZh = useSameText(); // compares by the lesson language's rules
  return (
    <div class="answer">
      <div class={g.correct ? 'right' : 'wrong'}>
        {g.correct ? '✓ ' : '✗ '}
        <Explained text={g.feedback} lang={lang} mode={mode} inTarget={g.judged ? undefined : false} />
      </div>
      {!g.correct && g.corrected && !sameZh(g.corrected, expected) && (
        <div class="small">
          Your sentence, fixed: <Zh text={g.corrected} ann={ann} mode={mode} />
        </div>
      )}
      <div class="small muted">
        Model answer: <Zh text={expected} ann={ann} mode={mode} /> <SpeakButton text={expected} small auto={auto} />
      </div>
      <SayIt target={expected} label="Repeat the model answer" />
    </div>
  );
}

/** Type the sentence; marked straight away (exact match, else Claude). */
function TypedRun({ items, lessonId, ann, mode, onDone, intro }: ZhProps & { items: TypedItem[]; lessonId: number; onDone: () => void; intro: string }) {
  const target = useTargetName();
  const [i, setI] = useState(0);
  const [text, setText] = useState('');
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const item = items[i];
  if (!item)
    return (
      <div class="step-end">
        <button onClick={onDone}>Continue</button>
      </div>
    );
  async function check() {
    if (!item || !text.trim()) return;
    setBusy(true);
    setErr('');
    try {
      setGrade(await api.grade(lessonId, item.kind, item.task, item.expected, text));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <p class="muted small">
        {intro} · {i + 1} of {items.length}
      </p>
      <div class="choice-prompt">{item.kind === 'fix' ? <Zh text={item.task} ann={ann} mode={mode} /> : item.task}</div>
      {item.kind === 'fix' && item.note && !grade && <p class="muted small">Hint: {item.note}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (grade) return;
          check();
        }}
      >
        <div class="input-mic">
          <input value={text} disabled={!!grade} placeholder={item.kind === 'fix' ? 'Type or say the corrected sentence' : `Type or say it in ${target}`} autocomplete="off" onInput={(e) => setText((e.target as HTMLInputElement).value)} />
          {!grade && <MicButton label={`Say it in ${target}`} onInterim={setText} onResult={(alts) => setText(alts[0] ?? '')} />}
        </div>
        {!grade && (
          <div class="row">
            <button disabled={busy || !text.trim()}>{busy ? 'Marking…' : 'Check'}</button>
            <button type="button" class="secondary" onClick={() => setGrade({ correct: false, feedback: 'Here is the answer.', corrected: '', judged: false })}>
              Show answer
            </button>
          </div>
        )}
      </form>
      {err && <p class="error">{err}</p>}
      {grade && (
        <>
          <Feedback g={grade} expected={item.expected} ann={ann} mode={mode} />
          {text.trim() && (
            <QueryButton
              key={i}
              ann={ann}
              mode={mode}
              ctx={{ lessonId, place: `${item.kind === 'fix' ? 'fix' : 'produce'} ${i + 1}`, kind: item.kind, task: item.task, expected: item.expected, answer: text.trim(), markedRight: grade.correct }}
              onRight={(r) => setGrade({ ...grade, correct: true, feedback: r.explanation })}
            />
          )}
          <button
            class="next"
            onClick={() => {
              setGrade(null);
              setText('');
              setI(i + 1);
            }}
          >
            Next
          </button>
        </>
      )}
    </div>
  );
}

/** The scored lesson check: answer everything, then see the marks. */
function CheckRun({ items, lessonId, passMark, ann, mode, onSubmitted }: ZhProps & { items: LessonCheckItem[]; lessonId: number; passMark: number; onSubmitted: (r: CheckSubmitResult) => void }) {
  const target = useTargetName();
  const sameZh = useSameText(); // compares by the lesson language's rules
  const [answers, setAnswers] = useState<(string | number | null)[]>(() => items.map(() => null));
  const [marks, setMarks] = useState<{ right: boolean; grade?: GradeResult }[] | null>(null);
  const [result, setResult] = useState<CheckSubmitResult | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const set = (k: number, v: string | number) => setAnswers(answers.map((a, n) => (n === k ? v : a)));
  const complete = answers.every((a) => a !== null && a !== '');

  async function submit() {
    setErr('');
    try {
      const out: { right: boolean; grade?: GradeResult }[] = [];
      for (const [k, it] of items.entries()) {
        const a = answers[k];
        if (it.kind === 'choice') out.push({ right: a === it.answer });
        else {
          setBusy(`Marking ${k + 1} of ${items.length}…`);
          const expected = it.kind === 'translate' ? it.zh : it.right;
          const task = it.kind === 'translate' ? it.en : it.wrong;
          const g = sameZh(String(a), expected) ? { correct: true, feedback: 'Exactly right.', corrected: expected, judged: false } : await api.grade(lessonId, it.kind, task, expected, String(a));
          out.push({ right: g.correct, grade: g });
        }
      }
      setBusy('Saving…');
      const r = await api.submitCheck(
        lessonId,
        items.map((it, k) => ({ kind: it.kind, right: out[k]!.right, answer: String(answers[k]) })),
      );
      setMarks(out);
      setResult(r);
      onSubmitted(r);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      {result ? (
        <div class={`card check-result ${result.passed ? 'done-banner' : ''}`}>
          <strong>
            {result.score} of {result.total} ({result.percent}%) · {result.passed ? 'Passed' : `Pass mark ${result.passMark}%`}
          </strong>
          <p class="small">
            {result.passed
              ? `Lesson done. ${result.done?.grammarCards ?? 0} grammar point(s) are now in your reviews.`
              : 'Not passed yet. This grammar comes back in your reviews tomorrow; retake the check when ready.'}
          </p>
        </div>
      ) : (
        <p class="muted small">
          {items.length} questions, no hints. Pass mark {passMark}%.
        </p>
      )}
      <ol class="check-list">
        {items.map((it, k) => (
          <li key={k} class={marks ? (marks[k]!.right ? 'is-right' : 'is-wrong') : ''}>
            {it.kind === 'choice' ? (
              <Choice item={it} ann={ann} mode={mode} chosen={(answers[k] as number | null) ?? null} reveal={!!marks} onChoose={(i) => set(k, i)} />
            ) : (
              <div class="choice">
                <div class="choice-prompt">
                  {it.kind === 'fix' ? (
                    <>
                      Fix: <Zh text={it.wrong} ann={ann} mode={mode} tap={!!marks} />
                    </>
                  ) : (
                    it.en
                  )}
                </div>
                <input value={(answers[k] as string) ?? ''} disabled={!!marks} placeholder={`Type it in ${target}`} autocomplete="off" onInput={(e) => set(k, (e.target as HTMLInputElement).value)} />
                {marks?.[k]?.grade && <Feedback g={marks[k]!.grade!} expected={it.kind === 'translate' ? it.zh : it.right} ann={ann} mode={mode} auto={false} />}
              </div>
            )}
            {marks && result && (
              <QueryButton
                ann={ann}
                mode={mode}
                ctx={{
                  lessonId,
                  place: `check ${k + 1}`,
                  kind: it.kind,
                  task: it.kind === 'choice' ? it.prompt : it.kind === 'translate' ? it.en : it.wrong,
                  options: it.kind === 'choice' ? it.options : undefined,
                  expected: it.kind === 'choice' ? it.options[it.answer]! : it.kind === 'translate' ? it.zh : it.right,
                  answer: it.kind === 'choice' ? (it.options[answers[k] as number] ?? '') : String(answers[k] ?? ''),
                  markedRight: marks[k]!.right,
                  checkId: result.checkId ?? undefined,
                  itemIndex: k,
                }}
                onRight={(r) => {
                  // The mark is won back: update this item and, when rescored, the result.
                  setMarks(marks.map((m, n) => (n === k ? { ...m, right: true } : m)));
                  if (r.check) {
                    setResult(r.check);
                    onSubmitted(r.check);
                  }
                }}
              />
            )}
          </li>
        ))}
      </ol>
      {!marks && (
        <button class="next" disabled={!complete || !!busy} onClick={submit}>
          {busy || (complete ? 'Submit check' : 'Answer every question to submit')}
        </button>
      )}
      {err && <p class="error">{err}</p>}
    </div>
  );
}

const QUIZ_RATING_LABEL: Record<1 | 2 | 3, string> = { 1: 'Pass: it comes back soon', 2: 'Hard', 3: 'Good' };

/**
 * The grammar review in Reviews: three questions from the lesson, marked one by one, with the
 * review rating worked out from the score (all right = Good, one wrong = Hard, else Pass).
 */
export function QuizRun({ items, lessonId, ann, mode, onDone }: ZhProps & { items: LessonCheckItem[]; lessonId: number; onDone: (score: number, total: number) => void }) {
  const target = useTargetName();
  const sameZh = useSameText(); // compares by the lesson language's rules
  const [i, setI] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [rights, setRights] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const item = items[i];
  const answered = item ? (item.kind === 'choice' ? chosen !== null : !!grade) : false;
  const right = item ? (item.kind === 'choice' ? chosen === item.answer : !!grade?.correct) : false;
  // Typed answers are said by their feedback's model answer; a choice says the right option.
  useAutoSpeak(item?.kind === 'choice' && chosen !== null ? item.options[item.answer] : null);

  if (!item) {
    const score = rights.filter(Boolean).length;
    const r = quizRating(score, items.length);
    return (
      <div class="step-end">
        <p>
          {score} of {items.length} right · {QUIZ_RATING_LABEL[r]}
        </p>
        <button onClick={() => onDone(score, items.length)}>Continue</button>
      </div>
    );
  }
  async function mark() {
    if (!item || item.kind === 'choice' || !text.trim()) return;
    const expected = item.kind === 'translate' ? item.zh : item.right;
    const task = item.kind === 'translate' ? item.en : item.wrong;
    setBusy(true);
    setErr('');
    try {
      setGrade(sameZh(text, expected) ? { correct: true, feedback: 'Exactly right.', corrected: expected, judged: false } : await api.grade(lessonId, item.kind, task, expected, text));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const next = (wasRight: boolean) => {
    setRights([...rights, wasRight]);
    setChosen(null);
    setText('');
    setGrade(null);
    setI(i + 1);
  };
  const expected = item.kind === 'choice' ? item.options[item.answer]! : item.kind === 'translate' ? item.zh : item.right;
  return (
    <div class="quiz">
      <p class="muted small">
        Grammar quiz · {i + 1} of {items.length}
      </p>
      {item.kind === 'choice' ? (
        <Choice item={item} ann={ann} mode={mode} chosen={chosen} reveal={chosen !== null} onChoose={setChosen} />
      ) : (
        <form
          class="choice"
          onSubmit={(e) => {
            e.preventDefault();
            if (!grade) mark();
          }}
        >
          <div class="choice-prompt">
            {item.kind === 'fix' ? (
              <>
                Fix: <Zh text={item.wrong} ann={ann} mode={mode} tap={!!grade} />
              </>
            ) : (
              item.en
            )}
          </div>
          <input value={text} disabled={!!grade} placeholder={`Type it in ${target}`} autocomplete="off" onInput={(e) => setText((e.target as HTMLInputElement).value)} />
          {!grade && <button disabled={busy || !text.trim()}>{busy ? 'Marking…' : 'Check'}</button>}
          {grade && <Feedback g={grade} expected={expected} ann={ann} mode={mode} />}
        </form>
      )}
      {err && <p class="error">{err}</p>}
      {answered && (
        <>
          <QueryButton
            key={i}
            ann={ann}
            mode={mode}
            ctx={{
              lessonId,
              place: 'quiz',
              kind: item.kind,
              task: item.kind === 'choice' ? item.prompt : item.kind === 'translate' ? item.en : item.wrong,
              options: item.kind === 'choice' ? item.options : undefined,
              expected,
              answer: item.kind === 'choice' ? item.options[chosen!]! : text.trim(),
              markedRight: right,
            }}
            onRight={(r) => (item.kind === 'choice' ? next(true) : setGrade({ ...(grade ?? { corrected: '', judged: true }), correct: true, feedback: r.explanation }))}
          />
          <button class="next" onClick={() => next(right)}>
            Next
          </button>
        </>
      )}
    </div>
  );
}

export function SteppedLesson({
  d,
  ann,
  mode,
  reload,
  onPractise,
  onOpen,
  learn,
}: {
  d: LessonDetail;
  ann: Ann;
  mode: PinyinMode;
  reload: () => void;
  onPractise: () => void;
  /** Open another lesson (previous / next in the course). */
  onOpen: (id: number) => void;
  /** The lesson's explanation, examples, key points and common errors. */
  learn: preact.ComponentChildren;
}) {
  const target = useTargetName();
  const { lesson } = d;
  const c = lesson.content;
  const { stage } = useLexiStage(lesson.lang);
  const [warm, setWarm] = useState<{ items: (WarmupItem & { lessonTitle: string })[]; ann: Ann } | null>(null);
  const [done, setDone] = useState<StepKey[]>(d.state.stepsDone);
  const [step, setStep] = useState<StepKey | null>(null);
  const [run, setRun] = useState(0); // remounts a step when it is retaken

  useEffect(() => {
    api
      .warmup(lesson.id)
      // Warm-up is tap-to-answer, so only multiple-choice recall questions are used.
      .then((w) => setWarm({ items: w.items.filter((i) => i.kind === 'choice'), ann: w.annotations }))
      .catch(() => setWarm({ items: [], ann: {} }));
  }, [lesson.id]);
  const [counts, setCounts] = useState<StepCounts | null>(null);
  useEffect(() => {
    api
      .settings()
      .then((s) => setCounts(stepCounts(s)))
      .catch(() => setCounts(DEFAULT_STEP_COUNTS));
  }, []);

  const steps = stepsFor(c, !!warm?.items.length);
  useEffect(() => {
    if (warm && step === null) setStep(steps.find((s) => !done.includes(s)) ?? 'check');
  }, [warm]);
  // Keep the current step's pill in view in the scrolling strip.
  useEffect(() => {
    document.querySelector('.step-pill.current')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [step]);
  const allAnn = useMemo(() => ({ ...ann, ...(warm?.ann ?? {}) }), [ann, warm]);
  const { build, produce } = splitDrills(c.drills, counts ?? DEFAULT_STEP_COUNTS);
  const recognise = (c.recognise ?? []).slice(0, (counts ?? DEFAULT_STEP_COUNTS).recognise);

  async function finish(s: StepKey) {
    const r = await api.lessonStep(lesson.id, s).catch(() => null);
    const nowDone = r?.stepsDone ?? [...new Set([...done, s])];
    setDone(nowDone);
    const next = steps[steps.indexOf(s) + 1];
    if (next) setStep(next);
    window.scrollTo(0, 0);
  }

  const reachable = (s: StepKey) => {
    if (lesson.completedAt) return true; // a finished lesson can be revisited at any step
    const k = steps.indexOf(s);
    return k === 0 || done.includes(s) || steps.slice(0, k).every((p) => done.includes(p));
  };
  if (!warm || !step || !counts) return <p class="muted">Loading…</p>;
  const z = { ann: allAnn, mode };
  const lastCheck = d.state.checks[0];
  // Bottom nav walks the steps first: the next lesson is only offered once this one is finished,
  // so a step cannot be skipped by tapping "next" (the step pills enforce the same order).
  const k = steps.indexOf(step);
  const prevStep = steps[k - 1];
  const nextStep = steps[k + 1];
  const finished = !!lesson.completedAt || steps.every((s) => done.includes(s));
  const goTo = (s: StepKey) => {
    setStep(s);
    window.scrollTo(0, 0);
  };

  return (
    <div class="stepped">
      <nav class="steps" aria-label="Lesson steps">
        {steps.map((s, k) => (
          <button key={s} class={`step-pill ${s === step ? 'current' : ''} ${done.includes(s) ? 'done' : ''}`} disabled={!reachable(s)} onClick={() => setStep(s)}>
            {done.includes(s) ? '✓ ' : `${k + 1} `}
            {STEP_LABEL[s]}
          </button>
        ))}
      </nav>

      <section class="card step-body" key={`${step}-${run}`}>
        <h2>{STEP_LABEL[step]}</h2>
        {step === 'warmup' && (
          <ChoiceRun
            {...z}
            lessonId={lesson.id}
            place="warm-up"
            intro="Quick recall from earlier lessons"
            items={warm.items.flatMap((w) => (w.kind === 'choice' ? [{ ...w, note: w.lessonTitle }] : []))}
            onDone={() => finish('warmup')}
          />
        )}
        {step === 'learn' && (
          <>
            {learn}
            <button class="next" onClick={() => finish('learn')}>
              Got it
            </button>
          </>
        )}
        {step === 'recognise' && <ChoiceRun {...z} lessonId={lesson.id} place="recognise" intro="Which is right?" items={recognise} onDone={() => finish('recognise')} />}
        {step === 'build' && <BuildRun {...z} lessonId={lesson.id} drills={build} onDone={() => finish('build')} />}
        {step === 'produce' && (
          <TypedRun {...z} intro={`Say it in ${target}`} lessonId={lesson.id} items={produce.map((dr) => ({ kind: 'translate', task: dr.en, expected: dr.zh }))} onDone={() => finish('produce')} />
        )}
        {step === 'fix' && (
          <TypedRun {...z} intro="Fix the mistake" lessonId={lesson.id} items={c.errors.map((e) => ({ kind: 'fix', task: e.wrong, expected: e.right, note: e.note }))} onDone={() => finish('fix')} />
        )}
        {step === 'use' && (
          <div class="lexi-moment">
            <Lexi stage={stage} mood="talk" size={72} />
            <div>
              <p>{c.chatPrompt ?? `Have a short chat using ${c.pattern}.`}</p>
              <p class="muted small">Lexi will steer the chat so you can use today's pattern. Come back here when you're done.</p>
              <div class="row">
                <button onClick={onPractise}>Start the chat</button>
                <button class="secondary" onClick={() => finish('use')}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
        {step === 'check' && (
          <>
            {lastCheck && (
              <p class="muted small">
                Last attempt: {lastCheck.score} of {lastCheck.total}
                {lastCheck.passed ? ' (passed)' : ''}.
              </p>
            )}
            <CheckRun
              {...z}
              items={c.check ?? []}
              lessonId={lesson.id}
              passMark={d.state.passMark}
              onSubmitted={(r) => {
                if (r.passed) api.lessonStep(lesson.id, 'check').catch(() => {});
                reload();
              }}
            />
            <button class="secondary next" onClick={() => setRun(run + 1)}>
              Retake
            </button>
          </>
        )}
      </section>

      <div class="row nav">
        {prevStep ? (
          <button class="secondary" onClick={() => goTo(prevStep)}>
            ‹ {STEP_LABEL[prevStep]}
          </button>
        ) : d.nav?.prev ? (
          <button class="secondary" onClick={() => onOpen(d.nav!.prev!)}>
            ‹ Previous lesson
          </button>
        ) : (
          <span />
        )}
        <span class="spacer" />
        {nextStep ? (
          <button class="secondary" disabled={!reachable(nextStep)} title={reachable(nextStep) ? undefined : `Finish ${STEP_LABEL[step]} first`} onClick={() => goTo(nextStep)}>
            {STEP_LABEL[nextStep]} ›
          </button>
        ) : (
          finished &&
          d.nav?.next && (
            <button class="secondary" onClick={() => onOpen(d.nav!.next!)}>
              Next lesson ›
            </button>
          )
        )}
      </div>
    </div>
  );
}
