#!/usr/bin/env node
// Sends developments (towers drawn by scripts/generate-developments.mjs) to the back end, for a developer client.
// Run by the platform's support team; the developer then manages status, prices, reservations and the spreadsheet
// in "Minha conta" (docs/espelho-de-vendas.md).
//
//   npm run developments:upload -- --org <slug-ou-id> [--only cora,aman] [--file public/data/developments.json]
//   options: --publish     publish them (otherwise they stay visible only to the team)
//            --with-sales  also copy price and status of each unit from the file (the demo's are fictional)
//            --prune       remove units of the database that are no longer in the drawing
//            --dry-run     only report what would change
//            --local       use the local Supabase (npm run db:start) instead of SUPABASE_URL
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service key: support only, never in the site).
// Sending again updates the drawing and keeps what the developer did: status, price and reservations of the units
// already there (matched by tower and number) are not touched unless --with-sales.
import { supabaseStatus } from './lib/cli.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { developmentRow, unitRows } from '../src/backend/developments.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);
const DRY = flag('dry-run');

function fail(msg) {
  console.error(`Erro: ${msg}`);
  process.exit(1);
}

let url = process.env.SUPABASE_URL;
let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (flag('local')) {
  const status = supabaseStatus();
  [url, key] = [status.API_URL, status.SERVICE_ROLE_KEY];
}
if (!url || !key) fail('defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou use --local)');
const db = createClient(url, key, { auth: { persistSession: false } });

const orgArg = opt('org');
if (!orgArg) fail('informe --org <slug ou id da incorporadora>');
const isUuid = /^[0-9a-f-]{36}$/.test(orgArg);
const { data: org } = await db.from('organizations').select('id, name').eq(isUuid ? 'id' : 'slug', orgArg).maybeSingle();
if (!org) fail(`cliente "${orgArg}" não encontrado`);

const file = JSON.parse(await readFile(path.resolve(ROOT, opt('file') ?? 'public/data/developments.json'), 'utf8'));
const only = opt('only')?.split(',').map((s) => s.trim());
const devs = file.developments.filter((d) => !only || only.includes(d.id));
if (!devs.length) fail('nenhum empreendimento no arquivo' + (only ? ` com --only ${only.join(',')}` : ''));

const report = [];
for (const d of devs) {
  const row = { org_id: org.id, ...developmentRow(d), ...(flag('publish') ? { published: true } : {}) };
  const { data: existing } = await db.from('developments').select('id, org_id, reservation_hours').eq('slug', row.slug).maybeSingle();
  if (existing && existing.org_id !== org.id) fail(`o endereço "${row.slug}" já é de um empreendimento de outro cliente`);
  const units = unitRows(d, flag('with-sales'), existing?.reservation_hours ?? 24);
  const line = { slug: row.slug, name: row.name, action: existing ? 'atualizado' : 'criado', units: { created: 0, updated: 0, removed: 0, notInDrawing: [] } };
  report.push(line);
  if (DRY) {
    line.units.created = units.length;
    continue;
  }
  let devId = existing?.id;
  if (existing) {
    const { error } = await db.from('developments').update(row).eq('id', existing.id);
    if (error) fail(`${row.slug}: ${error.message}`);
  } else {
    const { data, error } = await db.from('developments').insert(row).select('id').single();
    if (error) fail(`${row.slug}: ${error.message}`);
    devId = data.id;
  }
  const { data: have, error: e1 } = await db.from('development_units').select('id, tower, number').eq('development_id', devId);
  if (e1) fail(`${row.slug}: ${e1.message}`);
  const byKey = new Map(have.map((u) => [`${u.tower}|${u.number}`, u.id]));
  const fresh = [];
  for (const u of units) {
    const id = byKey.get(`${u.tower}|${u.number}`);
    byKey.delete(`${u.tower}|${u.number}`);
    if (!id) {
      fresh.push({ development_id: devId, ...u });
      continue;
    }
    // drawing only, unless --with-sales
    const { price, status, reserved_until, ...drawing } = u;
    const { error } = await db
      .from('development_units')
      .update(flag('with-sales') ? { ...drawing, price, status, reserved_until } : drawing)
      .eq('id', id);
    if (error) fail(`${row.slug} ${u.number}: ${error.message}`);
    line.units.updated++;
  }
  if (fresh.length) {
    const { error } = await db.from('development_units').insert(fresh);
    if (error) fail(`${row.slug}: ${error.message}`);
    line.units.created = fresh.length;
  }
  const gone = [...byKey.entries()];
  if (gone.length && flag('prune')) {
    const { error } = await db.from('development_units').delete().in('id', gone.map(([, id]) => id));
    if (error) fail(`${row.slug}: ${error.message}`);
    line.units.removed = gone.length;
  } else line.units.notInDrawing = gone.map(([k]) => k.replace(/^\|/, '').replace('|', ' '));
}
console.log(JSON.stringify({ org: org.name, dryRun: DRY, developments: report }, null, 2));
