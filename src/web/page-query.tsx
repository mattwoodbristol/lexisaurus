// "Query this page": a small flag on every screen. The learner says what looks wrong; Claude checks
// what is on screen and, on a lesson, may offer corrected examples or drills to apply.
import { useState } from 'preact/hooks';
import { api, errorText, type PageQueryResult } from './api';
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

export function PageQuery({ screen, lessonId }: { screen: string; lessonId?: number }) {
  const { lang } = useStudyLang();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<PageQueryResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
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
      setRes(await api.queryPage({ lang, screen, ...(lessonId ? { lessonId } : {}), text, note: note.trim() }));
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
      setApplied(true);
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
            placeholder={lessonId ? 'e.g. The examples don’t use the imperfect subjunctive' : 'What looks wrong?'}
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
              <div class="muted">Corrected {[f.examples && 'examples', f.drills && 'drills', f.keyPoints && 'key points', f.explanation && 'explanation'].filter(Boolean).join(', ')}:</div>
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
            </div>
          )}
          {applied && <div class="right small">Lesson updated. Reopen it to see the change.</div>}
          <div class="row">
            {f && !applied && (
              <button disabled={busy} onClick={apply}>
                {busy ? 'Saving…' : 'Fix the lesson'}
              </button>
            )}
            {applied ? (
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
