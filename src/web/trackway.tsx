// Trackway: the streak card. One T. rex footprint per day of the last week, filled when there was
// any practice that day (in any language); left and right prints alternate along the track.
import type { Trackway } from '../core/trackway';

export function Footprint({ size = 28, faded = false, mirror = false, label }: { size?: number; faded?: boolean; mirror?: boolean; label?: string }) {
  return (
    <svg
      class={`footprint ${faded ? 'faded' : ''}`}
      width={size}
      height={size * 1.15}
      viewBox="0 0 40 46"
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <g transform={mirror ? 'translate(40 0) scale(-1 1)' : undefined} fill="currentColor">
        {/* pad */}
        <ellipse cx="20" cy="33" rx="9.5" ry="10.5" />
        {/* middle toe */}
        <ellipse cx="20" cy="15" rx="4.2" ry="11" />
        <path d="M18.6 4.5 L20 0 L21.4 4.5 Z" />
        {/* inner toe */}
        <ellipse cx="8.5" cy="21" rx="3.8" ry="9.5" transform="rotate(-28 8.5 21)" />
        <path d="M4.6 13.2 L3.2 8.6 L7.3 11.8 Z" />
        {/* outer toe */}
        <ellipse cx="31.5" cy="21" rx="3.8" ry="9.5" transform="rotate(28 31.5 21)" />
        <path d="M35.4 13.2 L36.8 8.6 L32.7 11.8 Z" />
      </g>
    </svg>
  );
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return DAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

export function TrackwayCard({ t }: { t: Trackway }) {
  const line =
    t.streak === 0
      ? 'Any practice today leaves the first print.'
      : t.todayDone
        ? t.streak === 1
          ? 'First print down. Back tomorrow to make it a trail.'
          : 'Today’s print is down.'
        : `Practise today to make it ${t.streak + 1}.`;
  return (
    <article class="card trackway" aria-label="Trackway: days in a row">
      <div class="trackway-head">
        <div class="lexi-eyebrow">Trackway</div>
        <div class="trackway-count">
          <b>{t.streak}</b>
          <span>{t.streak === 1 ? 'day' : 'days'} in a row</span>
          {t.best > t.streak && <span class="muted small">· best {t.best}</span>}
        </div>
      </div>
      <ol class="trackway-prints">
        {t.recent.map((r, i) => (
          <li key={r.date} class={i === t.recent.length - 1 ? 'today' : ''} style={{ marginTop: i % 2 ? 0 : 10 }}>
            <Footprint faded={!r.done} mirror={i % 2 === 1} label={`${weekday(r.date)}: ${r.done ? 'done' : 'missed'}`} />
            <span class="muted small">{i === t.recent.length - 1 ? 'Today' : weekday(r.date).slice(0, 2)}</span>
          </li>
        ))}
      </ol>
      <div class="muted small">{line}</div>
    </article>
  );
}
