// A course pack: everything that defines one language's course, as plain files.
//
//   <pack>/course.json     { lang, title, lessons: [lesson ids in course order], planned: [...] }
//   <pack>/lessons/<id>.md one file per lesson (see lesson-file.ts)
//   <pack>/topics.json     [{ name, tags, scenario }] conversation topics
//
// Lesson numbers come from the order in course.json. "planned" lessons are not written yet: the
// app generates the next one with Claude when asked, and `course:export --new` pulls it back
// into the pack.
import { validateLesson, type LessonContent } from '../lessons/types';
import { getLanguage } from '../languages';
import { LessonFileError, numberedTitle, parseLessonFile, SLUG, type LessonFile } from './lesson-file';

export interface PlannedLesson {
  id: string;
  title: string;
  level: string;
  /** What the lesson should teach: passed to Claude when the lesson is generated. */
  focus: string;
}

export interface PackTopic {
  name: string;
  tags: string[];
  /** English instructions for the tutor: the situation to role-play. */
  scenario: string;
}

/** A word the pack brings into the word list (words.json). Existing words keep their status. */
export interface PackWord {
  lemma: string;
  gloss?: string;
  /** Difficulty band 1-6 (HSK 1-6 / CEFR A1-C2). */
  level?: number;
  /** For words not yet in the list; default new (the pool). */
  status?: 'new' | 'learning' | 'known';
  /** Introduce ahead of the rest of the pool (e.g. words met in lessons). */
  queue?: boolean;
  note?: string;
  example?: string;
}

/** A recurring mistake to watch for (mistakes.json). */
export interface PackMistake {
  wrong: string;
  right: string;
  note?: string;
}

export interface CourseManifest {
  lang: string;
  title: string;
  lessons: string[];
  planned: PlannedLesson[];
  /** Optional: about the learner, for lesson and chat prompts (personal context, known weak spots). */
  learner?: LearnerInfo;
}

export interface LearnerInfo {
  /** General, all languages (setting learner.about): who they are, interests, people in their life. Only a starting value. */
  about?: string;
  /** For this language (setting <lang>.learner_notes): recurring slips, what to push. */
  notes?: string;
}

export interface CoursePack {
  lang: string;
  title: string;
  lessons: LessonFile[];
  planned: PlannedLesson[];
  /** null when the pack has no topics.json: topics in the database are left alone. */
  topics: PackTopic[] | null;
  /** null when the pack has no words.json / mistakes.json: nothing is added. */
  words: PackWord[] | null;
  mistakes: PackMistake[] | null;
  learner: LearnerInfo | null;
}

/** The lesson as the app stores it: numbered title, full content. */
export function lessonContent(f: LessonFile, courseNo: number): LessonContent {
  return { title: numberedTitle(courseNo, f.title), ...f.content };
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Build a pack from the raw file contents and list every problem found. A pack with problems
 * must not be synced.
 */
export function assemblePack(
  manifestJson: string,
  lessonFiles: Record<string, string | undefined>,
  topicsJson: string | null,
  extra: { wordsJson?: string | null; mistakesJson?: string | null } = {},
): { pack: CoursePack | null; problems: string[] } {
  const problems: string[] = [];
  let manifest: CourseManifest;
  try {
    manifest = JSON.parse(manifestJson) as CourseManifest;
  } catch (e) {
    return { pack: null, problems: [`course.json is not valid JSON: ${(e as Error).message}`] };
  }
  if (!isStr(manifest.lang) || !/^[a-z]{2,3}$/.test(manifest.lang)) problems.push('course.json: "lang" must be a language code such as "zh"');
  else if (!getLanguage(manifest.lang)) problems.push(`course.json: language "${manifest.lang}" is not configured in the app`);
  if (!isStr(manifest.title)) problems.push('course.json: "title" is missing');
  if (!Array.isArray(manifest.lessons)) problems.push('course.json: "lessons" must be a list of lesson ids');
  const planned = Array.isArray(manifest.planned) ? manifest.planned : [];
  if (manifest.planned !== undefined && !Array.isArray(manifest.planned)) problems.push('course.json: "planned" must be a list');

  const seen = new Set<string>();
  const lessons: LessonFile[] = [];
  (manifest.lessons ?? []).forEach((id, i) => {
    const where = `lessons/${id}.md`;
    if (!isStr(id) || !SLUG.test(id)) return problems.push(`course.json: lesson ${i + 1} id "${id}" must be lower-case letters, digits and hyphens`);
    if (seen.has(id)) return problems.push(`course.json: lesson id "${id}" is listed twice`);
    seen.add(id);
    const md = lessonFiles[id];
    if (md === undefined) return problems.push(`${where}: file not found`);
    let f: LessonFile;
    try {
      f = parseLessonFile(md, where);
    } catch (e) {
      if (e instanceof LessonFileError) return problems.push(e.message);
      throw e;
    }
    if (f.id !== id) problems.push(`${where}: front matter id "${f.id}" does not match the file name`);
    for (const p of validateLesson(lessonContent(f, i + 1), getLanguage(manifest.lang)?.script ?? 'han')) problems.push(`${where}: ${p}`);
    const gps = f.content.grammarPoints.map((g) => g.title);
    if (new Set(gps).size !== gps.length) problems.push(`${where}: grammar point titles must be unique within a lesson`);
    lessons.push(f);
  });
  // The same common error may appear in several lessons: it is stored once, under the last one.
  for (const id of Object.keys(lessonFiles)) if (!seen.has(id)) problems.push(`lessons/${id}.md is not listed in course.json (add it to "lessons" or delete it)`);

  planned.forEach((p, i) => {
    const where = `course.json planned ${i + 1}`;
    if (!isStr(p?.id) || !SLUG.test(p.id)) problems.push(`${where}: id "${p?.id}" must be lower-case letters, digits and hyphens`);
    else if (seen.has(p.id)) problems.push(`${where}: id "${p.id}" is already used by a lesson`);
    else seen.add(p.id);
    if (!isStr(p?.title)) problems.push(`${where}: title is missing`);
    if (!isStr(p?.focus)) problems.push(`${where}: focus is missing (what the lesson should teach)`);
    if (typeof p?.level !== 'string') problems.push(`${where}: level is missing`);
  });

  let topics: PackTopic[] | null = null;
  if (topicsJson !== null) {
    try {
      const raw = JSON.parse(topicsJson) as unknown;
      if (!Array.isArray(raw)) throw new Error('expected a list');
      topics = raw as PackTopic[];
      const names = new Set<string>();
      topics.forEach((t, i) => {
        if (!isStr(t?.name)) problems.push(`topics.json ${i + 1}: name is missing`);
        else if (names.has(t.name)) problems.push(`topics.json: topic "${t.name}" is listed twice`);
        else names.add(t.name);
        if (!Array.isArray(t?.tags) || t.tags.some((x) => !isStr(x) || x.includes(','))) problems.push(`topics.json ${i + 1}: tags must be a list of words without commas`);
        if (!isStr(t?.scenario)) problems.push(`topics.json ${i + 1}: scenario is missing`);
      });
    } catch (e) {
      problems.push(`topics.json is not valid: ${(e as Error).message}`);
    }
  }

  if (problems.length) return { pack: null, problems };
  const words = parseList<PackWord>(extra.wordsJson, 'words.json', problems, (w, i) => {
    const where = `words.json ${i + 1}`;
    if (!isStr(w?.lemma)) return `${where}: lemma is missing`;
    if (w.level !== undefined && !(Number.isInteger(w.level) && w.level >= 1 && w.level <= 6)) return `${where}: level must be 1-6`;
    if (w.status !== undefined && !['new', 'learning', 'known'].includes(w.status)) return `${where}: status must be new, learning or known`;
    return null;
  });
  if (words) {
    const seenWords = new Set<string>();
    for (const w of words) {
      if (!isStr(w?.lemma)) continue; // already reported as missing
      const k = w.lemma.trim().toLowerCase();
      if (seenWords.has(k)) problems.push(`words.json: "${w.lemma}" is listed twice`);
      seenWords.add(k);
    }
  }
  const mistakes = parseList<PackMistake>(extra.mistakesJson, 'mistakes.json', problems, (m, i) =>
    isStr(m?.wrong) && isStr(m?.right) ? null : `mistakes.json ${i + 1}: needs wrong and right`,
  );
  const learner = manifest.learner ?? null;
  if (learner !== null && (typeof learner !== 'object' || (learner.about !== undefined && typeof learner.about !== 'string') || (learner.notes !== undefined && typeof learner.notes !== 'string')))
    problems.push('course.json: "learner" must be { "about": text, "notes": text } (both optional)');
  if (problems.length) return { pack: null, problems };
  return { pack: { lang: manifest.lang, title: manifest.title, lessons, planned, topics, words, mistakes, learner }, problems };
}

/** Parse an optional JSON list file, collecting problems. */
function parseList<T>(json: string | null | undefined, name: string, problems: string[], check: (x: T, i: number) => string | null): T[] | null {
  if (json === null || json === undefined) return null;
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) throw new Error('expected a list');
    raw.forEach((x, i) => {
      const p = check(x as T, i);
      if (p) problems.push(p);
    });
    return raw as T[];
  } catch (e) {
    problems.push(`${name} is not valid: ${(e as Error).message}`);
    return null;
  }
}
