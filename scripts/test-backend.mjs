#!/usr/bin/env node
// Runs the backend tests (tests/backend/) against the local Supabase started with `npm run db:start`.
// Also serves the edge functions with a fake e-mail provider, so the lead notification is tested end to end
// without sending anything. Reads the local URL and keys from `supabase status`; never use this against production.
import { spawn } from 'node:child_process';
import { cli, supabaseStatus } from './lib/cli.mjs';
import { startLocalFunctions } from './lib/local-functions.mjs';

const status = supabaseStatus();
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(status.API_URL)) {
  console.error(`Recusado: ${status.API_URL} não é o Supabase local.`);
  process.exit(1);
}
const env = {
  ...process.env,
  SUPABASE_URL: status.API_URL,
  SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
};

const fns = await startLocalFunctions(status.API_URL, 'http://127.0.0.1:4179/');
if (fns) env.MAIL_LOG = fns.mailLog;
else console.warn('O teste do aviso por e-mail será pulado.');

// async: the fake e-mail server above runs in this process and must keep answering while the tests run
const code = await new Promise((resolve) => spawn(...cli('vitest', ['run', 'tests/backend']), { stdio: 'inherit', env }).on('exit', resolve));
fns?.stop();
process.exit(code ?? 1);
