import type { Position } from 'geojson';
import type { SunInfo } from './lighting';

/**
 * Shadows of the buildings on the ground (the map is still flat). A building is a prism: its footprint raised to its
 * height. On flat ground its shadow is the footprint swept away from the sun by height / tan(altitude); for a convex
 * footprint that is exactly the convex hull of the footprint and of its moved copy, which is what is drawn (concave
 * footprints, like an L, also shade their inner corner: close enough at the map's scale). Computed in the browser
 * from the building tiles already loaded, so the map files do not grow.
 */

/** Metres per degree of latitude on MapLibre's sphere (Web Mercator, radius 6 378 137 m). */
export const M_PER_DEG = 111319.49;
/** Below this sun altitude (degrees) there are no shadows: they would be very long and faint (dawn, dusk, night). */
export const SHADOW_MIN_ALTITUDE = 4;
/** Longest shadow, in building heights (the sun about 9.5° above the horizon). */
export const SHADOW_MAX_RATIO = 6;

/**
 * Where the top of a 1 m tall pole falls on the ground, in degrees [Δlng, Δlat] from its foot: away from the sun,
 * 1 / tan(altitude) metres long. null when the sun is too low or below the horizon.
 */
export function shadowOffset(sun: SunInfo, lat: number): [number, number] | null {
  if (!(sun.altitude >= SHADOW_MIN_ALTITUDE)) return null;
  const rad = Math.PI / 180;
  const length = Math.min(SHADOW_MAX_RATIO, 1 / Math.tan(sun.altitude * rad));
  // the sun is at `azimuth` (clockwise from north): the shadow points the opposite way
  const az = sun.azimuth * rad;
  return [(-Math.sin(az) * length) / (M_PER_DEG * Math.cos(lat * rad)), (-Math.cos(az) * length) / M_PER_DEG];
}

/** Convex hull of the points (monotone chain), as a closed counter-clockwise ring; null if they are all in line. */
export function convexHull(points: Position[]): Position[] | null {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Position, a: Position, b: Position) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Position[]): Position[] => {
    const h: Position[] = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  const hull = [...half(pts), ...half(pts.reverse())];
  return hull.length >= 3 ? [...hull, hull[0]] : null;
}

/** Ground shadow of a building: its footprint (a closed ring), its height in metres and the sun's shadowOffset(). */
export function shadowRing(ring: Position[], height: number, offset: [number, number]): Position[] | null {
  const dx = offset[0] * height;
  const dy = offset[1] * height;
  const pts: Position[] = [];
  // the last point of a closed ring repeats the first
  for (let i = 0; i < ring.length - 1; i++) pts.push(ring[i], [ring[i][0] + dx, ring[i][1] + dy]);
  return convexHull(pts);
}
