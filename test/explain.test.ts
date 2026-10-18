import { describe, it, expect } from 'vitest';
import { CORRECT_FROM_BAND, explainInTarget, explainLanguage, learnerBand } from '../src/core/explain';

describe('explanation language', () => {
  it('auto switches to the language being learnt from B1 / HSK 3', () => {
    expect(explainInTarget('auto', 2)).toBe(false);
    expect(explainInTarget('auto', 3)).toBe(true);
    expect(explainInTarget('auto', null)).toBe(false);
    expect(explainInTarget('native', 6)).toBe(false);
    expect(explainInTarget('target', 1)).toBe(true);
  });
  it('switches chat corrections later than lessons', () => {
    expect(explainInTarget('auto', 3, CORRECT_FROM_BAND)).toBe(false);
    expect(explainInTarget('auto', 4, CORRECT_FROM_BAND)).toBe(true);
    expect(explainInTarget('target', 1, CORRECT_FROM_BAND)).toBe(true);
  });
  it('uses the weaker measured band (reading needs the vocabulary too), else the described level', () => {
    expect(learnerBand({ grammar: 2, vocab: 4 }, 'C1')).toBe(2);
    expect(learnerBand({ grammar: 5, vocab: 2 }, 'C1')).toBe(2);
    expect(learnerBand({ grammar: null, vocab: 4 }, 'C1')).toBe(4);
    expect(learnerBand(null, 'HSK 2-3 vocabulary')).toBe(3);
    expect(learnerBand(null, 'Upper-intermediate (about B1-B2)')).toBe(4);
  });
  it('tells the model the language and level', () => {
    const zh = explainLanguage({ target: true, lang: 'zh', langName: 'Mandarin Chinese', script: 'han', band: 3, nativeCode: 'en', nativeName: 'English' });
    expect(zh.code).toBe('zh');
    expect(zh.instruction).toContain('HSK 3');
    expect(zh.instruction).toContain('no pinyin');
    const en = explainLanguage({ target: false, lang: 'it', langName: 'Italian', script: 'latin', band: 5, nativeCode: 'en', nativeName: 'English' });
    expect(en.code).toBe('en');
    expect(en.instruction).toContain('in English');
  });
});
