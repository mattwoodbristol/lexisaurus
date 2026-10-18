import { describe, it, expect } from 'vitest';
import { createEmptyCard, State } from 'ts-fsrs';
import { parseCard, reviewCard, statusAfterReview, isRating } from '../src/core/srs/schedule';
import { chooseKind, makeExercise, checkCloze, normaliseZh, BLANK } from '../src/core/review/exercise';

const t0 = new Date('2026-10-04T08:00:00Z');
const DAY = 86_400_000;

describe('FSRS scheduling', () => {
  it('round-trips a card through JSON storage', () => {
    const c = reviewCard(createEmptyCard(t0), 3, t0);
    const back = parseCard(JSON.stringify(c));
    expect(back.due).toBeInstanceOf(Date);
    expect(back.due.getTime()).toBe(c.due.getTime());
    expect(() => reviewCard(back, 3, new Date(back.due.getTime() + DAY))).not.toThrow();
  });

  it('schedules Good later than Again, and Easy later than Good', () => {
    let c = createEmptyCard(t0);
    for (let i = 0; i < 3; i++) c = reviewCard(c, 3, new Date(Math.max(c.due.getTime(), t0.getTime())));
    const now = new Date(c.due.getTime());
    const again = reviewCard(c, 1, now);
    const good = reviewCard(c, 3, now);
    const easy = reviewCard(c, 4, now);
    expect(again.due.getTime()).toBeLessThan(good.due.getTime());
    expect(good.due.getTime()).toBeLessThanOrEqual(easy.due.getTime());
  });

  it('a word graduates to known after enough successful reviews, and only then', () => {
    let c = createEmptyCard(t0);
    let status: 'learning' | 'known' | 'new' = 'learning';
    let now = t0;
    const seen: string[] = [];
    for (let i = 0; i < 12 && status !== 'known'; i++) {
      c = reviewCard(c, 3, now);
      status = statusAfterReview(status, c, 3);
      seen.push(status);
      now = new Date(c.due.getTime());
    }
    expect(status).toBe('known');
    expect(c.stability).toBeGreaterThanOrEqual(21);
    expect(seen[0]).toBe('learning'); // never graduates on the first review
    expect(c.state).toBe(State.Review);
  });

  it('a known word failed with Again drops back to learning; Hard keeps it known', () => {
    const c = createEmptyCard(t0);
    expect(statusAfterReview('known', c, 1)).toBe('learning');
    expect(statusAfterReview('known', c, 2)).toBe('known');
  });

  it('validates ratings', () => {
    expect([1, 2, 3, 4].every(isRating)).toBe(true);
    expect([0, 5, '3', null].some(isRating)).toBe(false);
  });
});

describe('exercises', () => {
  const s = { id: 7, zh: '我们明天去图书馆看书吧。', en: "Let's go to the library to read tomorrow.", target: '图书馆' };

  it('rotates exercise kinds for words and uses en->zh for grammar', () => {
    expect([0, 1, 2, 3].map((r) => chooseKind(r, true, true))).toEqual(['cloze', 'zh_to_en', 'en_to_zh', 'cloze']);
    expect(chooseKind(0, true, false)).toBe('en_to_zh');
    expect(chooseKind(0, false, true)).toBe('flash');
  });

  it('adds the matching board for words with a meaning, in place of the flashcard', () => {
    expect([0, 1, 2, 3, 4].map((r) => chooseKind(r, true, true, 0, true))).toEqual(['cloze', 'match', 'zh_to_en', 'en_to_zh', 'cloze']);
    expect(chooseKind(0, false, true, 0, true)).toBe('match');
    expect(chooseKind(0, true, false, 0, true)).toBe('en_to_zh');
    expect(makeExercise('match', s)).toEqual({ kind: 'match' });
  });

  it('builds a cloze with the target blanked', () => {
    const e = makeExercise('cloze', s);
    expect(e.clozeZh).toBe(`我们明天去${BLANK}看书吧。`);
    expect(e.answerZh).toBe('图书馆');
    expect(e.promptEn).toBe(s.en);
  });

  it('falls back from cloze when the target is not in the sentence', () => {
    expect(makeExercise('cloze', { ...s, target: '咖啡' }).kind).toBe('zh_to_en');
    expect(makeExercise('cloze', undefined).kind).toBe('flash');
  });

  it('names the tested word on a meaning question, so it stays untappable until the answer shows', () => {
    expect(makeExercise('zh_to_en', s).target).toBe('图书馆');
  });

  it('checks typed answers leniently on spacing and punctuation only', () => {
    expect(checkCloze(' 图书馆。', '图书馆')).toBe(true);
    expect(checkCloze('图 书 馆', '图书馆')).toBe(true);
    expect(checkCloze('书馆', '图书馆')).toBe(false);
    expect(checkCloze('', '图书馆')).toBe(false);
    expect(normaliseZh('你好！')).toBe('你好');
  });
});
