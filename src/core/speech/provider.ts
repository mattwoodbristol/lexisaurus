// Speech input behind an interface (SPEC 8.6), so a paid recogniser or pronunciation grader can
// replace the browser's without touching feature code. Core code has no DOM types.

export type SpeechErrorCode = 'unsupported' | 'not-allowed' | 'no-speech' | 'network' | 'aborted' | 'other';

export class SpeechError extends Error {
  constructor(public code: SpeechErrorCode) {
    super(code);
  }
}

export interface ListenOptions {
  /** Partial text while the learner is still speaking. */
  onInterim?: (text: string) => void;
  /** Abort stops listening; whatever was heard so far is returned. */
  signal?: AbortSignal;
}

export interface SpeechProvider {
  /** Can this device listen in the language (BCP 47 tag, e.g. 'zh-CN')? */
  supported(lang: string): boolean;
  /** Listen for one utterance; resolves with the recogniser's alternatives, best first. */
  listen(lang: string, opts?: ListenOptions): Promise<string[]>;
}

/** A sentence for the learner when listening fails. */
export function speechErrorText(code: SpeechErrorCode): string {
  switch (code) {
    case 'unsupported':
      return 'This browser cannot listen. Try Chrome.';
    case 'not-allowed':
      return 'The microphone is blocked. Allow it for this site in the browser settings.';
    case 'no-speech':
      return 'I didn’t hear anything. Tap the mic and speak.';
    case 'network':
      return 'Speech recognition needs an internet connection.';
    case 'aborted':
      return '';
    default:
      return 'Listening failed. Try again.';
  }
}
