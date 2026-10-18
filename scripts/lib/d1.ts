// Run SQL against the local or remote D1 database through wrangler (no shell, so no quoting trouble).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Target = 'local' | 'remote';

const WRANGLER = join('node_modules', 'wrangler', 'bin', 'wrangler.js');

/** The D1 database name from wrangler.jsonc (comments stripped). */
export function databaseName(): string {
  const raw = readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const cfg = JSON.parse(raw) as { d1_databases?: { database_name: string }[] };
  const name = cfg.d1_databases?.[0]?.database_name;
  if (!name) throw new Error('wrangler.jsonc has no d1_databases entry');
  return name;
}

function wrangler(args: string[]): string {
  return execFileSync(process.execPath, [WRANGLER, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** One SELECT, rows back. */
export function query<T>(target: Target, sql: string): T[] {
  const out = wrangler(['d1', 'execute', databaseName(), `--${target}`, '--json', '--command', sql]);
  const parsed = JSON.parse(out.slice(out.indexOf('['))) as { results: T[]; success: boolean }[];
  if (!parsed[0]?.success) throw new Error(`query failed: ${sql}`);
  return parsed[0].results;
}

/** Run a list of statements as one file. Returns the path of the SQL file that was run. */
export function executeStatements(target: Target, statements: string[], label: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'lt-sql-'));
  const file = join(dir, `${label}.sql`);
  writeFileSync(file, statements.join('\n') + '\n');
  wrangler(['d1', 'execute', databaseName(), `--${target}`, '--yes', '--file', file]);
  return file;
}

export function targetFromArgs(args: string[]): Target | null {
  if (args.includes('--remote')) return 'remote';
  if (args.includes('--local')) return 'local';
  return null;
}
