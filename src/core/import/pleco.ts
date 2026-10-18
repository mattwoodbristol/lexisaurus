// Parse a Pleco flashcard XML export (formatversion 2) and apply the author's status rules.
import { numberedToMarked } from '../pinyin/tones';
import type { StoredStatus } from '../pinyin/annotate';

export interface PlecoScore {
  score: number;
  difficulty: number;
  history: string;
  correct: number;
  incorrect: number;
  reviewed: number;
  firstReviewedTime?: number; // unix seconds
  lastReviewedTime?: number;
}

export interface PlecoCard {
  simp: string;
  trad?: string;
  /** Tone-numbered pinyin as exported, e.g. "Zhong1guo2". */
  pron?: string;
  defn?: string;
  categories: string[];
  score?: PlecoScore;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

const attr = (s: string, name: string): string | undefined => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(s);
  return m ? decode(m[1] ?? '') : undefined;
};

export function parsePlecoXml(xml: string): PlecoCard[] {
  const cards: PlecoCard[] = [];
  const cardRe = /<card\b[^>]*>([\s\S]*?)<\/card>/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(xml))) {
    const body = m[1] ?? '';
    const simp = /<headword charset="sc">([^<]*)<\/headword>/.exec(body)?.[1];
    if (!simp) continue;
    const trad = /<headword charset="tc">([^<]*)<\/headword>/.exec(body)?.[1];
    const pron = /<pron[^>]*>([^<]*)<\/pron>/.exec(body)?.[1];
    const defn = /<defn>([\s\S]*?)<\/defn>/.exec(body)?.[1];
    const categories = [...body.matchAll(/<catassign category="([^"]*)"/g)].map((x) => decode(x[1] ?? ''));
    const si = /<scoreinfo\b([^>]*)\/>/.exec(body)?.[1];
    const card: PlecoCard = { simp: decode(simp).trim(), categories };
    if (trad) card.trad = decode(trad).trim();
    if (pron) card.pron = decode(pron).trim();
    if (defn) card.defn = decode(defn).replace(/\s+/g, ' ').trim();
    if (si) {
      const n = (k: string) => Number(attr(si, k) ?? 0);
      card.score = {
        score: n('score'),
        difficulty: n('difficulty'),
        history: attr(si, 'history') ?? '',
        correct: n('correct'),
        incorrect: n('incorrect'),
        reviewed: n('reviewed'),
        ...(attr(si, 'firstreviewedtime') ? { firstReviewedTime: n('firstreviewedtime') } : {}),
        ...(attr(si, 'lastreviewedtime') ? { lastReviewedTime: n('lastreviewedtime') } : {}),
      };
    }
    cards.push(card);
  }
  return cards;
}

/** HSK 3.0 level from categories: 1-6, or 7 for "Level 7-9". Undefined if none. */
export function hskLevel(categories: string[]): number | undefined {
  let best: number | undefined;
  for (const c of categories) {
    const m = /HSK 3\.0\/Level (\d)/.exec(c);
    if (m) {
      const lvl = Number(m[1]);
      if (best === undefined || lvl < best) best = lvl;
    }
  }
  return best;
}

export const KNOWN_SCORE_THRESHOLD = 1600;
export const PERSONAL_CATEGORIES = ['Duo Chars', 'Words'];

/**
 * the author's rules (2026-10-04, revised 2026-10-05): known if score > 1600, or HSK level 1-2 and
 * reviewed in Pleco; otherwise learning if ever reviewed in Pleco; otherwise new (the pool).
 * Neither the HSK level nor a personal category makes a never-reviewed word known or learning:
 * many of those were never studied (e.g. 检查).
 */
export function plecoStatus(card: PlecoCard): StoredStatus {
  const score = card.score?.score ?? 0;
  const lvl = hskLevel(card.categories);
  const reviewed = !!card.score && card.score.reviewed > 0;
  if (score > KNOWN_SCORE_THRESHOLD) return 'known';
  if (lvl !== undefined && lvl <= 2 && reviewed) return 'known';
  if (reviewed) return 'learning';
  return 'new';
}

const POS_LABEL =
  /^(noun|verb|adjective|adverb|pronoun|measure word|conjunction|preposition|particle|interjection|numeral|idiom|phrase|prefix|suffix|abbreviation|onomatopoeia|dialect|literary|colloquial)\s+/i;

/** Short English gloss from a Pleco definition: first sense, before any example. */
export function plecoGloss(defn: string | undefined): string | undefined {
  if (!defn) return undefined;
  let s = defn.replace(POS_LABEL, '').replace(/^1\s+/, '');
  // A leading usage note ("[in questions, often replaced by 多] how ...") is not the meaning.
  const note = /^\[[^\]]*\]\s*/.exec(s);
  if (note && note[0].length < s.length) s = s.slice(note[0].length);
  // Cut at the first Han character (examples), or at the next sense number, or a cross-reference.
  let cut = s.search(/[㐀-䶿一-鿿]|\s2\s|\sSee\s/);
  if (cut > 0) {
    // Never cut inside a bracket ("good (opp. 坏)"): cut where that bracket opens instead.
    const before = s.slice(0, cut);
    const open = Math.max(before.lastIndexOf('('), before.lastIndexOf('['));
    const close = Math.max(before.lastIndexOf(')'), before.lastIndexOf(']'));
    if (open > close) cut = open;
  }
  if (cut > 0) s = s.slice(0, cut);
  s = s.replace(/\s+/g, ' ').replace(/[;,\s]+$/, '').trim();
  return s.length > 0 ? s.slice(0, 120) : undefined;
}

export interface PlecoWordRow {
  lemma: string;
  reading: string | null;
  gloss: string | null;
  status: StoredStatus;
  meta: { trad?: string; hsk?: number; categories: string[]; pleco?: PlecoScore };
}

/** Dedupe on simplified headword, keeping the highest score and the union of categories. */
export function plecoToWords(cards: PlecoCard[]): PlecoWordRow[] {
  const byLemma = new Map<string, PlecoCard>();
  for (const c of cards) {
    const prev = byLemma.get(c.simp);
    if (!prev) {
      byLemma.set(c.simp, { ...c, categories: [...c.categories] });
      continue;
    }
    prev.categories = [...new Set([...prev.categories, ...c.categories])];
    if ((c.score?.score ?? -1) > (prev.score?.score ?? -1)) prev.score = c.score;
    prev.pron ||= c.pron;
    prev.defn ||= c.defn;
    prev.trad ||= c.trad;
  }
  const rows: PlecoWordRow[] = [];
  for (const c of byLemma.values()) {
    const hsk = hskLevel(c.categories);
    rows.push({
      lemma: c.simp,
      reading: c.pron ? numberedToMarked(c.pron) : null,
      gloss: plecoGloss(c.defn) ?? null,
      status: plecoStatus(c),
      meta: {
        ...(c.trad && c.trad !== c.simp ? { trad: c.trad } : {}),
        ...(hsk !== undefined ? { hsk } : {}),
        categories: c.categories,
        ...(c.score ? { pleco: c.score } : {}),
      },
    });
  }
  return rows;
}
