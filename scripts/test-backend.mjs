#!/usr/bin/env node
// Runs the backend tests (tests/backend/) against the local Supabase started with `npx supabase start`.
// Reads the local URL and keys from `supabase status`; never use this against a production project.
import { execFileSync, spawnSync } from 'node:child_process';

const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const env = {
  ...process.env,
  SUPABASE_URL: status.API_URL,
  SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
};
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(env.SUPABASE_URL)) {
  console.error(`Recusado: ${env.SUPABASE_URL} não é o Supabase local.`);
  process.exit(1);
}
const r = spawnSync('npx', ['vitest', 'run', 'tests/backend'], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
