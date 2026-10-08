#!/usr/bin/env node
// Fetches OpenStreetMap data for the "América" neighbourhood (Joinville/SC, Brazil)
// and writes GeoJSON layers to public/data/.
//
// - Idempotent: raw HTTP responses are cached in .cache/osm/. Delete that folder
//   (or pass --refresh) to download again.
// - Nominatim usage policy: identifiable User-Agent, max 1 request/second.
// - Overpass: retries with backoff, then falls back to alternative mirrors.
//
// Node's built-in fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 (Node >= 22.21).
// If you are behind a proxy, run: NODE_USE_ENV_PROXY=1 npm run data

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import osmtogeojson from 'osmtogeojson';
import turfBbox from '@turf/bbox';
import { computeRenderHeight } from './lib/height.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'osm');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const REFRESH = process.argv.includes('--refresh');

const USER_AGENT =
  'real-state-3d-web-viewer-prototype/0.1 (+https://github.com/caioleonardosch/real-state-3d-web-viewer)';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NEIGHBOURHOOD_QUERY = 'América, Joinville, Santa Catarina, Brasil';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
// Fallback radius when no administrative polygon is available.
const FALLBACK_RADIUS_M = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

async function cached(key, producer) {
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (!REFRESH && existsSync(file)) {
    console.log(`  [cache] ${path.relative(ROOT, file)}`);
    return JSON.parse(await readFile(file, 'utf8'));
  }
  const data = await producer();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return data;
}

async function fetchJsonWithRetry(url, init, { attempts = 4, baseDelayMs = 5000, label }) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return await res.json();
      lastErr = new Error(`${label}: HTTP ${res.status}`);
      // 4xx other than 429 will not get better by retrying
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastErr = new Error(`${label}: ${err.message}`);
    }
    const wait = baseDelayMs * 2 ** i;
    console.warn(`  ${lastErr.message} — retrying in ${wait / 1000}s (${i + 1}/${attempts})`);
    await sleep(wait);
  }
  throw lastErr;
}

async function nominatimLookup() {
  const params = new URLSearchParams({
    q: NEIGHBOURHOOD_QUERY,
    format: 'jsonv2',
    polygon_geojson: '1',
    limit: '5',
  });
  const url = `${NOMINATIM_URL}?${params}`;
  return cached(`nominatim-${hash(url)}`, async () => {
    console.log('  GET Nominatim', NEIGHBOURHOOD_QUERY);
    await sleep(1100); // respect 1 req/s
    return fetchJsonWithRetry(url, { headers: { 'User-Agent': USER_AGENT } }, { label: 'Nominatim' });
  });
}

async function overpass(query) {
  return cached(`overpass-${hash(query)}`, async () => {
    let lastErr;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        console.log(`  POST ${endpoint}`);
        return await fetchJsonWithRetry(
          endpoint,
          {
            method: 'POST',
            headers: {
              'User-Agent': USER_AGENT,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ data: query }),
          },
          { attempts: 3, label: `Overpass ${new URL(endpoint).host}` },
        );
      } catch (err) {
        lastErr = err;
        console.warn(`  ${err.message} — trying next mirror`);
      }
    }
    throw new Error(`All Overpass endpoints failed. Last error: ${lastErr?.message}`);
  });
}

function bboxAround(lat, lon, radiusM) {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

function fc(features) {
  return { type: 'FeatureCollection', features };
}

const isPolygonal = (f) => f.geometry && /Polygon$/.test(f.geometry.type);
const isLinear = (f) => f.geometry && /LineString$/.test(f.geometry.type);

function slimProps(f, keep) {
  const p = f.properties ?? {};
  const out = { osmId: p.id ?? f.id };
  for (const k of keep) if (p[k] !== undefined) out[k] = p[k];
  return out;
}

async function main() {
  console.log('1) Locating neighbourhood via Nominatim');
  const results = await nominatimLookup();
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('Nominatim returned no results for ' + NEIGHBOURHOOD_QUERY);
  }
  const admin = results.find(
    (r) =>
      r.osm_type === 'relation' &&
      r.category === 'boundary' &&
      r.type === 'administrative' &&
      r.geojson &&
      /Polygon$/.test(r.geojson.type),
  );
  const chosen = admin ?? results[0];
  const center = { lat: Number(chosen.lat), lon: Number(chosen.lon) };
  console.log(`  -> ${chosen.display_name} (${chosen.osm_type}/${chosen.osm_id})`);

  let boundaryKind;
  let boundaryFeature;
  let areaFilter; // Overpass filter fragment
  let areaDecl = '';
  if (admin) {
    boundaryKind = 'administrative';
    boundaryFeature = {
      type: 'Feature',
      properties: {
        name: admin.name,
        displayName: admin.display_name,
        osmType: admin.osm_type,
        osmId: admin.osm_id,
        boundaryKind,
        center: [center.lon, center.lat],
      },
      geometry: admin.geojson,
    };
    // Overpass area id for a relation = 3600000000 + relation id
    areaFilter = `(area.nb)`;
    areaDecl = `area(id:${3600000000 + Number(admin.osm_id)})->.nb;`;
  } else {
    boundaryKind = 'approximate-bbox';
    const [w, s, e, n] = bboxAround(center.lat, center.lon, FALLBACK_RADIUS_M);
    boundaryFeature = {
      type: 'Feature',
      properties: {
        name: chosen.name,
        displayName: chosen.display_name,
        boundaryKind,
        radiusM: FALLBACK_RADIUS_M,
        center: [center.lon, center.lat],
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
      },
    };
    areaFilter = `(${s},${w},${n},${e})`;
  }

  console.log(`2) Querying Overpass (boundary: ${boundaryKind})`);
  const query = `
[out:json][timeout:120];
${areaDecl}
(
  way["building"]${areaFilter};
  relation["building"]${areaFilter};
  way["highway"]${areaFilter};
  way["natural"="water"]${areaFilter};
  relation["natural"="water"]${areaFilter};
  way["waterway"]${areaFilter};
  way["leisure"="park"]${areaFilter};
  relation["leisure"="park"]${areaFilter};
  way["landuse"~"^(grass|forest)$"]${areaFilter};
  relation["landuse"~"^(grass|forest)$"]${areaFilter};
  way["natural"="wood"]${areaFilter};
);
out body;
>;
out skel qt;`;
  const osm = await overpass(query);
  if (osm.remark) console.warn('  Overpass remark:', osm.remark);

  console.log('3) Converting to GeoJSON');
  const gj = osmtogeojson(osm);
  const buildings = [];
  const roads = [];
  const water = [];
  const green = [];
  const heightStats = { height: 0, levels: 0, default: 0 };

  for (const f of gj.features) {
    const p = f.properties ?? {};
    if (p.building && isPolygonal(f)) {
      const { renderHeight, source } = computeRenderHeight(p);
      heightStats[source]++;
      const props = slimProps(f, [
        'building',
        'height',
        'building:levels',
        'name',
        'amenity',
        'shop',
        'office',
        'healthcare',
        'craft',
        'tourism',
        'leisure',
        'religion',
        'denomination',
        'industrial',
      ]);
      buildings.push({ type: 'Feature', properties: { ...props, renderHeight, heightSource: source }, geometry: f.geometry });
    } else if (p.highway && isLinear(f)) {
      roads.push({ type: 'Feature', properties: slimProps(f, ['highway', 'name']), geometry: f.geometry });
    } else if ((p.natural === 'water' && isPolygonal(f)) || (p.waterway && (isLinear(f) || isPolygonal(f)))) {
      water.push({ type: 'Feature', properties: slimProps(f, ['natural', 'waterway', 'name']), geometry: f.geometry });
    } else if (
      (p.leisure === 'park' || p.landuse === 'grass' || p.landuse === 'forest' || p.natural === 'wood') &&
      isPolygonal(f)
    ) {
      green.push({ type: 'Feature', properties: slimProps(f, ['leisure', 'landuse', 'natural', 'name']), geometry: f.geometry });
    }
  }

  // Use numeric OSM ids (way/123 -> 123, relation -> negative to avoid clashes) for feature-state
  for (const b of buildings) {
    const [kind, num] = String(b.properties.osmId).split('/');
    b.id = kind === 'relation' ? -Number(num) : Number(num);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const write = (name, obj) => writeFile(path.join(OUT_DIR, name), JSON.stringify(obj));
  await write('boundary.geojson', fc([boundaryFeature]));
  await write('buildings.geojson', fc(buildings));
  await write('roads.geojson', fc(roads));
  await write('water.geojson', fc(water));
  await write('green.geojson', fc(green));

  const all = fc([boundaryFeature, ...buildings, ...roads, ...water, ...green]);
  const dataBbox = turfBbox(all);
  const boundaryBbox = turfBbox(boundaryFeature);
  const meta = {
    generatedAt: new Date().toISOString(),
    source: 'OpenStreetMap contributors (ODbL) via Nominatim + Overpass API',
    neighbourhood: chosen.display_name,
    boundaryKind,
    boundaryOsm: admin ? `relation/${admin.osm_id}` : null,
    center: [center.lon, center.lat],
    boundaryBbox,
    dataBbox,
    counts: {
      buildings: buildings.length,
      roads: roads.length,
      water: water.length,
      green: green.length,
    },
    heightSources: heightStats,
  };
  await write('meta.json', meta);

  console.log('\nSummary');
  console.log(`  Boundary:   ${boundaryKind}${admin ? ` (relation/${admin.osm_id})` : ' — APPROXIMATE'}`);
  console.log(`  Center:     ${center.lat}, ${center.lon}`);
  console.log(`  Buildings:  ${buildings.length}`);
  console.log(`    height tag:        ${heightStats.height}`);
  console.log(`    building:levels×3: ${heightStats.levels}`);
  console.log(`    default 6 m:       ${heightStats.default}`);
  console.log(`  Roads:      ${roads.length}`);
  console.log(`  Water:      ${water.length}`);
  console.log(`  Green:      ${green.length}`);
  console.log(`  Boundary bbox: ${boundaryBbox.map((n) => n.toFixed(6)).join(', ')}`);
  console.log(`  Data bbox:     ${dataBbox.map((n) => n.toFixed(6)).join(', ')}`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  console.error('No data was fabricated. Fix connectivity and run again.');
  process.exit(1);
});
