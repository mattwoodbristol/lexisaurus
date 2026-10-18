import { describe, it, expect } from 'vitest';
import { cleanGloss, contextWindow, isLookupText, tidyListGloss, wordChars } from '../src/core/words/gloss';

describe('tap-to-translate helpers', () => {
  it('accepts short Hanzi words only for zh', () => {
    expect(isLookupText('zh', '觉得')).toBe(true);
    expect(isLookupText('zh', '')).toBe(false);
    expect(isLookupText('zh', 'hello')).toBe(false);
    expect(isLookupText('zh', '你好!')).toBe(false);
    expect(isLookupText('zh', '一'.repeat(13))).toBe(false);
    expect(isLookupText('it', 'ciao')).toBe(true);
  });

  it('cleans model glosses', () => {
    expect(cleanGloss('"to feel; to think"')).toBe('to feel; to think');
    expect(cleanGloss('Gloss: Bristol (city)\nExtra line')).toBe('Bristol (city)');
    expect(cleanGloss('很 very + 好 good')).toBe('很 very + 好 good');
    expect(cleanGloss('x'.repeat(300))).toHaveLength(158);
    expect(cleanGloss('')).toBe('');
  });

  it('tidies glosses cut off at import', () => {
    expect(tidyListGloss('feel')).toBe('feel');
    expect(tidyListGloss('good; fine; nice (opp.')).toBe('good; fine; nice…');
    expect(tidyListGloss('(of workers) have a holiday')).toBe('(of workers) have a holiday');
    const long = 'auxiliary 1 [after a verb or an adjective to indicate the completion of an action, at a point in the past or before the ';
    expect(tidyListGloss(long)).toBeNull(); // "auxiliary 1" is not a meaning
    expect(tidyListGloss('[in questions, often replaced by')).toBeNull();
    expect(tidyListGloss('[before verbs, adjectives, and other adverbs; never before the verb')).toBeNull();
    expect(tidyListGloss('(-//-) clean; neat and tidy (opp.')).toBe('clean; neat and tidy…');
    expect(tidyListGloss('white (opp.')).toBe('white…');
    expect(tidyListGloss('x; '.repeat(40))).toMatch(/…$/);
  });

  it('breaks multi-character words into distinct characters', () => {
    expect(wordChars('觉得')).toEqual(['觉', '得']);
    expect(wordChars('谢谢')).toEqual(['谢']);
    expect(wordChars('我')).toEqual([]);
  });

  it('windows long context around the word', () => {
    expect(contextWindow(undefined, '我')).toBe('');
    expect(contextWindow('我很好', '很')).toBe('我很好');
    const long = 'a'.repeat(200) + '觉得' + 'b'.repeat(200);
    const w = contextWindow(long, '觉得', 60);
    expect(w).toHaveLength(120);
    expect(w).toContain('觉得');
  });
});

import { plecoGloss } from '../src/core/import/pleco';
describe('Pleco gloss extraction', () => {
  it('skips a leading usage note and never cuts inside a bracket', () => {
    expect(plecoGloss('adverb [in questions, often replaced by 多] how; what (degree) 多么好 how good')).toBe('how; what (degree)');
    expect(plecoGloss('adjective good; fine; nice (opp. 坏 huài) 好人 good person')).toBe('good; fine; nice');
    expect(plecoGloss('verb feel 我觉得 I feel')).toBe('feel');
  });
});
