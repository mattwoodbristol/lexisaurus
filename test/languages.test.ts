import { describe, it, expect } from 'vitest';
import { listLanguages, getLanguage, validateLanguageConfig } from '../src/core/languages';

describe('language config', () => {
  it('ships zh and it validates', () => {
    const zh = getLanguage('zh');
    expect(zh).toBeDefined();
    expect(validateLanguageConfig(zh!)).toEqual([]);
    expect(zh!.hasRomanisation).toBe(true);
    expect(zh!.conversationLanguageRule).toMatch(/never write pinyin/i);
  });

  it('every registered language validates', () => {
    for (const l of listLanguages()) expect(validateLanguageConfig(l)).toEqual([]);
  });

  it('flags a broken config', () => {
    const bad = { ...getLanguage('zh')!, speechRecognitionLang: 'chinese', name: '' };
    expect(validateLanguageConfig(bad)).toEqual(expect.arrayContaining(['name is required', 'speechRecognitionLang must look like xx-YY']));
  });

  it('returns undefined for unknown ids', () => {
    expect(getLanguage('xx')).toBeUndefined();
  });
});
