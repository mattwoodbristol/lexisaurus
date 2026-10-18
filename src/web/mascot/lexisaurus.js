/**
 * Lexisaurus — mascot renderer for the language tutor app.
 *
 * Framework-free ES module. Returns SVG markup strings, so it works with
 * innerHTML, React (dangerouslySetInnerHTML), Svelte {@html}, or server rendering.
 *
 *   import { lexisaurusSVG, stageForWords } from './lexisaurus.js';
 *   el.innerHTML = lexisaurusSVG({ stage: 'hatchling', word: 'ciao', size: 120 });
 *
 * All art is drawn in a 200 x 200 viewBox. Feet sit on y = 188, so stages
 * bottom-align when rendered in equal-height boxes.
 */

export const COLORS = {
  navy: '#1f3a5f',   // outline, eyes, scarf, app accent
  amber: '#b5651d',  // words being learned, scarf stripe
  body: '#c49a6c',   // tabby body
  stripe: '#7a5536', // tabby stripes
  belly: '#f5ead8',  // belly
  shell: '#f6eedd',  // egg shell
  white: '#ffffff',
  darkBg: '#121417',
};

/** Growth stages. `min` = known words needed to reach the stage. */
export const STAGES = [
  { key: 'egg',       name: 'Egg',       min: 0 },
  { key: 'hatching',  name: 'Hatching',  min: 250 },
  { key: 'hatchling', name: 'Hatchling', min: 1000 },
  { key: 'juvenile',  name: 'Juvenile',  min: 2500 },
  { key: 'adult',     name: 'Adult',     min: 5000 },
];

/** Expressions (adult stage only). */
export const MOODS = ['talk', 'happy', 'thinking', 'encouraging', 'celebrating'];

/**
 * Work out the stage and progress for a known-word count.
 * @returns {{index:number, stage:object, next:object|null, progress:number, toGo:number}}
 *   progress is 0..1 towards the next stage (1 at the final stage).
 */
export function stageForWords(knownWords, stages = STAGES) {
  const n = Math.max(0, Math.floor(knownWords || 0));
  let index = 0;
  stages.forEach((s, i) => { if (n >= s.min) index = i; });
  const stage = stages[index];
  const next = stages[index + 1] || null;
  const progress = next ? (n - stage.min) / (next.min - stage.min) : 1;
  return { index, stage, next, progress, toGo: next ? next.min - n : 0 };
}

const N = COLORS.navy, A = COLORS.amber, T = COLORS.body, M = COLORS.belly, STRIPE = COLORS.stripe, S = COLORS.shell, W = COLORS.white;
const FONT = "Figtree, 'Noto Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif";
const G = `stroke="${N}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"`;
const shadow = (cx, rx) => `<ellipse cx="${cx}" cy="191" rx="${rx}" ry="5" fill="${N}" opacity="0.15" stroke="none"/>`;
const dot = (cx, cy, r, fill) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="none"/>`;
const arm = (d, w = 10) => `<path d="${d}" fill="none" stroke-width="${w}"/><path d="${d}" fill="none" stroke="${T}" stroke-width="5"/>`;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Shrinks the bubble word so short words in any script fit. */
function wordScale(word) {
  const len = Array.from(String(word)).length;
  return len <= 2 ? 1 : len === 3 ? 0.9 : len === 4 ? 0.82 : len === 5 ? 0.7 : 0.58;
}

function wordText(x, y, base, word) {
  if (!word) return '';
  const fs = Math.round(base * wordScale(word) * 10) / 10;
  return `<text x="${x}" y="${y}" font-size="${fs}" font-weight="800" fill="${A}" stroke="none" text-anchor="middle" dominant-baseline="central" font-family="${FONT}">${esc(word)}</text>`;
}

// ---------- stages ----------

const egg = () => `<g ${G}>
${shadow(100, 40)}
<path d="M100 40 C138 40 156 100 156 132 C156 166 131 188 100 188 C69 188 44 166 44 132 C44 100 62 40 100 40 Z" fill="${S}"/>
${dot(76, 122, 5, A)}${dot(124, 150, 4, A)}${dot(94, 166, 3.5, A)}${dot(132, 110, 3, A)}
${dot(66, 152, 4, STRIPE)}${dot(110, 128, 3, STRIPE)}${dot(84, 92, 3, STRIPE)}
<path d="M114 50 L104 62 L114 70 L106 84" fill="none" stroke-width="3.5"/>
<path d="M128 20 H154 Q164 20 164 30 V36 Q164 46 154 46 H144 L112 58 L132 46 H128 Q118 46 118 36 V30 Q118 20 128 20 Z" fill="${W}" stroke-width="3.5"/>
${dot(131, 33, 3, A)}${dot(141, 33, 3, A)}${dot(151, 33, 3, A)}
</g>`;

const hatching = (word) => `<g ${G}>
${shadow(100, 42)}
<path d="M62 100 C56 70 76 52 102 52 C126 52 144 64 146 84 C148 100 138 112 120 114 L84 116 C72 116 64 110 62 100 Z" fill="${T}"/>
<g fill="none" stroke="${STRIPE}" stroke-width="4.5" stroke-linecap="round"><path d="M92 59 L94 66"/><path d="M100 57 L101 64"/><path d="M108 58 L108 64"/><path d="M68 80 Q76 82 78 90"/></g>
<circle cx="106" cy="80" r="10" fill="${W}"/>${dot(108, 82, 5.5, N)}${dot(110.5, 79, 2, W)}
<path d="M118 98 Q129 105 139 95" fill="none" stroke-width="3.5"/>
${dot(137, 72, 2, N)}
<path d="M48 124 L60 112 L72 124 L86 110 L100 124 L114 110 L128 124 L140 112 L152 124 C154 162 132 188 100 188 C68 188 46 162 48 124 Z" fill="${S}"/>
${dot(76, 150, 4, A)}${dot(118, 164, 3.5, STRIPE)}${dot(126, 140, 3, A)}${dot(90, 172, 3, STRIPE)}
<ellipse cx="78" cy="120" rx="8" ry="5.5" fill="${T}"/>
<ellipse cx="124" cy="120" rx="8" ry="5.5" fill="${T}"/>
<path d="M136 14 H172 Q184 14 184 26 V36 Q184 48 172 48 H152 L132 60 L140 48 H136 Q124 48 124 36 V26 Q124 14 136 14 Z" fill="${W}" stroke-width="3.5"/>
${wordText(154, 31, 17, word)}
</g>`;

const HATCH_HEAD = 'M58 98 C52 64 74 44 102 44 C130 44 150 58 152 80 C154 98 142 112 122 114 L86 118 C72 118 60 110 58 98 Z';
const HATCH_CAP = 'M72 58 C72 34 122 28 128 52 L120 48 L112 56 L102 48 L92 56 L82 50 Z';

const hatchling = (word) => `<g ${G}>
${shadow(98, 46)}
<path d="M64 152 C46 154 34 164 26 176 C44 176 60 170 72 164 Z" fill="${T}"/>
<ellipse cx="80" cy="182" rx="15" ry="8" fill="${T}"/>
<ellipse cx="116" cy="182" rx="15" ry="8" fill="${T}"/>
<ellipse cx="96" cy="150" rx="38" ry="34" fill="${T}"/>
<ellipse cx="104" cy="156" rx="21" ry="21" fill="${M}" stroke="none"/>
<g fill="none" stroke="${STRIPE}" stroke-width="4.5" stroke-linecap="round"><path d="M62 140 Q70 142 76 148"/><path d="M62 156 Q70 158 74 164"/><path d="M46 158 L49 171"/></g>
<path d="${HATCH_HEAD}" fill="${T}"/>
<g fill="none" stroke="${STRIPE}" stroke-width="4.5" stroke-linecap="round"><path d="M66 74 Q74 76 78 84"/><path d="M64 90 Q72 92 76 98"/></g>
<path d="${HATCH_CAP}" fill="${S}"/>
${dot(100, 40, 3, A)}${dot(114, 38, 2.5, STRIPE)}
<circle cx="106" cy="78" r="12" fill="${W}"/>${dot(108, 80, 6.5, N)}${dot(111, 76, 2.4, W)}
<path d="M120 98 Q132 106 143 94" fill="none" stroke-width="3.5"/>
${dot(144, 72, 2.2, N)}
<ellipse cx="126" cy="134" rx="8" ry="5" fill="${T}" transform="rotate(25 126 134)"/>
<path d="M148 10 H182 Q194 10 194 22 V30 Q194 42 182 42 H164 L146 56 L152 42 H148 Q136 42 136 30 V22 Q136 10 148 10 Z" fill="${W}" stroke-width="3.5"/>
${wordText(165, 26, 17, word)}
</g>`;

const juvenile = (word) => `<g ${G}>
${shadow(96, 50)}
<path d="M70 126 C46 132 24 146 10 166 C34 164 60 158 82 150 Z" fill="${T}"/>
<path d="M70 144 C66 160 64 174 62 186 L82 186 C84 174 86 160 88 146 Z" fill="${T}"/>
<path d="M98 144 C100 160 100 174 98 186 L118 186 C116 172 114 158 112 142 Z" fill="${T}"/>
<ellipse cx="90" cy="124" rx="26" ry="34" fill="${T}" transform="rotate(-14 90 124)"/>
<ellipse cx="99" cy="130" rx="13" ry="24" fill="${M}" stroke="none" transform="rotate(-14 99 130)"/>
<g fill="none" stroke="${STRIPE}" stroke-width="4.5" stroke-linecap="round"><path d="M68 112 Q76 114 80 120"/><path d="M66 128 Q74 130 78 136"/><path d="M46 137 L49 155"/><path d="M30 147 L32 161"/><path d="M66 160 L84 158"/><path d="M65 171 L82 169"/><path d="M100 158 L113 156"/><path d="M100 170 L115 168"/></g>
<path d="M82 96 C74 76 78 52 100 46 C120 40 144 46 150 60 C154 72 152 82 142 86 L118 92 C108 100 90 104 82 96 Z" fill="${T}"/>
<g fill="none" stroke="${STRIPE}" stroke-width="4.5" stroke-linecap="round"><path d="M90 58 Q96 62 96 70"/><path d="M86 72 Q92 76 92 82"/></g>
<circle cx="114" cy="62" r="8.5" fill="${W}"/>${dot(116, 63, 4.8, N)}${dot(118, 60, 1.7, W)}
<path d="M120 82 Q132 90 144 82 Q132 86 120 82 Z" fill="${N}" stroke-width="2.5"/>
${dot(144, 60, 2, N)}
<g transform="rotate(-10 132 128)">
<rect x="100" y="106" width="64" height="44" rx="6" fill="${W}"/>
<rect x="112" y="117" width="30" height="8" rx="4" fill="${A}" stroke="none"/>
<rect x="112" y="131" width="40" height="4" rx="2" fill="${N}" opacity="0.3" stroke="none"/>
<rect x="112" y="139" width="26" height="4" rx="2" fill="${N}" opacity="0.3" stroke="none"/>
</g>
${arm('M102 112 Q109 110 112 116')}
${arm('M100 124 Q107 124 109 130')}
<path d="M152 6 H184 Q196 6 196 18 V26 Q196 38 184 38 H168 L148 50 L156 38 H152 Q140 38 140 26 V18 Q140 6 152 6 Z" fill="${W}" stroke-width="3.5"/>
${wordText(168, 22, 17, word)}
</g>`;

function adult(word, mood) {
  const is = (...ms) => ms.includes(mood);
  const eyeOpen = `<circle cx="118" cy="60" r="9" fill="${W}"/>${dot(120, 61, 5, N)}${dot(122, 58, 1.8, W)}`;
  const eyeUp = `<circle cx="118" cy="60" r="9" fill="${W}"/>${dot(116, 56, 5, N)}${dot(118, 54, 1.8, W)}`;
  const eyeClosed = `<path d="M110 62 Q118 52 126 62" fill="none"/>`;
  const eye = is('thinking') ? eyeUp : is('happy', 'celebrating') ? eyeClosed : eyeOpen;
  const brow = is('encouraging') ? `<path d="M109 46 Q118 40 127 45" fill="none" stroke-width="3.5"/>` : '';
  const blush = is('happy', 'celebrating') ? `<ellipse cx="134" cy="74" rx="6" ry="3.5" fill="${A}" opacity="0.4" stroke="none"/>` : '';
  const mouth = is('thinking')
    ? `<path d="M130 85 L148 83" fill="none" stroke-width="3.5"/>`
    : is('talk')
      ? `<path d="M126 82 Q139 92 152 82 Q139 86 126 82 Z" fill="${N}" stroke-width="2.5"/>`
      : `<path d="M122 80 Q138 98 154 80 Q138 86 122 80 Z" fill="${N}" stroke-width="2.5"/>`;
  const armPart = is('celebrating') ? arm('M118 116 Q126 108 126 98')
    : is('thinking') ? arm('M118 116 Q124 108 130 106')
    : is('encouraging') ? `${arm('M118 118 Q128 116 130 108')}<circle cx="144" cy="106" r="11" fill="${A}" stroke-width="3"/><path d="M139 106 L143 110 L150 102" fill="none" stroke="${W}" stroke-width="3"/>`
    : arm('M116 118 Q126 118 128 126');
  const confetti = is('celebrating') ? `<g stroke="none">
<rect x="34" y="40" width="9" height="4" rx="1" fill="${A}" transform="rotate(30 38 42)"/>
<rect x="62" y="18" width="9" height="4" rx="1" fill="${N}" transform="rotate(-20 66 20)"/>
<rect x="92" y="14" width="8" height="4" rx="1" fill="${A}" transform="rotate(60 96 16)"/>
<rect x="172" y="62" width="9" height="4" rx="1" fill="${STRIPE}" transform="rotate(45 176 64)"/>
${dot(186, 88, 3, A)}${dot(44, 74, 3, STRIPE)}${dot(168, 110, 2.5, N)}</g>` : '';
  const bubble = is('thinking')
    ? `<g stroke-width="3"><circle cx="152" cy="46" r="3.5" fill="${W}"/><circle cx="161" cy="34" r="5.5" fill="${W}"/><ellipse cx="176" cy="16" rx="20" ry="13" fill="${W}"/>${dot(168, 16, 2.5, A)}${dot(176, 16, 2.5, A)}${dot(184, 16, 2.5, A)}</g>`
    : `<path d="M152 4 H184 Q196 4 196 16 V24 Q196 36 184 36 H168 L156 50 L156 36 H152 Q140 36 140 24 V16 Q140 4 152 4 Z" fill="${W}" stroke-width="3.5"/>${wordText(168, 20, 17, word)}`;

  return `<g ${G}>
${shadow(96, 54)}
<path d="M74 128 C48 134 22 152 6 176 C34 172 62 164 86 156 Z" fill="${T}"/>
<path d="M68 148 C64 164 64 176 62 186 L86 186 C86 176 88 164 92 150 Z" fill="${T}"/>
<path d="M100 148 C102 164 102 176 100 186 L124 186 C122 172 120 160 118 146 Z" fill="${T}"/>
<ellipse cx="94" cy="130" rx="32" ry="38" fill="${T}" transform="rotate(-12 94 130)"/>
<ellipse cx="104" cy="136" rx="16" ry="28" fill="${M}" stroke="none" transform="rotate(-12 104 136)"/>
<g fill="none" stroke="${STRIPE}" stroke-width="4.5" stroke-linecap="round"><path d="M66 116 Q76 118 80 124"/><path d="M64 132 Q74 134 78 140"/><path d="M68 148 Q76 148 80 154"/><path d="M50 141 L54 160"/><path d="M34 150 L37 166"/><path d="M20 162 L22 171"/><path d="M66 162 L82 160"/><path d="M65 173 L82 171"/><path d="M103 160 L116 158"/><path d="M103 172 L117 170"/></g>
<path d="M84 98 C76 76 80 50 104 42 C126 36 152 42 158 58 C162 70 160 82 150 86 L122 94 C110 104 92 108 84 98 Z" fill="${T}"/>
<g fill="none" stroke="${STRIPE}" stroke-width="4.5" stroke-linecap="round"><path d="M92 56 Q98 60 98 68"/><path d="M88 70 Q94 74 94 80"/></g>
<path d="M84 96 C96 106 114 104 124 94 L128 102 C116 114 94 116 82 106 Z" fill="${N}" stroke-width="3"/><path d="M85 101 C97 110 114 108 126 98" fill="none" stroke="${A}" stroke-width="2.5"/>
<path d="M90 104 L82 128 L94 126 L98 106 Z" fill="${N}" stroke-width="3"/>
${dot(152, 60, 2, N)}
${eye}${brow}${blush}${mouth}${armPart}${confetti}${bubble}
</g>`;
}

// ---------- icon + monochrome ----------

/** Full-colour icon art (no background). Content spans roughly x 22-188, y 14-182. */
const iconArt = (word) => `<g ${G}>
<g transform="translate(-48 23) scale(1.35)" stroke-width="3">
<path d="${HATCH_HEAD}" fill="${T}"/>
<g fill="none" stroke="${STRIPE}" stroke-width="4.5" stroke-linecap="round"><path d="M66 74 Q74 76 78 84"/><path d="M64 90 Q72 92 76 98"/></g>
<path d="${HATCH_CAP}" fill="${S}"/>
${dot(100, 40, 3, A)}
<circle cx="106" cy="78" r="12" fill="${W}"/>${dot(108, 80, 6.5, N)}${dot(111, 76, 2.4, W)}
<path d="M120 98 Q132 106 143 94" fill="none"/>
${dot(144, 72, 2.2, N)}
</g>
<path d="M128 14 H172 Q188 14 188 30 V44 Q188 60 172 60 H152 L136 80 L136 60 H128 Q112 60 112 44 V30 Q112 14 128 14 Z" fill="${W}"/>
${wordText(150, 37, 26, word)}
</g>`;

/** Single-colour head in profile: open jaw, neck, tiny arm, bubble. Eye, nostril and bubble dots are cut out. */
const monoHead = (fill) => `<g fill="${fill}" stroke="none" fill-rule="evenodd">
<g transform="translate(-8 26) scale(0.86)">
<path d="M50 196 C42 170 34 140 38 118 C42 78 64 52 96 48 C128 44 160 54 172 70 C178 78 178 88 172 92 L128 102 L164 110 C168 116 166 124 160 126 L122 138 C114 150 110 172 110 196 Z M95 76 A11 11 0 1 0 117 76 A11 11 0 1 0 95 76 Z M156 66 A4 4 0 1 0 164 66 A4 4 0 1 0 156 66 Z"/>
<path d="M110 160 Q130 160 134 174" fill="none" stroke="${fill}" stroke-width="13" stroke-linecap="round"/>
</g>
<path d="M146 8 H182 Q196 8 196 22 V34 Q196 48 182 48 H162 L144 66 L150 48 H146 Q132 48 132 34 V22 Q132 8 146 8 Z M145 28 A5.5 5.5 0 1 0 156 28 A5.5 5.5 0 1 0 145 28 Z M158.5 28 A5.5 5.5 0 1 0 169.5 28 A5.5 5.5 0 1 0 158.5 28 Z M172 28 A5.5 5.5 0 1 0 183 28 A5.5 5.5 0 1 0 172 28 Z"/>
</g>`;

/** Single-colour full body (adult). */
const monoBody = (fill) => `<g fill="${fill}" stroke="none" fill-rule="evenodd">
<path d="M74 128 C48 134 22 152 6 176 C34 172 62 164 86 156 Z"/>
<path d="M68 148 C64 164 64 176 62 186 L86 186 C86 176 88 164 92 150 Z"/>
<path d="M100 148 C102 164 102 176 100 186 L124 186 C122 172 120 160 118 146 Z"/>
<ellipse cx="94" cy="130" rx="32" ry="38" transform="rotate(-12 94 130)"/>
<path d="M84 98 C76 76 80 50 104 42 C126 36 152 42 158 58 C162 70 160 82 150 86 L122 94 C110 104 92 108 84 98 Z M109 60 A9 9 0 1 0 127 60 A9 9 0 1 0 109 60 Z"/>
<path d="M116 118 Q126 118 128 126" fill="none" stroke="${fill}" stroke-width="9" stroke-linecap="round"/>
<path d="M152 4 H184 Q196 4 196 16 V24 Q196 36 184 36 H168 L156 50 L156 36 H152 Q140 36 140 24 V16 Q140 4 152 4 Z M152 20 A4 4 0 1 0 160 20 A4 4 0 1 0 152 20 Z M164 20 A4 4 0 1 0 172 20 A4 4 0 1 0 164 20 Z M176 20 A4 4 0 1 0 184 20 A4 4 0 1 0 176 20 Z"/>
</g>`;

/**
 * Render Lexisaurus as an SVG string.
 * @param {object} o
 * @param {'egg'|'hatching'|'hatchling'|'juvenile'|'adult'|'icon'|'iconMaskable'|'monoHead'|'monoBody'} [o.stage='adult']
 * @param {'talk'|'happy'|'thinking'|'encouraging'|'celebrating'} [o.mood='talk']  adult only
 * @param {string} [o.word='你好']   speech-bubble word (keep to ~1-6 characters)
 * @param {number|string} [o.size=200]  rendered width/height in px (or any CSS length)
 * @param {string} [o.monoFill='#1f3a5f'] colour for mono stages
 * @param {string} [o.background]  optional full-bleed square background (icons)
 * @param {string} [o.label='Lexisaurus'] accessible name; pass '' to mark decorative
 */
export function lexisaurusSVG(o = {}) {
  const { stage = 'adult', mood = 'talk', word = '你好', size = 200, monoFill = N, background, label = 'Lexisaurus' } = o;
  let body;
  switch (stage) {
    case 'egg': body = egg(); break;
    case 'hatching': body = hatching(word); break;
    case 'hatchling': body = hatchling(word); break;
    case 'juvenile': body = juvenile(word); break;
    case 'icon': body = iconArt(word); break;
    // Maskable: art scaled to 66% around the centre so it sits inside Android's 80% safe circle.
    case 'iconMaskable': body = `<g transform="translate(34 34) scale(0.66)">${iconArt(word)}</g>`; break;
    case 'monoHead': body = monoHead(monoFill); break;
    case 'monoBody': body = monoBody(monoFill); break;
    default: body = adult(word, mood);
  }
  const bg = background ? `<rect width="200" height="200" fill="${background}"/>` : '';
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 200 200" ${a11y}>${bg}${body}</svg>`;
}
