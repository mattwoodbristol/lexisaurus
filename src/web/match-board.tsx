// The matching board shared by Sort my words and Review: a few words, their meanings and one
// decoy. Tap a word then a meaning (or the other way round); "?" sends a word off as not known.
import { useEffect, useRef, useState } from 'preact/hooks';
import { newBoard, removeWord, returnWord, tooSimilar, type Board, type BoardItem } from '../core/assessment/sort-board';

export type MatchWord = BoardItem & { lemma: string };

/** Wrong matches before a word counts as not known. */
export const MATCH_STRIKES = 2;
/** Decoy meanings kept for later boards. */
const DECOYS_KEPT = 60;

/** How a tile is shown: matched (green, then fading out), a wrong try (shake), or leaving unmatched. */
export type TileFlash = { word: number; meaning: number; kind: 'right' | 'wrong' | 'gone' };

/** Animation times (ms), in step with styles.css. */
const RIGHT_MS = 800;
const WRONG_MS = 650;
const GONE_MS = 500;

export interface MatchBoard<T extends MatchWord> {
  board: Board<T> | null;
  picked: { word: number | null; meaning: number | null };
  flash: TileFlash | null;
  strikes: Record<number, number>;
  /** Words that just came onto the board, highlighted as they arrive. */
  fresh: Set<number>;
  /** Where tiles stand: a cleared tile leaves a blank its size until the set is done, so nothing moves under a finger. */
  layout: { words: Slot<T>[]; meanings: Slot<string>[] };
  /** A new board from these words; `decoys` join the decoy meanings kept from earlier boards. */
  start: (words: T[], decoys: string[]) => void;
  pickWord: (id: number) => void;
  pickMeaning: (k: number) => void;
  dontKnow: (word: T) => void;
  /** Put a settled word back on the board (an undo). */
  putBack: (word: T) => void;
}

const NONE = new Set<number>();

type Picked = { word: number | null; meaning: number | null };
const NO_PICK: Picked = { word: null, meaning: null };

/** A place on the board; `gone` once its tile has been cleared. */
export type Slot<X> = { item: X; gone: boolean };

/** Keep what stays in its place, blank what left, and put what came in the first blanks (or at the end). */
function place<X>(slots: Slot<X>[], next: X[], same: (a: X, b: X) => boolean): Slot<X>[] {
  const rest = [...next];
  const out = slots.map((s) => {
    const k = s.gone ? -1 : rest.findIndex((y) => same(s.item, y));
    return k < 0 ? { item: s.item, gone: true } : { item: rest.splice(k, 1)[0]!, gone: false };
  });
  // Nothing stayed: a new set, laid out afresh.
  if (out.every((s) => s.gone)) return next.map((item) => ({ item, gone: false }));
  for (const item of rest) {
    const k = out.findIndex((s) => s.gone);
    if (k < 0) out.push({ item, gone: false });
    else out[k] = { item, gone: false };
  }
  return out;
}

/**
 * Board state and taps. `onSettle` is called once per word as it leaves the board: known (matched)
 * or not ("?", or MATCH_STRIKES wrong tries), with the wrong tries it took.
 */
export function useMatchBoard<T extends MatchWord>(size: number, onSettle: (word: T, known: boolean, strikes: number) => void): MatchBoard<T> {
  const [board, setBoardState] = useState<Board<T> | null>(null);
  const [picked, setPickedState] = useState<Picked>(NO_PICK);
  // Taps can come while a pair is still clearing, so the handlers read these rather than the last render.
  const pick = useRef<Picked>(NO_PICK);
  const setPicked = (p: Picked) => {
    pick.current = p;
    setPickedState(p);
  };
  const [flash, setFlash] = useState<TileFlash | null>(null);
  const [strikes, setStrikesState] = useState<Record<number, number>>({});
  const struck = useRef<Record<number, number>>({});
  const setStrikes = (x: Record<number, number>) => {
    struck.current = x;
    setStrikesState(x);
  };
  const [fresh, setFresh] = useState(NONE);
  const [layout, setLayout] = useState<MatchBoard<T>['layout']>({ words: [], meanings: [] });
  const placed = useRef<MatchBoard<T>['layout']>({ words: [], meanings: [] });
  // Decoy meanings: other words at the level, and words matched this sitting.
  const decoys = useRef<string[]>([]);
  const seed = useRef(Date.now() % 1_000_000);
  const nextSeed = () => ++seed.current;
  const timer = useRef<number>();
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const settled = useRef(onSettle);
  settled.current = onSettle;
  const current = useRef<Board<T> | null>(null);
  /** Show a changed board, marking what arrived since the last one. */
  const showBoard = (next: Board<T>, highlight: boolean) => {
    const prev = current.current;
    current.current = next;
    setBoardState(next);
    setFresh(highlight && prev ? new Set(next.words.filter((w) => !prev.words.some((p) => p.id === w.id)).map((w) => w.id)) : NONE);
    // A tile picked while the last pair cleared stays picked, in its place on the new board.
    const p = pick.current;
    if (prev && (p.word !== null || p.meaning !== null)) {
      const mn = p.meaning === null ? undefined : prev.meanings[p.meaning];
      const nth = p.meaning === null ? 0 : prev.meanings.slice(0, p.meaning).filter((x) => x === mn).length;
      const k = mn === undefined ? -1 : next.meanings.findIndex((x, j) => x === mn && next.meanings.slice(0, j).filter((y) => y === mn).length === nth);
      setPicked({ word: next.words.some((w) => w.id === p.word) ? p.word : null, meaning: k < 0 ? null : k });
    }
    const was = prev ? placed.current : { words: [], meanings: [] };
    placed.current = { words: place(was.words, next.words, (a, b) => a.id === b.id), meanings: place(was.meanings, next.meanings, (a, b) => a === b) };
    setLayout(placed.current);
  };
  const later = (ms: number, fn: () => void) => {
    clearTimeout(timer.current);
    pending.current = fn;
    timer.current = window.setTimeout(() => {
      pending.current = null;
      fn();
    }, ms);
  };
  /** Finish what is clearing now, so a new pair can be tried on the board as it will be. */
  const flush = () => {
    while (pending.current) {
      const fn = pending.current;
      pending.current = null;
      clearTimeout(timer.current);
      fn();
    }
  };

  const start = (words: T[], more: string[]) => {
    decoys.current = [...new Set([...more, ...decoys.current])].slice(0, DECOYS_KEPT);
    clearTimeout(timer.current);
    pending.current = null;
    setStrikes({});
    setPicked(NO_PICK);
    setFlash(null);
    showBoard(newBoard(words, size, decoys.current, nextSeed()), false);
  };
  const settle = (word: T, known: boolean, n: number) => {
    setFlash(null);
    settled.current(word, known, n);
    if (known) decoys.current = [word.meaning, ...decoys.current.filter((d) => d !== word.meaning)];
    if (current.current) showBoard(removeWord(current.current, word.id, size, decoys.current, nextSeed()), true);
  };
  /** A word leaving unmatched fades out with its meaning first. */
  const leave = (word: T, n: number) => {
    setFlash({ word: word.id, meaning: current.current?.meanings.indexOf(word.meaning) ?? -1, kind: 'gone' });
    later(GONE_MS, () => settle(word, false, n));
  };
  const tryMatch = (wordId: number, meaningIdx: number) => {
    const b = current.current;
    const word = b?.words.find((w) => w.id === wordId);
    if (!b || !word || b.meanings[meaningIdx] === undefined) return setPicked(NO_PICK);
    const ok = tooSimilar(word.meaning, b.meanings[meaningIdx]);
    const n = struck.current[wordId] ?? 0;
    setPicked(NO_PICK);
    setFlash({ word: wordId, meaning: meaningIdx, kind: ok ? 'right' : 'wrong' });
    if (ok) return later(RIGHT_MS, () => settle(word, true, n));
    later(WRONG_MS, () => {
      setStrikes({ ...struck.current, [wordId]: n + 1 });
      if (n + 1 >= MATCH_STRIKES) return leave(word, n + 1);
      setFlash(null);
    });
  };
  // Tiles still clearing can't be tapped; the rest can, so a quick learner isn't held up. A tap
  // that makes a pair first finishes clearing the last one.
  const pickWord = (id: number) => {
    if (flash?.word === id) return;
    if (pick.current.meaning !== null) flush();
    const p = pick.current;
    if (p.meaning !== null) return tryMatch(id, p.meaning);
    setPicked({ word: p.word === id ? null : id, meaning: null });
  };
  const pickMeaning = (k: number) => {
    if (flash?.meaning === k) return;
    if (pick.current.word !== null && pending.current) {
      // The tile tapped, found again once the board has caught up.
      const mn = current.current?.meanings[k];
      const nth = current.current?.meanings.slice(0, k).filter((x) => x === mn).length ?? 0;
      flush();
      const now = current.current?.meanings ?? [];
      k = now.findIndex((x, j) => x === mn && now.slice(0, j).filter((y) => y === mn).length === nth);
      if (k < 0) return;
    }
    const p = pick.current;
    if (p.word !== null) return tryMatch(p.word, k);
    setPicked({ word: null, meaning: p.meaning === k ? null : k });
  };
  const dontKnow = (word: T) => {
    if (flash?.word === word.id) return;
    flush();
    if (current.current?.words.some((w) => w.id === word.id)) leave(word, struck.current[word.id] ?? 0);
  };
  const putBack = (word: T) => {
    const { [word.id]: _, ...rest } = struck.current;
    setStrikes(rest);
    setPicked(NO_PICK);
    if (current.current) showBoard(returnWord(current.current, word, size, decoys.current, nextSeed()), true);
  };
  return { board, picked, flash, strikes, fresh, layout, start, pickWord, pickMeaning, dontKnow, putBack };
}

/** Long words get a smaller tile font, so a word is never split across lines. */
function tileSize(lemma: string, latin: boolean): string {
  const n = Array.from(lemma).length;
  if (!latin) return n > 4 ? ' smaller' : '';
  return n > 12 ? ' smallest' : n > 9 ? ' smaller' : '';
}

export function MatchBoardView<T extends MatchWord>({ m, wordLang }: { m: MatchBoard<T>; wordLang: string }) {
  const { board, picked, flash, strikes, fresh, layout } = m;
  if (!board) return null;
  const latin = wordLang !== 'zh-Hans';
  return (
    <div class={`sort-board${latin ? ' latin' : ''}`}>
      <div class="sort-col">
        {layout.words.map(({ item: w, gone }, i) => {
          if (gone) return <Blank key={`blank${i}`} class={`sort-tile${tileSize(w.lemma, latin)}`} text={w.lemma} dunno />;
          const state = flash?.word === w.id ? ` ${flash.kind}` : picked.word === w.id ? ' picked' : fresh.has(w.id) ? ' entering' : '';
          return (
            <div key={w.id} class="sort-word">
              <button class={`option sort-tile${state}${tileSize(w.lemma, latin)}`} lang={wordLang} onClick={() => m.pickWord(w.id)}>
                {w.lemma}
                {strikes[w.id] ? <span class="sort-strike" title="One wrong try" /> : null}
              </button>
              <button class="secondary sort-dunno" onClick={() => m.dontKnow(w)} aria-label={`Don't know ${w.lemma}`} title="Don't know">
                ?
              </button>
            </div>
          );
        })}
      </div>
      <div class="sort-col">
        {layout.meanings.map(({ item: mn, gone }, i) => {
          if (gone) return <Blank key={`blank${i}`} class="sort-meaning" text={mn} />;
          // The same meaning can be on the board twice: find this one's place on the board.
          const nth = layout.meanings.slice(0, i).filter((x) => !x.gone && x.item === mn).length;
          const k = board.meanings.findIndex((x, j) => x === mn && board.meanings.slice(0, j).filter((y) => y === mn).length === nth);
          const state = flash?.meaning === k ? ` ${flash.kind}` : picked.meaning === k ? ' picked' : '';
          return (
            <button key={`${mn}#${nth}`} class={`option sort-meaning${state}`} onClick={() => m.pickMeaning(k)}>
              {mn}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** An invisible copy of a cleared tile, holding its place (and height) until the set is done. */
function Blank({ class: cls, text, dunno }: { class: string; text: string; dunno?: boolean }) {
  return (
    <div class="sort-blank" aria-hidden="true">
      <span class={`option ${cls}`}>{text}</span>
      {dunno ? <span class="sort-dunno" /> : null}
    </div>
  );
}
