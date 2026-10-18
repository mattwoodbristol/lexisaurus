// Parser for the author's "Mandarin Coach: Grammar Lessons 1-20" notes, after text extraction from .docx
// (one paragraph or table cell per line). Layout per lesson:
//   # Lesson N: Title
//   Grammar pattern: ...
//   ## Grammar Explanation
//   <paragraphs>
//   Examples
//   <汉字。  English.>            (two or more spaces between Chinese and English)
//   Key Points
//   - <bullet>
//   ## Translation Drills
//   English / Chinese / Pinyin   (header cells, then triples)
//   ## Common Errors             (optional)
//   Error / Correction           (header cells, then pairs; "fix (note)")
// A final "# Recurring Errors — Quick Reference" section holds general Error/Correction pairs.
import type { LessonContent, LessonError } from './types';

const HAN = /[㐀-䶿一-鿿]/;

export interface ParsedNotes {
  lessons: (LessonContent & { number: number })[];
  recurringErrors: LessonError[];
}

function splitExample(line: string): { zh: string; en: string } | null {
  const two = line.split(/\s{2,}/);
  if (two.length >= 2 && HAN.test(two[0] ?? '')) return { zh: two[0]!.trim(), en: two.slice(1).join(' ').trim() };
  // Fallback: Chinese up to the first Latin letter after the last Han character run.
  const m = /^(.*[㐀-䶿一-鿿][。！？!?.，,]*)\s+([A-Za-z(].*)$/.exec(line);
  return m ? { zh: m[1]!.trim(), en: m[2]!.trim() } : null;
}

/** "fix (note)" -> { right, note }. Notes are a trailing parenthesis that contains no Chinese-only fix. */
export function splitCorrection(cell: string): { right: string; note?: string } {
  const m = /^(.*?)\s*[（(]([^()（）]*)[)）]\s*$/.exec(cell.trim());
  if (m && m[1] && m[1].trim()) return { right: m[1].trim(), note: m[2]!.trim() };
  return { right: cell.trim() };
}

function pairs(lines: string[], header: string[]): string[][] {
  let i = 0;
  while (i < lines.length && header.includes(lines[i]!.trim())) i++;
  const out: string[][] = [];
  const width = header.length;
  for (; i + width - 1 < lines.length; i += width) out.push(lines.slice(i, i + width));
  return out;
}

function levelFor(n: number): string {
  if (n <= 3) return 'HSK 2';
  if (n <= 10) return 'HSK 3';
  return 'HSK 3-4';
}

export function parseLessonNotes(text: string): ParsedNotes {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  const lessons: ParsedNotes['lessons'] = [];
  let recurringErrors: LessonError[] = [];

  // Split into top-level sections at "# " headings.
  const sections: { head: string; body: string[] }[] = [];
  for (const line of lines) {
    if (/^# /.test(line)) sections.push({ head: line.slice(2).trim(), body: [] });
    else sections.at(-1)?.body.push(line);
  }

  for (const sec of sections) {
    const m = /^Lesson (\d+):\s*(.+)$/.exec(sec.head);
    if (!m) {
      if (/^Recurring Errors/i.test(sec.head)) {
        const body = sec.body.filter((l) => l.trim() && !/^These are/.test(l));
        recurringErrors = pairs(body, ['Error', 'Correction']).map(([w, r]) => ({ wrong: w!.trim(), right: r!.trim() }));
      }
      continue;
    }
    const number = Number(m[1]);
    const title = m[2]!.replace(/\s*—\s*/, ' — ').trim();

    // Sub-sections at "## ".
    const subs = new Map<string, string[]>();
    let cur = '_intro';
    subs.set(cur, []);
    for (const l of sec.body) {
      if (/^## /.test(l)) {
        cur = l.slice(3).trim();
        subs.set(cur, []);
      } else if (l.trim()) subs.get(cur)!.push(l);
    }

    const intro = subs.get('_intro') ?? [];
    const pattern = (intro.find((l) => l.startsWith('Grammar pattern:')) ?? '').replace('Grammar pattern:', '').trim();

    const g = subs.get('Grammar Explanation') ?? [];
    const iEx = g.indexOf('Examples');
    const iKp = g.indexOf('Key Points');
    const explanation = g.slice(0, iEx >= 0 ? iEx : iKp >= 0 ? iKp : g.length);
    const exampleLines = iEx >= 0 ? g.slice(iEx + 1, iKp >= 0 ? iKp : g.length) : [];
    const keyPoints = iKp >= 0 ? g.slice(iKp + 1).map((l) => l.replace(/^-\s*/, '').trim()) : [];
    const examples = exampleLines.map(splitExample).filter((x): x is { zh: string; en: string } => !!x);

    const drillRows = pairs(subs.get('Translation Drills') ?? [], ['English', 'Chinese', 'Pinyin']);
    const drills = drillRows.filter((r) => HAN.test(r[1] ?? '')).map(([en, zh]) => ({ en: en!.trim(), zh: zh!.trim() }));

    const errRows = pairs(subs.get('Common Errors') ?? [], ['Error', 'Correction']);
    const errors = errRows.map(([w, r]) => ({ wrong: w!.trim(), ...splitCorrection(r!) }));

    lessons.push({
      number,
      title: `Lesson ${number}: ${title}`,
      level: levelFor(number),
      pattern,
      explanation,
      examples,
      keyPoints,
      drills,
      errors,
      grammarPoints: [{ title: title.split(' — ')[0]!.trim(), summary: pattern || explanation[0] || title }],
      chatPrompt: `Use today's structure (${title.split(' — ')[0]}) in a short conversation.`,
    });
  }
  return { lessons, recurringErrors };
}
