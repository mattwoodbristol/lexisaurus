// "Query this page": a small flag on every screen. The learner says what looks wrong; Claude checks
// what is on screen and, on a lesson, may offer corrected examples or drills to apply.
import { useEffect, useState } from 'preact/hooks';
import { api, errorText, type FlaggedItem, type PageQueryResult } from './api';
import { useStudyLang } from './lang';
import { Explained } from './explained';

/** The screen's text, read as the flag is tapped (before the panel opens over it). */
function screenText(): string {
  const text = document.getElementById('app')?.innerText ?? '';
  return text
    .replace(/⚑/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 8000);
}

/**
 * What the current screen shows, beyond its route: the lesson a review's grammar quiz comes from,
 * the word and example sentence on a review card. Queries carry it, so a fix can be applied.
 */
/**
 * Sent on window when a fix is applied, with the fix. A screen that shows it in place (a review
 * card) cancels the event; otherwise the panel offers a reload.
 */
export const FIXED_EVENT = 'lexi:fixed';
export type AppliedFix = NonNullable<PageQueryResult['fix']>;

export interface QueryContext {
  lessonId?: number;
  wordId?: number;
  sentenceId?: number;
}
let shown: QueryContext = {};

/** Declare what this screen's content comes from, while it is shown. */
export function useQueryContext(ctx: QueryContext): void {
  useEffect(() => {
    shown = ctx;
    return () => {
      if (shown === ctx) shown = {};
    };
  }, [ctx.lessonId, ctx.wordId, ctx.sentenceId]);
}

export function PageQuery({ screen, lessonId: routeLesson }: { screen: string; lessonId?: number }) {
  const { lang } = useStudyLang();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<PageQueryResult | null>(null);
  /** 'here': the screen shows the fix already; 'reload': reopen the page to see it. */
  const [applied, setApplied] = useState<false | 'here' | 'reload'>(false);
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
  const [ctx, setCtx] = useState<QueryContext>({ lessonId: routeLesson });
  const close = () => {
    setOpen(false);
    setRes(null);
    setNote('');
    setErr('');
    setApplied(false);
  };
  async function send() {
    setBusy(true);
    setErr('');
    try {
      setRes(await api.queryPage({ lang, screen, ...ctx, text, note: note.trim() }));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!res) return;
    setBusy(true);
    setErr('');
    try {
      await api.applyPageFix(res.id);
      const here = !!res.fix && !window.dispatchEvent(new CustomEvent(FIXED_EVENT, { detail: res.fix, cancelable: true }));
      setApplied(here ? 'here' : 'reload');
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button
        class="page-query page-query-flag"
        onClick={() => {
          setText(screenText());
          setCtx({ ...shown, lessonId: routeLesson ?? shown.lessonId });
          setOpen(true);
        }}
        aria-label="Query this page: something looks wrong"
        title="Something looks wrong?"
      >
        ⚑
      </button>
    );
  const f = res?.fix;
  return (
    <div class="page-query card" role="dialog" aria-label="Query this page">
      <strong>Something looks wrong?</strong>
      {!res ? (
        <>
          <textarea
            rows={3}
            value={note}
            placeholder={ctx.lessonId ? 'e.g. The examples don’t use the imperfect subjunctive' : ctx.wordId ? 'e.g. That’s not what this word means here' : 'What looks wrong?'}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          />
          <div class="row">
            <button disabled={busy || !note.trim()} onClick={send}>
              {busy ? 'Checking…' : 'Check it'}
            </button>
            <button class="secondary" onClick={close}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div class={res.contentWrong ? 'wrong' : ''}>{res.contentWrong ? 'You’re right: this needs fixing.' : 'This looks right.'}</div>
          <div class="small">
            <Explained text={res.explanation} lang={lang} />
          </div>
          {f && !applied && (
            <div class="small page-query-fix">
              <div class="muted">
                Corrected{' '}
                {[f.examples && 'examples', f.drills && 'drills', f.keyPoints && 'key points', f.explanation && 'explanation', f.errors && 'common errors', f.recognise && 'quick questions', f.check && 'lesson check (and review quizzes)', f.word && 'word meaning', f.sentence && 'example sentence']
                  .filter(Boolean)
                  .join(', ')}
                {f.examples || f.word || f.sentence ? ':' : '.'}
              </div>
              {f.examples && (
                <ul>
                  {f.examples.map((x, i) => (
                    <li key={i}>
                      {x.zh} <span class="muted">— {x.en}</span>
                    </li>
                  ))}
                </ul>
              )}
              {f.drills && <div class="muted">{f.drills.length} new drills.</div>}
              {f.word && <div>Meaning: {f.word.gloss}</div>}
              {f.sentence && (
                <div>
                  Sentence: {f.sentence.zh} <span class="muted">— {f.sentence.en} (answer: {f.sentence.target})</span>
                </div>
              )}
            </div>
          )}
          {applied && <div class="right small">{applied === 'here' ? 'Fixed.' : 'Fixed. Reopen the page to see the change.'}</div>}
          <div class="row">
            {f && !applied && (
              <button disabled={busy} onClick={apply}>
                {busy ? 'Saving…' : f?.word || f?.sentence ? 'Fix it' : 'Fix the lesson'}
              </button>
            )}
            {applied === 'reload' ? (
              <button onClick={() => location.reload()}>Reload</button>
            ) : (
              <button class="secondary" onClick={close}>
                Close
              </button>
            )}
          </div>
        </>
      )}
      {err && <p class="error small">{err}</p>}
    </div>
  );
}

/** Settings → Flagged: what was queried and what became of it, with a skipped lesson fix to apply. */
export function Flagged() {
  const { lang } = useStudyLang();
  const [items, setItems] = useState<FlaggedItem[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const load = () =>
    api
      .flagged(lang)
      .then((r) => setItems(r.items))
      .catch((e) => setErr(errorText(e)));
  useEffect(() => {
    load();
  }, [lang]);
  async function apply(id: number) {
    setBusy(id);
    setErr('');
    try {
      await api.applyPageFix(id);
      await load();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  }
  const outcome = (it: FlaggedItem): { text: string; cls: string } => {
    if (it.source === 'mark') {
      if (it.keyWrong) return it.status === 'fixed' ? { text: `Answer key corrected: ${it.better ?? ''}`, cls: 'right' } : { text: `Answer key looks wrong${it.better ? ` (better: ${it.better})` : ''}, not found in the lesson to correct`, cls: 'wrong' };
      return it.learnerRight ? { text: 'Your answer was right: marked correct', cls: 'right' } : { text: 'The mark stood', cls: 'muted' };
    }
    if (!it.contentWrong) return { text: 'Checked: looked right', cls: 'muted' };
    if (it.status === 'applied') return { text: 'Fixed in the lesson', cls: 'right' };
    return it.canApply ? { text: 'Needs fixing: a fix is ready', cls: 'wrong' } : { text: 'Needs fixing (no fix to apply here)', cls: 'wrong' };
  };
  return (
    <div class="card">
      <strong>Flagged</strong>
      <p class="muted small">Answers you queried and things you flagged with ⚑, and what became of them.</p>
      {err && <p class="error small">{err}</p>}
      {items === null ? (
        <p class="muted small">Loading…</p>
      ) : items.length === 0 ? (
        <p class="muted small">Nothing flagged yet.</p>
      ) : (
        <ul class="list small flagged">
          {items.map((it) => {
            const o = outcome(it);
            return (
              <li key={`${it.source}${it.id}`}>
                <div class="muted">
                  {it.at.slice(0, 10)} · {it.where}
                </div>
                <div>{it.source === 'mark' ? <>“{it.what}” · you: {it.answer} · key: {it.expected}</> : <>“{it.what}”</>}</div>
                <div class={o.cls}>{o.text}</div>
                <details>
                  <summary class="muted">Claude’s answer</summary>
                  {it.explanation}
                </details>
                {it.source === 'page' && it.canApply && (
                  <button class="secondary" disabled={busy === it.id} onClick={() => apply(it.id)}>
                    {busy === it.id ? 'Saving…' : 'Apply the fix'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
