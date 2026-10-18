import { describe, it, expect } from 'vitest';
import { acceptUses, usageInstruction } from '../src/core/chat/usage';

const points = [
  { id: 4, title: '比', summary: 'A 比 B + adjective' },
  { id: 9, title: '越来越', summary: null },
];

describe('grammar use in chat', () => {
  it('lists the studied points for the tutor', () => {
    expect(usageInstruction(points)).toContain('id 4: 比 (A 比 B + adjective)');
  });
  it('keeps uses that quote the learner, marks hinted ones as prompted', () => {
    const out = acceptUses(
      [
        { grammarPointId: 4, correct: true, quote: '布里斯托比伦敦小' },
        { grammarPointId: 9, correct: false, quote: '越来越很冷' },
      ],
      points,
      '我觉得布里斯托比伦敦小，天气越来越很冷。',
      9,
    );
    expect(out).toEqual([
      { grammarPointId: 4, correct: true, quote: '布里斯托比伦敦小', prompted: false },
      { grammarPointId: 9, correct: false, quote: '越来越很冷', prompted: true },
    ]);
  });
  it('drops unknown points, duplicates and quotes the learner did not write', () => {
    const out = acceptUses(
      [
        { grammarPointId: 77, correct: true, quote: '我' },
        { grammarPointId: 4, correct: true, quote: '伦敦比布里斯托大' }, // from the tutor, not the learner
        { grammarPointId: 4, correct: true, quote: '我比你高' },
        { grammarPointId: 4, correct: true, quote: '我比你高' },
      ],
      points,
      '我比你高！',
      null,
    );
    expect(out.map((u) => u.quote)).toEqual(['我比你高']);
  });
});
