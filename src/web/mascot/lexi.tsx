// Lexisaurus in the app: the mascot component, the home-screen progress card and the small
// "moment" banners (session done, loading, Pass, stage-up).
import { useEffect, useState } from 'preact/hooks';
import { lexisaurusSVG, stageForWords, type LexiMood, type LexiStageInfo } from './lexisaurus.js';
import { api } from '../api';

/** Bubble word per language: a greeting in the language being learned. */
export const GREETING: Record<string, string> = { zh: '你好', it: 'ciao', es: 'hola', fr: 'salut' };

/**
 * The mascot at the learner's current stage. Moods only exist for the adult; younger stages
 * show their default pose (as the asset pack specifies).
 */
export function Lexi({
  stage = 'adult',
  mood = 'talk',
  word,
  size = 120,
  label = '',
  lang = 'zh',
}: {
  stage?: LexiStageInfo['key'];
  mood?: LexiMood;
  word?: string;
  size?: number;
  label?: string;
  lang?: string;
}) {
  const html = lexisaurusSVG({ stage, mood: stage === 'adult' ? mood : 'talk', word: word ?? GREETING[lang] ?? '', size, label });
  return <span class="lexi" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Known-word count and stage for a language, shared across screens (one fetch per page load). */
let knownCache: { lang: string; known: number } | null = null;
export function useLexiStage(lang = 'zh'): { known: number | null; stage: LexiStageInfo['key'] } {
  const [known, setKnown] = useState<number | null>(knownCache?.lang === lang ? knownCache.known : null);
  useEffect(() => {
    api
      .knownCount(lang)
      .then((s) => {
        knownCache = { lang, known: s.known };
        setKnown(s.known);
      })
      .catch(() => {});
  }, [lang]);
  return { known, stage: stageForWords(known ?? 0).stage.key };
}

const fmt = (n: number) => n.toLocaleString('en-GB');

/** Home-screen progress card (port of progress-card.html from the asset pack). */
export function ProgressCard({ known, lang = 'zh', celebrating = false }: { known: number; lang?: string; celebrating?: boolean }) {
  const { index, stage, next, progress, toGo } = stageForWords(known);
  const pct = Math.round(progress * 1000) / 10;
  return (
    <article class="card lexi-card" aria-labelledby="lexi-stage">
      <div class="lexi-head">
        <div class="lexi-tile">
          <Lexi stage={stage.key} mood={celebrating ? 'celebrating' : 'talk'} size={116} lang={lang} />
        </div>
        <div>
          <div class="lexi-eyebrow">
            Stage {index + 1} of 5{celebrating ? ' · New stage!' : ''}
          </div>
          <div class="lexi-stage" id="lexi-stage">
            {stage.name}
          </div>
        </div>
      </div>
      <div class="lexi-count">
        <b>{fmt(known)}</b>
        <span>words known</span>
      </div>
      <div>
        <div class="lexi-track" role="progressbar" aria-label="Progress to next stage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div class="lexi-fill" style={{ width: `${pct}%` }} />
        </div>
        <div class="lexi-ends">
          <span>{fmt(stage.min)}</span>
          <span>{next ? `${fmt(next.min)} · ${next.name}` : 'Max'}</span>
        </div>
      </div>
      <div class="lexi-next">
        {next ? (
          <>
            <b>{fmt(toGo)}</b> words to {next.name}
          </>
        ) : (
          'Fully grown. Keep chatting.'
        )}
      </div>
    </article>
  );
}

/**
 * Stage-up check: compares the stage with the last one this learner saw (stored in settings) and
 * reports a new stage once, then remembers it.
 */
export function useStageUp(known: number | null, lang = 'zh'): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (known === null) return;
    const key = `${lang}.mascot_stage`;
    const now = stageForWords(known).index;
    api
      .settings()
      .then((s) => {
        const seen = typeof s[key] === 'number' ? (s[key] as number) : null;
        if (seen === null || now !== seen) api.putSetting(key, now).catch(() => {});
        // The first visit only records the stage: no celebration for where the learner started.
        if (seen !== null && now > seen) setUp(true);
      })
      .catch(() => {});
  }, [known, lang]);
  return up;
}
