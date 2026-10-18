import { describe, it, expect } from 'vitest';
import { acceptCorrections, chooseShown, correctorSystem, shownKeys, type Correction } from '../src/core/chat/corrections';

const c = (wrong: string, right: string, severity: Correction['severity']): Correction => ({ wrong, right, note: 'n', severity });

describe('accepting corrections', () => {
  it('keeps only mistakes quoted from the learner, that change something, once each', () => {
    const out = acceptCorrections(
      [c('le cani', 'i cani', 'minor'), c('Bristol anche', 'anche Bristol', 'target'), c('non scritto', 'mai', 'meaning'), c('ok', 'ok', 'minor'), c('le cani', 'i cani', 'minor')],
      'Mi piacciono le cani e Bristol anche è bella.',
    );
    expect(out.map((x) => x.wrong)).toEqual(['le cani', 'Bristol anche']);
  });
  it('treats an unknown severity as minor', () => {
    expect(acceptCorrections([{ wrong: '我不有', right: '我没有', note: '', severity: 'x' as never }], '我不有钱')[0]!.severity).toBe('minor');
  });
});

describe('choosing what to show', () => {
  const all = [c('a', 'b', 'minor'), c('c', 'd', 'target'), c('e', 'f', 'meaning'), c('g', 'h', 'minor')];
  it('light shows meaning only', () => {
    expect(chooseShown(all, 'light').filter((x) => x.shown).map((x) => x.wrong)).toEqual(['e']);
  });
  it('balanced shows the most serious one', () => {
    expect(chooseShown(all, 'balanced').filter((x) => x.shown).map((x) => x.wrong)).toEqual(['e']);
    expect(chooseShown([c('a', 'b', 'minor'), c('c', 'd', 'target')], 'balanced').filter((x) => x.shown).map((x) => x.wrong)).toEqual(['c']);
    expect(chooseShown([c('a', 'b', 'minor')], 'balanced').filter((x) => x.shown).map((x) => x.wrong)).toEqual(['a']);
  });
  it('balanced holds back a minor one straight after a shown correction', () => {
    const last = shownKeys(chooseShown([c('z', 'y', 'minor')], 'balanced'));
    expect(chooseShown([c('a', 'b', 'minor')], 'balanced', last).some((x) => x.shown)).toBe(false);
    expect(chooseShown([c('a', 'b', 'target')], 'balanced', last).filter((x) => x.shown).map((x) => x.wrong)).toEqual(['a']);
  });
  it('strict shows up to three (the most serious), in message order', () => {
    expect(chooseShown(all, 'strict').filter((x) => x.shown).map((x) => x.wrong)).toEqual(['a', 'c', 'e']);
  });
  it('does not repeat a correction shown last time', () => {
    const last = shownKeys(chooseShown([c('c', 'd', 'target')], 'balanced'));
    expect(chooseShown([c('c', 'd', 'target'), c('x', 'y', 'target')], 'balanced', last).filter((x) => x.shown).map((x) => x.wrong)).toEqual(['x']);
  });
  it('keeps everything for the summary', () => {
    expect(chooseShown(all, 'light')).toHaveLength(4);
  });
});

describe('instruction', () => {
  it('names the practised grammar and recurring mistakes', () => {
    const t = correctorSystem('Italian', [{ wrong: 'le cani', right: 'i cani' }], 'congiuntivo');
    expect(t).toContain('the grammar being practised (congiuntivo)');
    expect(t).toContain('le cani → i cani');
    expect(t).toContain('learner of Italian');
  });
});

describe('end-of-chat summary', () => {
  it('lists each mistake once, most serious first', async () => {
    const { summariseCorrections } = await import('../src/core/chat/corrections');
    const s = (wrong: string, sev: Correction['severity']) => ({ ...c(wrong, wrong + '!', sev), shown: false });
    const out = summariseCorrections([[s('a', 'minor'), s('b', 'target')], null, [s('a', 'minor'), s('c', 'meaning')]]);
    expect(out.map((x) => x.wrong)).toEqual(['c', 'b', 'a']);
  });
});

describe('non-mistakes', () => {
  it('drops a "correction" that offers the learner\'s own words as an alternative', () => {
    expect(acceptCorrections([c('跟我的朋友', '和我的朋友 or 跟我的朋友', 'minor')], '周末我想去看电影跟我的朋友。')).toEqual([]);
  });
});
