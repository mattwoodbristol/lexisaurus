import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePlecoXml, plecoStatus, plecoGloss, hskLevel, plecoToWords } from '../src/core/import/pleco';
import { parseCsv, parseVocabSheet, isPattern } from '../src/core/import/sheet';
import { seedCardFromPleco } from '../src/core/srs/seed';
import { State } from 'ts-fsrs';

const xml = readFileSync(join(process.cwd(), 'test/fixtures/pleco-sample.xml'), 'utf8');

describe('pleco parser', () => {
  const cards = parsePlecoXml(xml);
  it('parses headwords, pron, defn, categories and scores', () => {
    expect(cards).toHaveLength(7);
    const guo = cards[0]!;
    expect(guo.simp).toBe('国');
    expect(guo.trad).toBe('國');
    expect(guo.pron).toBe('guo2');
    expect(guo.categories).toEqual(['HSK 3.0/Level 1']);
    expect(guo.score?.score).toBe(1908);
    expect(guo.score?.reviewed).toBe(7);
    expect(guo.score?.lastReviewedTime).toBe(1789820019);
    expect(cards[1]!.score).toBeUndefined();
    expect(cards[6]!.defn).toContain('& yet'); // entity decoded
  });

  it('derives HSK level (lowest wins, 7 for 7-9)', () => {
    expect(hskLevel(['HSK 3.0/Level 7-9', 'Words'])).toBe(7);
    expect(hskLevel(['HSK 3.0/Level 4', 'HSK 3.0/Level 2'])).toBe(2);
    expect(hskLevel(['Duo Chars'])).toBeUndefined();
  });

  it("applies the author's status rules", () => {
    const by = Object.fromEntries(cards.map((c) => [c.simp + (c.categories[0] ?? ''), plecoStatus(c)]));
    expect(by['国HSK 3.0/Level 1']).toBe('known'); // score 1908 > 1600
    expect(by['图书馆HSK 3.0/Level 2']).toBe('new'); // HSK 2 but never reviewed (revised 2026-10-05)
    expect(by['翻新HSK 3.0/Level 7-9']).toBe('learning'); // Words category, score 400
    expect(by['抓狂HSK 3.0/Level 7-9']).toBe('new'); // unreviewed HSK 7-9
    expect(by['女Duo Chars']).toBe('known'); // score 37877
    expect(by['虽然HSK 3.0/Level 4']).toBe('learning'); // reviewed once, failed
  });

  it('extracts a short gloss', () => {
    expect(plecoGloss('noun 1 country; nation; state 大国 dàguó a big country 2 best')).toBe('country; nation; state');
    expect(plecoGloss('verb renovate; recondition 翻新旧衣服 fānxīn')).toBe('renovate; recondition');
    expect(plecoGloss('noun library')).toBe('library');
    expect(plecoGloss(undefined)).toBeUndefined();
  });

  it('dedupes on simplified headword keeping best score and all categories', () => {
    const rows = plecoToWords(cards);
    expect(rows).toHaveLength(6);
    const nv = rows.find((r) => r.lemma === '女')!;
    expect(nv.status).toBe('known');
    expect([...nv.meta.categories].sort()).toEqual(['Duo Chars', 'HSK 3.0/Level 1']);
    expect(nv.meta.hsk).toBe(1);
    expect(nv.reading).toBe('nǚ');
    const tsg = rows.find((r) => r.lemma === '图书馆')!;
    expect(tsg.reading).toBe('tú shū guǎn');
    expect(tsg.meta.trad).toBe('圖書館');
    expect(tsg.meta.pleco).toBeUndefined();
  });
});

describe('vocab sheet', () => {
  const csv =
    'Lesson,Character,Pinyin,English,Part of Speech,Notes,\n' +
    'L4,意大利语,Yìdàlìyǔ,Italian language,noun,"语 = language; contrast 意大利 (Italy)",\n' +
    'L19,对...来说,duì...lái shuō,for.../from the perspective of,structure,Always at START of sentence,\n' +
    'L9,坐飞机,zuò fēijī,to take a plane,verb phrase,坐 for transport,not 用\n';
  it('parses CSV with quotes and overflow notes', () => {
    expect(parseCsv('a,"b,c",d\n1,"say ""hi""",3')).toEqual([
      ['a', 'b,c', 'd'],
      ['1', 'say "hi"', '3'],
    ]);
    const rows = parseVocabSheet(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      lesson: 'L4',
      hanzi: '意大利语',
      pinyin: 'Yìdàlìyǔ',
      english: 'Italian language',
      pos: 'noun',
      notes: '语 = language; contrast 意大利 (Italy)',
    });
    expect(rows[2]!.notes).toBe('坐 for transport, not 用');
  });
  it('flags pattern rows', () => {
    expect(parseVocabSheet(csv).map(isPattern)).toEqual([false, true, false]);
  });
});

describe('FSRS seeding from Pleco', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  it('leaves unreviewed cards new', () => {
    const c = seedCardFromPleco(undefined, now);
    expect(c.state).toBe(State.New);
    expect(c.reps).toBe(0);
  });
  it('maps score to stability and history to reps/lapses', () => {
    const c = seedCardFromPleco(
      { score: 1908, difficulty: 108, history: '6666666', correct: 7, incorrect: 0, reviewed: 7, lastReviewedTime: 1789820019 },
      now,
    );
    expect(c.state).toBe(State.Review);
    expect(c.stability).toBeCloseTo(19.08);
    expect(c.reps).toBe(7);
    expect(c.lapses).toBe(0);
    expect(c.difficulty).toBe(4);
    const expectedDue = new Date(1789820019 * 1000 + 19.08 * 86_400_000);
    expect(c.due.getTime()).toBe(Math.max(expectedDue.getTime(), now.getTime()));
  });
  it('caps stability and raises difficulty with failures', () => {
    const c = seedCardFromPleco(
      { score: 99999, difficulty: 100, history: '2', correct: 0, incorrect: 1, reviewed: 1, lastReviewedTime: 1789820019 },
      now,
    );
    expect(c.stability).toBe(365);
    expect(c.difficulty).toBe(10);
    expect(c.lapses).toBe(1);
  });
});
