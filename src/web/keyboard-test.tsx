// Diagnostics for the "keyboard language picker closes at once" report: three inputs set up
// differently, plus a live log of every focus, keyboard, composition and viewport event.
// Open /#/keyboard-test (no login needed), long-press space in each box, then screenshot the log.
import { useEffect, useRef, useState } from 'preact/hooks';

interface Entry {
  t: number;
  box: string;
  ev: string;
  detail: string;
}

export function KeyboardTest() {
  const [log, setLog] = useState<Entry[]>([]);
  const [controlled, setControlled] = useState('');
  const [plainControlled, setPlainControlled] = useState('');
  const start = useRef(performance.now());
  const add = (box: string, ev: string, detail = '') => {
    const t = Math.round(performance.now() - start.current);
    setLog((l) => [{ t, box, ev, detail }, ...l].slice(0, 200));
  };

  useEffect(() => {
    const onWin = (e: Event) => add('window', e.type, e.type === 'visibilitychange' ? document.visibilityState : '');
    const onDoc = (e: Event) => add('doc', e.type, `active=${(document.activeElement as HTMLElement | null)?.dataset?.box ?? document.activeElement?.tagName ?? ''}`);
    const vv = window.visualViewport;
    const onVv = () => add('viewport', 'resize', vv ? `${Math.round(vv.width)}x${Math.round(vv.height)}` : '');
    window.addEventListener('blur', onWin);
    window.addEventListener('focus', onWin);
    window.addEventListener('resize', onWin);
    document.addEventListener('visibilitychange', onWin);
    document.addEventListener('focusout', onDoc);
    vv?.addEventListener('resize', onVv);
    return () => {
      window.removeEventListener('blur', onWin);
      window.removeEventListener('focus', onWin);
      window.removeEventListener('resize', onWin);
      document.removeEventListener('visibilitychange', onWin);
      document.removeEventListener('focusout', onDoc);
      vv?.removeEventListener('resize', onVv);
    };
  }, []);

  // Native listeners, so the log shows exactly what the keyboard sends, in order.
  const watch = (box: string) => (el: HTMLInputElement | null) => {
    if (!el || el.dataset.watched) return;
    el.dataset.watched = '1';
    el.dataset.box = box;
    el.addEventListener('focus', () => add(box, 'focus'));
    el.addEventListener('blur', () => add(box, 'blur'));
    el.addEventListener('keydown', (e) => add(box, 'keydown', `key=${JSON.stringify(e.key)} code=${e.keyCode}${e.repeat ? ' repeat' : ''}`));
    el.addEventListener('keyup', (e) => add(box, 'keyup', `key=${JSON.stringify(e.key)} code=${e.keyCode}`));
    el.addEventListener('beforeinput', (e) => add(box, 'beforeinput', `${e.inputType} ${JSON.stringify(e.data)}`));
    el.addEventListener('input', () => add(box, 'input', JSON.stringify(el.value)));
    el.addEventListener('compositionstart', () => add(box, 'compositionstart'));
    el.addEventListener('compositionend', (e) => add(box, 'compositionend', JSON.stringify(e.data)));
    el.addEventListener('select', () => add(box, 'select'));
  };

  const copy = () => {
    const text = log
      .slice()
      .reverse()
      .map((e) => `${e.t}\t${e.box}\t${e.ev}\t${e.detail}`)
      .join('\n');
    navigator.clipboard?.writeText(`${navigator.userAgent}\n${text}`).then(
      () => add('page', 'copied'),
      () => add('page', 'copy failed'),
    );
  };

  return (
    <div class="kbtest">
      <h1>Keyboard test</h1>
      <p class="muted small">Long-press the space bar in each box and try to change the keyboard language. Note which boxes work, then tap Copy log and paste it to Claude.</p>

      <label class="label">A. Plain box, not controlled by the app</label>
      <input ref={watch('A')} placeholder="A: plain" />

      <label class="label">B. Like the chat box (controlled, autocomplete off)</label>
      <input
        ref={watch('B')}
        type="text"
        value={controlled}
        placeholder="B: like chat"
        autocomplete="off"
        autocapitalize="off"
        enterkeyhint="send"
        onInput={(e) => setControlled((e.target as HTMLInputElement).value)}
      />

      <label class="label">C. Controlled, no extra settings</label>
      <input ref={watch('C')} value={plainControlled} placeholder="C: controlled" onInput={(e) => setPlainControlled((e.target as HTMLInputElement).value)} />

      <div class="row">
        <button onClick={copy}>Copy log</button>
        <button class="secondary" onClick={() => setLog([])}>
          Clear
        </button>
        <a class="small" href="#/">
          Back to the app
        </a>
      </div>
      <pre class="kblog">
        {log.map((e) => `${String(e.t).padStart(6)}  ${e.box.padEnd(8)} ${e.ev} ${e.detail}`).join('\n')}
      </pre>
    </div>
  );
}
