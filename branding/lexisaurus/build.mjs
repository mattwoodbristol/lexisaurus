import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { lexisaurusSVG, STAGES, MOODS, COLORS } from './src/lexisaurus.js';
// Output goes to this folder (svg/, icons/, png/).

const out = '.';
for (const d of ['svg', 'icons', 'png']) mkdirSync(`${out}/${d}`, { recursive: true });

const svgs = {};
for (const s of STAGES) svgs[`svg/stage-${STAGES.indexOf(s) + 1}-${s.key}.svg`] = lexisaurusSVG({ stage: s.key });
for (const m of MOODS) svgs[`svg/adult-${m}.svg`] = lexisaurusSVG({ stage: 'adult', mood: m, word: { talk: '你好', happy: '再见', thinking: '', encouraging: '对!', celebrating: '太棒了' }[m] });
svgs['svg/icon.svg'] = lexisaurusSVG({ stage: 'icon', background: COLORS.navy, size: 512 });
svgs['svg/icon-maskable.svg'] = lexisaurusSVG({ stage: 'iconMaskable', background: COLORS.navy, size: 512 });
svgs['svg/mono-head.svg'] = lexisaurusSVG({ stage: 'monoHead', monoFill: '#ffffff', size: 96 });
svgs['svg/mono-body.svg'] = lexisaurusSVG({ stage: 'monoBody', monoFill: COLORS.navy });
svgs['icons/favicon.svg'] = lexisaurusSVG({ stage: 'icon', background: COLORS.navy, size: 32, label: '' });
for (const [p, s] of Object.entries(svgs)) writeFileSync(`${out}/${p}`, s);

const pngs = [
  ['icons/icon-512.png', 512, { stage: 'icon', background: COLORS.navy }],
  ['icons/icon-192.png', 192, { stage: 'icon', background: COLORS.navy }],
  ['icons/icon-maskable-512.png', 512, { stage: 'iconMaskable', background: COLORS.navy }],
  ['icons/icon-maskable-192.png', 192, { stage: 'iconMaskable', background: COLORS.navy }],
  ['icons/apple-touch-icon-180.png', 180, { stage: 'icon', background: COLORS.navy }],
  ['icons/favicon-32.png', 32, { stage: 'icon', background: COLORS.navy }],
  ['icons/icon-monochrome-512.png', 512, { stage: 'monoHead', monoFill: '#ffffff' }],
  ['icons/badge-96.png', 96, { stage: 'monoHead', monoFill: '#ffffff' }],
  ...STAGES.map((s, i) => [`png/stage-${i + 1}-${s.key}-400.png`, 400, { stage: s.key }]),
  ...MOODS.map((m) => [`png/adult-${m}-400.png`, 400, { stage: 'adult', mood: m, word: { talk: '你好', happy: '再见', thinking: '', encouraging: '对!', celebrating: '太棒了' }[m] }]),
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const page = await browser.newPage();
for (const [p, size, opts] of pngs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${lexisaurusSVG({ ...opts, size })}</body></html>`);
  await page.screenshot({ path: `${out}/${p}`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

// contact sheet for review
const cell = (o, s, bg) => `<div style="background:${bg};padding:12px;display:inline-block;vertical-align:bottom">${lexisaurusSVG({ ...o, size: s })}</div>`;
const sheet = `<html><body style="margin:0;background:#eef2f6;font-family:sans-serif">
<div>${STAGES.map((s) => cell({ stage: s.key }, 200, '#fff')).join('')}</div>
<div>${STAGES.map((s) => cell({ stage: s.key }, 200, '#121417')).join('')}</div>
<div>${MOODS.map((m) => cell({ stage: 'adult', mood: m, word: '你好' }, 200, '#fff')).join('')}</div>
<div>${cell({ stage: 'icon', background: COLORS.navy }, 192, '#fff')}${cell({ stage: 'iconMaskable', background: COLORS.navy }, 192, '#fff')}${cell({ stage: 'icon', background: COLORS.navy }, 48, '#fff')}
${cell({ stage: 'monoHead' }, 96, '#fff')}${cell({ stage: 'monoHead' }, 48, '#fff')}${cell({ stage: 'monoHead' }, 24, '#fff')}${cell({ stage: 'monoHead', monoFill: '#fff' }, 24, '#121417')}${cell({ stage: 'monoBody' }, 120, '#fff')}</div>
</body></html>`;
await page.setViewportSize({ width: 1120, height: 1000 });
await page.setContent(sheet);
await page.screenshot({ path: 'contact-sheet.png', fullPage: true });
await browser.close();
console.log('done', Object.keys(svgs).length, 'svgs', pngs.length, 'pngs');
