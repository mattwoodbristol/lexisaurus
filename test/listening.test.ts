import { describe, it, expect } from 'vitest';
import { knownShare, listeningProblems, speakerVoices, type ListeningContent } from '../src/core/listening/types';
import { rulesFor } from '../src/core/text/rules';

const hasHan = rulesFor('han').hasTarget;
const line = (speaker: string | null, text: string) => ({ speaker, text, translation: 'x' });
const q = (answer = 0) => ({ question: 'Who?', options: ['A', 'B', 'C'], answer });

const dialogue = (over: Partial<ListeningContent> = {}): ListeningContent => ({
  title: 'At the shop',
  kind: 'dialogue',
  lines: [line('小王', '你好！'), line('小李', '你好，你要什么？'), line('小王', '我要两个苹果。'), line('小李', '好的。')],
  questions: [q(0), q(2)],
  ...over,
});

describe('generated listening checks', () => {
  it('accepts a well-formed dialogue', () => {
    expect(listeningProblems(dialogue(), hasHan)).toEqual([]);
  });
  it('needs two named speakers in a dialogue, but none in a story', () => {
    const three = dialogue({ lines: [...dialogue().lines, line('小张', '我也要。')] });
    expect(listeningProblems(three, hasHan).join()).toMatch(/two named speakers/);
    const story = dialogue({ kind: 'story', lines: dialogue().lines.map((l) => ({ ...l, speaker: null })) });
    expect(listeningProblems(story, hasHan)).toEqual([]);
  });
  it('rejects lines not in the language, bad answer keys and repeated options', () => {
    const bad = dialogue({
      lines: [line('A', 'Hello'), ...dialogue().lines.slice(1)],
      questions: [q(3), { question: 'Why?', options: ['A', 'A', 'B'], answer: 0 }],
    });
    const p = listeningProblems(bad, hasHan).join('; ');
    expect(p).toMatch(/line 1 is not in the language/);
    expect(p).toMatch(/question 1 answer index/);
    expect(p).toMatch(/question 2 repeats an option/);
  });
  it('limits the length', () => {
    expect(listeningProblems(dialogue({ lines: dialogue().lines.slice(0, 2) }), hasHan).join()).toMatch(/lines/);
    expect(listeningProblems(dialogue({ questions: [q()] }), hasHan).join()).toMatch(/questions/);
  });
});

describe('known share', () => {
  it('counts known words among the words looked up, ignoring punctuation', () => {
    const tokens = [
      [{ text: '我', status: 'known' as const }, { text: '买', status: 'known' as const }, { text: '。' }],
      [{ text: '苹果', status: 'learning' as const }, { text: '榴莲', status: 'unknown' as const }],
    ];
    expect(knownShare(tokens)).toBe(0.5);
    expect(knownShare([[{ text: '。' }]])).toBeNull();
  });
});

describe('speaker voices', () => {
  it('gives the first speaker voice 0 and the second voice 1', () => {
    expect(speakerVoices([{ speaker: 'B' }, { speaker: 'A' }, { speaker: 'B' }, { speaker: null }])).toEqual([0, 1, 0, 0]);
  });
});
