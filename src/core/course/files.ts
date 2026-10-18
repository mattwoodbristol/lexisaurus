// A course pack as a map of file paths to text: what the app hands out as a zip and takes back as
// an upload, so the course can be edited without the command line.
import { assemblePack, type CourseManifest, type CoursePack, type PackTopic, type PlannedLesson } from './pack';
import { renderLessonFile, slugify, stripLessonNumber, type LessonFile } from './lesson-file';
import type { DbLesson, DbTopic } from './sync-plan';
import type { LessonContent } from '../lessons/types';
import type { FileMap } from './zip';
import { getLanguage } from '../languages';
import { ZH_CURRICULUM } from '../languages/zh.curriculum';
import { ZH_TOPICS } from '../languages/zh.topics';

/** Help files the app adds to a download; ignored on upload. */
export const GUIDE_FILES = ['HOW-TO-EDIT.md', 'FORMAT.md'];

export interface ExportedCourse {
  manifest: CourseManifest;
  lessons: LessonFile[];
  topics: PackTopic[];
}

/**
 * The course in the database as a pack. Lessons in course order (rows sorted by course_no); a
 * generated lesson keeps its planned id, older ones get an id from their title. Planned lessons
 * already written are left out of "planned". Mandarin without a plan or topics gets the built-in
 * ones.
 */
export function courseFromDb(lang: string, rows: DbLesson[], plan: PlannedLesson[], topicRows: DbTopic[], title?: string): ExportedCourse {
  const taken = new Set<string>(rows.map((r) => r.slug).filter((s): s is string => !!s));
  const uniqueId = (base: string) => {
    let id = base;
    for (let k = 2; taken.has(id); k++) id = `${base}-${k}`;
    taken.add(id);
    return id;
  };
  const lessons: LessonFile[] = rows.map((r, i) => {
    const { title: t, ...content } = JSON.parse(r.content_json) as LessonContent;
    const id = r.slug ?? uniqueId(slugify(t || r.title, `lesson-${r.course_no ?? i + 1}`));
    return { id, title: stripLessonNumber(t || r.title), content };
  });
  const written = new Set(lessons.map((l) => l.id));
  const titles = new Set(lessons.map((l) => l.title.toLowerCase()));
  const planned: PlannedLesson[] = plan.length
    ? plan.filter((p) => !written.has(p.id))
    : lang === 'zh'
      ? ZH_CURRICULUM.filter((c) => !titles.has(c.title.toLowerCase())).map((c) => ({ id: uniqueId(slugify(c.title, 'planned')), ...c }))
      : [];
  const topics: PackTopic[] = topicRows.length
    ? topicRows.map((t) => ({ name: t.name, tags: t.tags ? t.tags.split(',') : [], scenario: t.scenario_seed ?? '' }))
    : lang === 'zh'
      ? ZH_TOPICS
      : [];
  return { manifest: { lang, title: title ?? getLanguage(lang)?.name ?? lang, lessons: lessons.map((l) => l.id), planned }, lessons, topics };
}

export function manifestJson(m: CourseManifest): string {
  return JSON.stringify(m, null, 2) + '\n';
}

export function topicsJson(topics: PackTopic[]): string {
  return '[\n' + topics.map((t) => '  ' + JSON.stringify(t)).join(',\n') + '\n]\n';
}

export function courseToFiles(c: ExportedCourse): FileMap {
  const files: FileMap = { 'course.json': manifestJson(c.manifest) };
  for (const l of c.lessons) files[`lessons/${l.id}.md`] = renderLessonFile(l);
  files['topics.json'] = topicsJson(c.topics);
  return files;
}

const base = (path: string) => path.split('/').pop() ?? path;
const isGuide = (path: string) => GUIDE_FILES.includes(base(path)) || /^readme\.md$/i.test(base(path));

/**
 * Put uploaded files in pack shape. A whole pack (it has a course.json, possibly inside a folder)
 * is taken as it is. Without one, the files change the current course: each lesson file replaces
 * the lesson with its id or is added at the end (leaving the plan if it was planned), and a
 * topics.json, words.json or mistakes.json replaces or adds that file.
 */
export function mergeUpload(current: FileMap, uploaded: FileMap): { files: FileMap; whole: boolean } {
  const manifestPath = Object.keys(uploaded)
    .filter((p) => base(p) === 'course.json')
    .sort((a, b) => a.length - b.length)[0];
  if (manifestPath !== undefined) {
    const root = manifestPath.slice(0, -'course.json'.length);
    const files: FileMap = {};
    for (const [p, text] of Object.entries(uploaded)) {
      if (!p.startsWith(root) || isGuide(p)) continue;
      const rel = p.slice(root.length);
      if (rel === 'course.json' || rel === 'topics.json' || rel === 'words.json' || rel === 'mistakes.json' || /^lessons\/[^/]+\.md$/.test(rel)) files[rel] = text;
    }
    return { files, whole: true };
  }

  const files: FileMap = { ...current };
  const manifest = JSON.parse(current['course.json'] ?? '{}') as CourseManifest;
  manifest.lessons ??= [];
  manifest.planned ??= [];
  for (const [p, text] of Object.entries(uploaded)) {
    if (isGuide(p)) continue;
    const name = base(p);
    if (['topics.json', 'words.json', 'mistakes.json'].includes(name)) {
      files[name] = text;
      continue;
    }
    if (!name.endsWith('.md')) continue;
    // The id from the front matter; a broken file is still added under its name so the problem is reported.
    const id = /^﻿?---\r?\n[\s\S]*?^id:\s*(\S+)\s*$/m.exec(text)?.[1] ?? name.slice(0, -3);
    files[`lessons/${id}.md`] = text;
    if (!manifest.lessons.includes(id)) manifest.lessons.push(id);
    manifest.planned = manifest.planned.filter((x) => x.id !== id);
  }
  files['course.json'] = manifestJson(manifest);
  return { files, whole: false };
}

/** Check a pack given as files (pack shape: course.json, lessons/<id>.md, ...). */
export function packFromFiles(files: FileMap): { pack: CoursePack | null; problems: string[] } {
  if (files['course.json'] === undefined) return { pack: null, problems: ['course.json is missing'] };
  const lessons: Record<string, string> = {};
  for (const [p, text] of Object.entries(files)) {
    const m = /^lessons\/([^/]+)\.md$/.exec(p);
    if (m) lessons[m[1]!] = text;
  }
  const opt = (name: string) => files[name] ?? null;
  return assemblePack(files['course.json'], lessons, opt('topics.json'), { wordsJson: opt('words.json'), mistakesJson: opt('mistakes.json') });
}
