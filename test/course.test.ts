import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseLessonFile, renderLessonFile, slugify, numberedTitle, LessonFileError } from '../src/core/course/lesson-file';
import { assemblePack, lessonContent, type CoursePack } from '../src/core/course/pack';
import { planSync, renumberTitle, canonical, type DbSnapshot, type DbLesson } from '../src/core/course/sync-plan';

function readPackFiles(dir: string) {
  const files: Record<string, string> = {};
  for (const f of readdirSync(join(dir, 'lessons'))) files[basename(f, '.md')] = readFileSync(join(dir, 'lessons', f), 'utf8');
  const topics = existsSync(join(dir, 'topics.json')) ? readFileSync(join(dir, 'topics.json'), 'utf8') : null;
  return { manifest: readFileSync(join(dir, 'course.json'), 'utf8'), files, topics };
}

function examplePack(): CoursePack {
  const { manifest, files, topics } = readPackFiles('examples/course-zh');
  const { pack, problems } = assemblePack(manifest, files, topics);
  expect(problems).toEqual([]);
  return pack!;
}

describe('lesson files', () => {
  it('parse the example lessons and render them back unchanged', () => {
    for (const f of readdirSync('examples/course-zh/lessons')) {
      const md = readFileSync(join('examples/course-zh/lessons', f), 'utf8');
      const parsed = parseLessonFile(md, f);
      expect(renderLessonFile(parsed)).toBe(md);
    }
  });

  it('read the fields', () => {
    const f = parseLessonFile(readFileSync('examples/course-zh/lessons/shi-to-be.md', 'utf8'));
    expect(f.id).toBe('shi-to-be');
    expect(f.title).toBe('是 — To be');
    expect(f.content.level).toBe('HSK 1');
    expect(f.content.pattern).toBe('A 是 B');
    expect(f.content.explanation).toHaveLength(2);
    expect(f.content.examples[1]).toEqual({ zh: '他不是学生。', en: 'He is not a student.' });
    expect(f.content.drills[0]).toEqual({ en: 'I am British.', zh: '我是英国人。' });
    expect(f.content.errors[0]).toEqual({ wrong: '我是忙。', right: '我很忙。', note: 'adjectives do not take 是' });
    expect(f.content.grammarPoints[0]!.title).toBe('是');
    expect(f.content.chatPrompt).toMatch(/Introduce yourself/);
  });

  it('accept CRLF, a "Lesson N:" title and errors without a note', () => {
    const md = '---\r\nid: x\r\nlevel: HSK 1\r\n---\r\n# Lesson 7: 好 — Good\r\n\r\n## Common errors\r\n\r\n- ✗ 很好的 → ✓ 很好\r\n';
    const f = parseLessonFile(md);
    expect(f.title).toBe('好 — Good');
    expect(f.content.errors).toEqual([{ wrong: '很好的', right: '很好' }]);
  });

  it('report malformed lines with the file name', () => {
    const bad = (body: string) => () => parseLessonFile(`---\nid: x\n---\n# T\n\n${body}\n`, 'lessons/x.md');
    expect(bad('## Drills\n\n1. no arrow here')).toThrow(/lessons\/x.md: drill/);
    expect(bad('### Examples\n\n- 你好 Hello')).toThrow(/Chinese — English/);
    expect(bad('## Homework\n\nstuff')).toThrow(/unknown section/);
    expect(bad('## Drills\n\n## Drills')).toThrow(/twice/);
    expect(() => parseLessonFile('# no front matter')).toThrow(LessonFileError);
    expect(() => parseLessonFile('---\nid: Not Valid\n---\n')).toThrow(/lower-case/);
  });

  it('make ids and numbered titles', () => {
    expect(slugify('Lesson 4: 比 — Comparisons', 'x')).toBe('comparisons');
    expect(slugify('先…然后…最后… — Sequencing', 'x')).toBe('sequencing');
    expect(slugify('离', 'lesson-9')).toBe('lesson-9');
    expect(numberedTitle(3, 'Lesson 9: 比 — Comparisons')).toBe('Lesson 3: 比 — Comparisons');
    expect(renumberTitle('Lesson 21: Duration', 25)).toBe('Lesson 25: Duration');
    expect(renumberTitle('Custom lesson', 25)).toBe('Custom lesson');
  });
});

describe('course packs', () => {
  it('assemble the example pack', () => {
    const p = examplePack();
    expect(p.lessons.map((l) => l.id)).toEqual(['shi-to-be', 'ma-questions']);
    expect(p.planned).toHaveLength(2);
    expect(p.topics).toHaveLength(3);
    expect(lessonContent(p.lessons[1]!, 2).title).toBe('Lesson 2: 吗 — Yes/no questions');
  });

  it('list every problem', () => {
    const { manifest, files, topics } = readPackFiles('examples/course-zh');
    const m = JSON.parse(manifest);
    m.lessons.push('missing', 'shi-to-be');
    m.planned.push({ id: 'ma-questions', title: 'dup', level: '', focus: 'x' });
    const extra: Record<string, string> = { ...files, orphan: files['ma-questions']!.replace('id: ma-questions', 'id: orphan') };
    extra['ma-questions'] = files['ma-questions']!.replace(/## Drills[\s\S]*?## Common errors/, '## Common errors');
    extra['shi-to-be'] = files['shi-to-be']!.replace('- ✗ 我是忙。', '- ✗ 你是喜欢茶吗？ → ✓ 你喜欢茶吗？ — dup\n- ✗ 我是忙。');
    const { pack, problems } = assemblePack(JSON.stringify(m), extra, '[{"name":"a","tags":["x"],"scenario":"s"},{"name":"a","tags":["x"],"scenario":"s"}]');
    expect(pack).toBeNull();
    const text = problems.join('\n');
    expect(text).toMatch(/lessons\/missing.md: file not found/);
    expect(text).toMatch(/"shi-to-be" is listed twice/);
    expect(text).toMatch(/need at least 3 drills/);
    expect(text).toMatch(/already used by a lesson/);
    expect(text).toMatch(/orphan.md is not listed/);
    expect(text).toMatch(/topic "a" is listed twice/);
    void topics;
  });

  it('round-trip the real course when it is present', () => {
    const dir = 'data/courses/zh';
    if (!existsSync(join(dir, 'course.json'))) return;
    const { manifest, files, topics } = readPackFiles(dir);
    const { problems } = assemblePack(manifest, files, topics);
    expect(problems).toEqual([]);
    for (const [id, md] of Object.entries(files)) expect(renderLessonFile(parseLessonFile(md, id))).toBe(md);
  });
});

describe('sync plan', () => {
  const pack = examplePack();
  const row = (over: Partial<DbLesson>): DbLesson => ({
    id: 1,
    slug: null,
    course_no: 1,
    source: 'course_import',
    title: '',
    content_json: '{}',
    completed_at: null,
    created_at: '2026-10-01T00:00:00Z',
    ...over,
  });
  const empty: DbSnapshot = { lessons: [], grammarPoints: [], topics: [], planSlugs: [] };

  it('inserts everything into an empty database', () => {
    const p = planSync(empty, pack);
    expect(p.summary.added).toEqual(['shi-to-be', 'ma-questions']);
    expect(p.summary.grammarAdded).toBe(2);
    expect(p.summary.topics).toEqual({ added: 3, updated: 0, removed: 0 });
    expect(p.sql.filter((s) => s.startsWith('INSERT INTO exercises'))).toHaveLength(6);
    expect(p.sql.filter((s) => s.startsWith('INSERT INTO course_plan'))).toHaveLength(2);
  });

  it('adopts old imports by course number and keeps their rows', () => {
    const c1 = lessonContent(pack.lessons[0]!, 1);
    const db: DbSnapshot = {
      ...empty,
      lessons: [row({ id: 10, course_no: 1, content_json: JSON.stringify(c1), completed_at: '2026-10-02' }), row({ id: 11, course_no: 2 })],
      grammarPoints: [
        { id: 100, lesson_id: 10, title: '是', summary: 'A 是 B links two nouns; negative 不是', has_card: 1 },
        { id: 101, lesson_id: 11, title: 'old title', summary: 'old', has_card: 1 },
      ],
    };
    const p = planSync(db, pack);
    expect(p.summary.adopted).toEqual(['shi-to-be', 'ma-questions']);
    expect(p.summary.added).toEqual([]);
    expect(p.summary.updated).toEqual(['ma-questions']);
    expect(p.summary.unchanged).toBe(1);
    // Renamed grammar point keeps its row (and review card) by position.
    expect(p.sql).toContain(`UPDATE grammar_points SET title = '吗 questions', summary = 'statement + 吗 makes a yes/no question' WHERE id = 101;`);
    expect(p.summary.grammarRemoved).toEqual([]);
    expect(p.sql.some((s) => s.startsWith('DELETE FROM lessons'))).toBe(false);
    expect(p.sql.some((s) => /completed_at/.test(s))).toBe(false);
  });

  it('frees course numbers first and puts generated lessons after the pack', () => {
    const db: DbSnapshot = { ...empty, lessons: [row({ id: 5, slug: 'later', course_no: 1, source: 'generated', title: 'Lesson 1: Later' })] };
    const p = planSync(db, pack);
    expect(p.sql[0]).toMatch(/SET course_no = -id/);
    expect(p.sql).toContain(`UPDATE lessons SET course_no = 3, title = 'Lesson 3: Later' WHERE id = 5;`);
    expect(p.summary.kept).toEqual([]);
  });

  it('keeps removed pack lessons unless pruning, and prunes with their grammar points', () => {
    const db: DbSnapshot = {
      ...empty,
      lessons: [row({ id: 7, slug: 'gone', course_no: 9, source: 'course', title: 'Lesson 9: Gone' })],
      grammarPoints: [{ id: 70, lesson_id: 7, title: 'g', summary: null, has_card: 1 }],
    };
    const kept = planSync(db, pack);
    expect(kept.summary.kept).toEqual(['gone']);
    expect(kept.warnings[0]).toMatch(/--prune/);
    const pruned = planSync(db, pack, { prune: true });
    expect(pruned.summary.removed).toEqual(['gone']);
    expect(pruned.sql).toContain('DELETE FROM lessons WHERE id = 7;');
    expect(pruned.sql.some((s) => s.startsWith('DELETE FROM srs_cards') && s.includes('70'))).toBe(true);
  });

  it('replaces stale drills and errors but leaves conversation mistakes alone', () => {
    const p = planSync(empty, pack);
    const del = p.sql.find((s) => s.startsWith('DELETE FROM exercises'))!;
    expect(del).toMatch(/source = 'lesson'/);
    expect(del).toMatch(/NOT \(item_id = .* AND zh IN \('我是英国人。'/);
    const delM = p.sql.find((s) => s.startsWith('DELETE FROM mistakes'))!;
    expect(delM).toMatch(/source IN \('course', 'course_import', 'lesson'\)/);
  });

  it('leaves topics alone without topics.json and removes dropped ones with it', () => {
    const db: DbSnapshot = { ...empty, topics: [{ name: '旧话题', tags: 'x', scenario_seed: 's' }] };
    expect(planSync(db, { ...pack, topics: null }).sql.some((s) => /topics/.test(s))).toBe(false);
    const p = planSync(db, pack);
    expect(p.summary.topics!.removed).toBe(1);
    expect(p.sql.some((s) => s.startsWith('DELETE FROM topics') && s.includes('旧话题'))).toBe(true);
  });

  it('escapes quotes and ignores key order when comparing content', () => {
    expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonical({ a: [{ c: 3, d: 2 }], b: 1 }));
    const tricky = { ...pack, lessons: [{ ...pack.lessons[0]!, content: { ...pack.lessons[0]!.content, explanation: ["It's here"] } }] };
    expect(planSync(empty, tricky).sql.some((s) => s.includes("It''s here"))).toBe(true);
  });
});

describe('pack words and mistakes', () => {
  it('validates the optional lists', () => {
    const manifest = JSON.stringify({ lang: 'it', title: 'T', lessons: [], planned: [] });
    const ok = assemblePack(manifest, {}, null, { wordsJson: '[{"lemma":"adire le vie legali","gloss":"to sue","level":5}]', mistakesJson: '[{"wrong":"le cani","right":"i cani"}]' });
    expect(ok.problems).toEqual([]);
    expect(ok.pack!.words).toHaveLength(1);
    const bad = assemblePack(manifest, {}, null, { wordsJson: '[{"lemma":"a","level":9},{"lemma":"A"},{"gloss":"x"}]', mistakesJson: '[{"wrong":"x"}]' });
    const text = bad.problems.join('\n');
    expect(text).toMatch(/level must be 1-6/);
    expect(text).toMatch(/listed twice/);
    expect(text).toMatch(/lemma is missing/);
    expect(text).toMatch(/needs wrong and right/);
  });
  it('adds new words without touching existing statuses, and adds mistakes', () => {
    const pack = { ...examplePack(), words: [{ lemma: 'ciao', gloss: 'hi', level: 1, queue: true }, { lemma: 'adire', level: 5 }], mistakes: [{ wrong: 'le cani', right: 'i cani' }] };
    const p = planSync({ lessons: [], grammarPoints: [], topics: [], planSlugs: [] }, pack);
    const w = p.sql.filter((s) => s.startsWith('INSERT INTO words'));
    expect(w).toHaveLength(2);
    expect(w[0]).toMatch(/ON CONFLICT\(lang, lemma\) DO UPDATE SET gloss = COALESCE\(words.gloss, excluded.gloss\), level = COALESCE/);
    expect(w[0]).not.toMatch(/status = /); // an existing word keeps its status
    expect(w[0]).toMatch(/strftime/); // queued
    expect(w[1]).toMatch(/NULL\);?.*$/);
    expect(p.sql.some((s) => s.startsWith('INSERT OR IGNORE INTO mistakes') && s.includes('le cani'))).toBe(true);
    expect(p.summary.words).toBe(2);
  });
});

describe('learner block', () => {
  const { manifest, files, topics } = readPackFiles('examples/course-zh');
  const withLearner = (learner: unknown) => assemblePack(JSON.stringify({ ...JSON.parse(manifest), learner }), files, topics);
  it('sets this language\'s notes and only a starting "about you"', () => {
    const { pack } = withLearner({ about: "Lives in Leeds; plays the cello", notes: 'Mixes up 的 and 得' });
    const sql = planSync({ lessons: [], grammarPoints: [], topics: [], planSlugs: [] }, pack!).sql;
    expect(sql.find((s) => s.includes("'zh.learner_notes'"))).toMatch(/ON CONFLICT\(key\) DO UPDATE/);
    expect(sql.find((s) => s.includes("'learner.about'"))).toMatch(/^INSERT OR IGNORE/);
  });
  it('rejects a malformed block', () => {
    expect(withLearner({ about: 3 }).problems.join()).toMatch(/"learner" must be/);
  });
});
