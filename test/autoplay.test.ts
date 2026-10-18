import { describe, it, expect } from 'vitest';
import { autoplayText } from '../src/core/review/autoplay';
import { BLANK } from '../src/core/review/exercise';

const word = { lemma: '检查' };

describe('review auto-play', () => {
  it('plays Chinese prompts on show, never answers', () => {
    expect(autoplayText({ kind: 'zh_to_en', promptZh: '我在检查。', answerEn: 'I am checking.' }, word, false)).toBe('我在检查。');
    expect(autoplayText({ kind: 'intro' }, word, false)).toBe('检查');
    expect(autoplayText({ kind: 'en_to_zh', promptEn: 'x', answerZh: '我在检查。' }, word, false)).toBeNull();
    expect(autoplayText({ kind: 'flash' }, word, false)).toBeNull();
    expect(autoplayText({ kind: 'cloze', clozeZh: `我在${BLANK}。`, answerZh: '检查' }, word, false)).toBeNull();
  });
  it('plays the Chinese answer once revealed', () => {
    expect(autoplayText({ kind: 'cloze', clozeZh: `我在${BLANK}。`, answerZh: '检查' }, word, true)).toBe('我在检查。');
    expect(autoplayText({ kind: 'en_to_zh', promptEn: 'x', answerZh: '我在检查。' }, word, true)).toBe('我在检查。');
    expect(autoplayText({ kind: 'flash' }, word, true)).toBe('检查');
    expect(autoplayText({ kind: 'zh_to_en', promptZh: '我在检查。' }, word, true)).toBeNull();
    expect(autoplayText({ kind: 'quiz', quiz: [] }, undefined, false)).toBeNull();
  });
});
