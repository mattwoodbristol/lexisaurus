import { describe, expect, it } from 'vitest';
import { applyFix, hasFix } from '../src/core/lessons/fix';
import { validateLesson, type LessonContent } from '../src/core/lessons/types';

const lesson: LessonContent = {
  title: 'Il periodo ipotetico',
  level: 'C1',
  pattern: 'se + congiuntivo imperfetto, condizionale presente',
  explanation: ['Possible hypotheses use se + congiuntivo imperfetto.'],
  examples: [
    { zh: 'Ritengo che la proposta meriti attenzione.', en: 'I think the proposal deserves attention.' },
    { zh: 'Bisogna che tu venga.', en: 'You need to come.' },
  ],
  keyPoints: ['Never the conditional after se.'],
  drills: [
    { en: 'If I had time, I would come.', zh: 'Se avessi tempo, verrei.' },
    { en: 'If it rained, we would stay home.', zh: 'Se piovesse, resteremmo a casa.' },
    { en: 'If you knew, you would tell me.', zh: 'Se lo sapessi, me lo diresti.' },
  ],
  errors: [],
  grammarPoints: [{ title: 'Il periodo ipotetico', summary: 'se + congiuntivo imperfetto' }],
};
const none = { explanation: null, examples: null, drills: null, keyPoints: null };

describe('applyFix', () => {
  it('replaces only the sections given', () => {
    const examples = [
      { zh: 'Se avessi più tempo, leggerei di più.', en: 'If I had more time, I would read more.' },
      { zh: 'Se fossi in te, accetterei.', en: 'If I were you, I would accept.' },
    ];
    const out = applyFix(lesson, { ...none, examples });
    expect(out.examples).toEqual(examples);
    expect(out.drills).toBe(lesson.drills);
    expect(out.explanation).toBe(lesson.explanation);
    expect(validateLesson(out, 'latin')).toEqual([]);
  });

  it('keeps a section when its fix is empty', () => {
    expect(applyFix(lesson, { ...none, examples: [] })).toEqual(lesson);
  });

  it('a fix that breaks the lesson is caught by the validator', () => {
    expect(validateLesson(applyFix(lesson, { ...none, examples: [{ zh: 'Se fossi in te, accetterei.', en: 'If I were you, I would accept.' }] }), 'latin')).not.toEqual([]);
  });
});

describe('hasFix', () => {
  it('is true only with a section to replace', () => {
    expect(hasFix(null)).toBe(false);
    expect(hasFix(none)).toBe(false);
    expect(hasFix({ ...none, keyPoints: [] })).toBe(false);
    expect(hasFix({ ...none, keyPoints: ['x'] })).toBe(true);
  });
});
