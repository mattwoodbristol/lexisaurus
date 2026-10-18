// First run: pick languages, your own language and (optionally) a few lines about you, then the
// level check. Shown until setting setup.done is true (installs with words already have it).
import { useState } from 'preact/hooks';
import { api, errorText } from './api';
import { allLanguages, setEnabledLanguages } from './lang';
import { NATIVE_LANGUAGES } from '../core/languages/native';
import { Lexi } from './mascot/lexi';

export function Welcome({ onDone }: { onDone: (takeLevelCheck: boolean) => void }) {
  const languages = allLanguages();
  const [chosen, setChosen] = useState<string[]>(languages.length ? [languages[0]!.id] : []);
  const [native, setNative] = useState('en');
  const [about, setAbout] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function toggle(id: string) {
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  async function finish(takeLevelCheck: boolean) {
    if (!chosen.length) return setErr('Choose at least one language.');
    setBusy(true);
    setErr('');
    try {
      await setEnabledLanguages(chosen);
      await Promise.all([
        api.putSetting('ui.lang', chosen[0]),
        api.putSetting('native_lang', native),
        about.trim() ? api.putSetting('learner.about', about.trim().slice(0, 1000)) : Promise.resolve(),
      ]);
      await api.putSetting('setup.done', true);
      onDone(takeLevelCheck);
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div class="welcome">
      <div class="row">
        <Lexi stage="adult" mood="happy" size={72} />
        <div class="grow">
          <h1>Welcome</h1>
          <p class="muted small">A few questions, then a short level check so lessons and chats start at the right level.</p>
        </div>
      </div>

      <div class="card">
        <strong>What do you want to learn?</strong>
        {languages.map((l) => (
          <label key={l.id} class="check">
            <input type="checkbox" checked={chosen.includes(l.id)} onChange={() => toggle(l.id)} />
            <span>
              {l.name} <span class="muted">{l.nativeName}</span>
            </span>
          </label>
        ))}
        <p class="muted small">You can switch languages on or off later in Settings.</p>
      </div>

      <label class="card">
        <strong>Your own language</strong>
        <span class="muted small">Translations and explanations use it.</span>
        <select value={native} onChange={(e) => setNative((e.target as HTMLSelectElement).value)}>
          {NATIVE_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>

      <label class="card">
        <strong>About you (optional)</strong>
        <span class="muted small">Where you live, your work, interests, people in your life. Lessons use it for examples and Lexi for chat topics.</span>
        <textarea rows={3} maxLength={1000} value={about} placeholder="e.g. I live in Leeds, work as a nurse, cycle at weekends and have two cats." onInput={(e) => setAbout((e.target as HTMLTextAreaElement).value)} />
      </label>

      {err && <p class="error">{err}</p>}
      <button disabled={busy} onClick={() => finish(true)}>
        Take the level check
      </button>
      <button class="secondary" disabled={busy} onClick={() => finish(false)}>
        Skip for now
      </button>
    </div>
  );
}
