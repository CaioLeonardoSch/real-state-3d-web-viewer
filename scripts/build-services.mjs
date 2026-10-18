// Turns .cache/region/services.geojson (from scripts/extract-region.py) into public/data/servicos.json, the compact
// list the app loads for "Por perto" and the "perto de" filter: { kinds, items: [kindIdx, lon, lat, name?][] }.
// The same place is often mapped twice (a node and the building area, or two nodes): services of the same kind
// within DEDUPE_M of each other count once, keeping the one with a name.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '.cache', 'region', 'services.geojson');
const OUT = path.join(ROOT, 'public', 'data', 'servicos.json');
const KINDS = ['school', 'health', 'pharmacy', 'market', 'bakery', 'park'];
const DEDUPE_M = 50;

function distanceM(a, b) {
  const kx = 111_320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110_540);
}

const round = (v) => Math.round(v * 1e5) / 1e5;
const fc = JSON.parse(await readFile(SRC, 'utf8'));
// named first, so the kept copy of a duplicate is the named one; then by id, for a stable output
const features = fc.features
  .filter((f) => KINDS.includes(f.properties.kind) && f.geometry?.type === 'Point')
  .sort((a, b) => Number(!a.properties.name) - Number(!b.properties.name) || String(a.properties.osmId).localeCompare(String(b.properties.osmId)));
const kept = [];
for (const f of features) {
  const p = f.geometry.coordinates;
  if (kept.some((k) => k.kind === f.properties.kind && distanceM(k.p, p) < DEDUPE_M)) continue;
  kept.push({ kind: f.properties.kind, p, name: f.properties.name?.trim() || undefined });
}
kept.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.p[0] - b.p[0] || a.p[1] - b.p[1]);
const items = kept.map((s) => {
  const row = [KINDS.indexOf(s.kind), round(s.p[0]), round(s.p[1])];
  if (s.name) row.push(s.name);
  return row;
});
await writeFile(OUT, JSON.stringify({ kinds: KINDS, items }) + '\n');
const counts = Object.fromEntries(KINDS.map((k, i) => [k, items.filter((r) => r[0] === i).length]));
console.log(`servicos.json: ${items.length} serviços (${features.length - items.length} duplicados) ${JSON.stringify(counts)}`);
