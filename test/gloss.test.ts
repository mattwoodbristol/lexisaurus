import { describe, it, expect } from 'vitest';
import { cleanGloss, contextWindow, isLookupText, pairMeanings, tidyListGloss, wordChars, xrefTarget } from '../src/core/words/gloss';

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

  it('drops a cross-reference label whose headword was cut off', () => {
    expect(tidyListGloss('variant of')).toBeNull();
    expect(tidyListGloss('old variant of')).toBeNull();
    expect(tidyListGloss('Erhua variant of;')).toBeNull();
    expect(tidyListGloss('same as')).toBeNull();
    expect(tidyListGloss('abbr. for')).toBeNull();
    expect(tidyListGloss('that; variant of')).toBe('that');
    expect(tidyListGloss('see')).toBe('see'); // a real meaning, not a label
    expect(tidyListGloss('look; see')).toBe('look; see');
    expect(tidyListGloss('a variant of the game')).toBe('a variant of the game');
    expect(tidyListGloss('variant of 那 nà')).toBeNull();
    expect(tidyListGloss('that; variant of 那 nà')).toBe('that');
    expect(xrefTarget('old variant of 這|这 zhè')).toEqual(['这', '這']);
    expect(xrefTarget('same as before')).toBeNull();
  });

  it('drops Pleco link marks and entry ids', () => {
    // As stored by the import, which cut the link's Hanzi off: only the label is left.
    expect(tidyListGloss('abbreviation = \uEAB8\uEABB22930176\uEABC')).toBeNull();
    expect(tidyListGloss('fertilizer; see \uEAB8\uEABB22930176\uEABC化学肥料\uEABD')).toBe('fertilizer; see 化学肥料');
    expect(xrefTarget('abbreviation = 化学肥料')).toEqual(['化学肥料']);
    expect(tidyListGloss('= 化学肥料')).toBeNull();
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

describe('pairMeanings', () => {
  it('matches words Claude wrote a little differently', () => {
    const m = pairMeanings(
      ['吃', '哪儿/哪里', '（一）点儿'],
      [
        { word: '一点儿', meaning: 'a little' },
        { word: '吃 ', meaning: 'to eat' },
        { word: '哪里', meaning: 'where' },
      ],
    );
    expect(m.get('吃')).toBe('to eat');
    expect(m.get('哪儿/哪里')).toBe('where');
    expect(m.get('（一）点儿')).toBe('a little');
  });
  it('falls back to the place in the list when every word has one answer', () => {
    expect(pairMeanings(['帮助'], [{ word: '帮助 bāngzhù', meaning: 'to help' }]).get('帮助')).toBe('to help');
  });
  it('leaves an unmatched word out', () => {
    expect(pairMeanings(['帮助', '跑步'], [{ word: '唱歌', meaning: 'to sing' }]).size).toBe(0);
  });
});

import { isNameGloss } from '../src/core/words/gloss';
describe('name-only glosses', () => {
  it('spots a word whose every sense is a name', () => {
    for (const g of ['Zhu (surname)', 'surname Zhu', 'Li (given name)', 'Wang, a surname', 'family name', 'surname Zhu; Zhu (surname).']) expect(isNameGloss(g), g).toBe(true);
  });
  it('keeps words with another meaning, and ordinary words', () => {
    for (const g of ['vermilion; surname Zhu', 'Beijing (city)', 'name', 'to name; name', 'teacher', '', null]) expect(isNameGloss(g), String(g)).toBe(false);
  });
});
