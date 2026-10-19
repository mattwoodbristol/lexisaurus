import { describe, expect, it } from 'vitest';
import { applyFix, fixAnswerKey, fromFlat, hasFix } from '../src/core/lessons/fix';
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

describe('fixing practice questions', () => {
  it('turns the flat check items the model writes into lesson check items', () => {
    expect(fromFlat({ kind: 'fix', prompt: null, options: null, answer: null, en: null, zh: null, wrong: 'Se avrei tempo, verrei.', right: 'Se avessi tempo, verrei.', note: 'congiuntivo after se' })).toEqual({
      kind: 'fix',
      wrong: 'Se avrei tempo, verrei.',
      right: 'Se avessi tempo, verrei.',
      note: 'congiuntivo after se',
    });
    expect(fromFlat({ kind: 'choice', prompt: 'If I had time…', options: ['a', 'b'], answer: 1, en: null, zh: null, wrong: null, right: null, note: null })).toEqual({ kind: 'choice', prompt: 'If I had time…', options: ['a', 'b'], answer: 1 });
  });
  it('replaces the lesson check and counts as a fix', () => {
    const check = [{ kind: 'translate' as const, en: 'If I had time, I would come.', zh: 'Se avessi tempo, verrei.' }];
    expect(hasFix({ ...none, check })).toBe(true);
    expect(applyFix({ ...lesson, check: [] }, { ...none, check }).check).toEqual(check);
  });
});

describe('fixAnswerKey', () => {
  const sectioned: LessonContent = {
    ...lesson,
    errors: [{ wrong: 'Se avrei tempo, verrei.', right: 'Se avessi tempo, venirei.', note: 'congiuntivo' }],
    recognise: [{ prompt: 'If I had time, I would come.', options: ['Se avrei tempo, verrei.', 'Se avessi tempo, verrei.', 'Se ho tempo, verrei.'], answer: 0 }],
    check: [
      { kind: 'choice', prompt: 'If I had time, I would come.', options: ['Se avrei tempo, verrei.', 'Se avessi tempo, verrei.'], answer: 0 },
      { kind: 'translate', en: 'If it rained, we would stay home.', zh: 'Se pioveva, restavamo a casa.' },
      { kind: 'fix', wrong: 'Se avrei tempo, verrei.', right: 'Se avessi tempo, venirei.' },
    ],
  };
  it('moves a multiple-choice key to the right option, in quick questions and the check', () => {
    const out = fixAnswerKey(sectioned, { kind: 'choice', task: 'If I had time, I would come.', expected: 'Se avrei tempo, verrei.', better: 'Se avessi tempo, verrei.' })!;
    expect(out.recognise![0]!.answer).toBe(1);
    expect(out.check![0]).toMatchObject({ answer: 1 });
  });
  it('rewrites the keyed option when no option is right', () => {
    const out = fixAnswerKey(sectioned, { kind: 'choice', task: 'If I had time, I would come.', expected: 'Se avrei tempo, verrei.', better: 'Se avessi avuto tempo, sarei venuto.' })!;
    expect(out.recognise![0]!.options[0]).toBe('Se avessi avuto tempo, sarei venuto.');
  });
  it('corrects a translation key in the check and the drills', () => {
    const out = fixAnswerKey(sectioned, { kind: 'translate', task: 'If it rained, we would stay home.', expected: 'Se pioveva, restavamo a casa.', better: 'Se piovesse, resteremmo a casa.' })!;
    expect(out.check![1]).toEqual({ kind: 'translate', en: 'If it rained, we would stay home.', zh: 'Se piovesse, resteremmo a casa.' });
    const drill = fixAnswerKey(sectioned, { kind: 'translate', task: 'If I had time, I would come.', expected: 'Se avessi tempo, verrei.', better: 'Se avessi tempo, io verrei.' })!;
    expect(drill.drills[0]!.zh).toBe('Se avessi tempo, io verrei.');
  });
  it('corrects a fix key in the check and the common errors', () => {
    const out = fixAnswerKey(sectioned, { kind: 'fix', task: 'Se avrei tempo, verrei.', expected: 'Se avessi tempo, venirei.', better: 'Se avessi tempo, verrei.' })!;
    expect(out.check![2]).toMatchObject({ right: 'Se avessi tempo, verrei.' });
    expect(out.errors[0]!.right).toBe('Se avessi tempo, verrei.');
  });
  it('changes nothing when the question is not in the lesson or the key is the same', () => {
    expect(fixAnswerKey(sectioned, { kind: 'translate', task: 'Something else.', expected: 'x', better: 'y' })).toBeNull();
    expect(fixAnswerKey(sectioned, { kind: 'translate', task: 'If it rained, we would stay home.', expected: 'Se pioveva, restavamo a casa.', better: 'Se pioveva, restavamo a casa.' })).toBeNull();
  });
});

describe('a corrected key that is not just an answer', () => {
  it('is never written into the lesson', () => {
    const k = { kind: 'translate' as const, task: 'If I had time, I would come.', expected: 'Se avessi tempo, verrei.' };
    expect(fixAnswerKey(lesson, { ...k, better: "Se avessi tempo, verrei volentieri. (La frase era già corretta: l'esercizio va riformulato con un errore reale.)" })).toBeNull();
    expect(fixAnswerKey(lesson, { ...k, better: 'Se avessi tempo, verrei.\nNote: fine as it is.' })).toBeNull();
    expect(fixAnswerKey(lesson, { ...k, better: 'Se avessi tempo, io verrei.' })).not.toBeNull();
  });
});
