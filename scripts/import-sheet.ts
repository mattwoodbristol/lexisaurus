// Convert the vocabulary sheet CSV into a SQL seed file for D1.
// Usage: npx tsx scripts/import-sheet.ts data/seed/mandarin-vocab.csv [outDir=data/seed]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseVocabSheet, isPattern } from '../src/core/import/sheet';

const [, , csvPath, outDir = 'data/seed'] = process.argv;
if (!csvPath) {
  console.error('usage: tsx scripts/import-sheet.ts <sheet.csv> [outDir]');
  process.exit(1);
}
const q = (s: string | null | undefined) => (s == null || s === '' ? 'NULL' : `'${s.replace(/'/g, "''")}'`);

const rows = parseVocabSheet(readFileSync(csvPath, 'utf8'));
const words = rows.filter((r) => !isPattern(r));
const patterns = rows.filter(isPattern);
console.log(`rows ${rows.length}: ${words.length} words, ${patterns.length} grammar patterns`);

const lines: string[] = [];
for (const r of words) {
  const meta = JSON.stringify({ lesson: r.lesson, pos: r.pos, notes: r.notes || undefined, sheet: true });
  // Sheet words are known (the author has been taught them). Keep a better existing gloss if present.
  lines.push(
    `INSERT INTO words(lang, lemma, reading, gloss, source, status, meta_json) VALUES ('zh', ${q(r.hanzi)}, ${q(r.pinyin)}, ${q(r.english)}, 'sheet_import', 'known', ${q(meta)})
ON CONFLICT(lang, lemma) DO UPDATE SET status = 'known', gloss = COALESCE(words.gloss, excluded.gloss), reading = COALESCE(words.reading, excluded.reading),
  meta_json = json_patch(COALESCE(words.meta_json, '{}'), excluded.meta_json);`,
  );
}
for (const p of patterns) {
  const summary = [p.english, p.notes].filter(Boolean).join('. ');
  lines.push(
    `INSERT INTO grammar_points(lang, title, summary) SELECT 'zh', ${q(p.hanzi)}, ${q(summary)} WHERE NOT EXISTS (SELECT 1 FROM grammar_points WHERE lang = 'zh' AND title = ${q(p.hanzi)});`,
  );
}
mkdirSync(outDir, { recursive: true });
const name = join(outDir, 'sheet.sql');
writeFileSync(name, lines.join('\n') + '\n');
console.log(`wrote ${name}`);
