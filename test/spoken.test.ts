import { describe, it, expect } from 'vitest';
import { compareSpoken, blankPart, hintShown, heardWord, numberToZh, saidWord, soundsFrom, spokenRating } from '../src/core/speech/compare';
import { makeExercise } from '../src/core/review/exercise';

describe('numbers the recogniser writes as digits', () => {
  it('writes small numbers as Chinese numerals', () => {
    expect(numberToZh(3)).toBe('三');
    expect(numberToZh(10)).toBe('十');
    expect(numberToZh(15)).toBe('十五');
    expect(numberToZh(20)).toBe('二十');
    expect(numberToZh(105)).toBe('一百零五');
    expect(numberToZh(2026)).toBe('二千零二十六');
  });
});

describe('comparing speech with the target (Mandarin)', () => {
  it('matches ignoring punctuation', () => {
    const r = compareSpoken('han', '我想买三本书。', ['我想买三本书']);
    expect(r.match).toBe(true);
    expect(r.score).toBe(1);
    expect(r.parts.at(-1)).toEqual({ text: '。', ok: true });
  });
  it('treats digits as the numerals they stand for', () => {
    expect(compareSpoken('han', '我有三个苹果', ['我有3个苹果']).match).toBe(true);
  });
  it('marks the characters that were heard as something else', () => {
    const r = compareSpoken('han', '我想卖书', ['我想买书']);
    expect(r.match).toBe(false);
    expect(r.parts.map((p) => p.ok)).toEqual([true, true, false, true]);
    expect(r.score).toBe(0.75);
  });
  it('keeps the closest of several alternatives', () => {
    const r = compareSpoken('han', '他去过北京', ['他去过背景', '他去过北京']);
    expect(r.match).toBe(true);
    expect(r.heard).toBe('他去过北京');
  });
  it('handles nothing heard', () => {
    const r = compareSpoken('han', '你好', ['']);
    expect(r.match).toBe(false);
    expect(r.parts).toEqual([
      { text: '你', ok: false },
      { text: '好', ok: false },
    ]);
  });
});

describe('comparing speech with the target (Italian)', () => {
  it('ignores case and punctuation', () => {
    expect(compareSpoken('latin', 'Vorrei un caffè, per favore.', ['vorrei un caffè per favore']).match).toBe(true);
  });
  it('marks missed words and keeps the spacing', () => {
    const r = compareSpoken('latin', 'Ci vediamo domani', ['ci vedremo domani']);
    expect(r.parts).toEqual([
      { text: 'Ci', ok: true },
      { text: ' ', ok: true },
      { text: 'vediamo', ok: false },
      { text: ' ', ok: true },
      { text: 'domani', ok: true },
    ]);
  });
});

describe('suggested rating', () => {
  it('Good when understood, Hard when nearly, Pass otherwise', () => {
    expect(spokenRating(compareSpoken('han', '我想买书', ['我想买书']))).toBe(3);
    expect(spokenRating(compareSpoken('han', '我想买书', ['我想卖书']))).toBe(2);
    expect(spokenRating(compareSpoken('han', '我想买书', ['你好']))).toBe(1);
  });
});

describe('allowing for the recogniser', () => {
  const sounds = { 他: 'tā', 她: 'tā', 在: 'zài', 再: 'zài', 买: 'mǎi', 卖: 'mài', 我: 'wǒ', 想: 'xiǎng', 书: 'shū', 去: 'qù', 学: 'xué', 校: 'xiào' };
  it('counts a character that sounds the same as heard', () => {
    const r = compareSpoken('han', '她去学校', ['他去学校'], sounds);
    expect(r.score).toBe(1);
    expect(r.parts.every((p) => p.ok)).toBe(true);
    expect(spokenRating(r)).toBe(3);
  });
  it('gives half for the same syllable in another tone', () => {
    const r = compareSpoken('han', '我想买书', ['我想卖书'], sounds);
    expect(r.score).toBe(0.875);
    expect(r.parts[2]).toEqual({ text: '买', ok: false, close: true });
  });
  it('without sounds, compares characters as before', () => {
    expect(compareSpoken('han', '她去学校', ['他去学校']).score).toBe(0.75);
  });
  it('ignores accents and apostrophes in Italian', () => {
    expect(compareSpoken('latin', 'Perché è così?', ['perche e cosi']).match).toBe(true);
  });
  it('rates nearly all of it as Good', () => {
    const r = compareSpoken('latin', 'uno due tre quattro cinque sei sette otto nove dieci', ['uno due tre quattro cinque sei sette otto nove'], undefined);
    expect(r.score).toBe(0.9);
    expect(spokenRating(r)).toBe(3);
    expect(spokenRating(compareSpoken('latin', 'uno due tre quattro cinque', ['uno due tre']))).toBe(2);
    expect(spokenRating(compareSpoken('latin', 'uno due tre quattro cinque', ['uno']))).toBe(1);
  });
  it('reads sounds from annotation tokens', () => {
    expect(soundsFrom([{ text: '课堂', pinyin: 'kè táng' }, { text: '。' }, { text: '在', pinyin: 'zài' }])).toEqual({ 课: 'kè', 堂: 'táng', 在: 'zài' });
  });
});

describe('Say it in the target language', () => {
  it('keeps the word being practised, to check it was said', () => {
    const ex = makeExercise('en_to_zh', { id: 1, zh: '我买化肥。', en: 'I buy fertilizer.', target: '化肥' });
    expect(ex.target).toBe('化肥');
    expect(ex.clozeZh).toBeUndefined();
  });

  it('counts the word as said only when its own characters were heard', () => {
    const target = '姑姑要买化肥，因为家里的树不好。';
    const right = compareSpoken('han', target, ['姑姑要买化肥因为家里的树不好']);
    expect(heardWord(right, '化肥')).toBe(true);
    // Nearly all the sentence, but not the word being practised.
    const missed = compareSpoken('han', target, ['姑姑要买因为家里的树不好']);
    expect(heardWord(missed, '化肥')).toBe(false);
    expect(heardWord(missed, '姑姑')).toBe(true);
  });
});

describe('saidWord', () => {
  it('finds the tested word anywhere in what was said', () => {
    expect(saidWord('latin', 'Il cane oggi corre nel parco', 'corre')).toBe(true);
    expect(saidWord('latin', 'Nel parco il cane corre', 'il cane')).toBe(true);
    expect(saidWord('latin', 'Perche il cane corre', 'perché')).toBe(true);
    expect(saidWord('latin', 'Il cane va nel parco', 'corre')).toBe(false);
    expect(saidWord('han', '今天我很忙', '很忙')).toBe(true);
    expect(saidWord('han', '我今天非常忙', '很忙')).toBe(false);
  });
});

describe('hint after a missed Say-it try', () => {
  const parts = (s: string) => compareSpoken('latin', s, ['']).parts;
  it('uncovers a third of the hidden words per miss, never the tested word', () => {
    const p = parts('Il cane corre nel parco.');
    const words = p.map((x, i) => (x.text.trim() ? i : -1)).filter((i) => i >= 0);
    let shown = hintShown('latin', p, new Set(), 'corre');
    const visible = () => words.filter((i) => shown.has(i)).map((i) => p[i]!.text);
    expect(visible()).toEqual(['Il', 'cane']);
    shown = hintShown('latin', p, shown, 'corre');
    expect(visible()).toEqual(['Il', 'cane', 'nel']);
    shown = hintShown('latin', p, shown, 'corre');
    shown = hintShown('latin', p, shown, 'corre');
    expect(visible()).toEqual(['Il', 'cane', 'nel', 'parco.']);
  });
  it('does not give away the tested word when the rest was said right', () => {
    const r = compareSpoken('han', '我很喜欢吃苹果。', ['我很喜欢吃饭']);
    const shown = hintShown('han', r.parts, new Set(), '苹果');
    expect(r.parts.map((x, i) => (shown.has(i) ? x.text : '＿')).join('')).toBe('我很喜欢吃＿＿。');
  });
  it('shows the tested word once it was said right', () => {
    const r = compareSpoken('han', '我很喜欢吃苹果。', ['苹果']);
    const shown = hintShown('han', r.parts, new Set(), '苹果');
    expect(r.parts.filter((_, i) => shown.has(i)).map((x) => x.text).join('')).toContain('苹果');
  });
  it('shows what was said right', () => {
    const r = compareSpoken('latin', 'Il cane corre nel parco.', ['il cane va']);
    const shown = hintShown('latin', r.parts, new Set(), 'corre');
    expect(r.parts.filter((_, i) => shown.has(i)).map((x) => x.text).filter((t) => t.trim())).toEqual(['Il', 'cane', 'nel']);
  });
  it('blanks a word letter for letter, keeping punctuation', () => {
    expect(blankPart('latin', 'parco.')).toBe('_____.');
    expect(blankPart('han', '狗')).toBe('＿');
  });
});
