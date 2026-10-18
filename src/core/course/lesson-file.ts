// One lesson = one Markdown file in a course pack. The format is meant to be written by hand or by
// Claude, and round-trips exactly through parseLessonFile/renderLessonFile.
//
//   ---
//   id: bi-comparisons          stable id: keeps progress when the lesson is edited or moved
//   level: HSK 3
//   ---
//   # 比 — Comparisons          title without "Lesson N:", the number comes from the course order
//
//   **Pattern:** A 比 B + adjective
//
//   ## Grammar                  explanation paragraphs, separated by blank lines
//   ### Examples                - 中文 — English
//   ### Key points              - point
//   ## Drills                   1. English → 中文
//   ## Common errors            - ✗ wrong → ✓ right — optional note
//   ## Grammar points           - **title**: summary   (reviewed with spaced repetition)
//   ## Conversation             suggested chat prompt
import type { LessonCheckItem, LessonChoice, LessonContent } from '../lessons/types';

export interface LessonFile {
  id: string;
  /** Title without the "Lesson N:" prefix. */
  title: string;
  content: Omit<LessonContent, 'title'>;
}

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LESSON_PREFIX = /^Lesson\s+\d+\s*[:：]\s*/i;

export function stripLessonNumber(title: string): string {
  return title.replace(LESSON_PREFIX, '').trim();
}

export function numberedTitle(n: number, title: string): string {
  return `Lesson ${n}: ${stripLessonNumber(title)}`;
}

/** A readable ASCII id from a title; falls back to `lesson-N` when the title has no Latin letters. */
export function slugify(title: string, fallback: string): string {
  const s = stripLessonNumber(title)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-');
  return s || fallback;
}

export class LessonFileError extends Error {}

function splitOnce(s: string, sep: string): [string, string] | null {
  const i = s.indexOf(sep);
  return i < 0 ? null : [s.slice(0, i).trim(), s.slice(i + sep.length).trim()];
}

/** Paragraphs from a block of lines: blank lines separate, line breaks inside are kept. */
function paragraphs(lines: string[]): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (l.trim() === '') {
      if (cur.length) out.push(cur.join('\n'));
      cur = [];
    } else cur.push(l.trimEnd());
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

function bullets(lines: string[], where: string): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    const m = /^\s*[-*]\s+(.*)$/.exec(l);
    if (!m) throw new LessonFileError(`${where}: expected a "- " list item, got "${l.trim()}"`);
    out.push(m[1]!.trim());
  }
  return out;
}

interface Bullet {
  text: string;
  children: string[];
}

/** Top-level "- " items with their indented "- " children (options of a multiple-choice question). */
function nestedBullets(lines: string[], where: string): Bullet[] {
  const out: Bullet[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    const child = /^\s{2,}[-*]\s+(.*)$/.exec(l);
    const top = /^[-*]\s+(.*)$/.exec(l);
    if (child) {
      const parent = out[out.length - 1];
      if (!parent) throw new LessonFileError(`${where}: option "${child[1]!.trim()}" has no question above it`);
      parent.children.push(child[1]!.trim());
    } else if (top) out.push({ text: top[1]!.trim(), children: [] });
    else throw new LessonFileError(`${where}: expected a "- " list item, got "${l.trim()}"`);
  }
  return out;
}

const CORRECT = /\s*✓\s*$/;

function toChoice(b: Bullet, where: string): LessonChoice {
  const answers = b.children.map((c, i) => (CORRECT.test(c) ? i : -1)).filter((i) => i >= 0);
  if (answers.length !== 1) throw new LessonFileError(`${where}: "${b.text}" needs exactly one option marked ✓`);
  return { prompt: b.text, options: b.children.map((c) => c.replace(CORRECT, '').trim()), answer: answers[0]! };
}

function toCheckItem(b: Bullet, where: string): LessonCheckItem {
  if (b.children.length) return { kind: 'choice', ...toChoice(b, where) };
  const fix = /^✗\s*(.+?)\s+→\s+✓\s*(.+)$/.exec(b.text);
  if (fix) {
    const rn = splitOnce(fix[2]!, ' — ');
    return rn ? { kind: 'fix', wrong: fix[1]!.trim(), right: rn[0], note: rn[1] } : { kind: 'fix', wrong: fix[1]!.trim(), right: fix[2]!.trim() };
  }
  const tr = splitOnce(b.text, ' → ');
  if (tr) return { kind: 'translate', en: tr[0], zh: tr[1] };
  throw new LessonFileError(`${where}: "${b.text}" is not a choice (with options), "English → Chinese" or "✗ wrong → ✓ right"`);
}

const choiceLines = (c: LessonChoice) => [`- ${c.prompt}`, ...c.options.map((o, i) => `  - ${o}${i === c.answer ? ' ✓' : ''}`)];

function checkLines(it: LessonCheckItem): string[] {
  if (it.kind === 'choice') return choiceLines(it);
  if (it.kind === 'translate') return [`- ${it.en} → ${it.zh}`];
  return [`- ✗ ${it.wrong} → ✓ ${it.right}${it.note ? ` — ${it.note}` : ''}`];
}

export function parseLessonFile(md: string, where = 'lesson'): LessonFile {
  const text = md.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fm) throw new LessonFileError(`${where}: missing front matter (--- id: ... ---)`);
  const meta: Record<string, string> = {};
  for (const line of fm[1]!.split('\n')) {
    const kv = splitOnce(line, ':');
    if (kv && kv[0]) meta[kv[0].toLowerCase()] = kv[1];
  }
  const id = meta.id ?? '';
  if (!SLUG.test(id)) throw new LessonFileError(`${where}: id "${id}" must be lower-case letters, digits and hyphens`);

  const lines = text.slice(fm[0].length).split('\n');
  let title = '';
  let pattern = '';
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of lines) {
    const h1 = /^#\s+(.+)$/.exec(line);
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    const pat = /^\*\*Pattern:\*\*\s*(.*)$/.exec(line);
    if (h1 && !title) title = stripLessonNumber(h1[1]!.trim());
    else if (pat && current === null) pattern = pat[1]!.trim();
    else if (h) {
      current = h[2]!.trim().toLowerCase();
      if (sections.has(current)) throw new LessonFileError(`${where}: section "${h[2]}" appears twice`);
      sections.set(current, []);
    } else if (current) sections.get(current)!.push(line);
    else if (line.trim()) throw new LessonFileError(`${where}: unexpected text before the first section: "${line.trim()}"`);
  }
  const known = new Set(['grammar', 'examples', 'key points', 'drills', 'common errors', 'grammar points', 'conversation', 'recognise', 'lesson check']);
  for (const k of sections.keys()) if (!known.has(k)) throw new LessonFileError(`${where}: unknown section "${k}"`);
  const sec = (k: string) => sections.get(k) ?? [];

  const examples = bullets(sec('examples'), `${where} examples`).map((b) => {
    const p = splitOnce(b, ' — ');
    if (!p) throw new LessonFileError(`${where}: example "${b}" needs "Chinese — English"`);
    return { zh: p[0], en: p[1] };
  });
  const drills: LessonContent['drills'] = [];
  for (const l of sec('drills')) {
    if (!l.trim()) continue;
    const m = /^\s*\d+[.)]\s+(.*)$/.exec(l);
    const p = m ? splitOnce(m[1]!, ' → ') : null;
    if (!p) throw new LessonFileError(`${where}: drill "${l.trim()}" needs "1. English → Chinese"`);
    drills.push({ en: p[0], zh: p[1] });
  }
  const errors = bullets(sec('common errors'), `${where} common errors`).map((b) => {
    const m = /^✗\s*(.+?)\s+→\s+✓\s*(.+)$/.exec(b);
    if (!m) throw new LessonFileError(`${where}: error "${b}" needs "✗ wrong → ✓ right"`);
    const rn = splitOnce(m[2]!, ' — ');
    return rn ? { wrong: m[1]!.trim(), right: rn[0], note: rn[1] } : { wrong: m[1]!.trim(), right: m[2]!.trim() };
  });
  const grammarPoints = bullets(sec('grammar points'), `${where} grammar points`).map((b) => {
    const m = /^\*\*(.+?)\*\*\s*[:：]\s*(.*)$/.exec(b);
    if (!m) throw new LessonFileError(`${where}: grammar point "${b}" needs "**title**: summary"`);
    return { title: m[1]!.trim(), summary: m[2]!.trim() };
  });
  const chat = paragraphs(sec('conversation')).join('\n\n');
  const recognise = nestedBullets(sec('recognise'), `${where} recognise`).map((b) => toChoice(b, `${where} recognise`));
  const check = nestedBullets(sec('lesson check'), `${where} lesson check`).map((b) => toCheckItem(b, `${where} lesson check`));

  return {
    id,
    title,
    content: {
      level: meta.level ?? '',
      pattern,
      explanation: paragraphs(sec('grammar')),
      examples,
      keyPoints: bullets(sec('key points'), `${where} key points`),
      drills,
      errors,
      grammarPoints,
      ...(chat ? { chatPrompt: chat } : {}),
      ...(recognise.length ? { recognise } : {}),
      ...(check.length ? { check } : {}),
    },
  };
}

export function renderLessonFile(f: LessonFile): string {
  const c = f.content;
  const out = ['---', `id: ${f.id}`, `level: ${c.level}`, '---', `# ${stripLessonNumber(f.title)}`, ''];
  if (c.pattern) out.push(`**Pattern:** ${c.pattern}`, '');
  out.push('## Grammar', '', ...c.explanation.flatMap((p) => [p, '']));
  if (c.examples.length) out.push('### Examples', '', ...c.examples.map((e) => `- ${e.zh} — ${e.en}`), '');
  if (c.keyPoints.length) out.push('### Key points', '', ...c.keyPoints.map((k) => `- ${k}`), '');
  if (c.drills.length) out.push('## Drills', '', ...c.drills.map((d, i) => `${i + 1}. ${d.en} → ${d.zh}`), '');
  if (c.errors.length) out.push('## Common errors', '', ...c.errors.map((e) => `- ✗ ${e.wrong} → ✓ ${e.right}${e.note ? ` — ${e.note}` : ''}`), '');
  if (c.grammarPoints.length) out.push('## Grammar points', '', ...c.grammarPoints.map((g) => `- **${g.title}**: ${g.summary}`), '');
  if (c.chatPrompt) out.push('## Conversation', '', c.chatPrompt, '');
  if (c.recognise?.length) out.push('## Recognise', '', ...c.recognise.flatMap(choiceLines), '');
  if (c.check?.length) out.push('## Lesson check', '', ...c.check.flatMap(checkLines), '');
  return out.join('\n');
}
