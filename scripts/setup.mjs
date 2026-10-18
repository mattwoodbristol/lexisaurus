#!/usr/bin/env node
// One-command setup for your own copy of the tutor on Cloudflare.
//
//   npm run setup                 # interactive
//   npm run setup -- --dry-run    # show what it would do, change nothing
//   npm run setup -- --name my-tutor --passphrase "..." --anthropic-key sk-ant-... --yes
//
// It: checks you are logged in to Cloudflare, creates the D1 database (or finds it), writes its
// id into wrangler.jsonc, applies the migrations, builds and deploys, then stores the two secrets
// (passphrase, Anthropic key). The app generates its session and Web Push keys itself on first
// use. It also writes .dev.vars for local development if you do not have one. Safe to run again:
// existing things are reused.
//
// No terminal? The "Deploy to Cloudflare" button in the README does the same from the browser.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY = flag('dry-run');
const YES = flag('yes');
const WRANGLER = 'node_modules/wrangler/bin/wrangler.js';
const CONFIG = 'wrangler.jsonc';

const say = (s = '') => console.log(s);
const step = (s) => say(`\n▸ ${s}`);
function fail(s) {
  console.error(`\n✗ ${s}`);
  process.exit(1);
}

/** Run wrangler; read-only calls also run in a dry run. */
function wrangler(argv, { readOnly = false, input, capture = true } = {}) {
  if (DRY && !readOnly) {
    say(`  (dry run) wrangler ${argv.join(' ')}`);
    return { ok: true, out: '' };
  }
  const r = spawnSync(process.execPath, [WRANGLER, ...argv], { encoding: 'utf8', input, stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'] });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function npm(script) {
  if (DRY) return say(`  (dry run) npm run ${script}`);
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) fail(`npm run ${script} failed`);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
async function ask(question, fallback = '') {
  if (YES) return fallback;
  const a = (await rl.question(`  ${question}${fallback ? ` [${fallback}]` : ''}: `)).trim();
  return a || fallback;
}

say(`Language tutor setup${DRY ? ' (dry run: nothing will be changed)' : ''}`);

// 1. Tools and login.
step('Checking tools');
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) fail(`Node 22 or newer is needed (you have ${process.versions.node}).`);
if (!existsSync(WRANGLER)) fail('Dependencies are missing. Run: npm install');
const who = wrangler(['whoami'], { readOnly: true });
if (!who.ok || /not authenticated|You are not logged in/i.test(who.out)) fail('You are not logged in to Cloudflare. Run: npx wrangler login   then run this again.');
say('  Node and wrangler OK; logged in to Cloudflare.');

// 2. Names.
step('Names');
const config = readFileSync(CONFIG, 'utf8');
const currentName = /"name":\s*"([^"]+)"/.exec(config)?.[1] ?? 'language-tutor';
const name = opt('name') ?? (await ask('Worker and database name (part of your app URL)', currentName));
if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(name)) fail('Use lower-case letters, digits and hyphens for the name.');

// 3. Database.
step('Database');
const list = wrangler(['d1', 'list', '--json'], { readOnly: true });
let dbId = null;
try {
  dbId = JSON.parse(list.out.slice(list.out.indexOf('['))).find((d) => d.name === name)?.uuid ?? null;
} catch {
  /* older wrangler output: fall through and create */
}
if (dbId) say(`  Found D1 database "${name}" (${dbId}).`);
else {
  say(`  Creating D1 database "${name}"…`);
  const made = wrangler(['d1', 'create', name]);
  if (!made.ok) fail(`Could not create the database:\n${made.out}`);
  dbId = DRY ? '<new-database-id>' : (/"database_id":\s*"([0-9a-f-]{36})"/.exec(made.out)?.[1] ?? /database_id\s*=\s*"([0-9a-f-]{36})"/.exec(made.out)?.[1] ?? null);
  if (!dbId) fail(`Created the database but could not read its id from:\n${made.out}`);
  say(`  Created (${dbId}).`);
}

// 4. wrangler.jsonc.
const updated = config
  .replace(/("name":\s*)"[^"]+"/, `$1"${name}"`)
  .replace(/("database_name":\s*)"[^"]+"/, `$1"${name}"`)
  .replace(/("database_id":\s*)"[^"]+"/, `$1"${dbId}"`)
  // A fresh copy has no database_id line: add one after database_name.
  .replace(/^(\s*)("database_name":\s*"[^"]+",)(?![\s\S]*"database_id")/m, `$1$2\n$1"database_id": "${dbId}",`);
if (updated !== config) {
  step(`Writing the names and database id into ${CONFIG}`);
  if (!DRY) writeFileSync(CONFIG, updated);
  else say('  (dry run) not written');
}

// 5. Secrets: ask now so the rest runs unattended.
step('Secrets');
const passphrase = opt('passphrase') ?? process.env.TUTOR_PASSPHRASE ?? (await ask('Choose a passphrase to sign in to your tutor (12+ characters)'));
if (!DRY && (!passphrase || passphrase.length < 12)) fail('The passphrase must be at least 12 characters.');
const anthropicKey = opt('anthropic-key') ?? process.env.ANTHROPIC_API_KEY ?? (await ask('Anthropic API key (from console.anthropic.com; starts sk-ant-)'));
if (!DRY && !/^sk-ant-/.test(anthropicKey ?? '')) fail('That does not look like an Anthropic API key (it should start with sk-ant-).');
rl.close();
const secrets = { PASSPHRASE: passphrase, ANTHROPIC_API_KEY: anthropicKey };

// 6. Local development settings.
if (!existsSync('.dev.vars')) {
  step('Writing .dev.vars for local development (git ignores it)');
  if (!DRY) writeFileSync('.dev.vars', Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  else say('  (dry run) not written');
}

// 7. Database tables, then the app.
step('Creating the database tables (migrations)');
const mig = wrangler(['d1', 'migrations', 'apply', 'DB', '--remote'], { input: 'y\n', capture: false });
if (!mig.ok) fail('Migrations failed (see above). Fix the problem and run setup again.');
step('Building and deploying');
npm('deploy');

// 8. Secrets go on the deployed Worker.
step('Storing secrets on the Worker');
if (DRY) say(`  (dry run) wrangler secret bulk <${Object.keys(secrets).join(', ')}>`);
else {
  const file = join(tmpdir(), `tutor-secrets-${process.pid}.json`);
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  try {
    const put = wrangler(['secret', 'bulk', file]);
    if (!put.ok) fail(`Could not store the secrets:\n${put.out}`);
  } finally {
    unlinkSync(file);
  }
}

step('Done');
say(`  Open your tutor at https://${name}.<your-workers-subdomain>.workers.dev (the deploy output above shows the exact address).`);
say('  Sign in with your passphrase. A short welcome asks what you want to learn, then a level check.');
say('  On your phone: open the address and add it to your Home Screen (iPhone: Share, then "Add to');
say('  Home Screen"), open it from there, then switch on reminders in Settings.');
say('  Courses: see docs/course-packs.md to write or generate your own course and sync it.');
