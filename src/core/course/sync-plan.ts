// Course sync: turn "what the database holds" + "what the pack says" into SQL, keeping progress.
//
// Rules
// - Lessons are matched by id (lessons.slug). A lesson without an id is adopted by the pack
//   lesson at the same course number, once (the lessons imported before packs existed).
// - Matched lessons keep their row id, so completion, grammar-point review cards and history stay.
// - Course numbers follow the pack order. Generated lessons that are not in the pack yet keep
//   their place after the pack lessons, in the order they were made.
// - A lesson's drills and common errors are replaced by the pack's: stale ones are removed.
// - Grammar points are matched by title, then by position; review cards follow them. A grammar
//   point that is no longer in the pack is deleted with its review card.
// - Lessons that came from the pack but are no longer in it are kept (and reported) unless
//   `prune` is set.
// - Topics are replaced by topics.json when the pack has one. The planned list always is.
import { renderLessonMd, type LessonContent } from '../lessons/types';
import { lessonContent, type CoursePack } from './pack';
import { stripLessonNumber } from './lesson-file';

export interface DbLesson {
  id: number;
  slug: string | null;
  course_no: number | null;
  source: string;
  title: string;
  content_json: string;
  completed_at: string | null;
  created_at: string;
}
export interface DbGrammarPoint {
  id: number;
  lesson_id: number | null;
  title: string;
  summary: string | null;
  has_card: number;
}
export interface DbTopic {
  name: string;
  tags: string;
  scenario_seed: string | null;
}
export interface DbSnapshot {
  lessons: DbLesson[];
  grammarPoints: DbGrammarPoint[];
  topics: DbTopic[];
  planSlugs: string[];
}

export interface SyncSummary {
  added: string[];
  updated: string[];
  unchanged: number;
  adopted: string[];
  renumbered: number;
  kept: string[];
  removed: string[];
  grammarAdded: number;
  grammarRemoved: { lesson: string; title: string; hadCard: boolean }[];
  topics: { added: number; updated: number; removed: number } | null;
  /** Words and mistakes offered by the pack (new ones are added; nothing is removed). */
  words: number;
  mistakes: number;
  planned: number;
}

export interface SyncPlan {
  sql: string[];
  summary: SyncSummary;
  warnings: string[];
}

export const q = (s: string | null | undefined): string => (s == null ? 'NULL' : `'${s.replace(/'/g, "''")}'`);

const PACK_SOURCES = new Set(['course', 'course_import']);

/** JSON with sorted keys, so key order alone does not count as a change. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function sameContent(json: string, c: LessonContent): boolean {
  try {
    return canonical(JSON.parse(json)) === canonical(c);
  } catch {
    return false;
  }
}

/** Delete grammar points with everything hanging off them (review cards and history, drills, lesson mistakes). */
function deleteGrammarSql(idsSql: string): string[] {
  return [
    `DELETE FROM reviews WHERE card_id IN (SELECT id FROM srs_cards WHERE item_type = 'grammar_point' AND item_id IN (${idsSql}));`,
    `DELETE FROM srs_cards WHERE item_type = 'grammar_point' AND item_id IN (${idsSql});`,
    `DELETE FROM exercises WHERE item_type = 'grammar_point' AND item_id IN (${idsSql});`,
    `DELETE FROM mistakes WHERE source IN ('course', 'course_import', 'lesson') AND grammar_point_id IN (${idsSql});`,
    `DELETE FROM grammar_points WHERE id IN (${idsSql});`,
  ];
}

export function planSync(db: DbSnapshot, pack: CoursePack, opts: { prune?: boolean } = {}): SyncPlan {
  const L = q(pack.lang);
  const sql: string[] = [];
  const warnings: string[] = [];
  const s: SyncSummary = {
    added: [],
    updated: [],
    unchanged: 0,
    adopted: [],
    renumbered: 0,
    kept: [],
    removed: [],
    grammarAdded: 0,
    grammarRemoved: [],
    topics: null,
    planned: pack.planned.length,
    words: pack.words?.length ?? 0,
    mistakes: pack.mistakes?.length ?? 0,
  };

  // 1. Match pack lessons to rows.
  const used = new Set<number>();
  const match = new Map<string, DbLesson>();
  pack.lessons.forEach((f, i) => {
    let row = db.lessons.find((l) => l.slug === f.id);
    if (!row) {
      // A lesson without an id: the same title (a pack exported from the app and brought back),
      // else the old import at the same course number.
      row =
        db.lessons.find((l) => !l.slug && !used.has(l.id) && stripLessonNumber(l.title).toLowerCase() === f.title.toLowerCase()) ??
        db.lessons.find((l) => !l.slug && !used.has(l.id) && l.course_no === i + 1 && PACK_SOURCES.has(l.source));
      if (row) s.adopted.push(f.id);
    }
    if (row) {
      used.add(row.id);
      match.set(f.id, row);
    }
  });
  const leftovers = db.lessons.filter((l) => !used.has(l.id));
  const toRemove = opts.prune ? leftovers.filter((l) => PACK_SOURCES.has(l.source)) : [];
  const removeIds = new Set(toRemove.map((l) => l.id));
  // Generated lessons (and pack lessons kept without --prune) stay, after the pack, oldest first.
  const extras = leftovers.filter((l) => !removeIds.has(l.id)).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  for (const l of extras) if (PACK_SOURCES.has(l.source)) s.kept.push(l.slug ?? l.title);
  if (s.kept.length) warnings.push(`${s.kept.length} lesson(s) are no longer in the pack and were kept: ${s.kept.join(', ')}. Delete them with the command line's --prune.`);

  // 2. Free every course number so the new order cannot collide with the unique index.
  sql.push(`UPDATE lessons SET course_no = -id WHERE lang = ${L} AND course_no IS NOT NULL;`);

  // 3. Removed lessons.
  for (const l of toRemove) {
    const gps = db.grammarPoints.filter((g) => g.lesson_id === l.id);
    if (gps.length) sql.push(...deleteGrammarSql(gps.map((g) => g.id).join(', ')));
    sql.push(`DELETE FROM lessons WHERE id = ${l.id};`);
    s.removed.push(l.slug ?? l.title);
    if (l.completed_at) warnings.push(`Deleted "${l.title}", which you had marked done.`);
  }

  // 4. Pack lessons, in order.
  pack.lessons.forEach((f, i) => {
    const n = i + 1;
    const content = lessonContent(f, n);
    const json = q(JSON.stringify(content));
    const md = q(renderLessonMd(content));
    const row = match.get(f.id);
    let lessonRef: string;
    if (row) {
      lessonRef = String(row.id);
      const same = sameContent(row.content_json, content);
      const changed = !same || row.source !== 'course';
      sql.push(
        `UPDATE lessons SET slug = ${q(f.id)}, course_no = ${n}${changed ? `, title = ${q(content.title)}, level = ${q(content.level)}, content_json = ${json}, content_md = ${md}, source = 'course'` : ''} WHERE id = ${row.id};`,
      );
      if (!same) s.updated.push(f.id);
      else s.unchanged++;
      if (row.course_no !== n) s.renumbered++;
    } else {
      sql.push(
        `INSERT INTO lessons(lang, slug, title, level, content_json, content_md, course_no, source) VALUES (${L}, ${q(f.id)}, ${q(content.title)}, ${q(content.level)}, ${json}, ${md}, ${n}, 'course');`,
      );
      lessonRef = `(SELECT id FROM lessons WHERE lang = ${L} AND slug = ${q(f.id)})`;
      s.added.push(f.id);
    }

    // Grammar points: by title, then by position.
    const existing = row ? db.grammarPoints.filter((g) => g.lesson_id === row.id).sort((a, b) => a.id - b.id) : [];
    const packTitles = new Set(f.content.grammarPoints.map((g) => g.title));
    const taken = new Set<number>();
    const refs: string[] = [];
    f.content.grammarPoints.forEach((g, j) => {
      let gp = existing.find((e) => e.title === g.title && !taken.has(e.id));
      if (!gp) {
        const byPos = existing[j];
        if (byPos && !taken.has(byPos.id) && !packTitles.has(byPos.title)) gp = byPos;
      }
      if (gp) {
        taken.add(gp.id);
        if (gp.title !== g.title || gp.summary !== g.summary) sql.push(`UPDATE grammar_points SET title = ${q(g.title)}, summary = ${q(g.summary)} WHERE id = ${gp.id};`);
        refs.push(String(gp.id));
      } else {
        sql.push(
          `INSERT INTO grammar_points(lang, title, summary, lesson_id, meta_json) VALUES (${L}, ${q(g.title)}, ${q(g.summary)}, ${lessonRef}, ${q(JSON.stringify({ slug: f.id }))});`,
        );
        refs.push(`(SELECT id FROM grammar_points WHERE lesson_id = ${lessonRef} AND title = ${q(g.title)} ORDER BY id LIMIT 1)`);
        s.grammarAdded++;
      }
    });
    const gone = existing.filter((e) => !taken.has(e.id));
    if (gone.length) {
      sql.push(...deleteGrammarSql(gone.map((g) => g.id).join(', ')));
      for (const g of gone) s.grammarRemoved.push({ lesson: f.id, title: g.title, hadCard: g.has_card > 0 });
    }

    // Drills and errors hang off the lesson's first grammar point; replace them with the pack's.
    const first = refs[0]!;
    const lessonGps = `SELECT id FROM grammar_points WHERE lesson_id = ${lessonRef}`;
    const keepZh = f.content.drills.map((d) => q(d.zh)).join(', ');
    sql.push(
      `DELETE FROM exercises WHERE source = 'lesson' AND item_type = 'grammar_point' AND item_id IN (${lessonGps})${keepZh ? ` AND NOT (item_id = ${first} AND zh IN (${keepZh}))` : ''};`,
    );
    for (const d of f.content.drills) {
      sql.push(
        `INSERT INTO exercises(lang, item_type, item_id, zh, en, source) VALUES (${L}, 'grammar_point', ${first}, ${q(d.zh)}, ${q(d.en)}, 'lesson') ON CONFLICT(item_type, item_id, zh) DO UPDATE SET en = excluded.en;`,
      );
    }
    const keepErr = f.content.errors.map((e) => `(wrong = ${q(e.wrong)} AND right = ${q(e.right)})`).join(' OR ');
    sql.push(
      `DELETE FROM mistakes WHERE source IN ('course', 'course_import', 'lesson') AND grammar_point_id IN (${lessonGps})${keepErr ? ` AND NOT (grammar_point_id = ${first} AND (${keepErr}))` : ''};`,
    );
    for (const e of f.content.errors) {
      sql.push(
        `INSERT INTO mistakes(lang, grammar_point_id, wrong, right, note, source) VALUES (${L}, ${first}, ${q(e.wrong)}, ${q(e.right)}, ${q(e.note ?? null)}, 'course') ON CONFLICT(lang, wrong, right) DO UPDATE SET note = excluded.note, grammar_point_id = excluded.grammar_point_id;`,
      );
    }
  });

  // 5. Lessons outside the pack go after it.
  extras.forEach((l, k) => {
    const n = pack.lessons.length + k + 1;
    sql.push(`UPDATE lessons SET course_no = ${n}, title = ${q(renumberTitle(l.title, n))} WHERE id = ${l.id};`);
    if (l.course_no !== n) s.renumbered++;
  });

  // 6. Planned lessons.
  sql.push(`DELETE FROM course_plan WHERE lang = ${L};`);
  pack.planned.forEach((p, i) => {
    sql.push(
      `INSERT INTO course_plan(lang, slug, position, title, level, focus) VALUES (${L}, ${q(p.id)}, ${i + 1}, ${q(p.title)}, ${q(p.level)}, ${q(p.focus)});`,
    );
  });

  // 7. Topics.
  if (pack.topics) {
    const before = new Map(db.topics.map((t) => [t.name, t]));
    const t = { added: 0, updated: 0, removed: 0 };
    for (const topic of pack.topics) {
      const old = before.get(topic.name);
      const tags = topic.tags.join(',');
      if (!old) t.added++;
      else if (old.tags !== tags || old.scenario_seed !== topic.scenario) t.updated++;
      sql.push(
        `INSERT INTO topics(lang, name, tags, scenario_seed) VALUES (${L}, ${q(topic.name)}, ${q(tags)}, ${q(topic.scenario)}) ON CONFLICT(lang, name) DO UPDATE SET tags = excluded.tags, scenario_seed = excluded.scenario_seed;`,
      );
    }
    const names = new Set(pack.topics.map((x) => x.name));
    const gone = db.topics.filter((x) => !names.has(x.name));
    t.removed = gone.length;
    if (gone.length) {
      const list = gone.map((x) => q(x.name)).join(', ');
      sql.push(`UPDATE conversations SET topic_id = NULL WHERE topic_id IN (SELECT id FROM topics WHERE lang = ${L} AND name IN (${list}));`);
      sql.push(`DELETE FROM topics WHERE lang = ${L} AND name IN (${list});`);
    }
    s.topics = t;
  }

  // 8. Words: added to the list if new (status from the pack, default the pool); an existing word keeps its
  // status and only gains a missing gloss or level. Words are never removed by a sync.
  for (const w of pack.words ?? []) {
    const meta = w.note || w.example ? q(JSON.stringify({ note: w.note, example: w.example, from: 'course' })) : 'NULL';
    sql.push(
      `INSERT INTO words(lang, lemma, reading, gloss, source, status, level, meta_json, triaged_at) VALUES (${L}, ${q(w.lemma.trim())}, NULL, ${q(w.gloss ?? null)}, 'sheet_import', ${q(w.status ?? 'new')}, ${w.level ?? 'NULL'}, ${meta}, ${w.queue ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'NULL'}) ON CONFLICT(lang, lemma) DO UPDATE SET gloss = COALESCE(words.gloss, excluded.gloss), level = COALESCE(words.level, excluded.level);`,
    );
  }
  // 9. Recurring mistakes from the course notes.
  for (const m of pack.mistakes ?? []) {
    sql.push(`INSERT OR IGNORE INTO mistakes(lang, wrong, right, note, source) VALUES (${L}, ${q(m.wrong.trim())}, ${q(m.right.trim())}, ${q(m.note ?? null)}, 'course');`);
  }

  // 10. About the learner: the pack's notes for this language replace the stored ones; the general
  // "about you" text is only a starting value (edits in Settings win).
  if (pack.learner?.notes !== undefined) sql.push(`INSERT INTO settings(key, value) VALUES (${q(pack.lang + '.learner_notes')}, ${q(JSON.stringify(pack.learner.notes))}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
  if (pack.learner?.about) sql.push(`INSERT OR IGNORE INTO settings(key, value) VALUES ('learner.about', ${q(JSON.stringify(pack.learner.about))});`);

  for (const g of s.grammarRemoved) if (g.hadCard) warnings.push(`Grammar point "${g.title}" (${g.lesson}) was removed with its review card.`);
  return { sql, summary: s, warnings };
}

/** Keep a generated lesson's "Lesson N:" prefix in step with its new position. */
export function renumberTitle(title: string, n: number): string {
  return /^Lesson\s+\d+\s*[:：]/i.test(title) ? title.replace(/^Lesson\s+\d+/i, `Lesson ${n}`) : title;
}

export function describeSync(p: SyncPlan): string[] {
  const s = p.summary;
  const out = [
    `Lessons: ${s.added.length} added, ${s.updated.length} updated, ${s.unchanged} unchanged${s.renumbered ? `, ${s.renumbered} renumbered` : ''}${s.removed.length ? `, ${s.removed.length} removed` : ''}.`,
  ];
  if (s.added.length) out.push(`  added: ${s.added.join(', ')}`);
  if (s.updated.length) out.push(`  updated: ${s.updated.join(', ')}`);
  if (s.adopted.length) out.push(`  given ids (first sync): ${s.adopted.length}`);
  if (s.removed.length) out.push(`  removed: ${s.removed.join(', ')}`);
  if (s.grammarAdded || s.grammarRemoved.length) out.push(`Grammar points: ${s.grammarAdded} added, ${s.grammarRemoved.length} removed.`);
  if (s.topics) out.push(`Topics: ${s.topics.added} added, ${s.topics.updated} updated, ${s.topics.removed} removed.`);
  out.push(`Planned lessons: ${s.planned}.`);
  if (s.words) out.push(`Words: ${s.words} in the pack (new ones added; existing words keep their status).`);
  if (s.mistakes) out.push(`Mistakes: ${s.mistakes} in the pack (new ones added).`);
  return [...out, ...p.warnings.map((w) => `! ${w}`)];
}
