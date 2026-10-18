// Corrections in chat: the tutor reports every real mistake in the learner's last message with a
// severity; code decides which to show now (setting chat.corrections), and the rest wait for the
// end-of-chat summary. The tutor no longer corrects inside its reply.
//
//   meaning  changes or hides what the learner meant                      shown at every level
//   target   the grammar being practised, or one of the learner's recurring mistakes
//   minor    any other real mistake       Strict; Balanced when the last message showed nothing

export type Severity = 'meaning' | 'target' | 'minor';
export type CorrectionLevel = 'light' | 'balanced' | 'strict';
export const CORRECTION_LEVELS: CorrectionLevel[] = ['light', 'balanced', 'strict'];
export const DEFAULT_CORRECTION_LEVEL: CorrectionLevel = 'balanced';
const RANK: Record<Severity, number> = { meaning: 0, target: 1, minor: 2 };

export interface Correction {
  wrong: string;
  right: string;
  note: string;
  severity: Severity;
}

export interface ShownCorrection extends Correction {
  /** Shown under the message now; otherwise kept for the end-of-chat summary. */
  shown: boolean;
}

export function isCorrectionLevel(x: unknown): x is CorrectionLevel {
  return typeof x === 'string' && (CORRECTION_LEVELS as string[]).includes(x);
}

const compact = (s: string) => s.replace(/[\s\p{P}]/gu, '').toLowerCase();
const keyOf = (c: Pick<Correction, 'wrong' | 'right'>) => `${compact(c.wrong)}→${compact(c.right)}`;

/** Keep corrections that quote the learner's own words and actually change something; one per mistake. */
export function acceptCorrections(raw: Correction[], learnerText: string): Correction[] {
  const text = compact(learnerText);
  const seen = new Set<string>();
  const out: Correction[] = [];
  for (const c of raw) {
    const wrong = c.wrong?.trim() ?? '';
    const right = c.right?.trim() ?? '';
    if (!wrong || !right || compact(wrong) === compact(right)) continue;
    if (!text.includes(compact(wrong))) continue; // must come from what the learner wrote
    if (/\bor\b|\//.test(right) && compact(right).includes(compact(wrong))) continue; // 'X or <their own words>': not a mistake
    const severity: Severity = c.severity === 'meaning' || c.severity === 'target' ? c.severity : 'minor';
    const k = keyOf({ wrong, right });
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ wrong, right, note: (c.note ?? '').trim().slice(0, 200), severity });
  }
  return out;
}

/**
 * Which corrections to show now. Light: meaning only. Balanced: the single most important one; a
 * minor one only if nothing was shown under the previous message (so it is never every turn).
 * Strict: everything, at most three. A mistake shown under the previous message is not repeated.
 */
export function chooseShown(corrections: Correction[], level: CorrectionLevel, shownLastTime: Set<string> = new Set()): ShownCorrection[] {
  const eligible = (c: Correction) => (level === 'light' ? c.severity === 'meaning' : level === 'balanced' ? c.severity !== 'minor' || shownLastTime.size === 0 : true);
  const limit = level === 'strict' ? 3 : 1;
  const ranked = corrections
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => eligible(c) && !shownLastTime.has(keyOf(c)))
    .sort((a, b) => RANK[a.c.severity] - RANK[b.c.severity] || a.i - b.i)
    .slice(0, limit);
  const pick = new Set(ranked.map((r) => r.i));
  return corrections.map((c, i) => ({ ...c, shown: pick.has(i) }));
}

export function shownKeys(list: ShownCorrection[] | null | undefined): Set<string> {
  return new Set((list ?? []).filter((c) => c.shown).map(keyOf));
}

/** For the tutor: corrections are someone else's job now. */
export const TUTOR_NO_CORRECTIONS =
  'Do not correct or restate the learner\'s sentence inside "reply": the app checks their message separately and shows corrections itself. This replaces the correction style above. Keep "reply" pure conversation.';

/** System prompt for the separate checker (a stronger model than the chat tutor). */
export function correctorSystem(languageName: string, recurring: { wrong: string; right: string }[], practising: string | null, explain = ''): string {
  return [
    `You check one message written by a learner of ${languageName} in a casual chat with a tutor. List every real mistake in it.`,
    'For each: wrong = the exact words from their message (the shortest stretch that contains the mistake; for word order, the phrase that is out of order), right = ONE corrected version of those words (no alternatives), note = the rule in one short clause of at most ten words, in the explanation language below (name the rule; do not restate the fix or add encouragement), and severity:',
    '- "meaning": the mistake changes or hides what they meant;',
    `- "target": it involves ${practising ? `the grammar being practised (${practising}) or ` : ''}one of their recurring mistakes${recurring.length ? `: ${recurring.map((m) => `${m.wrong} → ${m.right}`).join('; ')}` : ''};`,
    '- "minor": any other real mistake.',
    'Check word order, particles, measure words, verb forms, agreement and word choice. A mistake is something a native speaker would not say. If their version is acceptable, it is not a mistake: leave it out. Never list something that is "fine", "also correct" or merely less common.',
    'Ignore typos, missing accents, punctuation, capitalisation, English words and natural alternatives. An empty list is normal.',
    explain,
  ].filter(Boolean).join('\n');
}

/** The end-of-chat list: every distinct mistake in the chat, most serious first, at most `max`. */
export function summariseCorrections(perMessage: (ShownCorrection[] | null | undefined)[], max = 8): ShownCorrection[] {
  const seen = new Set<string>();
  const all: { c: ShownCorrection; i: number }[] = [];
  for (const list of perMessage)
    for (const c of list ?? []) {
      const k = keyOf(c);
      if (seen.has(k)) continue;
      seen.add(k);
      all.push({ c, i: all.length });
    }
  return all
    .sort((a, b) => RANK[a.c.severity] - RANK[b.c.severity] || a.i - b.i)
    .slice(0, max)
    .map((x) => x.c);
}
