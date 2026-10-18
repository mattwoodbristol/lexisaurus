import { describe, it, expect } from 'vitest';
import { rulesFor, sameText } from '../src/core/text/rules';
import { annotate } from '../src/core/pinyin/annotate';

const dict = new Map([
  ['parlare', { id: 1, status: 'learning' as const }],
  ['acqua', { id: 2, status: 'known' as const }],
  ['比', { id: 3, status: 'known' as const }],
]);

describe('Mandarin rules are unchanged', () => {
  const r = rulesFor('han');
  it('tokenizes exactly like the original annotator', () => {
    const pin = (t: string) => Array.from(t).map(() => 'x');
    expect(r.tokenize('我比你高。', dict, pin)).toEqual(annotate('我比你高。', dict, pin));
  });
  it('compares and looks up as before', () => {
    expect(sameText('han', '今天 比 昨天冷！', '今天比昨天冷。')).toBe(true);
    expect(r.isLookup('觉得')).toBe(true);
    expect(r.isLookup('hello')).toBe(false);
    expect(r.hasTarget('A 比 B')).toBe(true);
    expect(r.hasTarget('only English')).toBe(false);
  });
});

describe('Latin-script rules (Italian)', () => {
  const r = rulesFor('latin');
  it('splits words, keeps elisions as their own word and the text intact', () => {
    const toks = r.tokenize("L'acqua è fredda, ma parlare aiuta.", dict);
    expect(toks.map((t) => t.text).join('')).toBe("L'acqua è fredda, ma parlare aiuta.");
    expect(toks.filter((t) => t.status).map((t) => t.text)).toEqual(["L'", 'acqua', 'è', 'fredda', 'ma', 'parlare', 'aiuta']);
    expect(toks.find((t) => t.text === 'acqua')).toMatchObject({ status: 'known', wordId: 2 });
    expect(toks.find((t) => t.text === 'parlare')).toMatchObject({ status: 'learning' });
    expect(toks.find((t) => t.text === 'fredda')!.status).toBe('unknown');
  });
  it('matches the word list case-insensitively and without the elision mark', () => {
    expect(r.key('Acqua')).toBe('acqua');
    expect(r.key("dell'")).toBe('dell');
    expect(r.isLookup("dell'")).toBe(true);
    expect(r.isLookup('due parole')).toBe(false);
  });
  it('compares answers ignoring case, punctuation and spacing but not accents', () => {
    expect(sameText('latin', 'Vado a casa', 'vado a casa.')).toBe(true);
    expect(sameText('latin', 'L’acqua  è fredda', "l'acqua è fredda!")).toBe(true);
    expect(sameText('latin', 'perche', 'perché')).toBe(false); // accents left to the marker
    expect(sameText('latin', 'vado acasa', 'vado a casa')).toBe(false); // spaces matter
  });
});
