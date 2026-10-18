import { describe, it, expect } from 'vitest';
import { bandLabel, estimateGrammar, estimateVocab, lessonsBelow, levelText, nextGrammarBand, parseBand, sampleVocab, seededShuffle } from '../src/core/assessment/levels';

describe('bands', () => {
  it('labels and parses levels per language', () => {
    expect(bandLabel('zh', 3)).toBe('HSK 3');
    expect(bandLabel('it', 5)).toBe('C1');
    expect(parseBand('HSK 3')).toBe(3);
    expect(parseBand('HSK 3-4')).toBe(4);
    expect(parseBand('B2')).toBe(4);
    expect(parseBand('C1-C2')).toBe(6);
    expect(parseBand('All')).toBeNull();
  });
  it('shuffles reproducibly', () => {
    expect(seededShuffle([1, 2, 3, 4, 5], 9)).toEqual(seededShuffle([1, 2, 3, 4, 5], 9));
    expect(seededShuffle([1, 2, 3, 4, 5], 9).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('vocabulary', () => {
  it('samples the learner\'s own words per band and reports shortfalls', () => {
    const words = [1, 1, 1, 2, 2, 6].map((band, i) => ({ id: i, lemma: `w${i}`, gloss: 'g', band }));
    const { picked, short } = sampleVocab(words, 2, 1);
    expect(picked.filter((w) => w.band === 1)).toHaveLength(2);
    expect(short).toEqual({ 3: 2, 4: 2, 5: 2, 6: 1 });
  });
  it('estimates the band, correcting for claimed made-up words', () => {
    const ans = (band: number, known: number, of: number) => Array.from({ length: of }, (_, i) => ({ band, pseudo: false, known: i < known }));
    const answers = [...ans(1, 8, 8), ...ans(2, 7, 8), ...ans(3, 6, 8), ...ans(4, 3, 8), ...ans(5, 1, 8)];
    expect(estimateVocab(answers).band).toBe(3);
    // Claiming half the made-up words knocks the corrected rates down a band.
    const fake = Array.from({ length: 10 }, (_, i) => ({ band: 0, pseudo: true, known: i < 5 }));
    const r = estimateVocab([...answers, ...fake]);
    expect(r.falseAlarm).toBe(0.5);
    expect(r.band).toBe(2);
  });
});

describe('grammar', () => {
  it('moves up after two right, down after two wrong', () => {
    expect(nextGrammarBand(3, [true, true])).toBe(4);
    expect(nextGrammarBand(3, [false, false])).toBe(2);
    expect(nextGrammarBand(3, [true, false])).toBe(3);
    expect(nextGrammarBand(6, [true, true])).toBe(6);
    expect(nextGrammarBand(1, [false, false])).toBe(1);
  });
  it('estimates the band and the weakest topics', () => {
    const a = (band: number, right: boolean, topic = 't') => ({ band, right, topic });
    const r = estimateGrammar([a(3, true), a(3, true), a(4, true), a(4, false, 'subjunctive'), a(5, false, 'subjunctive'), a(5, false, 'prepositions')]);
    expect(r.band).toBe(4);
    expect(r.weak).toEqual(['subjunctive', 'prepositions']);
    expect(estimateGrammar([a(3, false), a(3, false), a(2, false), a(2, false)]).band).toBe(1);
  });
});

describe('results', () => {
  it('writes the level line and offers lessons below the grammar level', () => {
    expect(levelText('it', { date: '2026-10-06', vocab: 4, grammar: 3, writing: 4, weak: ['subjunctive'] })).toBe(
      'Level check 2026-10-06: vocabulary B2; grammar B1 (weaker: subjunctive); writing B2.',
    );
    const lessons = [
      { id: 1, level: 'HSK 2', completed: false },
      { id: 2, level: 'HSK 3-4', completed: false },
      { id: 3, level: 'HSK 3', completed: true },
      { id: 4, level: 'All', completed: false },
    ];
    expect(lessonsBelow(lessons, 4)).toEqual([1]);
  });
});
