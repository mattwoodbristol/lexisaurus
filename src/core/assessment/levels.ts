// Level check: difficulty bands, sampling, scoring and the level summary. Pure functions; the
// worker stores results and the app runs the questions.
//
// Bands are 1-6 in every language: Mandarin HSK 1..6 (7-9 folded into 6), others CEFR A1..C2.

export const BANDS = [1, 2, 3, 4, 5, 6] as const;
export type Band = (typeof BANDS)[number];
const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function bandLabel(lang: string, band: number): string {
  const b = Math.min(6, Math.max(1, Math.round(band)));
  return lang === 'zh' ? `HSK ${b}` : CEFR[b - 1]!;
}

/** Band from a lesson's level text: "HSK 3-4" -> 4 (the top of a range), "C1" -> 5. Null if none. */
export function parseBand(text: string | null | undefined): number | null {
  if (!text) return null;
  const hsk = /HSK\s*(\d)(?:\s*[-–]\s*(\d))?/i.exec(text);
  if (hsk) return Math.min(6, Number(hsk[2] ?? hsk[1]));
  const cefr = [...text.toUpperCase().matchAll(/\b([ABC][12])\b/g)].map((m) => CEFR.indexOf(m[1]!) + 1).filter((n) => n > 0);
  return cefr.length ? Math.max(...cefr) : null;
}

/** Seeded shuffle (mulberry32), so a check is reproducible from its seed. */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  let t = seed >>> 0 || 1;
  const rnd = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface ListWord {
  id: number;
  lemma: string;
  gloss: string | null;
  band: number;
}

/** Up to `perBand` of the learner's own words from each band, plus how many each band is short. */
export function sampleVocab(words: ListWord[], perBand: number, seed: number): { picked: ListWord[]; short: Record<number, number> } {
  const picked: ListWord[] = [];
  const short: Record<number, number> = {};
  for (const b of BANDS) {
    const inBand = seededShuffle(
      words.filter((w) => w.band === b && w.gloss),
      seed + b,
    ).slice(0, perBand);
    picked.push(...inBand);
    if (inBand.length < perBand) short[b] = perBand - inBand.length;
  }
  return { picked, short };
}

export interface VocabAnswer {
  band: number;
  pseudo: boolean;
  /** Said "I know it", and passed the meaning spot-check if one was asked. */
  known: boolean;
}

/**
 * Vocabulary band: the highest band where the learner knows at least 60% of words, after
 * correcting for guessing with the made-up words (known' = (known - falseAlarm) / (1 - falseAlarm)).
 */
export function estimateVocab(answers: VocabAnswer[]): { band: number; perBand: Record<number, number>; falseAlarm: number } {
  const pseudo = answers.filter((a) => a.pseudo);
  const falseAlarm = pseudo.length ? pseudo.filter((a) => a.known).length / pseudo.length : 0;
  const perBand: Record<number, number> = {};
  let band = 0;
  for (const b of BANDS) {
    const real = answers.filter((a) => !a.pseudo && a.band === b);
    if (!real.length) continue;
    const raw = real.filter((a) => a.known).length / real.length;
    const corrected = falseAlarm >= 1 ? 0 : Math.max(0, (raw - falseAlarm) / (1 - falseAlarm));
    perBand[b] = Math.round(corrected * 100) / 100;
    if (corrected >= 0.6) band = b;
  }
  return { band: Math.max(1, band), perBand, falseAlarm: Math.round(falseAlarm * 100) / 100 };
}

export interface GrammarAnswer {
  band: number;
  right: boolean;
  topic: string;
}

export const GRAMMAR_START: Band = 3;
export const GRAMMAR_MAX_ITEMS = 16;

/** Adaptive step: after each pair, two right moves up a band, two wrong moves down, one of each stays. */
export function nextGrammarBand(current: number, lastPair: boolean[]): number {
  const right = lastPair.filter(Boolean).length;
  if (right === lastPair.length && lastPair.length) return Math.min(6, current + 1);
  if (right === 0 && lastPair.length) return Math.max(1, current - 1);
  return current;
}

/** Grammar band: the highest band answered at 50% or better (two questions or more), and weak topics. */
export function estimateGrammar(answers: GrammarAnswer[]): { band: number; perBand: Record<number, number>; weak: string[] } {
  const perBand: Record<number, number> = {};
  let band = 0;
  for (const b of BANDS) {
    const at = answers.filter((a) => a.band === b);
    if (!at.length) continue;
    const acc = at.filter((a) => a.right).length / at.length;
    perBand[b] = Math.round(acc * 100) / 100;
    if (at.length >= 2 && acc >= 0.5) band = b;
  }
  if (!band) {
    const lowest = Math.min(...answers.map((a) => a.band), GRAMMAR_START);
    band = Math.max(1, lowest - 1);
  }
  const wrong = new Map<string, number>();
  for (const a of answers) if (!a.right && a.topic) wrong.set(a.topic, (wrong.get(a.topic) ?? 0) + 1);
  const weak = [...wrong.entries()].sort((x, y) => y[1] - x[1]).map(([t]) => t).slice(0, 4);
  return { band, perBand, weak };
}

export interface LevelResult {
  date: string;
  vocab: number | null;
  grammar: number | null;
  writing: number | null;
  weak: string[];
}

/** The level line given to the tutor and the lesson writer. */
export function levelText(lang: string, r: LevelResult): string {
  const parts = [
    r.vocab ? `vocabulary ${bandLabel(lang, r.vocab)}` : '',
    r.grammar ? `grammar ${bandLabel(lang, r.grammar)}${r.weak.length ? ` (weaker: ${r.weak.join(', ')})` : ''}` : '',
    r.writing ? `writing ${bandLabel(lang, r.writing)}` : '',
  ].filter(Boolean);
  return parts.length ? `Level check ${r.date}: ${parts.join('; ')}.` : '';
}

/** Lessons below the grammar level that are not done yet: offered for marking as Practised. */
export function lessonsBelow(lessons: { id: number; level: string | null; completed: boolean }[], grammarBand: number): number[] {
  return lessons.filter((l) => !l.completed && (parseBand(l.level) ?? 99) < grammarBand).map((l) => l.id);
}

/**
 * The highest band of new words within reach of a measured vocabulary band: its own band and the
 * next one up. Words above it wait in the pool until the learner gets there.
 */
export function reachBand(vocab: number): number {
  return Math.min(6, Math.max(1, Math.round(vocab) + 1));
}

/** Bands a starter pool is filled at after a level check: the measured band (A1 at least) and the next. */
export function starterBands(vocab: number): number[] {
  const from = Math.min(6, Math.max(1, Math.round(vocab)));
  return from < 6 ? [from, from + 1] : [from];
}
