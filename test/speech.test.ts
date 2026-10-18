import { describe, it, expect } from 'vitest';
import { pickVoice, rankVoices } from '../src/core/speech/voice';

const v = (name: string, lang: string, localService = true) => ({ name, lang, localService });

describe('voice choice', () => {
  it('prefers an exact mainland Mandarin voice', () => {
    const voices = [v('English', 'en-GB'), v('Cantonese', 'zh-HK'), v('Taiwan', 'zh-TW'), v('Mandarin', 'zh-CN')];
    expect(pickVoice(voices, 'zh-CN')?.name).toBe('Mandarin');
  });
  it('falls back to another Chinese voice, mainland-style first, and handles zh_CN spelling', () => {
    expect(pickVoice([v('Cantonese', 'zh-HK'), v('Generic', 'zh')], 'zh-CN')?.name).toBe('Generic');
    expect(pickVoice([v('Android', 'zh_CN')], 'zh-CN')?.name).toBe('Android');
  });
  it('returns null when there is no voice for the language', () => {
    expect(pickVoice([v('English', 'en-GB')], 'zh-CN')).toBeNull();
  });
});

describe('voices for a dialogue', () => {
  it('lists every voice for the language, best first, without other languages', () => {
    const voices = [v('Cantonese', 'zh-HK'), v('English', 'en-GB'), v('Mandarin 2', 'zh-CN', false), v('Mandarin', 'zh-CN')];
    expect(rankVoices(voices, 'zh-CN').map((x) => x.name)).toEqual(['Mandarin', 'Mandarin 2', 'Cantonese']);
  });
});
