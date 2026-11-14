// Themed vocabulary: a short course of words, phrases and grammar around one theme (the body,
// the home and its fittings, tennis...), so the learner can talk about it in detail. It runs over
// a few days: Claude plans the days and writes each one; the app checks it, draws its diagrams,
// marks which words are already known, adds them to reviews and runs the quizzes.
// Pure functions shared by the API and the UI.

export type ThemeItemKind = 'word' | 'phrase';

export interface ThemeItem {
  kind: ThemeItemKind;
  /** As shown: a noun with its article (il ginocchio), a verb, or a whole phrase. */
  text: string;
  /** In the learner's own language. */
  translation: string;
  /** The dictionary word to add to the word list (ginocchio), or null for a phrase. */
  lemma: string | null;
  /** Short usage note: irregular plural, gender, register, a false friend. May be empty. */
  note: string;
  /** One emoji that pictures the item, or empty when none fits. */
  emoji?: string;
}

/** Fill of a diagram shape; the app maps these to colours that work in light and dark mode. */
export type DiagramTone = 'line' | 'light' | 'mid' | 'dark' | 'accent';
export const DIAGRAM_TONES: DiagramTone[] = ['line', 'light', 'mid', 'dark', 'accent'];

/** A schematic line drawing on a 400 x 300 canvas, with markers on the parts it names. */
export interface ThemeDiagram {
  /** SVG path data, drawn in order (later shapes on top). */
  shapes: { d: string; tone: DiagramTone }[];
  /** Where each named part is: `item` is the index of the item in the section. */
  markers: { item: number; x: number; y: number }[];
}

export const DIAGRAM_SIZE = { w: 400, h: 300 };

export interface ThemeSection {
  heading: string;
  /** Which day of the theme teaches it (1-based; packs written before days were all day 1). */
  day?: number;
  diagram?: ThemeDiagram | null;
  items: ThemeItem[];
}

export interface ThemeExample {
  text: string;
  translation: string;
}

export interface ThemeGrammar {
  title: string;
  day?: number;
  /** In the learner's own language. */
  explanation: string;
  examples: ThemeExample[];
}

export interface ThemeDayPlan {
  title: string;
  /** What the day covers, for writing it later. */
  focus: string;
}

export interface ThemeContent {
  title: string;
  /** One or two sentences in the learner's language on what the theme covers. */
  intro: string;
  /** The plan, one entry per day. Missing on packs written before days. */
  days?: ThemeDayPlan[];
  sections: ThemeSection[];
  grammar: ThemeGrammar[];
}

export const DAY_LIMITS = { min: 1, max: 5, default: 3 };
export const SECTION_LIMITS = { min: 2, max: 4 };
export const ITEM_LIMITS = { min: 4, max: 14 };
export const GRAMMAR_LIMITS = { min: 1, max: 2 };
const MAX_SHAPES = 60;
const MAX_PATH = 3000;
/** SVG path data only: commands and numbers, nothing that could carry markup or a URL. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[‍️⃣]|\p{Emoji_Modifier})+$/u;

export const dayOf = (x: { day?: number }): number => x.day ?? 1;

/** Number of days in the theme: the plan's, or the last day written for an older pack. */
export function themeDays(c: ThemeContent): number {
  return Math.max(c.days?.length ?? 0, ...c.sections.map(dayOf), 1);
}

/** Has the day been written yet? */
export const dayWritten = (c: ThemeContent, day: number): boolean => c.sections.some((s) => dayOf(s) === day);

/** A usable emoji, or '' (models sometimes write a word, or several emoji). */
export function cleanEmoji(s: string | undefined): string {
  const t = (s ?? '').trim();
  return t && t.length <= 12 && EMOJI.test(t) ? t : '';
}

/** Problems with a diagram, phrased for a retry. */
export function diagramProblems(d: ThemeDiagram, items: number, at: string): string[] {
  const p: string[] = [];
  if (!d.shapes.length || d.shapes.length > MAX_SHAPES) p.push(`${at} diagram needs 1-${MAX_SHAPES} shapes`);
  d.shapes.forEach((s, i) => {
    if (!PATH_DATA.test(s.d) || s.d.length > MAX_PATH) p.push(`${at} diagram shape ${i + 1} must be plain SVG path data under ${MAX_PATH} characters`);
    if (!DIAGRAM_TONES.includes(s.tone)) p.push(`${at} diagram shape ${i + 1} has an unknown tone`);
  });
  if (d.markers.length < 3) p.push(`${at} diagram needs at least 3 markers`);
  const used = new Set<number>();
  d.markers.forEach((m, i) => {
    if (!Number.isInteger(m.item) || m.item < 0 || m.item >= items) p.push(`${at} diagram marker ${i + 1} points at no item`);
    if (used.has(m.item)) p.push(`${at} diagram marks item ${m.item} twice`);
    used.add(m.item);
    if (!(m.x >= 0 && m.x <= DIAGRAM_SIZE.w && m.y >= 0 && m.y <= DIAGRAM_SIZE.h)) p.push(`${at} diagram marker ${i + 1} is off the ${DIAGRAM_SIZE.w}x${DIAGRAM_SIZE.h} canvas`);
  });
  return p;
}

/** Problems with one day's sections and grammar, phrased for a retry. Empty when usable. */
export function dayProblems(c: Pick<ThemeContent, 'sections' | 'grammar'>, hasTarget: (s: string) => boolean, isLookup: (s: string) => boolean, covered: string[] = []): string[] {
  const p: string[] = [];
  if (c.sections.length < SECTION_LIMITS.min || c.sections.length > SECTION_LIMITS.max) p.push(`write ${SECTION_LIMITS.min}-${SECTION_LIMITS.max} sections`);
  const seen = new Set(covered.map((t) => t.trim().toLowerCase()));
  const before = new Set(seen);
  c.sections.forEach((s, i) => {
    if (!s.heading.trim()) p.push(`section ${i + 1} has no heading`);
    if (s.items.length < ITEM_LIMITS.min || s.items.length > ITEM_LIMITS.max) p.push(`section ${i + 1} needs ${ITEM_LIMITS.min}-${ITEM_LIMITS.max} items`);
    s.items.forEach((it, j) => {
      const at = `section ${i + 1} item ${j + 1}`;
      if (!hasTarget(it.text)) p.push(`${at} is not in the language being learnt`);
      if (!it.translation.trim()) p.push(`${at} has no translation`);
      if (it.kind === 'word' && (!it.lemma || !isLookup(it.lemma.trim()))) p.push(`${at} is a word, so lemma must be its single dictionary word`);
      const k = it.text.trim().toLowerCase();
      if (before.has(k)) p.push(`"${it.text}" was already covered on an earlier day`);
      else if (seen.has(k)) p.push(`${at} repeats "${it.text}"`);
      seen.add(k);
    });
    if (s.diagram) p.push(...diagramProblems(s.diagram, s.items.length, `section ${i + 1}`));
  });
  if (c.grammar.length < GRAMMAR_LIMITS.min || c.grammar.length > GRAMMAR_LIMITS.max) p.push(`write ${GRAMMAR_LIMITS.min}-${GRAMMAR_LIMITS.max} grammar points`);
  c.grammar.forEach((g, i) => {
    if (!g.title.trim() || !g.explanation.trim()) p.push(`grammar point ${i + 1} needs a title and an explanation`);
    if (g.examples.length < 2) p.push(`grammar point ${i + 1} needs at least 2 examples`);
    g.examples.forEach((e, j) => {
      if (!hasTarget(e.text)) p.push(`grammar point ${i + 1} example ${j + 1} is not in the language being learnt`);
    });
  });
  return p;
}

/** Problems with a new theme: the plan for `days` days plus the first day. */
export function themeProblems(c: ThemeContent, days: number, hasTarget: (s: string) => boolean, isLookup: (s: string) => boolean): string[] {
  const p: string[] = [];
  if (!c.title.trim()) p.push('title is empty');
  if ((c.days?.length ?? 0) !== days) p.push(`plan exactly ${days} days`);
  c.days?.forEach((d, i) => {
    if (!d.title.trim() || !d.focus.trim()) p.push(`day ${i + 1} of the plan needs a title and a focus`);
  });
  return [...p, ...dayProblems(c, hasTarget, isLookup)];
}

export interface ThemeEntry {
  text: string;
  translation: string;
  group: string;
  day: number;
  emoji: string;
  /** Section and item index, for items (not grammar examples). */
  section?: number;
  item?: number;
}

/** Everything the theme teaches, flattened: items, then grammar examples as phrases. */
export function themeEntries(c: ThemeContent): ThemeEntry[] {
  return [
    ...c.sections.flatMap((s, si) => s.items.map((it, ii) => ({ text: it.text, translation: it.translation, group: s.heading, day: dayOf(s), emoji: cleanEmoji(it.emoji), section: si, item: ii }))),
    ...c.grammar.flatMap((g) => g.examples.map((e) => ({ text: e.text, translation: e.translation, group: g.title, day: dayOf(g), emoji: '' }))),
  ];
}

/** Dictionary words (single words with a lemma), once each, in order; only `day`'s when given. */
export function themeLemmas(c: ThemeContent, key: (w: string) => string, day?: number): string[] {
  const out: string[] = [];
  for (const s of c.sections) {
    if (day !== undefined && dayOf(s) !== day) continue;
    for (const it of s.items)
      if (it.lemma) {
        const k = key(it.lemma.trim());
        if (k && !out.includes(k)) out.push(k);
      }
  }
  return out;
}

export type QuizKind = 'say' | 'meaning' | 'picture' | 'diagram';

export interface QuizQuestion {
  kind: QuizKind;
  /** The translation (say), the target text (meaning), the emoji (picture), '' (diagram). */
  prompt: string;
  options: string[];
  answer: number;
  /** The target-language text this question is about (for read-aloud). */
  text: string;
  /** Diagram questions: the section whose diagram to show, and the item to highlight. */
  section?: number;
  item?: number;
}

function shuffle<T>(xs: T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * A multiple-choice quiz: up to `n` entries from `day` (all days when not given), plus up to
 * `review` from earlier days. Wrong options come from the same group first (ginocchio vs gomito
 * is the useful contrast). Items on a diagram are often asked from the diagram, items with an
 * emoji from the picture; otherwise questions alternate between saying it and its meaning.
 */
/** Diagram questions a quiz always asks when its day has a diagram (fewer if it marks fewer parts). */
export const MIN_DIAGRAM = 3;

export function themeQuiz(c: ThemeContent, opts: { day?: number; n?: number; review?: number } = {}, rng: () => number = Math.random): QuizQuestion[] {
  const { day, n = 12, review = 4 } = opts;
  const all = themeEntries(c).filter((e) => e.text.trim() && e.translation.trim());
  const today = all.filter((e) => day === undefined || e.day === day);
  const earlier = day === undefined ? [] : all.filter((e) => e.day < day);
  const marked = new Set<string>();
  c.sections.forEach((s, si) => s.diagram?.markers.forEach((m) => marked.add(`${si}:${m.item}`)));
  const onDiagram = (e: ThemeEntry) => e.section !== undefined && marked.has(`${e.section}:${e.item}`);
  // A day with a diagram always gets diagram questions: up to MIN_DIAGRAM of its parts are taken
  // first and asked from the diagram; the rest of the quiz is filled at random.
  const drawn = shuffle(today.filter(onDiagram), rng).slice(0, Math.min(MIN_DIAGRAM, n));
  const rest = shuffle(today.filter((e) => !drawn.includes(e)), rng).slice(0, n - drawn.length);
  const fromDiagram = new Set<ThemeEntry>(drawn);
  const picked = [...drawn, ...rest, ...shuffle(earlier, rng).slice(0, review)];
  return shuffle(picked, rng).map((e, i) => {
    const kind: QuizKind = fromDiagram.has(e) || (onDiagram(e) && rng() < 0.5) ? 'diagram' : e.emoji && rng() < 0.4 ? 'picture' : i % 3 === 2 ? 'meaning' : 'say';
    const side = (x: ThemeEntry) => (kind === 'meaning' ? x.translation : x.text);
    const right = side(e);
    const others = (pool: ThemeEntry[]) => shuffle(pool.filter((o) => side(o) !== right && (kind === 'say' || kind === 'meaning' || o.section !== undefined)), rng);
    const wrong: string[] = [];
    for (const o of [...others(all.filter((o) => o.group === e.group)), ...others(all.filter((o) => o.group !== e.group))]) {
      if (wrong.length === 3) break;
      if (!wrong.includes(side(o))) wrong.push(side(o));
    }
    const options = shuffle([right, ...wrong], rng);
    const prompt = kind === 'say' ? e.translation : kind === 'meaning' ? e.text : kind === 'picture' ? e.emoji : '';
    return { kind, prompt, options, answer: options.indexOf(right), text: e.text, ...(kind === 'diagram' ? { section: e.section, item: e.item } : {}) };
  });
}

/** The day to work on: the first not done, or the last once all are done. */
export function currentDay(daysDone: number, days: number): number {
  return Math.min(Math.max(daysDone + 1, 1), days);
}
