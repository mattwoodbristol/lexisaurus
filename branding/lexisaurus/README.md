# Lexisaurus — mascot asset pack and implementation brief

Hand this folder to Claude Code. It contains everything needed to add the Lexisaurus mascot to the
language tutor phone web app (PWA). The source of truth is `src/lexisaurus.js`; every SVG and PNG in this
pack was generated from it with `build.mjs`.

## What's in the pack

| Path | What it is | Used for |
|---|---|---|
| `src/lexisaurus.js` | ES module, no dependencies. `lexisaurusSVG()` returns SVG markup; `stageForWords()` maps a known-word count to a stage. | All in-app mascot rendering (the speech-bubble word is dynamic) |
| `svg/stage-1-egg.svg` … `stage-5-adult.svg` | Static SVG of each growth stage, word 你好 | Reference / static use |
| `svg/adult-{talk,happy,thinking,encouraging,celebrating}.svg` | Expressions | Reference / static use |
| `svg/icon.svg`, `svg/icon-maskable.svg` | App icon art on navy | Source for icon PNGs |
| `svg/mono-head.svg`, `svg/mono-body.svg` | Single-colour silhouettes | Notification badge / themed icon source |
| `icons/icon-192.png`, `icons/icon-512.png` | Square app icon, full bleed | Manifest `purpose: "any"` |
| `icons/icon-maskable-192.png`, `icons/icon-maskable-512.png` | Art inside central 80% circle | Manifest `purpose: "maskable"` (Android launchers) |
| `icons/icon-monochrome-512.png` | White silhouette, transparent | Manifest `purpose: "monochrome"` (Android 13+ themed icons) |
| `icons/badge-96.png` | White silhouette, transparent | `showNotification({ badge })` — Android status bar |
| `icons/apple-touch-icon-180.png` | Square, opaque | iOS home screen |
| `icons/favicon.svg`, `icons/favicon-32.png` | Small icon | Browser tab |
| `png/*.png` | 400 px raster of each stage and expression | Fallbacks, marketing, store listing |
| `progress-card.html` | Working vanilla HTML/CSS/JS reference of the home-screen progress card | Port into the app's component system |
| `build.mjs` | Regenerates `svg/`, `icons/`, `png/` (needs Node 18+ and Playwright) | Re-run after editing the art |

## Design tokens

```css
:root {
  --lexi-navy:  #1f3a5f; /* outline, eyes, scarf, app accent */
  --lexi-amber: #b5651d; /* words being learned, scarf stripe, progress fill */
  --lexi-amber-on-dark: #e0924f; /* amber text on #121417 (4.5:1) */
  --lexi-body:  #c49a6c; /* tabby body */
  --lexi-stripe: #7a5536; /* tabby stripes */
  --lexi-belly: #f5ead8; /* belly */
  --lexi-shell: #f6eedd; /* egg shell */
  --bg-light: #ffffff;
  --bg-dark:  #121417;
}
```

Fonts used in the designs: **Bricolage Grotesque** (800) for headings and numbers, **Figtree** (400–800) for
UI text. The bubble word falls back through Noto Sans SC / PingFang SC / Microsoft YaHei for CJK.

## Implementation tasks

### 1. Add the module

Copy `src/lexisaurus.js` into the app (for example `src/mascot/lexisaurus.js`). Wrap it in a component in
whatever framework the app uses:

```js
import { lexisaurusSVG } from './mascot/lexisaurus.js';

// vanilla
el.innerHTML = lexisaurusSVG({ stage: 'hatchling', word: 'ciao', size: 120 });

// React
const Lexi = ({ stage, mood, word, size = 120 }) => (
  <span style={{ display: 'inline-block', lineHeight: 0 }}
        dangerouslySetInnerHTML={{ __html: lexisaurusSVG({ stage, mood, word, size }) }} />
);
```

`word` is HTML-escaped inside the module. Keep it short (1–6 characters); the font shrinks automatically
for longer words. Pass `label: ''` when the mascot is purely decorative next to text that already says the
same thing.

Options: `stage` = `egg | hatching | hatchling | juvenile | adult | icon | iconMaskable | monoHead | monoBody`;
`mood` (adult only) = `talk | happy | thinking | encouraging | celebrating`; `size`; `monoFill`; `background`; `label`.

### 2. Growth stages

```js
import { stageForWords } from './mascot/lexisaurus.js';
const { stage, next, progress, toGo } = stageForWords(knownWordCount);
// stage.key -> pass to lexisaurusSVG({ stage: stage.key })
```

Thresholds live in `STAGES` (known words): Egg 0, Hatching 250, Hatchling 1,000, Juvenile 2,500,
Adult 5,000. They are adjustable; pass a custom array as the second argument of `stageForWords` if they
are made per-language. "Known words" = whatever the app's flashcard scheduler treats as known (e.g.
cards past a mastery interval); decide that in the app, not here.

The egg and hatching stages have no expressions; expressions apply to the adult. For learners below the
adult stage, show their current stage in the default pose at the in-app moments below.

### 3. In-app moments

| Moment | Render |
|---|---|
| Daily session finished | `mood: 'happy'` |
| Loading (tutor reply, sync) | `mood: 'thinking'` — no speech bubble, thought bubble instead |
| Flashcard marked Pass | `mood: 'encouraging'` |
| Learner reaches a new stage | `mood: 'celebrating'`, then show the new stage |
| Default / chat header | `mood: 'talk'` |

Bubble words: use the current lesson language, e.g. a word just reviewed or a greeting (你好 / ciao /
hola). Sample words in the pack are placeholders.

### 4. Home-screen progress card

See `progress-card.html` (open it in a browser; edit the number at the bottom). Content:
current stage art (116 px, in a tinted 120 px tile), "Stage N of 5", stage name, known-word count,
progress bar (amber fill) from the current threshold to the next, the two threshold labels, and
"X words to <next stage>". At Adult it shows a full bar and "Fully grown. Keep chatting."
Card width 360 px max; light and dark themes via `prefers-color-scheme`. The bar is a real
`role="progressbar"` with `aria-valuenow`.

### 5. PWA icons — manifest and head tags

Copy `icons/` to the public/static folder, then:

```json
{
  "name": "Lexisaurus",
  "short_name": "Lexisaurus",
  "theme_color": "#1f3a5f",
  "background_color": "#1f3a5f",
  "display": "standalone",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/icon-monochrome-512.png", "sizes": "512x512", "type": "image/png", "purpose": "monochrome" }
  ]
}
```

(The app's actual name may differ; "Lexisaurus" is the mascot's name. Change `name`/`short_name` as needed.)

```html
<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">
<meta name="theme-color" content="#1f3a5f">
```

### 6. Notifications (only if reminders are implemented)

```js
registration.showNotification('Time for your daily review', {
  body: '12 cards waiting',
  icon: '/icons/icon-192.png',   // large image in the notification
  badge: '/icons/badge-96.png',  // Android status bar; alpha only, colour ignored
});
```

iOS ignores `badge` and shows the app icon.

## Rules for anyone changing the art

- Keep the same face, colours and silhouette across stages.
- No text in the art except the speech-bubble word.
- Must read at 48 px and 200 px; check the mono head at 24 px.
- Maskable icon content must stay inside the central 80% circle (the module scales the art to 66% for this).
- Avoid bright lime green and anything owl-like.
- Colouring is a brown tabby: tan body, darker stripes on head, back, tail and legs, cream belly, navy scarf.
- After editing `src/lexisaurus.js`, run `node build.mjs` to regenerate the SVGs and PNGs
  (edit the Playwright import path in `build.mjs` for the local machine; it currently points at the
  build environment's global install).

## In this repo

- The app uses its own copy of the renderer: `src/web/mascot/lexisaurus.js` (types in
  `lexisaurus.d.ts`, Preact wrapper and progress card in `lexi.tsx`). After editing
  `branding/lexisaurus/src/lexisaurus.js`, copy it there too.
- Icons live in `src/web/public/icons/`, fonts (self-hosted Figtree and Bricolage Grotesque, Latin)
  in `src/web/public/fonts/`.
