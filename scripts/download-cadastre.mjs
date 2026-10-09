#!/usr/bin/env node
// Downloads, for the map region, the Joinville property cadastre from the city's public GIS server
// (SIMGeo, https://geo.joinville.sc.gov.br/server/rest/services):
//   - SEFAZ/lotes_urbanos_sefaz   lot outlines (objectid, iq)
//   - SEFAZ/lotes_joinsgc_sefaz   per-lot attributes: built area, land area, vacant, address (no geometry)
//   - SEPUR/outorga_onerosa_do_direito_de_construir_oodc_sepur   lots with a granted height (m)
// Writes .cache/cadastre/{lotes.geojson,atributos.json,oodc.geojson} (not versioned). Pages of 2,000 records,
// one request at a time with a pause, to be gentle with the server. Skips files already downloaded
// (use --refresh). Behind a proxy, Node's fetch needs NODE_USE_ENV_PROXY=1.
//
// The data is public, but no licence is stated: confirm the terms with SEPUR.UGP (simgeo@joinville.sc.gov.br)
// before using it in a product.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.cache', 'cadastre');
const SERVER = 'https://geo.joinville.sc.gov.br/server/rest/services';
const PAGE = 2000;
const PAUSE_MS = 400;
const REFRESH = process.argv.includes('--refresh');
const UA = { 'User-Agent': 'real-state-3d-web-viewer-prototype/0.1 (+https://github.com/caioleonardosch/real-state-3d-web-viewer)' };

const meta = JSON.parse(await readFile(path.join(ROOT, '.cache', 'region', 'meta.json'), 'utf8'));
const [w, s, e, n] = meta.boundaryBbox;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(layer, params, attempt = 1) {
  const url = new URL(`${SERVER}/${layer}/MapServer/0/query`);
  const all = {
    where: '1=1',
    geometry: `${w},${s},${e},${n}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    ...params,
  };
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(JSON.stringify(json.error));
    return json;
  } catch (err) {
    if (attempt >= 4) throw new Error(`${layer}: ${err.message}`);
    await sleep(2000 * attempt);
    return query(layer, params, attempt + 1);
  }
}

/** All records of a layer inside the region bbox, page by page (ordered by objectid). */
async function downloadAll(layer, params, orderBy, pick) {
  const { count } = await query(layer, { returnCountOnly: 'true', f: 'json' });
  const out = [];
  for (let offset = 0; offset < count; offset += PAGE) {
    const page = await query(layer, { ...params, orderByFields: orderBy, resultOffset: String(offset), resultRecordCount: String(PAGE) });
    out.push(...pick(page));
    process.stdout.write(`\r  ${layer}: ${out.length}/${count}`);
    await sleep(PAUSE_MS);
  }
  process.stdout.write('\n');
  return out;
}

async function step(file, producer) {
  const target = path.join(OUT, file);
  if (!REFRESH && existsSync(target)) return console.log(`  [cache] ${path.relative(ROOT, target)}`);
  const data = await producer();
  await writeFile(target, JSON.stringify(data));
}

await mkdir(OUT, { recursive: true });
console.log(`Cadastro da Prefeitura de Joinville, bbox ${meta.boundaryBbox.join(', ')}`);

await step('lotes.geojson', async () => ({
  type: 'FeatureCollection',
  features: await downloadAll(
    'SEFAZ/lotes_urbanos_sefaz',
    { outFields: 'objectid,iq', returnGeometry: 'true', f: 'geojson' },
    'objectid',
    (page) => page.features,
  ),
}));

const A = 'gisdb.gisadmin.mvw_lote.';
await step('atributos.json', async () =>
  downloadAll(
    'SEFAZ/lotes_joinsgc_sefaz',
    {
      outFields: ['gisdb.gisadmin.lotes.objectid', 'area_construida', 'area_terreno', 'baldio', 'logradouro', 'numero', 'bairro']
        .map((f) => (f.startsWith('gisdb') ? f : A + f))
        .join(','),
      returnGeometry: 'false',
      f: 'json',
    },
    'gisdb.gisadmin.lotes.objectid',
    (page) =>
      page.features.map(({ attributes: a }) => ({
        objectid: a['gisdb.gisadmin.lotes.objectid'],
        areaConstruida: a[`${A}area_construida`],
        areaTerreno: a[`${A}area_terreno`],
        baldio: a[`${A}baldio`] === 'Sim',
        logradouro: a[`${A}logradouro`],
        numero: a[`${A}numero`],
        bairro: a[`${A}bairro`],
      })),
  ),
);

await step('oodc.geojson', async () => ({
  type: 'FeatureCollection',
  features: await downloadAll(
    'SEPUR/outorga_onerosa_do_direito_de_construir_oodc_sepur',
    { outFields: 'objectid_1,iq,altura,alt_out', returnGeometry: 'true', f: 'geojson' },
    'objectid_1',
    (page) => page.features,
  ),
}));

await writeFile(
  path.join(OUT, 'meta.json'),
  JSON.stringify({ source: SERVER, downloadedAt: new Date().toISOString(), bbox: meta.boundaryBbox }, null, 2) + '\n',
);
console.log('OK');
