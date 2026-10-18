// Audio for Chinese phrases with the device's own text-to-speech (Web Speech API): free, offline
// where the voice is installed, no keys. Rate comes from the speech.rate setting.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from './api';
import { useLangConfig } from './lang';
import { pickVoice, rankVoices } from '../core/speech/voice';

export { pickVoice };

export const SPEECH_RATES: { value: number; label: string }[] = [
  { value: 0.6, label: 'Slow' },
  { value: 0.85, label: 'Learner' },
  { value: 1, label: 'Natural' },
  // Rate 1 is the engine's own default, which is slow for some Mandarin voices.
  { value: 1.3, label: 'Fast' },
];
export const DEFAULT_RATE = 0.85;

let rate = DEFAULT_RATE;
let rateLoaded = false;
let playing: { text: string; stop: () => void } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const synth = (): SpeechSynthesis | null => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);

function voicesNow(): SpeechSynthesisVoice[] {
  return synth()?.getVoices() ?? [];
}

export function setSpeechRate(r: number): void {
  rate = r;
}

export function stopSpeaking(): void {
  synth()?.cancel();
  playing = null;
  notify();
}

/** Speak a phrase; tapping the same phrase again stops it. */
export function speak(text: string, lang = 'zh-CN'): void {
  const s = synth();
  if (!s || !text.trim()) return;
  if (playing?.text === text) return stopSpeaking();
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const v = pickVoice(voicesNow(), lang);
  if (v) u.voice = v;
  u.rate = rate;
  const done = () => {
    if (playing?.text === text) {
      playing = null;
      notify();
    }
  };
  u.onend = done;
  u.onerror = done;
  playing = { text, stop: () => s.cancel() };
  notify();
  s.speak(u);
}

/**
 * Read lines one after another (a listening passage), with a short pause between them. `voice`
 * picks the n-th installed voice for the language, so two speakers can sound different; with only
 * one voice the second speaker is pitched lower. Stops when anything else is spoken or stopped.
 */
export function playLines(lines: { text: string; voice?: number }[], lang: string, opts: { from?: number; onLine?: (i: number | null) => void; rate?: number } = {}): () => void {
  const s = synth();
  if (!s || !lines.length) return () => {};
  s.cancel();
  const voices = rankVoices(voicesNow(), lang);
  // Not a phrase any 🔊 button shows, so none lights up while the passage plays.
  const mine = { text: `lines:${lines.map((l) => l.text).join('|')}`, stop: () => s.cancel() };
  playing = mine;
  notify();
  let timer: number | undefined;
  const end = () => {
    clearTimeout(timer);
    if (playing === mine) {
      playing = null;
      notify();
    }
    opts.onLine?.(null);
  };
  const say = (i: number) => {
    if (playing !== mine) return opts.onLine?.(null);
    const line = lines[i];
    if (!line) return end();
    opts.onLine?.(i);
    const u = new SpeechSynthesisUtterance(line.text);
    u.lang = lang;
    const n = line.voice ?? 0;
    const v = voices[n % Math.max(voices.length, 1)];
    if (v) u.voice = v;
    if (n > 0 && voices.length < 2) u.pitch = 0.75;
    u.rate = opts.rate ?? rate;
    u.onend = () => {
      // A shorter pause between lines at faster speeds, so the gaps keep pace with the speech.
      timer = window.setTimeout(() => say(i + 1), Math.round(400 / (opts.rate ?? rate)));
    };
    u.onerror = () => end();
    s.speak(u);
  };
  say(opts.from ?? 0);
  return () => {
    if (playing === mine) stopSpeaking();
    end();
  };
}

/** The speech rate from the speech.rate setting (or the default until it has loaded). */
export function speechRate(): number {
  return rate;
}

/** Whether a voice for the language is available (voices load asynchronously on some browsers). */
export function useCanSpeak(lang = 'zh-CN'): boolean {
  const [ok, setOk] = useState(() => !!pickVoice(voicesNow(), lang));
  useEffect(() => {
    const s = synth();
    if (!s) return;
    const check = () => setOk(!!pickVoice(s.getVoices(), lang));
    check();
    s.addEventListener('voiceschanged', check);
    if (!rateLoaded) {
      rateLoaded = true;
      api
        .settings()
        .then((st) => {
          const r = Number(st['speech.rate']);
          if (Number.isFinite(r) && r > 0) rate = r;
        })
        .catch(() => {});
    }
    return () => s.removeEventListener('voiceschanged', check);
  }, [lang]);
  return ok;
}

function usePlaying(text: string): boolean {
  const [on, setOn] = useState(playing?.text === text);
  useEffect(() => {
    const l = () => setOn(playing?.text === text);
    listeners.add(l);
    l();
    return () => {
      listeners.delete(l);
    };
  }, [text]);
  return on;
}

// Auto-play (setting review.autoplay, on by default): review prompts, and answers as they are
// revealed in reviews and lessons. Loaded once; null until known, so nothing plays early.
let autoplay: boolean | null = null;
let autoplayLoading = false;
const autoplayListeners = new Set<() => void>();
export function setAutoplay(on: boolean): void {
  autoplay = on;
  autoplayListeners.forEach((l) => l());
}
export function useAutoplay(): boolean | null {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    autoplayListeners.add(l);
    if (autoplay === null && !autoplayLoading) {
      autoplayLoading = true;
      api
        .settings()
        .then((s) => setAutoplay(s['review.autoplay'] !== false))
        .catch(() => setAutoplay(true))
        .finally(() => (autoplayLoading = false));
    }
    return () => {
      autoplayListeners.delete(l);
    };
  }, []);
  return autoplay;
}

/** Say `text` once when it appears (an answer just revealed), if auto-play is on. */
export function useAutoSpeak(text: string | null | undefined, langProp?: string): void {
  const ctx = useLangConfig();
  const lang = langProp ?? ctx.ttsLang;
  const can = useCanSpeak(lang);
  const on = useAutoplay();
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (!text) {
      said.current = null;
      return;
    }
    if (!on || !can || said.current === text) return;
    said.current = text;
    if (playing?.text !== text) speak(text, lang);
  }, [text, on, can]);
}

/** 🔊 button for one phrase. Renders nothing when the device has no voice for the language. */
export function SpeakButton({ text, lang: langProp, small = false, auto = false }: { text: string; lang?: string; small?: boolean; /** Play once as it appears (auto-play). */ auto?: boolean }) {
  const ctx = useLangConfig(); // always called: hooks must run in the same order every render
  const lang = langProp ?? ctx.ttsLang;
  const can = useCanSpeak(lang);
  const on = usePlaying(text);
  useAutoSpeak(auto ? text : null, lang);
  if (!can || !text.trim()) return null;
  return (
    <button
      type="button"
      class={`speak ${small ? 'small' : ''} ${on ? 'on' : ''}`}
      aria-label={on ? 'Stop audio' : 'Play audio'}
      title={on ? 'Stop' : 'Listen'}
      onClick={(e) => {
        e.stopPropagation(); // e.g. inside a drill button
        speak(text, lang);
      }}
    >
      {on ? '■' : '🔊'}
    </button>
  );
}
