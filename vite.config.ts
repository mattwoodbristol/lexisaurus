import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// The version shown at the foot of the app: release (or build date) and commit (Workers Builds sets
// WORKERS_CI_COMMIT_SHA; elsewhere git is asked).
function commit(): string {
  const sha = process.env.WORKERS_CI_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}
// A published release (release.json, stamped by scripts/make-public-copy.mjs) names itself;
// otherwise the build date stands in.
const release = (JSON.parse(readFileSync('release.json', 'utf8')) as { release?: string }).release;
const version = `${release && release !== 'dev' ? release : new Date().toISOString().slice(0, 10).replace(/-/g, '.')} · ${commit()}`;

// Frontend only. The Worker is built and run by wrangler.
export default defineConfig({
  root: 'src/web',
  publicDir: 'public',
  plugins: [preact()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: '../../dist/web', emptyOutDir: true, sourcemap: true },
  server: {
    port: 5173,
    // During `npm run dev:web`, API calls go to `wrangler dev` on 8787.
    proxy: { '/api': 'http://localhost:8787' },
  },
});
