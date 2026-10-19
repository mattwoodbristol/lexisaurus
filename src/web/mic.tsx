// Speech input with the browser's own recogniser (Web Speech API): free, no keys. Chrome sends
// the audio to Google's recogniser; Safari uses Apple's; Firefox has none, so the mic is hidden.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from './api';
import { stopSpeaking } from './speech';
import { useLangConfig } from './lang';
import { Zh } from './ruby';
import { SpeechError, speechErrorText, type ListenOptions, type SpeechProvider } from '../core/speech/provider';
import { compareSpoken, goodEnough, soundsFrom, type SpokenResult } from '../core/speech/compare';
import type { Token } from '../core/pinyin/annotate';

// The parts of the Web Speech recognition API used here (not in every TypeScript DOM lib).
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [i: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [i: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERROR_CODES: Record<string, SpeechError['code']> = {
  'not-allowed': 'not-allowed',
  'service-not-allowed': 'not-allowed',
  'no-speech': 'no-speech',
  network: 'network',
  aborted: 'aborted',
  'audio-capture': 'not-allowed',
};

export const webSpeech: SpeechProvider = {
  supported: () => !!recognitionClass(),
  listen(lang: string, opts: ListenOptions = {}) {
    const Rec = recognitionClass();
    if (!Rec) return Promise.reject(new SpeechError('unsupported'));
    return new Promise<string[]>((resolve, reject) => {
      const rec = new Rec();
      rec.lang = lang;
      rec.interimResults = true;
      rec.maxAlternatives = 5;
      rec.continuous = false;
      let final: string[] = [];
      let interim = '';
      let failed: SpeechError | null = null;
      rec.onresult = (e) => {
        interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]!;
          if (r.isFinal) {
            // One utterance: alternatives of the final result, best first.
            const alts: string[] = [];
            for (let k = 0; k < r.length; k++) alts.push(r[k]!.transcript.trim());
            final = final.length ? final.map((f, k) => `${f}${alts[k] ?? alts[0] ?? ''}`) : alts;
          } else interim += r[0]?.transcript ?? '';
        }
        opts.onInterim?.((final[0] ?? '') + interim);
      };
      rec.onerror = (e) => {
        failed = new SpeechError(ERROR_CODES[e.error] ?? 'other');
      };
      rec.onend = () => {
        const heard = final.length ? final : interim.trim() ? [interim.trim()] : [];
        if (heard.length) resolve(heard);
        else reject(failed ?? new SpeechError('no-speech'));
      };
      opts.signal?.addEventListener('abort', () => rec.stop());
      stopSpeaking(); // the recogniser would hear the device's own voice
      rec.start();
    });
  },
};

/** The speech provider in use. */
export const speech: SpeechProvider = webSpeech;

/**
 * 🎤 button: listen once in the screen's language. Tap again to stop early. Renders nothing when
 * the browser cannot listen.
 */
export function MicButton({
  onResult,
  onInterim,
  lang: langProp,
  small = false,
  label = 'Speak',
  disabled = false,
}: {
  onResult: (alternatives: string[]) => void;
  onInterim?: (text: string) => void;
  lang?: string;
  small?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const ctx = useLangConfig();
  const lang = langProp ?? ctx.speechRecognitionLang;
  const [on, setOn] = useState(false);
  const [err, setErr] = useState('');
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);
  if (!speech.supported(lang)) return null;
  async function toggle() {
    if (on) {
      stop.current?.abort();
      return;
    }
    setErr('');
    setOn(true);
    stop.current = new AbortController();
    try {
      onResult(await speech.listen(lang, { onInterim, signal: stop.current.signal }));
    } catch (e) {
      setErr(e instanceof SpeechError ? speechErrorText(e.code) : 'Listening failed. Try again.');
    } finally {
      setOn(false);
    }
  }
  return (
    <>
      <button
        type="button"
        class={`mic ${small ? 'small' : ''} ${on ? 'on' : ''}`}
        disabled={disabled}
        aria-label={on ? 'Stop listening' : label}
        title={on ? 'Listening… tap to stop' : label}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        {on ? '■' : '🎤'}
      </button>
      {err && <span class="error small mic-error">{err}</span>}
    </>
  );
}

/** Whether the screen's language can be spoken into on this device. */
export function useCanListen(): boolean {
  return speech.supported(useLangConfig().speechRecognitionLang);
}

/**
 * Say a target sentence aloud and see what the recogniser understood: each character (or word)
 * of the target marked heard or not, and for Chinese what it heard, with pinyin, so a wrong tone
 * that became a different word shows up.
 */
export function SayIt({ target, label = 'Say it', onResult }: { target: string; label?: string; onResult?: (r: SpokenResult) => void }) {
  const config = useLangConfig();
  const [res, setRes] = useState<SpokenResult | null>(null);
  const [live, setLive] = useState('');
  const [ann, setAnn] = useState<Record<string, Token[]>>({});
  useEffect(() => {
    setRes(null);
    setLive('');
  }, [target]);
  if (!speech.supported(config.speechRecognitionLang)) return null;
  return (
    <div class="say-it">
      <div class="row">
        <MicButton
          small
          label={label}
          onInterim={setLive}
          onResult={(alts) => {
            const r = compareSpoken(config.script, target, alts);
            setRes(r);
            setLive('');
            onResult?.(r);
            if (config.hasRomanisation && !r.match)
              api
                .annotateTexts(config.id, [target, r.heard])
                .then((a) => {
                  setAnn(a.annotations);
                  // The recogniser may have written a character that sounds the same: count it.
                  const sounds = soundsFrom([...(a.annotations[target] ?? []), ...(a.annotations[r.heard] ?? [])]);
                  const better = compareSpoken(config.script, target, [r.heard], sounds);
                  if (better.score > r.score) {
                    setRes(better);
                    onResult?.(better);
                  }
                })
                .catch(() => {});
          }}
        />
        <span class="muted small">{live || (res ? '' : label)}</span>
      </div>
      {res && (
        <div class="spoken" role="status">
          <div class="spoken-parts" aria-label={goodEnough(res) ? 'Understood' : 'Parts not understood are marked'}>
            {goodEnough(res) ? '✓ ' : ''}
            {res.parts.map((p, i) => (
              <span key={i} class={p.ok ? 'heard' : p.close ? 'close' : 'missed'} title={p.close ? 'Heard in another tone' : undefined}>
                {p.text}
              </span>
            ))}
          </div>
          {!res.match && goodEnough(res) && <div class="small muted">Close enough: speech recognition often mishears a word or two.</div>}
          {!res.match && (
            <div class="small">
              Heard: {res.heard ? <Zh text={res.heard} ann={ann} mode="all" force /> : <span class="muted">nothing</span>}
              {config.hasRomanisation && ann[target] && (
                <div class="muted">
                  Target: <Zh text={target} ann={ann} mode="all" force />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
