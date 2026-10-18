// Course: plan the next lessons with Claude, and download or upload the course as files (to edit
// by hand or with Claude elsewhere). Uploads are checked and previewed before anything is saved.
import { useState } from 'preact/hooks';
import { api, ApiError, errorText, type CoursePlan, type CourseSyncResult } from './api';
import { useStudyLang } from './lang';
import { readZip, writeZip, type FileMap } from '../core/course/zip';
import howTo from '../../docs/editing-with-claude.md?raw';
import format from '../../docs/course-packs.md?raw';

export function Course({ onBack, onLessons }: { onBack: () => void; onLessons: () => void }) {
  const { lang, config } = useStudyLang();
  return (
    <>
      <div class="row">
        <button class="secondary icon" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <h1 class="grow">{config.name} course</h1>
      </div>
      <PlanCard key={`plan-${lang}`} lang={lang} onLessons={onLessons} />
      <FilesCard key={`files-${lang}`} lang={lang} />
    </>
  );
}

/** Show the lines a sync reports, or the problems that stopped it. */
function SyncReport({ r }: { r: CourseSyncResult }) {
  if (!r.ok)
    return (
      <div class="error small">
        <p>Nothing was changed. Fix these first:</p>
        <ul>
          {r.problems.slice(0, 30).map((p, i) => (
            <li key={i}>{p}</li>
          ))}
          {r.problems.length > 30 && <li>…and {r.problems.length - 30} more</li>}
        </ul>
      </div>
    );
  return (
    <ul class="list small">
      {r.lines.map((l, i) => (
        <li key={i} class={l.startsWith('!') ? 'error' : ''}>
          {l.replace(/^! /, '')}
        </li>
      ))}
    </ul>
  );
}

function PlanCard({ lang, onLessons }: { lang: string; onLessons: () => void }) {
  const [goals, setGoals] = useState('');
  const [count, setCount] = useState(10);
  const [withTopics, setWithTopics] = useState(false);
  const [plan, setPlan] = useState<CoursePlan | null>(null);
  const [result, setResult] = useState<CourseSyncResult | null>(null);
  const [busy, setBusy] = useState<'' | 'drafting' | 'saving'>('');
  const [err, setErr] = useState('');

  async function draft(e: Event) {
    e.preventDefault();
    setBusy('drafting');
    setErr('');
    setResult(null);
    try {
      setPlan(await api.coursePlan(lang, goals, count, withTopics));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy('');
    }
  }

  async function use() {
    if (!plan) return;
    setBusy('saving');
    setErr('');
    try {
      const { files } = await api.courseFiles(lang);
      const manifest = JSON.parse(files['course.json'] ?? '{}') as { planned?: unknown };
      manifest.planned = plan.planned;
      files['course.json'] = JSON.stringify(manifest, null, 2) + '\n';
      if (plan.topics) files['topics.json'] = JSON.stringify(plan.topics, null, 2) + '\n';
      const r = await api.courseSync(lang, files, true);
      setResult(r);
      if (r.ok) setPlan(null);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <div class="card course-card">
      <strong>Plan the next lessons with Claude</strong>
      <p class="muted small">
        Say what you want to be able to do. Claude plans the next lessons from there, building on the ones you have done; each lesson is written when you reach it. The
        plan replaces lessons that are planned but not written yet. Lessons you already have stay as they are.
      </p>
      {!plan && (
        <form class="settings" onSubmit={draft}>
          <label>
            <div class="label">Your goals (optional)</div>
            <textarea
              rows={3}
              value={goals}
              placeholder="e.g. hold a conversation with my partner’s family, talk about my work, get through a holiday"
              onInput={(e) => setGoals((e.target as HTMLTextAreaElement).value)}
            />
          </label>
          <label>
            <div class="label">How many lessons</div>
            <input type="number" min={3} max={30} value={count} onInput={(e) => setCount(Number((e.target as HTMLInputElement).value) || 10)} />
          </label>
          <label class="check">
            <input type="checkbox" checked={withTopics} onChange={(e) => setWithTopics((e.target as HTMLInputElement).checked)} />
            <span>Also write new conversation topics (replaces the current ones)</span>
          </label>
          <button disabled={!!busy}>{busy === 'drafting' ? 'Drafting the plan… (up to a minute)' : 'Draft a plan'}</button>
        </form>
      )}
      {plan && (
        <>
          <ol class="plan-list small">
            {plan.planned.map((p) => (
              <li key={p.id}>
                <strong>{p.title}</strong> <span class="muted">· {p.level}</span>
                <div class="muted">{p.focus}</div>
              </li>
            ))}
          </ol>
          {plan.topics && <p class="small muted">Plus {plan.topics.length} new conversation topics: {plan.topics.map((t) => t.name).join(', ')}.</p>}
          <div class="row">
            <button onClick={use} disabled={!!busy}>
              {busy === 'saving' ? 'Saving…' : 'Use this plan'}
            </button>
            <button class="secondary" onClick={() => setPlan(null)} disabled={!!busy}>
              Change goals
            </button>
          </div>
        </>
      )}
      {result && <SyncReport r={result} />}
      {result?.ok && (
        <div class="row">
          <button class="secondary" onClick={onLessons}>
            Go to lessons
          </button>
        </div>
      )}
      {err && <p class="error">{err}</p>}
    </div>
  );
}

/** Pick out course files from what the learner chose: zips are opened, .md and .json taken as they are. */
async function readChosen(list: FileList): Promise<FileMap> {
  const out: FileMap = {};
  for (const f of Array.from(list)) {
    if (/\.zip$/i.test(f.name)) Object.assign(out, await readZip(new Uint8Array(await f.arrayBuffer())));
    else if (/\.(md|json)$/i.test(f.name)) out[f.name] = (await f.text()).replace(/^﻿/, '');
  }
  return out;
}

function FilesCard({ lang }: { lang: string }) {
  const [files, setFiles] = useState<FileMap | null>(null);
  const [names, setNames] = useState('');
  const [preview, setPreview] = useState<CourseSyncResult | null>(null);
  const [done, setDone] = useState<CourseSyncResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function download() {
    setBusy(true);
    setErr('');
    try {
      const { files } = await api.courseFiles(lang);
      const zip = writeZip({ 'HOW-TO-EDIT.md': howTo, 'FORMAT.md': format, ...files });
      const url = URL.createObjectURL(new Blob([zip.slice().buffer as ArrayBuffer], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `lexisaurus-${lang}-course.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function choose(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    setBusy(true);
    setErr('');
    setPreview(null);
    setDone(null);
    try {
      const chosen = await readChosen(input.files);
      if (!Object.keys(chosen).length) throw new Error('No course files found: choose a .zip, or lesson .md files, or a .json file from the course.');
      setFiles(chosen);
      setNames(Array.from(input.files, (f) => f.name).join(', '));
      setPreview(await api.courseSync(lang, chosen, false));
    } catch (e) {
      setErr(e instanceof ApiError || !(e instanceof Error) ? errorText(e) : e.message);
    } finally {
      setBusy(false);
      input.value = '';
    }
  }

  async function apply() {
    if (!files) return;
    setBusy(true);
    setErr('');
    try {
      setDone(await api.courseSync(lang, files, true));
      setPreview(null);
      setFiles(null);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="card course-card">
      <strong>Your course as files</strong>
      <p class="muted small">
        Download the course to change it yourself or with Claude: in claude.ai or the Claude app, attach the zip and say what you want (new lessons, more drills, topics
        about your life). The zip includes a guide Claude follows. Then upload what you get back: the whole zip, or only the lesson files that changed.
      </p>
      <div class="row">
        <button class="secondary" onClick={download} disabled={busy}>
          Download course files
        </button>
        <label class={`button-link ${busy ? 'disabled' : ''}`}>
          Upload course files
          <input type="file" accept=".zip,.md,.json,application/zip,application/json,text/markdown" multiple hidden disabled={busy} onChange={choose} />
        </label>
      </div>
      {busy && !preview && <p class="muted small">Working…</p>}
      {preview && (
        <>
          <p class="small">
            <strong>{names}</strong>
            {preview.ok && <span class="muted"> · {preview.whole ? 'a whole course' : 'changes to your course'}. Nothing is saved yet.</span>}
          </p>
          <SyncReport r={preview} />
          {preview.ok && (
            <div class="row">
              <button onClick={apply} disabled={busy}>
                {busy ? 'Saving…' : 'Apply these changes'}
              </button>
              <button class="secondary" onClick={() => setPreview(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}
      {done && (
        <>
          <p class="small">
            <strong>Saved.</strong> Your progress is kept.
          </p>
          <SyncReport r={done} />
        </>
      )}
      {err && <p class="error">{err}</p>}
    </div>
  );
}
