// The language being studied right now (setting ui.lang) and the languages switched on
// (setting languages.enabled). Screens read the current one; the home screen switches it.
import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { api } from './api';
import { DEFAULT_ENABLED, getLanguage, listLanguages, type LanguageConfig } from '../core/languages';

/** Language of the screen being shown (a chat or lesson uses its own language). */
export const LangContext = createContext<string>('zh');

export function useLangConfig(): LanguageConfig {
  return getLanguage(useContext(LangContext)) ?? getLanguage('zh')!;
}

let current = 'zh';
let enabled: string[] = [...DEFAULT_ENABLED];
let loaded = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function load(): void {
  if (loaded) return;
  loaded = true;
  api
    .settings()
    .then((s) => {
      const list = Array.isArray(s['languages.enabled']) ? (s['languages.enabled'] as unknown[]).filter((x): x is string => typeof x === 'string' && !!getLanguage(x)) : [];
      if (list.length) enabled = list;
      const ui = typeof s['ui.lang'] === 'string' ? (s['ui.lang'] as string) : null;
      current = ui && enabled.includes(ui) ? ui : enabled[0]!;
      notify();
    })
    .catch(() => {});
}

/** Current study language, the switched-on languages, and a switcher that is remembered. */
export function useStudyLang(): { lang: string; config: LanguageConfig; enabled: LanguageConfig[]; setLang: (id: string) => void } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    load();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return {
    lang: current,
    config: getLanguage(current) ?? getLanguage('zh')!,
    enabled: enabled.map((id) => getLanguage(id)).filter((l): l is LanguageConfig => !!l),
    setLang: (id: string) => {
      if (!enabled.includes(id) || id === current) return;
      current = id;
      notify();
      api.putSetting('ui.lang', id).catch(() => {});
    },
  };
}

/** For Settings: switch a language on or off (at least one stays on). */
export async function setEnabledLanguages(ids: string[]): Promise<void> {
  const valid = ids.filter((id) => !!getLanguage(id));
  enabled = valid.length ? valid : [...DEFAULT_ENABLED];
  if (!enabled.includes(current)) current = enabled[0]!;
  notify();
  await api.putSetting('languages.enabled', enabled);
}

export function allLanguages(): LanguageConfig[] {
  return listLanguages();
}

/** What the learner calls the language in an instruction: "Type it in Chinese / Italian". */
export function targetName(config: LanguageConfig): string {
  return config.id === 'zh' ? 'Chinese' : config.name;
}

/** The target-language name for the screen being shown. */
export function useTargetName(): string {
  return targetName(useLangConfig());
}
