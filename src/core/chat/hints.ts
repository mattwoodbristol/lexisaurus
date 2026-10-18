// Grammar hints in chat: now and then the tutor's question comes with a nudge to use a grammar
// point from a finished lesson ("Try 是…的 to say when it happened"). Code decides how often and
// which points are offered; the model decides whether one fits the question it is asking.

export interface HintCandidate {
  id: number;
  title: string;
  summary: string | null;
  lessonId: number | null;
  /** Review card due date, if the point is in reviews. Sooner = more worth practising. */
  dueAt: string | null;
}

export interface MessageHint {
  grammarPointId: number;
  /** Short nudge in the explanation language, e.g. "Try 是…的 to say when you went." */
  text: string;
  title: string;
  lessonId: number | null;
}

export const DEFAULT_HINT_EVERY = 4;
export const MAX_CANDIDATES = 4;

/**
 * Offer a hint on this tutor reply? Only every `every` replies at most (0 = never), counting
 * replies since the last hint, and never on the opening message of a chat.
 */
export function shouldOfferHint(o: { every: number; tutorRepliesSoFar: number; repliesSinceHint: number | null }): boolean {
  if (o.every <= 0 || o.tutorRepliesSoFar === 0) return false;
  const since = o.repliesSinceHint ?? o.tutorRepliesSoFar;
  return since >= o.every - 1;
}

/** Points to offer: not yet hinted in this chat, soonest due first, then the most recent lessons. */
export function pickCandidates(points: HintCandidate[], hintedInChat: Set<number>, limit = MAX_CANDIDATES): HintCandidate[] {
  return points
    .filter((p) => !hintedInChat.has(p.id))
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return (b.lessonId ?? 0) - (a.lessonId ?? 0);
    })
    .slice(0, limit);
}

/** The per-turn instruction listing the points the tutor may hint at. */
export function hintInstruction(candidates: HintCandidate[], explain = ''): string {
  const list = candidates.map((c) => `- id ${c.id}: ${c.title}${c.summary ? ` (${c.summary})` : ''}`).join('\n');
  return [
    'Grammar hint (this reply only): the learner has studied these grammar points:',
    list,
    'If the question you end your reply with naturally invites the learner to use ONE of them in their answer, set "hint" to that point\'s id and a short nudge of at most 15 words (in the explanation language below) that names the pattern and says how to use it in this answer, e.g. "Try 是…的 to say when and how you got there." Show the pattern (Chinese is fine, no pinyin) but never a sample sentence: the learner writes the answer.',
    'If none fits naturally, set "hint" to null. A forced hint is worse than none. Do not mention the hint inside "reply".',
    explain,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Accept the model's hint only for an offered point, with a usable nudge. */
export function acceptHint(raw: { grammarPointId: number; text: string } | null, candidates: HintCandidate[]): MessageHint | null {
  if (!raw) return null;
  const c = candidates.find((x) => x.id === raw.grammarPointId);
  const text = raw.text.trim().replace(/\s+/g, ' ');
  if (!c || !text || text.length > 160) return null;
  return { grammarPointId: c.id, text, title: c.title, lessonId: c.lessonId };
}
