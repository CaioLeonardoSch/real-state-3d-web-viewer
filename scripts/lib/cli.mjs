// Runs the project's CLIs (supabase, vite, vitest) through this Node, never through npx or node_modules/.bin:
// on Windows those are .cmd shims that spawn() without a shell cannot start, and killing npx leaves the real
// process running. The same call works on Linux (CI) and Windows.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = {
  supabase: 'node_modules/supabase/dist/supabase.js',
  vite: 'node_modules/vite/bin/vite.js',
  vitest: 'node_modules/vitest/vitest.mjs',
};

/** `[command, args]` for execFileSync/spawn: `cli('vite', ['build'])`. */
export const cli = (name, args) => [process.execPath, [path.join(ROOT, ENTRY[name]), ...args]];

/** `supabase status` of the local stack: API_URL, ANON_KEY, SERVICE_ROLE_KEY... */
export const supabaseStatus = () =>
  JSON.parse(execFileSync(...cli('supabase', ['status', '-o', 'json']), { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));

/** Starts a long-running CLI whose whole process tree `killTree` can stop. */
export const spawnCli = (name, args, opts = {}) => spawn(...cli(name, args), { cwd: ROOT, ...opts, detached: process.platform !== 'win32' });

/** Stops a process and its children (the supabase wrapper starts the real binary as a child). */
export function killTree(proc) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-proc.pid);
  } catch {}
}
