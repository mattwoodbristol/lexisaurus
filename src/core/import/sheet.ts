// Parse the "Mandarin Lesson Vocabulary Dictionary" sheet (CSV export).
// Columns: Lesson, Character, Pinyin, English, Part of Speech, Notes, (overflow)

export interface SheetRow {
  lesson: string;
  hanzi: string;
  pinyin: string;
  english: string;
  pos: string;
  notes: string;
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function parseVocabSheet(csv: string): SheetRow[] {
  const rows = parseCsv(csv);
  const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (name: string) => header.findIndex((h) => h.startsWith(name));
  const iLesson = col('lesson');
  const iHanzi = col('character');
  const iPinyin = col('pinyin');
  const iEnglish = col('english');
  const iPos = col('part of speech');
  const iNotes = col('notes');
  if (iHanzi < 0) throw new Error('sheet: no Character column');
  const out: SheetRow[] = [];
  for (const r of rows.slice(1)) {
    const hanzi = (r[iHanzi] ?? '').trim();
    if (!hanzi) continue;
    // Anything after the Notes column is overflow from a comma inside the note.
    const notes = [r[iNotes] ?? '', ...r.slice(iNotes + 1)]
      .map((x) => x.trim())
      .filter(Boolean)
      .join(', ');
    out.push({
      lesson: (r[iLesson] ?? '').trim(),
      hanzi,
      pinyin: (r[iPinyin] ?? '').trim(),
      english: (r[iEnglish] ?? '').trim(),
      pos: (r[iPos] ?? '').trim(),
      notes,
    });
  }
  return out;
}

/** Rows like 对...来说 are grammar patterns, not words. */
export function isPattern(row: SheetRow): boolean {
  return /\.\.\.|…/.test(row.hanzi) || row.pos === 'structure';
}
