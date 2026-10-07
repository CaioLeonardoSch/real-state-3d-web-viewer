#!/usr/bin/env node
// Validates public/data/listings.json against the real OSM data:
// unique ids, every buildingOsmId exists, every lot is inside the boundary and does not
// intersect any building (nor road/water/green), approximate circles contain the true location.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import turfBbox from '@turf/bbox';
import turfCentroid from '@turf/centroid';
import turfDistance from '@turf/distance';
import turfBooleanIntersects from '@turf/boolean-intersects';
import turfBooleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const read = async (f) => JSON.parse(await readFile(path.join(DATA, f), 'utf8'));
const [listingsFile, buildings, roads, water, green, boundaryFc] = await Promise.all(
  ['listings.json', 'buildings.geojson', 'roads.geojson', 'water.geojson', 'green.geojson', 'boundary.geojson'].map(read),
);
const boundary = boundaryFc.features[0];
const errors = [];
const ok = (msg) => console.log(`  ✔ ${msg}`);
const bboxOverlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

const { listings, agencies } = listingsFile;
if (listingsFile.fictional !== true) errors.push('root.fictional !== true');

// counts
const count = (t) => listings.filter((l) => l.type === t).length;
console.log(`Listings: ${listings.length} (apt ${count('apartment')}, house ${count('house')}, semi ${count('semi_detached')}, land ${count('land')}); agencies: ${agencies.length}`);
if (listings.length < 14 || listings.length > 16) errors.push(`expected 14–16 listings, got ${listings.length}`);

// unique ids
const ids = listings.map((l) => l.id);
if (new Set(ids).size !== ids.length) errors.push('duplicated listing ids');
else ok('all listing ids are unique');

// fictional flag
if (listings.some((l) => l.fictional !== true)) errors.push('some listing lacks fictional: true');
else ok('every listing has fictional: true');

// buildingOsmId existence + uniqueness
const byId = new Map(buildings.features.map((f) => [f.properties.osmId, f]));
const withBuilding = listings.filter((l) => l.type !== 'land');
const missing = withBuilding.filter((l) => !byId.has(l.buildingOsmId));
if (missing.length) errors.push(`buildingOsmId not found: ${missing.map((l) => l.id).join(', ')}`);
else ok(`all ${withBuilding.length} buildingOsmId exist in buildings.geojson`);
const bIds = withBuilding.map((l) => l.buildingOsmId);
if (new Set(bIds).size !== bIds.length) errors.push('two listings share the same building');

// residential & untagged building check
const BAD = ['amenity', 'shop', 'office', 'healthcare', 'craft', 'tourism', 'leisure', 'religion'];
const RES = new Set(['yes', 'house', 'residential', 'apartments', 'detached', 'semidetached_house', 'terrace']);
const bad = withBuilding.filter((l) => {
  const p = byId.get(l.buildingOsmId)?.properties ?? {};
  return !RES.has(p.building) || BAD.some((k) => p[k] !== undefined);
});
if (bad.length) errors.push(`non-residential building chosen: ${bad.map((l) => l.id).join(', ')}`);
else ok('all chosen buildings are residential without amenity/shop/office/healthcare tags');

// lots
const obstacles = [
  ...buildings.features.map((g) => ['building', g]),
  ...roads.features.map((g) => ['road', g]),
  ...water.features.map((g) => ['water', g]),
  ...green.features.map((g) => ['green', g]),
].map(([k, g]) => ({ k, g, bbox: turfBbox(g) }));
for (const l of listings.filter((x) => x.type === 'land')) {
  const lot = { type: 'Feature', properties: {}, geometry: l.lotPolygon };
  const lb = turfBbox(lot);
  const hits = obstacles.filter((o) => bboxOverlap(lb, o.bbox) && turfBooleanIntersects(lot, o.g));
  if (hits.length) errors.push(`${l.id} intersects ${hits.map((h) => `${h.k}:${h.g.properties.osmId}`).join(', ')}`);
  else ok(`${l.id} lot does not intersect any building/road/water/green`);
  if (l.lotPolygon.coordinates[0].some((c) => !turfBooleanPointInPolygon(point(c), boundary)))
    errors.push(`${l.id} lot is not fully inside the neighbourhood boundary`);
}

// buildings inside boundary
const outside = withBuilding.filter((l) => !turfBooleanPointInPolygon(turfCentroid(byId.get(l.buildingOsmId)), boundary));
if (outside.length) errors.push(`buildings outside boundary: ${outside.map((l) => l.id).join(', ')}`);
else ok('all listing buildings are inside the neighbourhood boundary');

// approximate locations
const approx = listings.filter((l) => l.approximateLocation);
for (const l of approx) {
  const truth =
    l.type === 'land' ? turfCentroid({ type: 'Feature', properties: {}, geometry: l.lotPolygon }) : turfCentroid(byId.get(l.buildingOsmId));
  const d = turfDistance(truth, point(l.approxCenter), { units: 'meters' });
  if (d > l.approxRadiusM) errors.push(`${l.id}: true location ${d.toFixed(0)} m from circle center > radius`);
  else ok(`${l.id} approximate: offset ${d.toFixed(0)} m, circle radius ${l.approxRadiusM} m`);
}
if (approx.length !== 3) errors.push(`expected 3 approximate listings, got ${approx.length}`);

if (errors.length) {
  console.error('\nVALIDATION FAILED:\n - ' + errors.join('\n - '));
  process.exit(1);
}
console.log('\nlistings.json OK');
