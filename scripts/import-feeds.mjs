#!/usr/bin/env node
// Scheduled XML import (workflow "Importar XML", every hour): reads the feeds the clients' administrators set in
// "Minha conta" (table listing_feeds) and imports each one with scripts/import-xml.mjs. A feed is read every 6 hours,
// or on the next run after someone clicks "Importar agora". The outcome goes back to the table for the screen.
//
//   npm run import:feeds                 (needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)
//   options: --local      the local Supabase (npm run db:start)
//            --org <id>   only this client, due or not
import { execFile } from 'node:child_process';
import { supabaseStatus } from './lib/cli.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const LOCAL = args.includes('--local');
const ONLY = args.includes('--org') ? args[args.indexOf('--org') + 1] : null;
const EVERY_MS = 6 * 3600 * 1000;
const run = promisify(execFile);

let url = process.env.SUPABASE_URL;
let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (LOCAL) {
  const status = supabaseStatus();
  [url, key] = [status.API_URL, status.SERVICE_ROLE_KEY];
}
if (!url || !key) {
  console.error('Erro: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou use --local)');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const { data: feeds, error } = await db.from('listing_feeds').select('org_id, url, sync, requested_at, last_run_at').eq('enabled', true);
if (error) {
  console.error(`Erro: ${error.message}`);
  process.exit(1);
}
const now = Date.now();
const due = feeds.filter((f) =>
  ONLY
    ? f.org_id === ONLY
    : !f.last_run_at || now - Date.parse(f.last_run_at) >= EVERY_MS - 5 * 60 * 1000 || (f.requested_at && f.requested_at > f.last_run_at),
);
console.log(`${feeds.length} feeds ativos, ${due.length} para ler agora`);

/** What the screen shows: the counts and the first messages of each kind. */
function summary(r) {
  const few = (list) => list.slice(0, 20).map((x) => ({ referenceCode: x.referenceCode, text: x.message ?? x.reason ?? x.title ?? '' }));
  return {
    created: r.created.length,
    updated: r.updated.length,
    trashed: r.trashed.length,
    skipped: r.skipped.length,
    suspect: !!r.suspect,
    warnings: few(r.warnings),
    warningCount: r.warnings.length,
    errors: few(r.errors),
    errorCount: r.errors.length,
    skippedList: few(r.skipped),
  };
}

for (const f of due) {
  const startedAt = new Date().toISOString();
  const cmd = ['scripts/import-xml.mjs', '--org', f.org_id, '--url', f.url, '--json', ...(f.sync ? ['--sync'] : []), ...(LOCAL ? ['--local'] : [])];
  let out = '';
  let err = '';
  try {
    ({ stdout: out } = await run('node', cmd, { cwd: ROOT, timeout: 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } }));
  } catch (e) {
    // exit 2: imported, with errors in some listings (the report is still on stdout)
    out = e.stdout ?? '';
    err = (e.stderr ?? '').trim() || e.message;
  }
  const last = out.trim().split('\n').at(-1) ?? '';
  let report = null;
  try {
    report = last.startsWith('{') ? JSON.parse(last) : null;
  } catch {}
  const s = report ? summary(report) : null;
  const status = !report ? 'erro' : s.errorCount || s.suspect ? 'avisos' : 'ok';
  const upd = await db
    .from('listing_feeds')
    .update({
      last_run_at: startedAt,
      last_status: status,
      last_summary: s,
      last_error: report ? null : err.replace(/^Erro:\s*/m, '').split('\n').filter(Boolean).at(-1)?.slice(0, 500) ?? 'falha na importação',
    })
    .eq('org_id', f.org_id);
  if (upd.error) console.error(`  não foi possível gravar o resultado: ${upd.error.message}`);
  console.log(`- ${f.org_id}: ${status}${s ? ` (${s.created} criados, ${s.updated} atualizados, ${s.trashed} para a lixeira, ${s.errorCount} erros)` : ` — ${err}`}`);
}
// a feed that fails is the client's to fix (shown on their screen), not a failure of the job
