// "A new version is out": compares this copy's release with the latest published one (from the
// upstream repository's release.json, checked at most twice a day). Copies update themselves
// daily (.github/workflows/update.yml); this shows when one has fallen behind.
import { Hono } from 'hono';
import type { Env } from './env';
import { getSetting } from './day';
import { isNewer } from '../core/release';
import releaseFile from '../../release.json';

export const updateRoutes = new Hono<{ Bindings: Env }>();

const CHECK_EVERY_MS = 12 * 3600 * 1000;

updateRoutes.get('/', async (c) => {
  const { release, upstream, branch } = releaseFile as { release: string; upstream: string; branch: string };
  const none = { current: release, latest: null as string | null, available: false };
  if (!/^[\w.-]+\/[\w.-]+$/.test(upstream ?? '') || release === 'dev') return c.json(none);
  const cached = await getSetting<{ at: number; latest: string } | null>(c.env.DB, 'update.check', null);
  let latest = cached?.latest ?? null;
  if (!cached || Date.now() - cached.at > CHECK_EVERY_MS) {
    try {
      const r = await fetch(`https://raw.githubusercontent.com/${upstream}/${branch || 'release'}/release.json`, { headers: { 'user-agent': 'lexisaurus' } });
      if (r.ok) latest = ((await r.json()) as { release?: string }).release ?? null;
    } catch {
      // offline or GitHub unreachable: keep the last answer
    }
    await c.env.DB.prepare('INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind('update.check', JSON.stringify({ at: Date.now(), latest }))
      .run();
  }
  return c.json({ current: release, latest, available: !!latest && isNewer(release, latest) });
});
