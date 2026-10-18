// Choosing a device text-to-speech voice for a language.

/** The parts of a SpeechSynthesisVoice this needs (core code has no DOM types). */
export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
}

/** Installed voices for a BCP 47 tag, best first: exact match, then same language (mainland first for zh). */
export function rankVoices<V extends VoiceLike>(voices: V[], tag: string): V[] {
  const norm = (s: string) => s.replace('_', '-').toLowerCase();
  const want = norm(tag);
  const base = want.split('-')[0]!;
  const rank = (v: V) => (/hk|tw|yue/i.test(v.lang + v.name) ? 1 : 0) - (v.localService ? 0.1 : 0);
  const exact = voices.filter((v) => norm(v.lang) === want).sort((a, b) => rank(a) - rank(b));
  const same = voices.filter((v) => norm(v.lang) !== want && norm(v.lang).split('-')[0] === base).sort((a, b) => rank(a) - rank(b));
  return [...exact, ...same];
}

/** Best installed voice for a BCP 47 tag. */
export function pickVoice<V extends VoiceLike>(voices: V[], tag: string): V | null {
  return rankVoices(voices, tag)[0] ?? null;
}
