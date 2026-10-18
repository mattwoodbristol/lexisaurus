import { describe, it, expect } from 'vitest';
import { pinyin } from 'pinyin-pro';
import { numberedToMarked, markSyllable } from '../src/core/pinyin/tones';
import { segmentChinese } from '../src/core/pinyin/segment';
import { annotate, showPinyin, unknownWords, candidateLemmas, nextPinyinMode, type WordInfo, type Token } from '../src/core/pinyin/annotate';
import { stripPinyin } from '../src/core/pinyin/strip';

const pinyinFor = (text: string) => pinyin(text, { type: 'all' }).map((x) => (x.isZh ? x.pinyin : ''));

const dict = new Map<string, WordInfo>([
  ['我', { id: 1, status: 'known' }],
  ['明天', { id: 2, status: 'known' }],
  ['在', { id: 3, status: 'known' }],
  ['图书馆', { id: 4, status: 'known', reading: 'tú shū guǎn' }],
  ['学习', { id: 5, status: 'known' }],
  ['中文', { id: 6, status: 'known' }],
  ['翻新', { id: 7, status: 'learning' }],
  ['隔热', { id: 8, status: 'new' }],
  ['也', { id: 9, status: 'known' }],
]);

describe('tone marks', () => {
  it('places marks by the a/e, ou, last-vowel rule', () => {
    expect(markSyllable('guo', 2)).toBe('guó');
    expect(markSyllable('xiu', 1)).toBe('xiū');
    expect(markSyllable('dou', 4)).toBe('dòu');
    expect(markSyllable('nv', 3)).toBe('nǚ');
    expect(markSyllable('lu:', 4)).toBe('lǜ');
    expect(markSyllable('ma', 5)).toBe('ma');
  });
  it('splits concatenated Pleco syllables', () => {
    expect(numberedToMarked('Zhong1guo2')).toBe('Zhōng guó');
    expect(numberedToMarked('tu2shu1guan3')).toBe('tú shū guǎn');
    expect(numberedToMarked("xin1sheng1'er2")).toBe('xīn shēng ér');
    expect(numberedToMarked('ni3 hao3')).toBe('nǐ hǎo');
    expect(numberedToMarked('nǐ hǎo')).toBe('nǐ hǎo'); // already marked: untouched
  });
});

describe('segmentation', () => {
  it('prefers the longest word in the learner list over ICU', () => {
    const segs = segmentChinese('我明天在图书馆学习中文。', (s) => dict.has(s));
    expect(segs.map((s) => s.text)).toEqual(['我', '明天', '在', '图书馆', '学习', '中文', '。']);
  });
  it('falls back to ICU for words not in the list and keeps non-Han runs intact', () => {
    const segs = segmentChinese('Bluebell喝了茶！', (s) => dict.has(s));
    expect(segs[0]).toEqual({ text: 'Bluebell', isHan: false });
    expect(segs.filter((s) => s.isHan).map((s) => s.text).join('|')).toMatch(/^喝\|了\|茶$|^喝了\|茶$/);
    expect(segs.at(-1)).toEqual({ text: '！', isHan: false });
  });
});

describe('annotate + rule', () => {
  const sentence = '我明天在图书馆翻新隔热，Bluebell也来。';
  const tokens = annotate(sentence, dict, pinyinFor);

  it('tags every Han token with a status and pinyin', () => {
    const han = tokens.filter((t) => t.status);
    expect(han.map((t) => [t.text, t.status])).toEqual([
      ['我', 'known'],
      ['明天', 'known'],
      ['在', 'known'],
      ['图书馆', 'known'],
      ['翻新', 'learning'],
      ['隔热', 'new'],
      ['也', 'known'],
      ['来', 'unknown'],
    ]);
    for (const t of han) expect(t.pinyin).toBeTruthy();
    expect(tokens.find((t) => t.text === 'Bluebell')?.pinyin).toBeUndefined();
  });

  it('uses the stored reading when present, generated pinyin otherwise', () => {
    expect(tokens.find((t) => t.text === '图书馆')?.pinyin).toBe('tú shū guǎn');
    expect(tokens.find((t) => t.text === '翻新')?.pinyin).toBe('fān xīn');
  });

  it('smart mode shows pinyin for learning, new and unknown words only', () => {
    const shown = tokens.filter((t) => showPinyin(t, 'smart')).map((t) => t.text);
    expect(shown).toEqual(['翻新', '隔热', '来']);
  });

  it('off shows nothing, all shows every Han word', () => {
    expect(tokens.some((t) => showPinyin(t, 'off'))).toBe(false);
    expect(tokens.filter((t) => showPinyin(t, 'all')).length).toBe(8);
  });

  it('is deterministic: the same input always yields the same decision', () => {
    expect(annotate(sentence, dict, pinyinFor)).toEqual(tokens);
  });

  it('reads 了 in context, not in isolation', () => {
    const t = annotate('我吃了饭。', new Map(), pinyinFor);
    expect(t.find((x) => x.text.includes('了'))?.pinyin).toMatch(/\ble\b/);
  });

  it('lists unknown words once each', () => {
    expect(unknownWords(tokens)).toEqual(['来']);
  });

  it('produces candidate lemmas for a single IN lookup', () => {
    expect(candidateLemmas('图书馆。', 3)).toEqual(['图', '图书', '图书馆', '书', '书馆', '馆']);
  });

  it('cycles modes off -> smart -> all -> off', () => {
    expect(nextPinyinMode('off')).toBe('smart');
    expect(nextPinyinMode('smart')).toBe('all');
    expect(nextPinyinMode('all')).toBe('off');
  });

  it('showPinyin is false for tokens without pinyin', () => {
    const t: Token = { text: 'hi' };
    expect(showPinyin(t, 'all')).toBe(false);
  });
});

describe('stripPinyin', () => {
  it('removes bracketed pinyin next to Hanzi', () => {
    expect(stripPinyin('你好（nǐ hǎo）！今天（jīntiān）怎么样?')).toBe('你好！今天怎么样?');
    expect(stripPinyin('我喜欢 (wǒ xǐhuan) 咖啡')).toBe('我喜欢 咖啡');
    expect(stripPinyin('图书馆 (tu2shu1guan3)')).toBe('图书馆');
  });
  it('drops lines that are pure pinyin', () => {
    expect(stripPinyin('我很好。\nWǒ hěn hǎo.\n你呢？')).toBe('我很好。\n你呢？');
  });
  it('leaves English explanations and names alone', () => {
    const s = 'This means "I am fine". Bluebell 是我的猫。';
    expect(stripPinyin(s)).toBe(s);
    const g = 'Grammar: 是…的 emphasises when something happened.';
    expect(stripPinyin(g)).toBe(g);
  });
});
