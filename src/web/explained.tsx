// Explanatory text (chat hints, correction notes, marking feedback) that may be written in the
// language being learnt: shown with pinyin / tappable words, plus a button that translates it
// into the learner's own language.
import { useEffect, useState } from 'preact/hooks';
import { api } from './api';
import { RubyText, useNativeLang } from './ruby';
import type { PinyinMode, Token } from '../core/pinyin/annotate';

const status = new Map<string, Promise<boolean>>();

/** Whether explanations for this study language are in that language (null while loading). */
export function useExplainTarget(lang: string): boolean | null {
  const [target, setTarget] = useState<boolean | null>(null);
  useEffect(() => {
    if (!status.has(lang))
      status.set(
        lang,
        api
          .explainStatus(lang)
          .then((r) => r.target)
          .catch(() => false),
      );
    let live = true;
    status.get(lang)!.then((t) => live && setTarget(t));
    return () => {
      live = false;
    };
  }, [lang]);
  return target;
}

/** Forget the cached answer (after Settings changes it). */
export function resetExplainStatus(): void {
  status.clear();
}

// Annotation requests made in the same tick go out together.
type Pending = { texts: Set<string>; waiters: ((a: Record<string, Token[]>) => void)[] };
const pending = new Map<string, Pending>();
const annCache = new Map<string, Token[]>();
function annotate(lang: string, text: string): Promise<Token[] | undefined> {
  const key = `${lang}\u0000${text}`;
  if (annCache.has(key)) return Promise.resolve(annCache.get(key));
  let p = pending.get(lang);
  if (!p) {
    p = { texts: new Set(), waiters: [] };
    pending.set(lang, p);
    queueMicrotask(() => {
      const batch = pending.get(lang)!;
      pending.delete(lang);
      api
        .annotateTexts(lang, [...batch.texts])
        .then((r) => batch.waiters.forEach((w) => w(r.annotations)))
        .catch(() => batch.waiters.forEach((w) => w({})));
    });
  }
  p.texts.add(text);
  return new Promise((resolve) =>
    p!.waiters.push((a) => {
      if (a[text]) annCache.set(key, a[text]!);
      resolve(a[text]);
    }),
  );
}

/**
 * A short explanation. In the language being learnt it gets pinyin (Chinese), tappable words and
 * a translate button; otherwise it is plain text.
 */
export function Explained({ text, lang, mode = 'smart', inTarget }: { text: string; lang: string; mode?: PinyinMode; inTarget?: boolean }) {
  const auto = useExplainTarget(lang);
  const target = inTarget ?? auto ?? false;
  const native = useNativeLang();
  const [tokens, setTokens] = useState<Token[] | undefined>(undefined);
  const [translation, setTranslation] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTokens(undefined);
    setTranslation(null);
    setOpen(false);
    if (target && text) annotate(lang, text).then(setTokens);
  }, [text, lang, target]);

  if (!target) return <span>{text}</span>;

  async function toggle(e: Event) {
    e.stopPropagation();
    if (open) return setOpen(false);
    setOpen(true);
    if (translation !== null) return;
    setBusy(true);
    try {
      setTranslation((await api.translateText(lang, text)).translation);
    } catch {
      setTranslation('(translation failed)');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span class="explained">
      {tokens ? <RubyText tokens={tokens} mode={mode} lang={lang} /> : <span>{text}</span>}{' '}
      <button type="button" class={`secondary icon tiny ${open ? 'on' : ''}`} onClick={toggle} aria-label={open ? `Hide ${native.english}` : `In ${native.english}`} title={native.english}>
        {native.label}
      </button>
      {open && <span class="explained-translation">{busy ? '…' : translation}</span>}
    </span>
  );
}
