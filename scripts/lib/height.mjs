// Shared by scripts/fetch-osm.mjs and unit tests.
export const METERS_PER_LEVEL = 3;
export const DEFAULT_HEIGHT_M = 6;

/** Parses OSM numeric tags like "12", "12.5", "12 m", "12,5". Returns NaN when not parseable. */
export function parseOsmNumber(value) {
  if (value === undefined || value === null) return NaN;
  const m = String(value).trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(m|meters?|metres?)?$/i);
  return m ? Number(m[1]) : NaN;
}

/**
 * renderHeight rule: `height` tag if valid; else `building:levels` × 3 m; else 6 m.
 * @param {Record<string, unknown>} tags
 * @returns {{ renderHeight: number, source: 'height' | 'levels' | 'default' }}
 */
export function computeRenderHeight(tags) {
  const h = parseOsmNumber(tags?.height);
  if (Number.isFinite(h) && h > 0) return { renderHeight: h, source: 'height' };
  const levels = parseOsmNumber(tags?.['building:levels']);
  if (Number.isFinite(levels) && levels > 0) return { renderHeight: levels * METERS_PER_LEVEL, source: 'levels' };
  return { renderHeight: DEFAULT_HEIGHT_M, source: 'default' };
}
