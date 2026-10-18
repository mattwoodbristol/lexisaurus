import { describe, it, expect } from 'vitest';
import { acceptHint, hintInstruction, pickCandidates, shouldOfferHint, type HintCandidate } from '../src/core/chat/hints';

const pt = (id: number, over: Partial<HintCandidate> = {}): HintCandidate => ({ id, title: `gp${id}`, summary: null, lessonId: id, dueAt: null, ...over });

describe('when to offer a grammar hint', () => {
  it('never on the opening message or when switched off', () => {
    expect(shouldOfferHint({ every: 4, tutorRepliesSoFar: 0, repliesSinceHint: null })).toBe(false);
    expect(shouldOfferHint({ every: 0, tutorRepliesSoFar: 10, repliesSinceHint: null })).toBe(false);
  });
  it('at most one every N tutor replies', () => {
    // every 4: replies 1-3 plain, the 4th (3 replies so far) may carry one.
    expect([1, 2, 3].map((n) => shouldOfferHint({ every: 4, tutorRepliesSoFar: n, repliesSinceHint: null }))).toEqual([false, false, true]);
    expect(shouldOfferHint({ every: 4, tutorRepliesSoFar: 5, repliesSinceHint: 1 })).toBe(false);
    expect(shouldOfferHint({ every: 4, tutorRepliesSoFar: 7, repliesSinceHint: 3 })).toBe(true);
    expect(shouldOfferHint({ every: 1, tutorRepliesSoFar: 1, repliesSinceHint: 0 })).toBe(true);
  });
});

describe('which points to offer', () => {
  it('skips points already hinted in this chat and puts due ones first', () => {
    const pts = [pt(1), pt(2, { dueAt: '2026-10-09' }), pt(3, { dueAt: '2026-10-06' }), pt(4), pt(5)];
    expect(pickCandidates(pts, new Set([3])).map((p) => p.id)).toEqual([2, 5, 4, 1]);
    expect(pickCandidates(pts, new Set(), 2).map((p) => p.id)).toEqual([3, 2]);
  });
  it('lists them for the model with ids', () => {
    const text = hintInstruction([pt(7, { title: '是…的', summary: 'emphasise when/where/how' })]);
    expect(text).toContain('id 7: 是…的 (emphasise when/where/how)');
    expect(text).toMatch(/set "hint" to null/);
  });
});

describe('accepting the model hint', () => {
  const offered = [pt(7, { title: '是…的', lessonId: 12 })];
  it('keeps a hint for an offered point', () => {
    expect(acceptHint({ grammarPointId: 7, text: '  Try 是…的 to say  when you went. ' }, offered)).toEqual({
      grammarPointId: 7,
      text: 'Try 是…的 to say when you went.',
      title: '是…的',
      lessonId: 12,
    });
  });
  it('drops null, unknown points, empty or rambling text', () => {
    expect(acceptHint(null, offered)).toBeNull();
    expect(acceptHint({ grammarPointId: 8, text: 'Try this' }, offered)).toBeNull();
    expect(acceptHint({ grammarPointId: 7, text: '  ' }, offered)).toBeNull();
    expect(acceptHint({ grammarPointId: 7, text: 'x'.repeat(200) }, offered)).toBeNull();
  });
});
