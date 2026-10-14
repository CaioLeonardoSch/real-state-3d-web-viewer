#!/usr/bin/env node
// Monthly change report of the map: compares two builds of the region tiles (last month's and the new one) and
// lists what changed on the ground — buildings added, removed or redrawn, heights changed, per neighbourhood — plus
// the pavement and scenery counts (meta.json) and the listings whose building changed. The monthly workflow
// (.github/workflows/mapa-mensal.yml) runs it after scripts/build-tiles.mjs and puts the report in the pull request
// that publishes the new map, so a person looks at the changes before they go live.
//
//   node scripts/map-changes.mjs --old <previous.pmtiles> [--old-meta <previous meta.json>]
//        [--new public/data/joinville.pmtiles] [--new-meta public/data/meta.json]
//        [--listings public/data/listings.json] [--out report.md] [--json summary.json]
import { existsSync } from 'node:fs';
import { open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';
import { frame, polygonTester } from './lib/scenery.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Z = 15; // the tiles' full-detail zoom
/** A height change smaller than a floor is noise (rounding, a new estimate of the same floors). */
export const HEIGHT_STEP_M = 3;
/** An old and a new building this close (centres, metres) with different ids are the same building redrawn. */
export const REDRAWN_M = 4;
/** Rows of the "largest changes" tables. */
const TOP = 30;

// ---------------------------------------------------------------- reading the tiles

class FileRangeSource {
  constructor(handle, key) {
    this.handle = handle;
    this.key = key;
  }
  getKey() {
    return this.key;
  }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await this.handle.read(buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead) };
  }
}

const lon2x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const lat2y = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z);
};
const x2lon = (x) => (x / 2 ** Z) * 360 - 180;
const y2lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** Z))) * 180) / Math.PI;

/**
 * Every building of a .pmtiles file (path or file: URL): osmId → { height, residential, center [lon, lat] }. A
 * building crossing tile edges appears in several tiles (clipped); the centre is the one of its largest piece.
 * @returns {Promise<Map<string, { height: number, residential: boolean, center: [number, number], size: number }>>}
 */
export async function readBuildings(file) {
  const handle = await open(file, 'r');
  try {
    const archive = new PMTiles(new FileRangeSource(handle, String(file)));
    const h = await archive.getHeader();
    const out = new Map();
    for (let x = lon2x(h.minLon); x <= lon2x(h.maxLon); x++) {
      for (let y = lat2y(h.maxLat); y <= lat2y(h.minLat); y++) {
        const t = await archive.getZxy(Z, x, y);
        const layer = t && new VectorTile(new Pbf(new Uint8Array(t.data))).layers.buildings;
        for (let i = 0; layer && i < layer.length; i++) {
          const f = layer.feature(i);
          const id = f.properties.osmId;
          if (typeof id !== 'string') continue;
          const piece = ringCentre(f.loadGeometry()[0] ?? [], layer.extent);
          const prev = out.get(id);
          if (prev && prev.size >= piece.size) continue;
          out.set(id, {
            height: Number(f.properties.height) || 0,
            residential: f.properties.residential === true || f.properties.residential === 'true',
            center: [x2lon(x + piece.x), y2lat(y + piece.y)],
            size: piece.size,
          });
        }
      }
    }
    return out;
  } finally {
    await handle.close();
  }
}

/** Area centroid of a ring in tile units (as a fraction of the tile) and its area, for choosing the largest piece. */
function ringCentre(ring, extent) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
    a += cross;
    cx += (ring[j].x + ring[i].x) * cross;
    cy += (ring[j].y + ring[i].y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const p = ring[0] ?? { x: extent / 2, y: extent / 2 };
    return { x: p.x / extent, y: p.y / extent, size: 0 };
  }
  return { x: cx / (3 * a) / extent, y: cy / (3 * a) / extent, size: Math.abs(a) / 2 };
}

// ---------------------------------------------------------------- comparing

/**
 * Differences between two sets of buildings. Removed and added buildings at the same spot (centres within
 * REDRAWN_M) are one building redrawn in OSM under a new id, not a demolition plus a new building.
 */
export function compareBuildings(before, after, lat0 = -26.3) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, b] of after) {
    const a = before.get(id);
    if (!a) added.push({ id, ...b });
    else if (Math.abs(b.height - a.height) >= HEIGHT_STEP_M) changed.push({ id, center: b.center, from: a.height, to: b.height });
  }
  for (const [id, a] of before) if (!after.has(id)) removed.push({ id, ...a });

  // pair removed and added buildings at the same spot (grid of REDRAWN_M cells)
  const { kx, ky } = frame(lat0);
  const cell = (c) => [Math.floor((c[0] * kx) / REDRAWN_M), Math.floor((c[1] * ky) / REDRAWN_M)];
  const grid = new Map();
  for (const b of added) {
    const [i, j] = cell(b.center);
    const k = `${i},${j}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(b);
  }
  const redrawn = [];
  const paired = new Set();
  for (const r of removed) {
    const [i, j] = cell(r.center);
    let best = null;
    let bestD = REDRAWN_M;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const b of grid.get(`${i + di},${j + dj}`) ?? []) {
          if (paired.has(b.id)) continue;
          const d = Math.hypot((b.center[0] - r.center[0]) * kx, (b.center[1] - r.center[1]) * ky);
          if (d <= bestD) [best, bestD] = [b, d];
        }
      }
    }
    if (!best) continue;
    paired.add(best.id);
    paired.add(r.id);
    redrawn.push({ from: r.id, to: best.id, center: best.center, heightFrom: r.height, heightTo: best.height });
  }
  return {
    added: added.filter((b) => !paired.has(b.id)),
    removed: removed.filter((b) => !paired.has(b.id)),
    redrawn,
    changed: [...changed, ...redrawn.filter((r) => Math.abs(r.heightTo - r.heightFrom) >= HEIGHT_STEP_M).map((r) => ({ id: r.to, center: r.center, from: r.heightFrom, to: r.heightTo }))],
  };
}

/** Neighbourhood of a point (name), or null outside every neighbourhood (rural areas, part of Araquari). */
export function bairroLocator(areas) {
  const tests = areas.features.map((f) => {
    const coords = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of coords) {
      for (const [x, y] of poly[0]) {
        w = Math.min(w, x);
        e = Math.max(e, x);
        s = Math.min(s, y);
        n = Math.max(n, y);
      }
    }
    return { name: f.properties.name, bbox: [w, s, e, n], inside: polygonTester(f.geometry) };
  });
  return ([x, y]) => tests.find((t) => x >= t.bbox[0] && x <= t.bbox[2] && y >= t.bbox[1] && y <= t.bbox[3] && t.inside([x, y]))?.name ?? null;
}

// ---------------------------------------------------------------- report

const nf = (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—');
const diff = (a, b) => {
  if (typeof a !== 'number' || typeof b !== 'number') return '—';
  const d = Math.round((b - a) * 10) / 10;
  return d === 0 ? '0' : `${d > 0 ? '+' : '−'}${nf(Math.abs(d))}`;
};
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '?');
const osmLink = (id) => `[${id}](https://www.openstreetmap.org/${id})`;
const SURFACES = [
  ['a', 'Asfalto'],
  ['c', 'Calçamento (lajota, paralelepípedo, paver)'],
  ['p', 'Outro pavimento (concreto…)'],
  ['u', 'Sem pavimento (estrada de chão)'],
  ['?', 'Sem informação no OSM'],
];

/** Markdown report (Portuguese: it is read by the team in the pull request). */
export function report({ diffs, beforeMeta, afterMeta, bairroOf, listings = [], developments = [] }) {
  const { added, removed, redrawn, changed } = diffs;
  const lines = [];
  const push = (...l) => lines.push(...l);
  const c0 = beforeMeta?.counts ?? {};
  const c1 = afterMeta?.counts ?? {};
  const taller = changed.filter((c) => c.to > c.from).length;

  push(`# Mapa: mudanças de ${date(beforeMeta?.osmTimestamp)} para ${date(afterMeta?.osmTimestamp)}`, '');
  push(
    `Extrato do OpenStreetMap de ${date(beforeMeta?.osmTimestamp)} comparado com o de ${date(afterMeta?.osmTimestamp)} ` +
      `(${afterMeta?.regionName ?? afterMeta?.region ?? 'região'}). Alturas: OpenStreetMap e, onde ele não informa, a estimativa pelo cadastro da Prefeitura.`,
    '',
  );
  push('## Resumo', '');
  push(`- **Prédios novos:** ${nf(added.length)}`);
  push(`- **Prédios removidos:** ${nf(removed.length)}`);
  push(`- **Redesenhados** (mesmo lugar, id novo no OSM): ${nf(redrawn.length)}`);
  push(`- **Altura mudou ${HEIGHT_STEP_M} m ou mais:** ${nf(changed.length)} (${nf(taller)} mais altos, ${nf(changed.length - taller)} mais baixos)`);
  const affected = listingsAffected(listings, developments, diffs);
  push(`- **Anúncios afetados:** ${nf(affected.length)}`, '');

  push('| | Antes | Agora | Diferença |', '|---|---:|---:|---:|');
  const row = (label, a, b) => push(`| ${label} | ${nf(a)} | ${nf(b)} | ${diff(a, b)} |`);
  row('Prédios', c0.buildings, c1.buildings);
  row('Vias (trechos)', c0.roads, c1.roads);
  row('Água (trechos e áreas)', c0.water, c1.water);
  row('Áreas verdes', c0.green, c1.green);
  push('');

  // per neighbourhood
  const per = new Map();
  const bump = (name, k) => {
    const key = name ?? '(fora dos bairros)';
    if (!per.has(key)) per.set(key, { added: 0, removed: 0, changed: 0 });
    per.get(key)[k]++;
  };
  for (const b of added) bump(bairroOf(b.center), 'added');
  for (const b of removed) bump(bairroOf(b.center), 'removed');
  for (const c of changed) bump(bairroOf(c.center), 'changed');
  if (per.size) {
    push('## Por bairro', '');
    push('| Bairro | Novos | Removidos | Altura mudou |', '|---|---:|---:|---:|');
    const rows = [...per].sort((a, b) => b[1].added + b[1].removed + b[1].changed - (a[1].added + a[1].removed + a[1].changed) || a[0].localeCompare(b[0], 'pt-BR'));
    for (const [name, v] of rows) push(`| ${name} | ${nf(v.added)} | ${nf(v.removed)} | ${nf(v.changed)} |`);
    push('');
  }

  // pavement
  const km0 = c0.roadKmBySurface;
  const km1 = c1.roadKmBySurface;
  if (km1) {
    push('## Pavimento das ruas', '', 'Quilômetros de rua de carro por tipo de pavimento, conforme a tag `surface` do OpenStreetMap.', '');
    push('| Tipo | Antes | Agora | Diferença |', '|---|---:|---:|---:|');
    for (const [k, label] of SURFACES) push(`| ${label} | ${nf(km0?.[k])} | ${nf(km1[k] ?? 0)} | ${km0 ? diff(km0[k] ?? 0, km1[k] ?? 0) : '—'} |`);
    if (!km0) push('', '_O mapa anterior não tinha esta contagem: a comparação começa no próximo mês._');
    push('');
  }

  // scenery and height sources
  push('## Paisagem e origem das alturas', '');
  push('| | Antes | Agora | Diferença |', '|---|---:|---:|---:|');
  row('Árvores no mapa', c0.trees, c1.trees);
  row('… mapeadas no OSM', c0.treesFromOsm, c1.treesFromOsm);
  row('Postes no mapa', c0.lamps, c1.lamps);
  row('… mapeados no OSM', c0.lampsFromOsm, c1.lampsFromOsm);
  row('Altura pela tag `height`', c0.heightFromTag, c1.heightFromTag);
  row('Altura pelos andares do OSM', c0.heightFromLevels, c1.heightFromLevels);
  row('Altura pelo cadastro', c0.heightFromCadastre, c1.heightFromCadastre);
  row('Altura padrão (6 m)', c0.heightDefault, c1.heightDefault);
  push('', '_Árvores e postes do mapa são ilustrativos onde o OSM não os mapeia (veja `scripts/lib/scenery.mjs`)._', '');

  if (affected.length) {
    push('## Anúncios afetados', '', 'O anúncio guarda o prédio e a altura do mapa: confira e atualize (no painel, abra o anúncio e salve a localização de novo).', '');
    for (const a of affected) push(`- ${a.label}: ${a.what}`);
    push('');
  }

  const sus = changed.filter((c) => Math.abs(c.to - c.from) >= 15).length;
  if (changed.length) {
    push(`## Maiores mudanças de altura (até ${TOP})`, '');
    push('| Prédio | Bairro | Antes | Agora |', '|---|---|---:|---:|');
    for (const c of [...changed].sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from)).slice(0, TOP)) {
      push(`| ${osmLink(c.id)} | ${bairroOf(c.center) ?? '—'} | ${nf(c.from)} m | ${nf(c.to)} m |`);
    }
    push('');
  }
  if (added.length) {
    push(`## Prédios novos mais altos (até ${TOP})`, '');
    push('| Prédio | Bairro | Altura | Residencial |', '|---|---|---:|---|');
    for (const b of [...added].sort((a, b) => b.height - a.height || b.size - a.size).slice(0, TOP)) {
      push(`| ${osmLink(b.id)} | ${bairroOf(b.center) ?? '—'} | ${nf(b.height)} m | ${b.residential ? 'sim' : 'não'} |`);
    }
    push('');
  }
  if (removed.length) {
    push(`## Prédios removidos (até ${TOP})`, '');
    push('| Prédio | Bairro | Altura |', '|---|---|---:|');
    for (const b of [...removed].sort((a, b) => b.height - a.height || b.size - a.size).slice(0, TOP)) {
      push(`| ${osmLink(b.id)} | ${bairroOf(b.center) ?? '—'} | ${nf(b.height)} m |`);
    }
    push('');
  }

  push('## Antes de aprovar', '');
  push('- [ ] Os números do resumo são plausíveis para um mês (centenas de prédios, não dezenas de milhares).');
  push(`- [ ] As alturas que mudaram 15 m ou mais${sus ? ` (${nf(sus)})` : ''} foram conferidas no openstreetmap.org: pode ser erro de edição.`);
  push('- [ ] Nenhuma fonte de altura caiu bruscamente: uma queda grande em "Altura pelo cadastro" indica que o download do cadastro falhou.');
  push('- [ ] Os anúncios afetados foram avisados ou corrigidos.');
  return lines.join('\n') + '\n';
}

/** Listings (and development plots) whose building was removed, redrawn or changed height. */
export function listingsAffected(listings, developments, { removed, redrawn, changed }) {
  const gone = new Set(removed.map((b) => b.id));
  const moved = new Map(redrawn.map((r) => [r.from, r.to]));
  const height = new Map(changed.map((c) => [c.id, c]));
  const out = [];
  for (const l of listings) {
    const id = l.buildingOsmId;
    if (!id) continue;
    const label = `\`${l.referenceCode ?? l.id}\` ${l.title ?? ''}`.trim();
    if (gone.has(id)) out.push({ id: l.id, label, what: `o prédio ${osmLink(id)} saiu do mapa` });
    else if (moved.has(id)) out.push({ id: l.id, label, what: `o prédio foi redesenhado: ${osmLink(id)} → ${osmLink(moved.get(id))}` });
    else if (height.has(id)) out.push({ id: l.id, label, what: `a altura do prédio mudou de ${nf(height.get(id).from)} m para ${nf(height.get(id).to)} m` });
  }
  for (const d of developments) {
    const ids = (d.hiddenBuildingIds ?? []).filter((id) => gone.has(id) || moved.has(id));
    if (ids.length) out.push({ id: d.id, label: `empreendimento ${d.name}`, what: `${ids.length} das construções antigas do terreno saíram do OSM (demolição registrada: confira a lista \`hiddenBuildingIds\`)` });
  }
  return out;
}

// ---------------------------------------------------------------- command line

async function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : fallback;
  };
  const oldFile = arg('old');
  if (!oldFile || !existsSync(oldFile)) {
    console.error('Uso: node scripts/map-changes.mjs --old <mapa-anterior.pmtiles> [--old-meta meta-anterior.json] [--out relatorio.md] [--json resumo.json]');
    process.exit(2);
  }
  const newFile = arg('new', path.join(ROOT, 'public', 'data', 'joinville.pmtiles'));
  const readJson = async (f) => (f && existsSync(f) ? JSON.parse(await readFile(f, 'utf8')) : null);
  const beforeMeta = await readJson(arg('old-meta', path.join(path.dirname(oldFile), 'meta.json')));
  const afterMeta = await readJson(arg('new-meta', path.join(path.dirname(newFile), 'meta.json')));
  const areas = await readJson(arg('bairros', path.join(path.dirname(newFile), 'bairros-areas.geojson')));
  const listingsFile = await readJson(arg('listings', path.join(ROOT, 'public', 'data', 'listings.json')));
  const devFile = await readJson(arg('developments', path.join(ROOT, 'public', 'data', 'developments.json')));

  const [before, after] = await Promise.all([readBuildings(oldFile), readBuildings(newFile)]);
  const diffs = compareBuildings(before, after, afterMeta?.center?.[1]);
  const md = report({
    diffs,
    beforeMeta,
    afterMeta,
    bairroOf: areas ? bairroLocator(areas) : () => null,
    listings: listingsFile ? (listingsFile.listings ?? listingsFile) : [],
    developments: devFile ? (devFile.developments ?? devFile) : [],
  });
  const out = arg('out');
  if (out) await writeFile(out, md);
  else process.stdout.write(md);
  const summary = {
    before: before.size,
    after: after.size,
    added: diffs.added.length,
    removed: diffs.removed.length,
    redrawn: diffs.redrawn.length,
    heightChanged: diffs.changed.length,
    osmTimestamp: afterMeta?.osmTimestamp ?? null,
  };
  const json = arg('json');
  if (json) await writeFile(json, JSON.stringify(summary, null, 2) + '\n');
  console.error(
    `Prédios: ${before.size} → ${after.size}; novos ${summary.added}, removidos ${summary.removed}, redesenhados ${summary.redrawn}, altura mudou ${summary.heightChanged}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
