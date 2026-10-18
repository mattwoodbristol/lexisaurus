// Tap-to-translate: tapping a Chinese word opens a bottom sheet with its pinyin, meaning and a
// character breakdown. One sheet for the whole app, opened through openWord().
import { useEffect, useState } from 'preact/hooks';
import { api, errorText, type WordLookup } from './api';
import { SpeakButton } from './speech';
import { getLanguage } from '../core/languages';

interface Target {
  lang: string;
  text: string;
  /** Pinyin already shown in the text, displayed while the lookup loads. */
  pinyin?: string;
  /** The sentence the word came from, so a missing gloss is written for this sense. */
  context?: string;
}

type Listener = (t: Target | null) => void;
let listener: Listener | null = null;
const cache = new Map<string, WordLookup>();

export function openWord(t: Target): void {
  listener?.(t);
}

const STATUS_LABEL: Record<WordLookup['status'], string> = {
  known: 'Known',
  learning: 'Learning',
  new: 'In your pool',
  unknown: 'Not in your list',
};

export function WordSheet() {
  const [target, setTarget] = useState<Target | null>(null);
  const [data, setData] = useState<WordLookup | null>(null);
  const [err, setErr] = useState('');
  const [learning, setLearning] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    listener = setTarget;
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    setErr('');
    setAdded(false);
    if (!target) {
      setData(null);
      return;
    }
    const key = `${target.lang}:${target.text}`;
    const hit = cache.get(key);
    if (hit) {
      setData(hit);
      return;
    }
    setData(null);
    let live = true;
    api
      .lookup(target.lang, target.text, target.context)
      .then((r) => {
        if (r.gloss) cache.set(key, r);
        if (live) setData(r);
      })
      .catch((e) => live && setErr(errorText(e)));
    return () => {
      live = false;
    };
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTarget(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target]);

  if (!target) return null;
  const config = getLanguage(target.lang) ?? getLanguage('zh')!;
  const reading = data?.reading ?? target.pinyin;

  // "Don't know this": the word becomes learning with a review card that skips the daily ration.
  async function learn() {
    if (!target || !data) return;
    setLearning(true);
    setErr('');
    try {
      // Latin scripts: add the dictionary word, remembering the form that was tapped.
      await api.learnWord(target.lang, data.lemma ?? target.text, data.lemma ? target.text : undefined);
      const updated = { ...data, status: 'learning' as const };
      cache.set(`${target.lang}:${target.text}`, updated);
      setData(updated);
      setAdded(true);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setLearning(false);
    }
  }
  return (
    <div class="sheet-backdrop" onClick={() => setTarget(null)}>
      <div class="sheet" role="dialog" aria-label={`Meaning of ${target.text}`} onClick={(e) => e.stopPropagation()}>
        <div class="row">
          <span class={`sheet-word${config.script === 'latin' ? ' latin' : ''}`} lang={config.id === 'zh' ? 'zh-Hans' : config.id}>
            {target.text}
          </span>
          <span class="sheet-reading">{reading ?? (data?.lemma && data.lemma !== data.text.toLowerCase() ? `→ ${data.lemma}` : '')}</span>
          <SpeakButton text={target.text} lang={config.ttsLang} />
          <span class="spacer" />
          <button class="secondary icon" onClick={() => setTarget(null)} aria-label="Close">
            ✕
          </button>
        </div>
        {err && <p class="error">{err}</p>}
        {!data && !err && <p class="muted">Looking up…</p>}
        {data && (
          <>
            <p class="sheet-gloss">
              {data.gloss ?? <span class="muted">{data.glossError === 'budget' ? 'No meaning available: daily budget reached.' : 'No meaning found.'}</span>}
            </p>
            {data.chars.length > 0 && (
              <ul class="sheet-chars">
                {data.chars.map((ch) => (
                  <li key={ch.char}>
                    <span class="sheet-char" lang="zh-Hans">
                      {ch.char}
                    </span>{' '}
                    <span class="muted">{ch.reading}</span> {ch.gloss && <span class="small">{ch.gloss}</span>}
                  </li>
                ))}
              </ul>
            )}
            <div class="row sheet-foot">
              <div class="muted small grow">
                {STATUS_LABEL[data.status]}
                {data.glossSource === 'claude' ? ' · meaning written by Claude' : ''}
              </div>
              {added ? (
                <span class="small">Added to your reviews</span>
              ) : (
                data.status !== 'learning' && (
                  <button class="secondary" onClick={learn} disabled={learning}>
                    Don’t know this
                  </button>
                )
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
