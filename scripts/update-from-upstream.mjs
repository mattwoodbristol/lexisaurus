#!/usr/bin/env node
// Bring this copy up to date with the published Lexisaurus (release.json: upstream repository and
// branch). Run daily by .github/workflows/update.yml in copies made with the Deploy to Cloudflare
// button; Cloudflare then rebuilds and redeploys on the push. Copies are not forks, so this takes
// the published files as they are, keeping only what belongs to this copy: its Cloudflare names
// and ids in wrangler.jsonc, and its workflow files (the workflow's token may not change them).
// Learners' data lives in the database, not here, so it is never touched.
//
//   node scripts/update-from-upstream.mjs     (then git push; the workflow does both)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { keepLocal } from './lib/keep-local.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const conf = JSON.parse(readFileSync('release.json', 'utf8'));
const upstream = String(conf.upstream ?? '').trim();
const branch = String(conf.branch ?? 'release').trim() || 'release';
if (!/^[\w.-]+\/[\w.-]+$/.test(upstream)) {
  console.log('No upstream repository in release.json: nothing to update from.');
  process.exit(0);
}
if (upstream.toLowerCase() === String(process.env.GITHUB_REPOSITORY ?? '').toLowerCase()) {
  console.log('This is the published repository itself: nothing to update.');
  process.exit(0);
}

// LEXISAURUS_UPSTREAM_URL: another place to fetch from, for trying this out locally.
git('fetch', '--depth=1', process.env.LEXISAURUS_UPSTREAM_URL || `https://github.com/${upstream}.git`, branch);
const latest = JSON.parse(git('show', 'FETCH_HEAD:release.json')).release;
if (latest === conf.release) {
  console.log(`Up to date (release ${latest}).`);
  process.exit(0);
}

const mineWrangler = readFileSync('wrangler.jsonc', 'utf8');
const ownWorkflows = git('ls-files', '.github/workflows').split('\n').filter(Boolean);
// Index and working tree become the published release exactly (files it dropped go too).
git('read-tree', '--reset', '-u', 'FETCH_HEAD');
writeFileSync('wrangler.jsonc', keepLocal(mineWrangler, readFileSync('wrangler.jsonc', 'utf8')));
for (const f of git('ls-files', '.github/workflows').split('\n').filter(Boolean)) if (!ownWorkflows.includes(f)) git('rm', '-q', '--cached', f);
if (ownWorkflows.length) git('checkout', 'HEAD', '--', ...ownWorkflows);
git('add', '-A', '--', '.', ':!.github/workflows');
if (existsSync('.github/workflows')) git('add', '--', ...ownWorkflows);
try {
  git('diff', '--cached', '--quiet');
  console.log('Nothing changed.');
} catch {
  git('commit', '-q', '-m', `Update to Lexisaurus release ${latest}`);
  console.log(`Updated from release ${conf.release} to ${latest}.`);
}
