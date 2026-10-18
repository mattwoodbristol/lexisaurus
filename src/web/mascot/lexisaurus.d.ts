// Types for lexisaurus.js (the mascot renderer from the Lexisaurus asset pack; keep the .js as is).
export type LexiStage = 'egg' | 'hatching' | 'hatchling' | 'juvenile' | 'adult' | 'icon' | 'iconMaskable' | 'monoHead' | 'monoBody';
export type LexiMood = 'talk' | 'happy' | 'thinking' | 'encouraging' | 'celebrating';

export interface LexiStageInfo {
  key: 'egg' | 'hatching' | 'hatchling' | 'juvenile' | 'adult';
  name: string;
  min: number;
}

export const COLORS: Record<'navy' | 'amber' | 'body' | 'stripe' | 'belly' | 'shell' | 'white' | 'darkBg', string>;
export const STAGES: LexiStageInfo[];
export const MOODS: LexiMood[];

export function stageForWords(
  knownWords: number,
  stages?: LexiStageInfo[],
): { index: number; stage: LexiStageInfo; next: LexiStageInfo | null; progress: number; toGo: number };

export function lexisaurusSVG(o?: {
  stage?: LexiStage;
  mood?: LexiMood;
  word?: string;
  size?: number | string;
  monoFill?: string;
  background?: string;
  label?: string;
}): string;
