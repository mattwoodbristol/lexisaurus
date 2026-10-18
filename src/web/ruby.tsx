import { useContext, useEffect, useState } from 'preact/hooks';
import { LangContext } from './lang';
import { getLanguage } from '../core/languages';
import { api } from './api';
import { openWord } from './word-sheet';
import { DEFAULT_NATIVE, nativeLabel, nativeLanguage, type NativeLanguage } from '../core/languages/native';
import { showPinyin, isPinyinMode, nextPinyinMode, type PinyinMode, type Token } from '../core/pinyin/annotate';

export const MODE_LABEL: Record<PinyinMode, string> = { off: 'Off', smart: 'Smart', all: 'All' };

/**
 * Ruby rendering. `force` shows pinyin on every word regardless of mode (the 拼 button / `p`).
 * Every word can be tapped for its meaning unless `tap` is false, or a function that returns
 * false for it (a review prompt keeps the word being tested locked until the answer shows).
 */
export function RubyText({
  tokens,
  mode,
  force = false,
  big = false,
  tap = true,
  lang,
}: {
  tokens: Token[];
  mode: PinyinMode;
  force?: boolean;
  big?: boolean;
  tap?: boolean | ((t: Token) => boolean);
  lang?: string;
}) {
  const ctxLang = useContext(LangContext);
  const id = lang ?? ctxLang;
  const config = getLanguage(id) ?? getLanguage('zh')!;
  const context = tokens.map((t) => t.text).join('');
  const open = (t: Token) => (e: Event) => {
    e.stopPropagation(); // a word inside a drill button must not also toggle the drill
    e.preventDefault();
    openWord({ lang: id, text: t.text, pinyin: t.pinyin, context });
  };
  const onKey = (t: Token) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') open(t)(e);
  };
  return (
    <span class={`ruby-text${big ? ' big' : ''}${config.script === 'latin' ? ' latin' : ''}`} lang={config.id === 'zh' ? 'zh-Hans' : config.id}>
      {tokens.map((t, i) => {
        if (!t.status) return <span key={i}>{t.text}</span>;
        // Words not in the list are underlined only where the list is meant to cover them (Mandarin).
        const mark = t.status !== 'unknown' || config.markUnknownWords;
        const canTap = typeof tap === 'function' ? tap(t) : tap;
        const cls = `w${mark ? ` w-${t.status}` : ''}${canTap ? ' tap' : ' locked'}`;
        const props = canTap ? { onClick: open(t), onKeyDown: onKey(t), role: 'button' as const, tabIndex: 0 } : {};
        if (force || showPinyin(t, mode)) {
          return (
            <ruby key={i} class={cls} {...props}>
              {t.text}
              <rt>{t.pinyin}</rt>
            </ruby>
          );
        }
        return (
          <span key={i} class={cls} {...props}>
            {t.text}
          </span>
        );
      })}
    </span>
  );
}

/** Text that may contain Chinese: rendered with ruby if the server sent annotations for it. */
export function Zh({
  text,
  ann,
  mode,
  force,
  big,
  tap,
}: {
  text: string;
  ann: Record<string, Token[]>;
  mode: PinyinMode;
  force?: boolean;
  big?: boolean;
  tap?: boolean | ((t: Token) => boolean);
}) {
  const tokens = ann[text];
  return tokens ? <RubyText tokens={tokens} mode={mode} force={force} big={big} tap={tap} /> : <span>{text}</span>;
}

/** The persisted per-language pinyin mode, shared by chat, lessons and review. */
export function usePinyinMode(lang = 'zh'): [PinyinMode, () => void] {
  const [mode, setMode] = useState<PinyinMode>('smart');
  const key = `${lang}.pinyin_mode`;
  useEffect(() => {
    api
      .settings()
      .then((s) => isPinyinMode(s[key]) && setMode(s[key]))
      .catch(() => {});
  }, [key]);
  const cycle = () => {
    const next = nextPinyinMode(mode);
    setMode(next);
    api.putSetting(key, next).catch(() => {});
  };
  return [mode, cycle];
}

export function PinyinToggle({ mode, onCycle }: { mode: PinyinMode; onCycle: () => void }) {
  const config = getLanguage(useContext(LangContext));
  if (config && !config.hasRomanisation) return null; // pinyin is for Chinese only
  return (
    <button class="secondary" onClick={onCycle} aria-label={`Pinyin mode: ${MODE_LABEL[mode]}. Tap to change.`}>
      拼音 · {MODE_LABEL[mode]}
    </button>
  );
}

/** The learner's own language (setting native_lang): the translate button's target and label. */
export function useNativeLang(): NativeLanguage & { label: string } {
  const [code, setCode] = useState<string>(DEFAULT_NATIVE);
  useEffect(() => {
    api
      .settings()
      .then((s) => typeof s['native_lang'] === 'string' && setCode(s['native_lang'] as string))
      .catch(() => {});
  }, []);
  const lang = nativeLanguage(code);
  return { ...lang, label: nativeLabel(code) };
}
