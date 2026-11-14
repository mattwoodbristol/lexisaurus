// Speech input with the browser's own recogniser (Web Speech API): free, no keys. Chrome sends
// the audio to Google's recogniser; Safari uses Apple's; Firefox has none, so the mic is hidden.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from './api';
import { stopSpeaking } from './speech';
import { useLangConfig } from './lang';
import { Zh } from './ruby';
import { SpeechError, speechErrorText, type ListenOptions, type SpeechProvider } from '../core/speech/provider';
import { blankPart, compareSpoken, goodEnough, hintShown, soundsFrom, type SpokenResult } from '../core/speech/compare';
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
      const began = Date.now();
      let final: string[] = [];
      let stopped = false;
      let current: Recognition | null = null;
      // Joins one turn's alternatives onto what earlier turns heard, best with best.
      const join = (before: string[], alts: string[]) => (before.length ? before.map((f, k) => `${f}${alts[k] ?? alts[0] ?? ''}`) : alts);
      // One turn of the recogniser. It ends on a pause (or after a few seconds of silence); another
      // turn follows while the learner has not started yet (waitMs), or has not finished (complete).
      const turn = () => {
        const rec = new Rec();
        current = rec;
        rec.lang = lang;
        rec.interimResults = true;
        rec.maxAlternatives = 5;
        rec.continuous = false;
        let got: string[] = [];
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
              got = join(got, alts);
            } else interim += r[0]?.transcript ?? '';
          }
          opts.onInterim?.((join(final, got)[0] ?? '') + interim);
        };
        rec.onerror = (e) => {
          failed = new SpeechError(ERROR_CODES[e.error] ?? 'other');
        };
        rec.onend = () => {
          const heard = got.length ? got : interim.trim() ? [interim.trim()] : [];
          if (heard.length) final = join(final, heard);
          const silent = !failed || failed.code === 'no-speech';
          if (!stopped && silent && Date.now() - began < MAX_LISTEN_MS) {
            if (!final.length && Date.now() - began < (opts.waitMs ?? 0)) return turn();
            if (heard.length && opts.complete && !opts.complete(final)) return turn();
          }
          if (final.length) resolve(final);
          else reject(failed ?? new SpeechError('no-speech'));
        };
        try {
          rec.start();
        } catch {
          // A recogniser that will not start again: keep what earlier turns heard.
          if (final.length) resolve(final);
          else reject(new SpeechError('other'));
        }
      };
      opts.signal?.addEventListener('abort', () => {
        stopped = true;
        current?.stop();
      });
      stopSpeaking(); // the recogniser would hear the device's own voice
      turn();
    });
  },
};

/** How long the mic waits for the learner to start speaking (the recogniser alone gives up after a few seconds). */
const WAIT_TO_SPEAK_MS = 15_000;
/** Longest a listen goes on for, however many turns it takes. */
const MAX_LISTEN_MS = 45_000;

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
  complete,
}: {
  onResult: (alternatives: string[]) => void;
  onInterim?: (text: string) => void;
  lang?: string;
  small?: boolean;
  label?: string;
  disabled?: boolean;
  /** Whether what was heard is all of it: until then a pause does not stop listening. */
  complete?: (heard: string[]) => boolean;
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
      onResult(await speech.listen(lang, { onInterim, signal: stop.current.signal, waitMs: WAIT_TO_SPEAK_MS, ...(complete ? { complete } : {}) }));
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
 * that became a different word shows up. `hidden`: the target is the answer and not shown yet, so
 * a miss shows only what was heard, and the mic stays ready for another try. `accept`: whether a
 * try counts as right (default: nearly all of it understood). `onResult` gets each try's number.
 * While hidden, each miss shows a hint: the sentence with the parts said right so far and a few
 * more uncovered, the rest blanked; the tested word (`keep`) stays blank until said right.
 */
export function SayIt({
  target,
  label = 'Say it',
  onResult,
  hidden = false,
  accept = goodEnough,
  keep,
}: {
  target: string;
  label?: string;
  onResult?: (r: SpokenResult, attempt: number) => void;
  hidden?: boolean;
  accept?: (r: SpokenResult) => boolean;
  keep?: string;
}) {
  const config = useLangConfig();
  const [res, setRes] = useState<SpokenResult | null>(null);
  const [live, setLive] = useState('');
  const [ann, setAnn] = useState<Record<string, Token[]>>({});
  const attempts = useRef(0);
  /** The hint after a miss: which parts of the target show (the rest blanked). */
  const [hint, setHint] = useState<{ parts: SpokenResult['parts']; shown: Set<number> } | null>(null);
  useEffect(() => {
    setRes(null);
    setLive('');
    setHint(null);
    attempts.current = 0;
  }, [target]);
  if (!speech.supported(config.speechRecognitionLang)) return null;
  const ok = !!res && accept(res);
  const retry = hidden && !!res && !ok;
  return (
    <div class="say-it">
      <div class="row">
        <MicButton
          small
          label={retry ? 'Try again' : label}
          onInterim={setLive}
          // A pause to think does not end the try while the sentence is not all there yet.
          complete={(alts) => goodEnough(compareSpoken(config.script, target, alts))}
          onResult={(alts) => {
            const attempt = ++attempts.current;
            const r = compareSpoken(config.script, target, alts);
            setRes(r);
            setLive('');
            if (hidden && !accept(r)) setHint((h) => ({ parts: r.parts, shown: hintShown(config.script, r.parts, h?.shown ?? new Set(), keep) }));
            onResult?.(r, attempt);
            if (config.hasRomanisation && !r.match)
              api
                .annotateTexts(config.id, [target, r.heard])
                .then((a) => {
                  setAnn(a.annotations);
                  // The recogniser may have written a character that sounds the same: count it.
                  const sounds = soundsFrom([...(a.annotations[target] ?? []), ...(a.annotations[r.heard] ?? [])]);
                  const better = compareSpoken(config.script, target, [r.heard], sounds);
                  if (better.score > r.score && attempts.current === attempt) {
                    setRes(better);
                    onResult?.(better, attempt);
                  }
                })
                .catch(() => {});
          }}
        />
        <span class="muted small">{live || (retry ? 'Not quite. Tap the mic to try again, or show the answer.' : res ? '' : label)}</span>
      </div>
      {res && retry && (
        <div class="spoken small" role="status">
          Heard: {res.heard ? <Zh text={res.heard} ann={ann} mode="all" force /> : <span class="muted">nothing</span>}
        </div>
      )}
      {hidden && hint && (
        <div class="spoken-hint" aria-label="Hint: part of the sentence">
          <span class="muted small">Hint: </span>
          {hint.parts.map((p, i) => (hint.shown.has(i) ? <span key={i}>{p.text}</span> : <span key={i} class="hint-blank">{blankPart(config.script, p.text)}</span>))}
        </div>
      )}
      {res && !retry && (
        <div class="spoken" role="status">
          <div class="spoken-parts" aria-label={ok ? 'Understood' : 'Parts not understood are marked'}>
            {ok ? '✓ ' : ''}
            {res.parts.map((p, i) => (
              <span key={i} class={p.ok ? 'heard' : p.close ? 'close' : 'missed'} title={p.close ? 'Heard in another tone' : undefined}>
                {p.text}
              </span>
            ))}
          </div>
          {!res.match && ok && <div class="small muted">Close enough: speech recognition often mishears a word or two.</div>}
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
