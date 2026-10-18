import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLessonNotes, splitCorrection } from '../src/core/lessons/parse-notes';
import { validateLesson, renderLessonMd, lessonStrings, type LessonContent } from '../src/core/lessons/types';

const sample = `Mandarin Coach
# Lesson 4: 比 — Comparisons
Grammar pattern: A 比 B + adjective
## Grammar Explanation
To compare two things in Chinese, use: A 比 B + adjective.
Examples
今天比昨天冷。  Today is colder than yesterday.
我没有你高。  I'm not as tall as you. (Negative)
Key Points
- No word for 'more' needed
- Negative: A 没有 B + adjective
## Translation Drills
English
Chinese
Pinyin
Bristol is bigger than Nottingham.
布里斯托比诺丁汉大。
Bùlǐsītuō bǐ Nuòdīnghàn dà.
Today is much colder than yesterday.
今天比昨天冷多了。
Jīntiān bǐ zuótiān lěng duō le.
Chinese is harder than Italian.
中文比意大利语难。
Zhōngwén bǐ Yìdàlìyǔ nán.
## Common Errors
Error
Correction
比英文没不同
跟英文没什么不同 (use 跟 not 比 for similarity)
# Recurring Errors — Quick Reference
These are the most common mistakes from all 20 lessons. Review regularly!
Error
Correction
没 + 了
NEVER combine: 没去 ✓, 没去了 ✗
`;

describe('lesson notes parser', () => {
  const { lessons, recurringErrors } = parseLessonNotes(sample);

  it('extracts every section of a lesson', () => {
    expect(lessons).toHaveLength(1);
    const l = lessons[0]!;
    expect(l.number).toBe(4);
    expect(l.title).toBe('Lesson 4: 比 — Comparisons');
    expect(l.pattern).toBe('A 比 B + adjective');
    expect(l.explanation).toEqual(['To compare two things in Chinese, use: A 比 B + adjective.']);
    expect(l.examples).toEqual([
      { zh: '今天比昨天冷。', en: 'Today is colder than yesterday.' },
      { zh: '我没有你高。', en: "I'm not as tall as you. (Negative)" },
    ]);
    expect(l.keyPoints).toEqual(["No word for 'more' needed", 'Negative: A 没有 B + adjective']);
    expect(l.drills).toHaveLength(3);
    expect(l.drills[0]).toEqual({ en: 'Bristol is bigger than Nottingham.', zh: '布里斯托比诺丁汉大。' });
    expect(l.errors).toEqual([{ wrong: '比英文没不同', right: '跟英文没什么不同', note: 'use 跟 not 比 for similarity' }]);
    expect(l.grammarPoints[0]!.title).toBe('比');
  });

  it('drops the pinyin column (the app adds pinyin itself)', () => {
    expect(JSON.stringify(lessons[0]!.drills)).not.toMatch(/Bùlǐsītuō/);
  });

  it('reads the recurring errors table', () => {
    expect(recurringErrors).toEqual([{ wrong: '没 + 了', right: 'NEVER combine: 没去 ✓, 没去了 ✗' }]);
  });

  it('splits a correction from its trailing note', () => {
    expect(splitCorrection('讲得很清楚 (degree particle 得, not possessive 的)')).toEqual({
      right: '讲得很清楚',
      note: 'degree particle 得, not possessive 的',
    });
    expect(splitCorrection('Always 没有用, NEVER 不有用')).toEqual({ right: 'Always 没有用, NEVER 不有用' });
  });

  const real = join(process.cwd(), 'data/course/mandarin-lessons-1-20.md');
  it.skipIf(!existsSync(real))('parses all 20 real lessons into valid lessons', () => {
    const parsed = parseLessonNotes(readFileSync(real, 'utf8'));
    expect(parsed.lessons.map((l) => l.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    for (const l of parsed.lessons) expect(validateLesson(l), l.title).toEqual([]);
    expect(parsed.recurringErrors.length).toBeGreaterThanOrEqual(10);
  });
});

describe('lesson validation and rendering', () => {
  const good: LessonContent = {
    title: '离 for distance',
    level: 'HSK 3',
    pattern: 'A 离 B + 远/近',
    explanation: ['离 marks distance from a fixed point.'],
    examples: [
      { zh: '我家离公司很近。', en: 'My home is close to the office.' },
      { zh: '布里斯托离伦敦不远。', en: 'Bristol is not far from London.' },
    ],
    keyPoints: ['离 is static; 从…到 is movement.'],
    drills: [
      { en: 'The station is far from here.', zh: '车站离这儿很远。' },
      { en: 'My office is near the harbour.', zh: '我的办公室离港口很近。' },
      { en: 'Is the library far from your home?', zh: '图书馆离你家远吗？' },
    ],
    errors: [{ wrong: '从我家到公司很近', right: '我家离公司很近', note: 'static distance uses 离' }],
    grammarPoints: [{ title: '离', summary: 'Distance from a fixed point.' }],
  };

  it('accepts a well-formed lesson', () => {
    expect(validateLesson(good)).toEqual([]);
  });

  it('rejects missing parts and pinyin in Chinese fields', () => {
    expect(validateLesson({ ...good, drills: good.drills.slice(0, 1) })).toContain('need at least 3 drills');
    expect(validateLesson({ ...good, grammarPoints: [] })).toContain('need at least 1 grammar point');
    const withPinyin = { ...good, examples: [{ zh: '我家离公司很近 (wǒ jiā lí gōngsī hěn jìn)', en: 'x' }, good.examples[1]!] };
    expect(validateLesson(withPinyin).some((p) => p.startsWith('pinyin found'))).toBe(true);
    expect(validateLesson(null)).toEqual(['not an object']);
  });

  it('renders searchable markdown and lists Chinese strings for annotation', () => {
    const md = renderLessonMd(good);
    expect(md).toContain('# 离 for distance');
    expect(md).toContain('车站离这儿很远。');
    expect(md).toContain('✗ 从我家到公司很近 → ✓ 我家离公司很近');
    const strings = lessonStrings(good);
    expect(strings).toContain('我家离公司很近。');
    expect(strings).not.toContain('The station is far from here.');
  });
});
