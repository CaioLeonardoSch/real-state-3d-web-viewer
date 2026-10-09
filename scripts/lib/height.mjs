// Shared by the data scripts (build-tiles, generate-listings) and unit tests.
export const METERS_PER_LEVEL = 3;
export const DEFAULT_HEIGHT_M = 6;

/** Parses OSM numeric tags like "12", "12.5", "12 m", "12,5". Returns NaN when not parseable. */
export function parseOsmNumber(value) {
  if (value === undefined || value === null) return NaN;
  const m = String(value).trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(m|meters?|metres?)?$/i);
  return m ? Number(m[1]) : NaN;
}

/**
 * renderHeight rule: OSM `height` tag if valid; else OSM `building:levels` × 3 m; else floors estimated from the
 * city cadastre (scripts/estimate-heights.mjs) × 3 m; else 6 m.
 * @param {Record<string, unknown>} tags
 * @param {number} [cadastreFloors]
 * @returns {{ renderHeight: number, source: 'height' | 'levels' | 'cadastre' | 'default' }}
 */
export function computeRenderHeight(tags, cadastreFloors) {
  const h = parseOsmNumber(tags?.height);
  if (Number.isFinite(h) && h > 0) return { renderHeight: h, source: 'height' };
  const levels = parseOsmNumber(tags?.['building:levels']);
  if (Number.isFinite(levels) && levels > 0) return { renderHeight: levels * METERS_PER_LEVEL, source: 'levels' };
  if (cadastreFloors && cadastreFloors > 0) return { renderHeight: cadastreFloors * METERS_PER_LEVEL, source: 'cadastre' };
  return { renderHeight: DEFAULT_HEIGHT_M, source: 'default' };
}

/**
 * Floors estimated from the cadastre, by OSM id (.cache/region/heights.json); empty when the cadastre
 * was not downloaded (the map then falls back to OSM and 6 m).
 * @param {string} root repository root
 * @returns {Promise<Map<string, number>>}
 */
export async function loadCadastreFloors(root) {
  const { readFile } = await import('node:fs/promises');
  try {
    const raw = JSON.parse(await readFile(`${root}/.cache/region/heights.json`, 'utf8'));
    return new Map(Object.entries(raw).map(([id, v]) => [id, v.floors]));
  } catch {
    return new Map();
  }
}
