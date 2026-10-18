// Merging generated practice (extra drills, recognise questions, lesson check) into a lesson.
import type { LessonFile } from '../course/lesson-file';
import type { LessonCheckItem, LessonChoice } from './types';

export interface Practice {
  extraDrills: { en: string; zh: string }[];
  recognise: LessonChoice[];
  checkChoice: LessonChoice[];
  checkTranslate: { en: string; zh: string }[];
  checkFix: { wrong: string; right: string; note: string }[];
}

/** Mix the check so kinds alternate: choice, translate, choice, fix, translate, ... */
export function mixCheck(p: Pick<Practice, 'checkChoice' | 'checkTranslate' | 'checkFix'>): LessonCheckItem[] {
  const queues: LessonCheckItem[][] = [
    p.checkChoice.map((c) => ({ kind: 'choice' as const, ...c })),
    p.checkTranslate.map((t) => ({ kind: 'translate' as const, ...t })),
    p.checkFix.map((f) => ({ kind: 'fix' as const, ...f })),
  ];
  const out: LessonCheckItem[] = [];
  const order = [0, 1, 0, 2, 1, 0, 1, 2];
  for (const q of order) {
    const it = queues[q]!.shift();
    if (it) out.push(it);
  }
  for (const q of queues) out.push(...q);
  return out;
}

/** Merge a generated practice set into a lesson file (keeps everything already there). */
export function withPractice(f: LessonFile, p: Practice): LessonFile {
  const seen = new Set(f.content.drills.map((d) => d.zh));
  const extra = p.extraDrills.filter((d) => !seen.has(d.zh)).slice(0, Math.max(0, 8 - f.content.drills.length));
  const recognise: LessonChoice[] = p.recognise;
  return { ...f, content: { ...f.content, drills: [...f.content.drills, ...extra], recognise, check: mixCheck(p) } };
}
