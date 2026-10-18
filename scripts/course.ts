// Course packs on the command line.
//
//   npm run course -- check  <pack>                          validate a pack, offline
//   npm run course -- sync   <pack> --local|--remote [--dry-run] [--prune]
//   npm run course -- export <pack> --local|--remote [--lang zh] [--new] [--force]
//
// export writes the course in the database out as a pack (the starting point). With --new it
// only adds lessons that are in the database but not yet in the pack (e.g. generated ones).
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPack, writeLesson, writeManifest, writeTopics } from './lib/pack-fs';
import { executeStatements, query, targetFromArgs, type Target } from './lib/d1';
import { planSync, describeSync, type DbGrammarPoint, type DbLesson, type DbSnapshot, type DbTopic } from '../src/core/course/sync-plan';
import { stripLessonNumber, type LessonFile } from '../src/core/course/lesson-file';
import type { LessonContent } from '../src/core/lessons/types';
import { courseFromDb } from '../src/core/course/files';
import { q } from '../src/core/course/sync-plan';
import { generatePractice } from './lib/practice';
import { isSectioned } from '../src/core/lessons/types';
import { estimateCostUsd } from '../src/core/models';

const [, , cmd, dir, ...rest] = process.argv;
const flag = (name: string) => rest.includes(`--${name}`);
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function needTarget(): Target {
  return targetFromArgs(rest) ?? die('Say which database: --local or --remote');
}

function snapshot(target: Target, lang: string): DbSnapshot {
  const L = q(lang);
  return {
    lessons: query<DbLesson>(target, `SELECT id, slug, course_no, source, title, content_json, completed_at, created_at FROM lessons WHERE lang = ${L}`),
    grammarPoints: query<DbGrammarPoint>(
      target,
      `SELECT g.id, g.lesson_id, g.title, g.summary, (SELECT COUNT(*) FROM srs_cards s WHERE s.item_type = 'grammar_point' AND s.item_id = g.id) AS has_card FROM grammar_points g WHERE g.lang = ${L} AND g.lesson_id IS NOT NULL`,
    ),
    topics: query<DbTopic>(target, `SELECT name, tags, scenario_seed FROM topics WHERE lang = ${L}`),
    planSlugs: query<{ slug: string }>(target, `SELECT slug FROM course_plan WHERE lang = ${L} ORDER BY position`).map((r) => r.slug),
  };
}

function check(): void {
  if (!dir) die('Usage: course check <pack dir>');
  const { pack, problems } = loadPack(dir);
  if (!pack) die(`${problems.length} problem(s):\n${problems.map((p) => `- ${p}`).join('\n')}`);
  const drills = pack.lessons.reduce((n, l) => n + l.content.drills.length, 0);
  console.log(`OK: ${pack.title} (${pack.lang}): ${pack.lessons.length} lessons, ${drills} drills, ${pack.planned.length} planned, ${pack.topics ? `${pack.topics.length} topics` : 'no topics.json'}.`);
}

function sync(): void {
  if (!dir) die('Usage: course sync <pack dir> --local|--remote [--dry-run] [--prune]');
  const target = needTarget();
  const { pack, problems } = loadPack(dir);
  if (!pack) die(`Not synced. Fix these first:\n${problems.map((p) => `- ${p}`).join('\n')}`);
  const plan = planSync(snapshot(target, pack.lang), pack, { prune: flag('prune') });
  console.log(describeSync(plan).join('\n'));
  if (flag('dry-run')) {
    const out = join(dir, '..', `sync-${pack.lang}-${target}.sql`);
    writeFileSync(out, plan.sql.join('\n') + '\n');
    console.log(`Dry run: nothing written to the ${target} database. SQL saved to ${out}`);
    return;
  }
  executeStatements(target, plan.sql, `course-sync-${pack.lang}`);
  console.log(`Synced to the ${target} database (${plan.sql.length} statements).`);
}

function exportPack(): void {
  if (!dir) die('Usage: course export <pack dir> --local|--remote [--lang zh] [--new] [--force]');
  const target = needTarget();
  const onlyNew = flag('new');
  const existing = existsSync(join(dir, 'course.json')) ? loadPack(dir) : null;
  if (existing && !onlyNew && !flag('force')) die(`${dir} already has a course. Use --new to add lessons from the database, or --force to overwrite.`);
  if (onlyNew && !existing?.pack) die(existing ? `Fix the pack first:\n${existing.problems.join('\n')}` : `${dir} has no course.json yet: run export without --new first.`);
  const lang = opt('lang') ?? existing?.pack?.lang ?? 'zh';
  const rows = query<DbLesson>(target, `SELECT id, slug, course_no, source, title, content_json, completed_at, created_at FROM lessons WHERE lang = ${q(lang)} ORDER BY course_no IS NULL, course_no, created_at`);

  if (onlyNew) {
    // Generated lessons carry their planned id; slug-less rows are the old imports, already exported.
    const pack = existing!.pack!;
    const inPack = new Set(pack.lessons.map((l) => l.id));
    const files: LessonFile[] = rows
      .filter((r) => r.slug && !inPack.has(r.slug))
      .map((r) => {
        const { title, ...content } = JSON.parse(r.content_json) as LessonContent;
        return { id: r.slug!, title: stripLessonNumber(title || r.title), content };
      });
    if (!files.length) return console.log('Nothing new: every lesson in the database is already in the pack.');
    for (const f of files) writeLesson(dir, f);
    const added = new Set(files.map((f) => f.id));
    writeManifest(dir, {
      lang: pack.lang,
      title: pack.title,
      lessons: [...pack.lessons.map((l) => l.id), ...files.map((f) => f.id)],
      planned: pack.planned.filter((p) => !added.has(p.id)),
    });
    console.log(`Added ${files.length} lesson(s) to ${dir}: ${files.map((f) => f.id).join(', ')}`);
    return;
  }

  const plan = query<{ slug: string; title: string; level: string; focus: string }>(target, `SELECT slug, title, level, focus FROM course_plan WHERE lang = ${q(lang)} ORDER BY position`);
  const topicRows = query<DbTopic>(target, `SELECT name, tags, scenario_seed FROM topics WHERE lang = ${q(lang)} ORDER BY id`);
  const course = courseFromDb(lang, rows, plan.map((p) => ({ id: p.slug, title: p.title, level: p.level, focus: p.focus })), topicRows, opt('title'));
  for (const f of course.lessons) writeLesson(dir, f);
  writeManifest(dir, course.manifest);
  writeTopics(dir, course.topics);
  console.log(`Exported ${course.lessons.length} lessons, ${course.manifest.planned.length} planned, ${course.topics.length} topics to ${dir}`);
  const after = loadPack(dir);
  if (!after.pack) console.log(`The exported pack needs fixing before it can be synced:\n${after.problems.map((p) => `- ${p}`).join('\n')}`);
}

/**
 * Add practice sets (recognise questions, more drills, a lesson check) to lessons that lack them.
 * --lesson <id> for one lesson; --force to regenerate lessons that already have them.
 */
async function practice(): Promise<void> {
  if (!dir) die('Usage: course practice <pack dir> [--lesson <id>] [--force]');
  const { pack, problems } = loadPack(dir);
  if (!pack) die(`Fix the pack first:\n${problems.map((p) => `- ${p}`).join('\n')}`);
  const only = opt('lesson');
  const targets = pack.lessons
    .map((f, i) => ({ f, n: i + 1 }))
    .filter(({ f }) => (only ? f.id === only : true))
    .filter(({ f }) => flag('force') || !isSectioned(f.content));
  if (only && !targets.length) die(`No lesson "${only}" needing practice (use --force to redo).`);
  let input = 0;
  let output = 0;
  for (const { f, n } of targets) {
    process.stdout.write(`Lesson ${n} ${f.id} … `);
    try {
      const { file, usage } = await generatePractice(f, n, pack.lang);
      writeLesson(dir, file);
      input += usage.input;
      output += usage.output;
      console.log(`${file.content.recognise!.length} recognise, ${file.content.drills.length} drills, ${file.content.check!.length} check items`);
    } catch (e) {
      console.log(`failed: ${(e as Error).message}`);
    }
  }
  const cost = estimateCostUsd('lessons', input, output);
  console.log(`Done: ${targets.length} lesson(s), ${input} input + ${output} output tokens, about $${cost.toFixed(2)}. Check with: npm run course -- check ${dir}`);
}

/**
 * Answers the learner queried where Sonnet found the answer key wrong, so the lesson file can be
 * corrected. --all also lists queries where the key was fine.
 * Usage: course queries --local|--remote [--all]   (no pack dir needed)
 */
function queries(): void {
  const target = targetFromArgs([dir ?? '', ...rest]) ?? die('Say which database: --local or --remote');
  const all = [dir, ...rest].includes('--all');
  const rows = query<{
    id: number;
    slug: string | null;
    place: string;
    kind: string;
    task: string;
    expected: string;
    answer: string;
    learner_right: number;
    key_wrong: number;
    explanation: string;
    better_key: string | null;
    created_at: string;
  }>(
    target,
    `SELECT q.id, l.slug, q.place, q.kind, q.task, q.expected, q.answer, q.learner_right, q.key_wrong, q.explanation, q.better_key, q.created_at
     FROM answer_queries q LEFT JOIN lessons l ON l.id = q.lesson_id
     WHERE q.status = 'open' ${all ? '' : 'AND q.key_wrong = 1'} ORDER BY q.id`,
  );
  if (!rows.length) return console.log(all ? 'No queries.' : 'No open queries with a wrong answer key.');
  for (const r of rows) {
    console.log(`#${r.id} ${r.slug ?? '?'} · ${r.place} (${r.kind}) · ${r.created_at.slice(0, 10)}`);
    console.log(`  task:     ${r.task}`);
    console.log(`  key:      ${r.expected}${r.key_wrong ? `   → better: ${r.better_key ?? '?'}` : ''}`);
    console.log(`  answered: ${r.answer} (${r.learner_right ? 'learner right' : 'learner wrong'})`);
    console.log(`  ${r.explanation}`);
  }
  console.log(`\nFix the lesson files, sync, then close them with:\n  npx wrangler d1 execute <db> --${target} --command "UPDATE answer_queries SET status = 'fixed' WHERE id IN (...)"`);
}

switch (cmd) {
  case 'queries':
    queries();
    break;
  case 'practice':
    await practice();
    break;
  case 'check':
    check();
    break;
  case 'sync':
    sync();
    break;
  case 'export':
    exportPack();
    break;
  default:
    die('Usage: npm run course -- check|sync|export <pack dir> [--local|--remote] ...');
}
