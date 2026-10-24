#!/usr/bin/env node
// Sends the map tiles (public/data/<região>.pmtiles, <região>-detalhe.pmtiles and <região>-arvores.pmtiles, from
// npm run data:tiles) to the "map-tiles" bucket of the back end and points public/data/meta.json at them, so the
// .pmtiles leave the git history (~25 MB a month). Each file gets a name by version,
// <região>-<mês do OSM>-<hash>.pmtiles: a published name never changes content, so browsers and CDNs can keep it
// for good, and the previous month stays there for comparison.
//
//   npm run tiles:upload [-- --local] [--dry-run]
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service key: the monthly workflow and support only).
// The files in public/data stay as they are (the local build and the e2e checks read them); meta.json gets the URLs.
import { createHash } from 'node:crypto';
import { supabaseStatus } from './lib/cli.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const META = path.join(DATA, 'meta.json');
const BUCKET = 'map-tiles';
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);

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
url = url.replace(/\/$/, '');

const meta = JSON.parse(await readFile(META, 'utf8'));
const month = (meta.osmTimestamp ?? new Date().toISOString()).slice(0, 7);
/** Local file of a meta.json entry: the name itself, or the region's file when it already points to the bucket. */
const localName = (entry, suffix) => (/^https?:\/\//.test(entry) ? `${meta.region}${suffix}.pmtiles` : entry);

const out = {};
for (const [field, suffix] of [['tiles', ''], ['detailTiles', '-detalhe'], ['treeTiles', '-arvores']]) {
  if (!meta[field]) continue;
  const file = localName(meta[field], suffix);
  const body = await readFile(path.join(DATA, file)).catch(() => fail(`${file} não está em public/data (rode npm run data:tiles)`));
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 10);
  const name = `${meta.region}${suffix}-${month}-${hash}.pmtiles`;
  const publicUrl = `${url}/storage/v1/object/public/${BUCKET}/${name}`;
  out[field] = publicUrl;
  const mb = (body.length / 1e6).toFixed(1);
  if (flag('dry-run')) {
    console.log(`${file} (${mb} MB) → ${publicUrl} (não enviado: --dry-run)`);
    continue;
  }
  // same content, same name: already there (a rerun of the workflow) is fine
  const head = await fetch(publicUrl, { method: 'HEAD' });
  if (head.ok) {
    console.log(`${file} (${mb} MB) já estava em ${publicUrl}`);
    continue;
  }
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${name}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      apikey: key,
      'content-type': 'application/vnd.pmtiles',
      // the name says the version: nothing to revalidate
      'cache-control': 'max-age=31536000',
      'x-upsert': 'false',
    },
    body,
  });
  if (!res.ok) fail(`${file}: ${res.status} ${await res.text()}`);
  console.log(`${file} (${mb} MB) → ${publicUrl}`);
}

if (!flag('dry-run')) {
  // meta.json keeps its formatting (2 spaces, as scripts/build-tiles.mjs writes it)
  await writeFile(META, JSON.stringify({ ...meta, ...out }, null, 2) + '\n');
  console.log('public/data/meta.json aponta para os arquivos enviados.');
}
