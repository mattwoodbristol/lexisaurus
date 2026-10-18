// Convert a Pleco XML export into SQL seed files for D1.
// Usage: npx tsx scripts/import-pleco.ts "<path to flash-*.xml>" [outDir=data/seed]
// Then:  npm run seed:local   (applies every data/seed/*.sql to the local D1)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parsePlecoXml, plecoToWords } from '../src/core/import/pleco';
import { seedCardFromPleco } from '../src/core/srs/seed';

const [, , xmlPath, outDir = 'data/seed'] = process.argv;
if (!xmlPath) {
  console.error('usage: tsx scripts/import-pleco.ts <flash.xml> [outDir]');
  process.exit(1);
}

const q = (s: string | null | undefined) => (s == null ? 'NULL' : `'${s.replace(/'/g, "''")}'`);
const CHUNK = 1500;
const now = new Date();

const cards = parsePlecoXml(readFileSync(xmlPath, 'utf8'));
const rows = plecoToWords(cards);
console.log(`cards ${cards.length}, unique words ${rows.length}`);

const counts: Record<string, number> = {};
for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
console.log('status counts', counts);

mkdirSync(outDir, { recursive: true });
let fileNo = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const lines: string[] = [];
  for (const r of chunk) {
    // Upsert the word. Re-running the import refreshes reading/gloss/meta but never
    // downgrades a status the app has since promoted to known.
    lines.push(
      `INSERT INTO words(lang, lemma, reading, gloss, source, status, meta_json) VALUES ('zh', ${q(r.lemma)}, ${q(r.reading)}, ${q(r.gloss)}, 'pleco_import', ${q(r.status)}, ${q(JSON.stringify(r.meta))})
ON CONFLICT(lang, lemma) DO UPDATE SET reading = COALESCE(words.reading, excluded.reading), gloss = COALESCE(words.gloss, excluded.gloss), meta_json = excluded.meta_json,
  status = CASE WHEN words.status = 'known' THEN 'known' ELSE excluded.status END;`,
    );
    // SRS card for learning words (and for known words that Pleco actually reviewed, so
    // they resurface on a long cycle). New words get a card when they first appear in use.
    const reviewed = (r.meta.pleco?.reviewed ?? 0) > 0;
    if (r.status === 'learning' || (r.status === 'known' && reviewed)) {
      const card = seedCardFromPleco(r.meta.pleco, now);
      lines.push(
        `INSERT OR IGNORE INTO srs_cards(item_type, item_id, lang, fsrs_state_json, due_at) SELECT 'word', id, 'zh', ${q(JSON.stringify(card))}, ${q(card.due.toISOString())} FROM words WHERE lang = 'zh' AND lemma = ${q(r.lemma)};`,
      );
    }
  }
  const name = join(outDir, `pleco-${String(fileNo++).padStart(2, '0')}.sql`);
  writeFileSync(name, lines.join('\n') + '\n');
  console.log(`wrote ${name} (${chunk.length} words)`);
}
