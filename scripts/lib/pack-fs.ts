// Read and write course packs on disk.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { assemblePack, type CourseManifest, type CoursePack, type PackTopic } from '../../src/core/course/pack';
import { renderLessonFile, type LessonFile } from '../../src/core/course/lesson-file';

export function loadPack(dir: string): { pack: CoursePack | null; problems: string[] } {
  const manifestPath = join(dir, 'course.json');
  if (!existsSync(manifestPath)) return { pack: null, problems: [`${manifestPath} not found`] };
  const lessonDir = join(dir, 'lessons');
  const files: Record<string, string> = {};
  if (existsSync(lessonDir)) {
    for (const f of readdirSync(lessonDir)) if (f.endsWith('.md')) files[basename(f, '.md')] = readFileSync(join(lessonDir, f), 'utf8');
  }
  const topicsPath = join(dir, 'topics.json');
  const optional = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);
  return assemblePack(readFileSync(manifestPath, 'utf8'), files, optional('topics.json'), { wordsJson: optional('words.json'), mistakesJson: optional('mistakes.json') });
}

export function writeManifest(dir: string, m: CourseManifest): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'course.json'), JSON.stringify(m, null, 2) + '\n');
}

export function writeLesson(dir: string, f: LessonFile): void {
  mkdirSync(join(dir, 'lessons'), { recursive: true });
  writeFileSync(join(dir, 'lessons', `${f.id}.md`), renderLessonFile(f));
}

export function writeTopics(dir: string, topics: PackTopic[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'topics.json'), '[\n' + topics.map((t) => '  ' + JSON.stringify(t)).join(',\n') + '\n]\n');
}
