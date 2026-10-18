// Grammar use in chat: on each reply the tutor also reports which studied grammar points the
// learner used in their last message, and whether correctly. Unprompted correct uses count
// towards a lesson being "embedded" (core/lessons/mastery.ts).

export interface StudiedPoint {
  id: number;
  title: string;
  summary: string | null;
}

export interface ReportedUse {
  grammarPointId: number;
  correct: boolean;
  /** The words from the learner's message that use the pattern. */
  quote: string;
}

export interface AcceptedUse extends ReportedUse {
  /** True when the tutor's previous message hinted at this point. */
  prompted: boolean;
}

export const MAX_STUDIED = 25;

export function usageInstruction(points: StudiedPoint[]): string {
  const list = points.map((p) => `- id ${p.id}: ${p.title}${p.summary ? ` (${p.summary})` : ''}`).join('\n');
  return [
    'Grammar use check (this reply only): the learner has studied these grammar points:',
    list,
    'In "used", list each of these points that the learner actually used in their LAST message (not in your reply), with correct=true if they used it correctly and quote = the words from their message that use it. Do not list a point just because a related word appears, and do not list points they avoided. An empty list is normal.',
  ].join('\n');
}

/** Keep reports for studied points that quote the learner's message; one per point. */
export function acceptUses(raw: ReportedUse[], points: StudiedPoint[], learnerText: string, previousHintId: number | null): AcceptedUse[] {
  const ids = new Set(points.map((p) => p.id));
  const compact = (s: string) => s.replace(/[\s\p{P}]/gu, '');
  const text = compact(learnerText);
  const seen = new Set<number>();
  const out: AcceptedUse[] = [];
  for (const r of raw) {
    if (!ids.has(r.grammarPointId) || seen.has(r.grammarPointId)) continue;
    const q = compact(r.quote ?? '');
    // The quote must come from what the learner wrote, so a use in the tutor's reply is not counted.
    if (!q || !text.includes(q)) continue;
    seen.add(r.grammarPointId);
    out.push({ grammarPointId: r.grammarPointId, correct: !!r.correct, quote: r.quote.trim().slice(0, 120), prompted: r.grammarPointId === previousHintId });
  }
  return out;
}
