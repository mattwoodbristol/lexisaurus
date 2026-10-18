// Convert the author's extracted lesson notes into SQL for D1: 20 course lessons, one grammar point each,
// drill sentences cached as exercises, and the Common Errors as personal mistakes.
// Usage: npx tsx scripts/import-lessons.ts [data/course/mandarin-lessons-1-20.md] [outDir=data/seed]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseLessonNotes } from '../src/core/lessons/parse-notes';
import { renderLessonMd, validateLesson } from '../src/core/lessons/types';

const [, , notesPath = 'data/course/mandarin-lessons-1-20.md', outDir = 'data/seed'] = process.argv;
const q = (s: string | null | undefined) => (s == null ? 'NULL' : `'${s.replace(/'/g, "''")}'`);

const { lessons, recurringErrors } = parseLessonNotes(readFileSync(notesPath, 'utf8'));
const lines: string[] = [];
for (const l of lessons) {
  const problems = validateLesson(l);
  if (problems.length) throw new Error(`${l.title}: ${problems.join('; ')}`);
  const { number, ...content } = l;
  const lessonSel = `(SELECT id FROM lessons WHERE lang = 'zh' AND course_no = ${number})`;
  // Upsert by course number; re-importing refreshes content but keeps completed_at.
  lines.push(
    `INSERT INTO lessons(lang, title, level, content_json, content_md, course_no, source) VALUES ('zh', ${q(l.title)}, ${q(l.level)}, ${q(JSON.stringify(content))}, ${q(renderLessonMd(content))}, ${number}, 'course_import')
ON CONFLICT(lang, course_no) WHERE course_no IS NOT NULL DO UPDATE SET title = excluded.title, level = excluded.level, content_json = excluded.content_json, content_md = excluded.content_md;`,
  );
  for (const g of l.grammarPoints) {
    lines.push(
      `INSERT INTO grammar_points(lang, title, summary, lesson_id, meta_json) SELECT 'zh', ${q(g.title)}, ${q(g.summary)}, ${lessonSel}, ${q(JSON.stringify({ courseNo: number }))}
WHERE NOT EXISTS (SELECT 1 FROM grammar_points WHERE lang = 'zh' AND lesson_id = ${lessonSel} AND title = ${q(g.title)});`,
    );
  }
  const gpSel = `(SELECT id FROM grammar_points WHERE lang = 'zh' AND lesson_id = ${lessonSel} ORDER BY id LIMIT 1)`;
  for (const d of l.drills) {
    lines.push(`INSERT OR IGNORE INTO exercises(lang, item_type, item_id, zh, en, source) SELECT 'zh', 'grammar_point', ${gpSel}, ${q(d.zh)}, ${q(d.en)}, 'lesson';`);
  }
  for (const e of l.errors) {
    lines.push(`INSERT OR IGNORE INTO mistakes(lang, grammar_point_id, wrong, right, note, source) SELECT 'zh', ${gpSel}, ${q(e.wrong)}, ${q(e.right)}, ${q(e.note ?? null)}, 'course_import';`);
  }
}
for (const e of recurringErrors) {
  lines.push(`INSERT OR IGNORE INTO mistakes(lang, wrong, right, source) VALUES ('zh', ${q(e.wrong)}, ${q(e.right)}, 'course_import');`);
}
mkdirSync(outDir, { recursive: true });
const name = join(outDir, 'lessons.sql');
writeFileSync(name, lines.join('\n') + '\n');
console.log(`${lessons.length} lessons, ${lessons.reduce((n, l) => n + l.drills.length, 0)} drills, ${lessons.reduce((n, l) => n + l.errors.length, 0) + recurringErrors.length} mistakes -> ${name}`);
