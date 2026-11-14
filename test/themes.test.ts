import { describe, it, expect } from 'vitest';
import {
  cleanEmoji,
  currentDay,
  dayProblems,
  dayWritten,
  diagramProblems,
  themeDays,
  themeEntries,
  themeLemmas,
  themeProblems,
  themeQuiz,
  type ThemeContent,
  type ThemeDiagram,
  type ThemeItem,
} from '../src/core/themes/types';
import { THEME_IDEAS } from '../src/core/themes/suggestions';
import { rulesFor } from '../src/core/text/rules';
import { seededRng } from '../src/core/topics/select';

const latin = rulesFor('latin');
const word = (text: string, lemma: string, translation = text, emoji = ''): ThemeItem => ({ kind: 'word', text, lemma, translation, note: '', emoji });
const phrase = (text: string, translation = text): ThemeItem => ({ kind: 'phrase', text, lemma: null, translation, note: '' });

const diagram = (over: Partial<ThemeDiagram> = {}): ThemeDiagram => ({
  shapes: [
    { d: 'M10 10 L390 10 L390 290 Z', tone: 'light' },
    { d: 'M100,100 C120,80 140,80 160,100', tone: 'line' },
  ],
  markers: [
    { item: 0, x: 100, y: 200 },
    { item: 1, x: 150, y: 250 },
    { item: 2, x: 200, y: 280 },
  ],
  ...over,
});

const body = (over: Partial<ThemeContent> = {}): ThemeContent => ({
  title: 'The body',
  intro: 'Body parts.',
  days: [
    { title: 'Legs', focus: 'Leg and foot' },
    { title: 'Aches', focus: 'Injuries' },
  ],
  sections: [
    { heading: 'Leg', day: 1, diagram: diagram(), items: [word('il ginocchio', 'ginocchio', 'knee'), word('la caviglia', 'caviglia', 'ankle'), word('il piede', 'piede', 'foot', '👣'), word('il tallone', 'tallone', 'heel', '🦶')] },
    { heading: 'Aches', day: 1, items: [phrase('mi fa male', 'it hurts'), phrase('mi sono slogato la caviglia', 'I sprained my ankle'), word('il livido', 'livido', 'bruise'), word('Il Ginocchio rotto', 'ginocchio', 'broken knee')] },
  ],
  grammar: [{ title: 'Irregular plurals', day: 1, explanation: 'Some body parts become feminine.', examples: [{ text: 'le ginocchia', translation: 'the knees' }, { text: 'le braccia', translation: 'the arms' }] }],
  ...over,
});

const day2 = (): ThemeContent => {
  const b = body();
  return {
    ...b,
    sections: [...b.sections, { heading: 'Arm', day: 2, items: [word('il gomito', 'gomito', 'elbow', '💪'), word('il polso', 'polso', 'wrist'), word('la spalla', 'spalla', 'shoulder'), word("l'unghia", 'unghia', 'nail', '💅')] }],
  };
};

describe('themed vocabulary checks', () => {
  it('accepts a well-formed theme', () => {
    expect(themeProblems(body(), 2, latin.hasTarget, latin.isLookup)).toEqual([]);
  });
  it('needs the plan to have the days asked for', () => {
    expect(themeProblems(body(), 3, latin.hasTarget, latin.isLookup).join()).toMatch(/plan exactly 3 days/);
  });
  it('needs a single dictionary word for each word item', () => {
    const bad = body();
    bad.sections[0]!.items[0] = word('il ginocchio', 'il ginocchio');
    bad.sections[0]!.items[1] = { ...word('la caviglia', 'x'), lemma: null };
    const p = themeProblems(bad, 2, latin.hasTarget, latin.isLookup).join('; ');
    expect(p).toMatch(/section 1 item 1 is a word/);
    expect(p).toMatch(/section 1 item 2 is a word/);
  });
  it('rejects repeats, short sections and missing grammar examples', () => {
    const bad = body({ grammar: [{ title: 'X', explanation: 'Y', examples: [{ text: 'uno', translation: 'one' }] }] });
    bad.sections[1]!.items[3] = word('il ginocchio', 'ginocchio');
    bad.sections[0]!.items.splice(2);
    bad.sections[0]!.diagram = null;
    const p = themeProblems(bad, 2, latin.hasTarget, latin.isLookup).join('; ');
    expect(p).toMatch(/repeats "il ginocchio"/);
    expect(p).toMatch(/section 1 needs/);
    expect(p).toMatch(/grammar point 1 needs at least 2 examples/);
  });
  it('rejects a later day that repeats an earlier one', () => {
    const later = { sections: body().sections, grammar: body().grammar };
    expect(dayProblems(later, latin.hasTarget, latin.isLookup, ['il piede']).join()).toMatch(/"il piede" was already covered on an earlier day/);
  });
  it('lists dictionary words once, by their key, for one day or all', () => {
    expect(themeLemmas(body(), latin.key)).toEqual(['ginocchio', 'caviglia', 'piede', 'tallone', 'livido']);
    expect(themeLemmas(day2(), latin.key, 2)).toEqual(['gomito', 'polso', 'spalla', 'unghia']);
  });
});

describe('theme diagrams', () => {
  it('accepts plain path data with markers on items', () => {
    expect(diagramProblems(diagram(), 4, 's1')).toEqual([]);
  });
  it('rejects markup, markers off the canvas or on no item, and too few markers', () => {
    const p = diagramProblems(
      diagram({
        shapes: [{ d: 'M0 0"/><script>alert(1)</script>', tone: 'line' }],
        markers: [
          { item: 0, x: 500, y: 10 },
          { item: 9, x: 10, y: 10 },
        ],
      }),
      4,
      's1',
    ).join('; ');
    expect(p).toMatch(/plain SVG path data/);
    expect(p).toMatch(/off the 400x300 canvas/);
    expect(p).toMatch(/points at no item/);
    expect(p).toMatch(/at least 3 markers/);
  });
});

describe('theme days', () => {
  it('counts the planned days, and one for packs written before days', () => {
    expect(themeDays(body())).toBe(2);
    const old = body({ days: undefined });
    old.sections.forEach((s) => delete s.day);
    expect(themeDays(old)).toBe(1);
    expect(dayWritten(old, 1)).toBe(true);
    expect(dayWritten(body(), 2)).toBe(false);
  });
  it('works on the first day not done', () => {
    expect(currentDay(0, 3)).toBe(1);
    expect(currentDay(2, 3)).toBe(3);
    expect(currentDay(3, 3)).toBe(3);
  });
});

describe('theme quiz', () => {
  it('asks about entries with one right option among distinct ones', () => {
    const quiz = themeQuiz(body(), {}, seededRng(7));
    expect(quiz.length).toBe(themeEntries(body()).length);
    for (const q of quiz) {
      expect(new Set(q.options).size).toBe(q.options.length);
      expect(q.options.length).toBe(4);
      const entry = themeEntries(body()).find((e) => e.text === q.text)!;
      expect(q.options[q.answer]).toBe(q.kind === 'meaning' ? entry.translation : entry.text);
      if (q.kind === 'say') expect(q.prompt).toBe(entry.translation);
      if (q.kind === 'picture') expect(q.prompt).toBe(entry.emoji);
      if (q.kind === 'diagram') expect(body().sections[q.section!]!.diagram!.markers.some((m) => m.item === q.item)).toBe(true);
    }
  });
  it('asks from pictures and diagrams across seeds', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed < 30; seed++) for (const q of themeQuiz(body(), {}, seededRng(seed))) kinds.add(q.kind);
    expect([...kinds].sort()).toEqual(['diagram', 'meaning', 'picture', 'say']);
  });
  it("takes the day's entries plus a few from earlier days", () => {
    const quiz = themeQuiz(day2(), { day: 2, review: 2 }, seededRng(3));
    const earlier = new Set(themeEntries(body()).map((e) => e.text));
    expect(quiz).toHaveLength(6);
    expect(quiz.filter((q) => earlier.has(q.text))).toHaveLength(2);
  });
  it('always asks some parts from the diagram', () => {
    for (let seed = 1; seed < 30; seed++) {
      const quiz = themeQuiz(body(), { day: 1, n: 5 }, seededRng(seed));
      expect(quiz.filter((q) => q.kind === 'diagram').length).toBeGreaterThanOrEqual(3);
    }
  });
  it('limits the number of questions', () => {
    expect(themeQuiz(body(), { n: 3 }, seededRng(1))).toHaveLength(3);
  });
});

describe('emoji and built-in theme ideas', () => {
  it('keeps one emoji and drops words', () => {
    expect(cleanEmoji(' 🚿 ')).toBe('🚿');
    expect(cleanEmoji('👍🏽')).toBe('👍🏽');
    expect(cleanEmoji('shower')).toBe('');
    expect(cleanEmoji(undefined)).toBe('');
  });
  it('have unique names and a hint each', () => {
    expect(new Set(THEME_IDEAS.map((i) => i.name.toLowerCase())).size).toBe(THEME_IDEAS.length);
    for (const i of THEME_IDEAS) expect(i.hint.length).toBeGreaterThan(10);
    expect(THEME_IDEAS.some((i) => /buildings/i.test(i.name))).toBe(true);
  });
});
