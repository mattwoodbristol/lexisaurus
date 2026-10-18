import { describe, it, expect } from 'vitest';
import { DEFAULT_STEP_COUNTS, joinTiles, moveTile, stepCounts, nextStep, pickWarmup, sameZh, scoreCheck, shuffle, splitDrills, stepsFor, tilesFor } from '../src/core/lessons/steps';
import type { Token } from '../src/core/pinyin/annotate';

const tok = (...t: string[]): Token[] => t.map((text) => ({ text, ...(/[一-鿿]/.test(text) ? { status: 'known' as const, pinyin: 'x' } : {}) }));

describe('lesson steps', () => {
  it('orders the steps, with warm-up and fix only when there is material', () => {
    expect(stepsFor({ errors: [{ wrong: 'a', right: 'b' }] }, true)).toEqual(['warmup', 'learn', 'recognise', 'build', 'produce', 'fix', 'use', 'check']);
    expect(stepsFor({ errors: [] }, false)).toEqual(['learn', 'recognise', 'build', 'produce', 'use', 'check']);
  });
  it('splits drills between build and produce', () => {
    const d = (n: number) => Array.from({ length: n }, (_, i) => ({ en: `e${i}`, zh: `中${i}` }));
    expect(splitDrills(d(8)).build).toHaveLength(3);
    expect(splitDrills(d(8)).produce).toHaveLength(5);
    expect(splitDrills(d(3)).build).toHaveLength(1);
    expect(splitDrills(d(3)).produce).toHaveLength(2);
    expect(splitDrills(d(8), { build: 2, produce: 3 }).build).toHaveLength(2);
    expect(splitDrills(d(8), { build: 2, produce: 3 }).produce.map((x) => x.en)).toEqual(['e2', 'e3', 'e4']);
    expect(splitDrills(d(8), { build: 10, produce: 10 }).build).toHaveLength(6);
  });
  it('reads step counts from settings, falling back to the defaults', () => {
    expect(stepCounts({})).toEqual(DEFAULT_STEP_COUNTS);
    expect(stepCounts({ 'lesson.recognise_count': 2, 'lesson.build_count': 0, 'lesson.produce_count': 'x' })).toEqual({ recognise: 2, build: 3, produce: 5 });
  });
  it('makes tiles without the final punctuation', () => {
    expect(tilesFor(tok('今天', '比', '昨天', '冷', '。'))).toEqual({ tiles: ['今天', '比', '昨天', '冷'], ending: '。' });
    expect(tilesFor(tok('你好', '！'))).toBeNull();
  });

  it('leaves punctuation out of the tiles', () => {
    expect(tilesFor(tok('Se', 'avessi', 'tempo', ',', 'verrei', '.'))).toEqual({ tiles: ['Se', 'avessi', 'tempo', 'verrei'], ending: '.' });
    expect(tilesFor(tok('如果', '有', '时间', '，', '我', '就', '来', '。'))).toEqual({ tiles: ['如果', '有', '时间', '我', '就', '来'], ending: '。' });
    expect(tilesFor(tok('«', 'Vieni', "l'", 'anno', '»'))!.tiles).toEqual(['Vieni', "l'", 'anno']);
  });

  it('moves a tile to a new place', () => {
    expect(moveTile(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTile(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('shuffles deterministically and never returns the original order', () => {
    const a = ['a', 'b', 'c', 'd'];
    expect(shuffle(a, 7)).toEqual(shuffle(a, 7));
    expect(shuffle(a, 7).sort()).toEqual(a);
    for (let s = 1; s < 30; s++) expect(shuffle(a, s)).not.toEqual(a);
  });
  it('matches typed Chinese loosely on punctuation', () => {
    expect(sameZh('今天比昨天冷', '今天比昨天冷。')).toBe(true);
    expect(sameZh('今天 比 昨天冷！', '今天比昨天冷。')).toBe(true);
    expect(sameZh('今天比昨天很冷', '今天比昨天冷。')).toBe(false);
    expect(sameZh('', '。')).toBe(false);
  });
  it('scores against the pass mark', () => {
    const r = (n: number, of: number) => Array.from({ length: of }, (_, i) => ({ right: i < n }));
    expect(scoreCheck(r(7, 8))).toEqual({ score: 7, total: 8, percent: 88, passed: true });
    expect(scoreCheck(r(6, 8))).toEqual({ score: 6, total: 8, percent: 75, passed: false });
    expect(scoreCheck(r(6, 8), 75).passed).toBe(true);
    expect(scoreCheck([]).passed).toBe(false);
  });
  it('picks one warm-up question per earlier lesson, most due first, choices preferred', () => {
    const choice = { prompt: 'p', options: ['甲', '乙'], answer: 0 };
    const items = pickWarmup(
      [
        { lessonId: 1, lessonTitle: 'L1', dueAt: null, content: { check: [{ kind: 'translate', en: 'x', zh: '中' }] } },
        { lessonId: 2, lessonTitle: 'L2', dueAt: '2026-10-06', content: { recognise: [choice] } },
        { lessonId: 3, lessonTitle: 'L3', dueAt: '2026-10-01', content: { check: [{ kind: 'choice', ...choice }, { kind: 'translate', en: 'y', zh: '文' }] } },
        { lessonId: 4, lessonTitle: 'L4', dueAt: '2026-10-09', content: {} },
      ],
      1,
    );
    expect(items.map((i) => i.lessonId)).toEqual([3, 2, 1]);
    expect(items[0]!.kind).toBe('choice');
    expect(items[2]!.kind).toBe('translate');
  });
});

describe('next step', () => {
  it('is the first unfinished step, ignoring the warm-up, and null once all are done', () => {
    const withFix = { errors: [{ wrong: 'x', right: 'y', note: '' }] };
    expect(nextStep(withFix, [])).toBe('learn');
    expect(nextStep(withFix, ['learn', 'recognise', 'build'])).toBe('produce');
    expect(nextStep(withFix, ['warmup', 'learn', 'recognise', 'build', 'produce'])).toBe('fix');
    expect(nextStep({ errors: [] }, ['learn', 'recognise', 'build', 'produce', 'use', 'check'])).toBeNull();
  });
});

describe('joinTiles', () => {
  it('runs Chinese tiles together', () => {
    expect(joinTiles(['今天', '比', '昨天', '冷'], false)).toBe('今天比昨天冷');
  });
  it('spaces Latin words but not after an elided article', () => {
    expect(joinTiles(['Mi', 'auguro', 'che', "l'", 'accordo', 'regga'], true)).toBe("Mi auguro che l'accordo regga");
    expect(joinTiles(['dell’', 'anno'], true)).toBe('dell’anno');
  });
});
