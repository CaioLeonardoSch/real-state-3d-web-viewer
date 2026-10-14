// Low-poly tower crane for buildings under construction (listings and developments), at real scale:
// a mast taller than the building, the jib reaching out, the counter-jib with its counterweight and the top.
import type { Feature, Polygon } from 'geojson';

export interface CranePart {
  p: 'mast' | 'jib' | 'counter' | 'weight' | 'top';
  /** Base and top in metres. */
  b: number;
  h: number;
}

/** Box of `width` metres across, from `from` to `to` metres along `angle` (radians, east = 0), around (x, y). */
function box(x: number, y: number, kx: number, ky: number, angle: number, from: number, to: number, width: number): Polygon {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const w = width / 2;
  const at = (a: number, b: number): [number, number] => [x + (ux * a - uy * b) / kx, y + (uy * a + ux * b) / ky];
  const ring = [at(from, -w), at(to, -w), at(to, w), at(from, w)];
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}

/**
 * Crane next to a building of `buildingTopM` metres (mast at `center`), pointing to `angle`. The mast rises 8 m
 * above the building (at least 22 m), as on a real site.
 */
export function craneParts(center: [number, number], buildingTopM: number, angle: number, props: Record<string, unknown> = {}): Feature<Polygon, CranePart & Record<string, unknown>>[] {
  const [x, y] = center;
  const kx = 111320 * Math.cos((y * Math.PI) / 180);
  const ky = 110540;
  const H = Math.max(22, buildingTopM + 8);
  const parts: [CranePart['p'], number, number, Polygon][] = [
    ['mast', 0, H, box(x, y, kx, ky, angle, -0.8, 0.8, 1.6)],
    ['jib', H - 2.2, H - 1.1, box(x, y, kx, ky, angle, 0.8, 30, 1.1)],
    ['counter', H - 2.2, H - 1.1, box(x, y, kx, ky, angle, -10, -0.8, 1.4)],
    ['weight', H - 4.2, H - 1.4, box(x, y, kx, ky, angle, -10, -7.4, 2.4)],
    ['top', H - 1.1, H + 3.2, box(x, y, kx, ky, angle, -0.4, 0.4, 0.8)],
  ];
  return parts.map(([p, b, h, geometry]) => ({ type: 'Feature', properties: { ...props, p, b, h }, geometry }));
}
