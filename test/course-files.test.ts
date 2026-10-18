import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readZip, writeZip, type FileMap } from '../src/core/course/zip';
import { courseFromDb, courseToFiles, mergeUpload, packFromFiles } from '../src/core/course/files';
import { lessonContent } from '../src/core/course/pack';
import { planSync, type DbLesson, type DbSnapshot } from '../src/core/course/sync-plan';

function exampleFiles(): FileMap {
  const dir = 'examples/course-zh';
  const files: FileMap = { 'course.json': readFileSync(join(dir, 'course.json'), 'utf8'), 'topics.json': readFileSync(join(dir, 'topics.json'), 'utf8') };
  for (const f of readdirSync(join(dir, 'lessons'))) files[`lessons/${f}`] = readFileSync(join(dir, 'lessons', f), 'utf8');
  return files;
}

/** A one-file zip with a deflated entry, as most zip tools make them. */
function deflatedZip(name: string, text: string): Uint8Array {
  const n = Buffer.from(name);
  const raw = Buffer.from(text);
  const data = deflateRawSync(raw);
  const stored = Buffer.from(writeZip({ [name]: text }));
  const crc = stored.readUInt32LE(14);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(raw.length, 24);
  cd.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12);
  end.writeUInt32LE(30 + n.length + data.length, 16);
  return new Uint8Array(Buffer.concat([local, n, data, cd, n, end]));
}

describe('zip', () => {
  it('round-trips text files, including non-ASCII names and content', async () => {
    const files = { 'course.json': '{"lang":"zh"}', 'lessons/是.md': '# 是 — To be\n' };
    expect(await readZip(writeZip(files))).toEqual(files);
  });

  it('reads deflated entries and skips folders, Mac metadata and other files', async () => {
    const text = '---\nid: x\n---\n# 好\n'.repeat(20);
    expect(await readZip(deflatedZip('pack/lessons/x.md', text))).toEqual({ 'pack/lessons/x.md': text });
    const z = writeZip({ '__MACOSX/._a.md': 'junk', 'a.png': 'x', 'b.md': 'ok' });
    expect(await readZip(z)).toEqual({ 'b.md': 'ok' });
  });

  it('rejects something that is not a zip', async () => {
    await expect(readZip(new TextEncoder().encode('hello'))).rejects.toThrow(/not a zip/);
  });
});

describe('course files', () => {
  const row = (over: Partial<DbLesson>): DbLesson => ({
    id: 1,
    slug: null,
    course_no: 1,
    source: 'generated',
    title: 'Lesson 1: X',
    content_json: '{}',
    completed_at: null,
    created_at: '2026-10-01T00:00:00Z',
    ...over,
  });

  it('a whole pack inside a folder is taken as it is, without the guide files', () => {
    const up: FileMap = {};
    for (const [p, t] of Object.entries(exampleFiles())) up[`my-course/${p}`] = t;
    up['my-course/HOW-TO-EDIT.md'] = 'guide';
    const { files, whole } = mergeUpload({}, up);
    expect(whole).toBe(true);
    expect(Object.keys(files).sort()).toEqual(['course.json', 'lessons/ma-questions.md', 'lessons/shi-to-be.md', 'topics.json']);
    expect(packFromFiles(files).problems).toEqual([]);
  });

  it('single lesson files replace or join the current course and leave the plan', () => {
    const current = exampleFiles();
    const lesson = current['lessons/shi-to-be.md']!.replace('id: shi-to-be', 'id: measure-words');
    const { files, whole } = mergeUpload(current, { 'Downloads/anything.md': lesson, 'topics.json': '[]' });
    expect(whole).toBe(false);
    const manifest = JSON.parse(files['course.json']!);
    expect(manifest.lessons).toEqual(['shi-to-be', 'ma-questions', 'measure-words']);
    expect(manifest.planned.map((p: { id: string }) => p.id)).toEqual(['le-completed-actions']);
    expect(files['topics.json']).toBe('[]');
    expect(packFromFiles(files).problems).toEqual([]);
  });

  it('reports a broken lesson under its file name', () => {
    const { files } = mergeUpload(exampleFiles(), { 'oops.md': 'no front matter' });
    expect(packFromFiles(files).problems.join('\n')).toMatch(/lessons\/oops\.md/);
  });

  it('exports the database as a valid pack that syncs back without changes', () => {
    const { pack } = packFromFiles(exampleFiles());
    const rows = pack!.lessons.map((f, i) =>
      // The second lesson was generated from a custom title, so it has no id.
      row({ id: i + 1, slug: i === 0 ? f.id : null, course_no: i + 1, source: i === 0 ? 'course' : 'generated', title: `Lesson ${i + 1}: ${f.title}`, content_json: JSON.stringify(lessonContent(f, i + 1)) }),
    );
    // A planned lesson that has been written is not planned any more.
    const plan = [...pack!.planned, { id: 'shi-to-be', title: 'x', level: 'HSK 1', focus: 'x' }];
    const course = courseFromDb('zh', rows, plan, []);
    expect(course.manifest.planned.map((p) => p.id)).toEqual(['measure-words', 'le-completed-actions']);
    const back = packFromFiles(courseToFiles(course));
    expect(back.problems).toEqual([]);
    const db: DbSnapshot = { lessons: rows, grammarPoints: [], topics: [], planSlugs: [] };
    const p = planSync(db, back.pack!);
    expect(p.summary.added).toEqual([]);
    expect(p.summary.adopted).toEqual([course.lessons[1]!.id]); // matched by title, not duplicated
    expect(p.summary.updated).toEqual([]);
  });
});
