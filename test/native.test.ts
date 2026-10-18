import { describe, it, expect } from 'vitest';
import { nativeLabel, nativeLanguage } from '../src/core/languages/native';
import { translatePrompt, TRANSLATE_V1 } from '../prompts/translate.v1';
import { nextPinyinMode } from '../src/core/pinyin/annotate';

describe('native language', () => {
  it('labels the translate button with the language code', () => {
    expect(nativeLabel('en')).toBe('EN');
    expect(nativeLabel('it')).toBe('IT');
    expect(nativeLabel('xx')).toBe('EN'); // unknown falls back to English
    expect(nativeLanguage(undefined).english).toBe('English');
  });
  it('translates into that language', () => {
    expect(translatePrompt('English')).toBe(TRANSLATE_V1);
    expect(translatePrompt('Italian')).toMatch(/into natural Italian/);
  });
  it('per-message pinyin cycles Off, Smart, All', () => {
    expect(['off', 'smart', 'all'].map((m) => nextPinyinMode(m as 'off'))).toEqual(['smart', 'all', 'off']);
  });
});
