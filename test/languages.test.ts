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

describe('Spanish and French', () => {
  it('ship as Latin-script languages with prompts, topics and a curriculum', async () => {
    const { hasPrompts } = await import('../prompts');
    const { TOPIC_SEEDS, CURRICULA } = await import('../src/core/languages/seeds');
    for (const id of ['es', 'fr']) {
      const l = getLanguage(id);
      expect(l?.script).toBe('latin');
      expect(validateLanguageConfig(l!)).toEqual([]);
      expect(hasPrompts(id)).toBe(true);
      expect(TOPIC_SEEDS[id]!.length).toBeGreaterThanOrEqual(30);
      expect(new Set(TOPIC_SEEDS[id]!.map((t) => t.name)).size).toBe(TOPIC_SEEDS[id]!.length);
      expect(CURRICULA[id]!.length).toBeGreaterThanOrEqual(20);
    }
  });
});
