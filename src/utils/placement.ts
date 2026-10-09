import type { Feature, Geometry, MultiPolygon, Polygon } from 'geojson';
import turfBbox from '@turf/bbox';
import turfBooleanIntersects from '@turf/boolean-intersects';
import turfBooleanPointInPolygon from '@turf/boolean-point-in-polygon';
import turfDestination from '@turf/destination';
import { point, polygon } from '@turf/helpers';
import type { AppData } from '../data/load';

/**
 * Geometry rules for listings added in the browser. They mirror scripts/generate-listings.mjs and
 * scripts/validate-listings.mjs, so an exported listing passes `npm run validate:data` once merged.
 */

export const APPROX_RADIUS_M = 150;

export type BBox = [number, number, number, number];
interface Obstacle {
  kind: string;
  g: Feature<Geometry> | Geometry;
  bbox: BBox;
}

const bboxOverlap = (a: BBox, b: BBox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** Lot rectangle (front × depth metres) centred on `center`, north-aligned unless `bearingDeg` is given. */
export function lotRectangle(center: [number, number], frontM: number, depthM: number, bearingDeg = 0): Polygon {
  const move = (from: number[], dist: number, bearing: number) =>
    turfDestination(point(from), Math.abs(dist), dist < 0 ? bearing + 180 : bearing, { units: 'meters' }).geometry
      .coordinates;
  const corners = [
    [-frontM / 2, -depthM / 2],
    [frontM / 2, -depthM / 2],
    [frontM / 2, depthM / 2],
    [-frontM / 2, depthM / 2],
  ].map(([a, p]) => {
    const [x, y] = move(move(center, a, bearingDeg + 90), p, bearingDeg);
    return [Number(x.toFixed(7)), Number(y.toFixed(7))];
  });
  return polygon([[...corners, corners[0]]]).geometry;
}

/** Front and depth (2.5:1 proportion, like a typical urban lot) for a lot of `areaM2`. */
export function lotSize(areaM2: number): { front: number; depth: number } {
  const front = Math.sqrt(areaM2 / 2.5);
  return { front: Math.round(front * 10) / 10, depth: Math.round(front * 25) / 10 };
}

/** FNV-1a, same as the generator: the offset only depends on the listing id. */
function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Displayed centre for "localização aproximada": 50–149 m from the real one, so the circle always contains it. */
export function approxCenterFor(id: string, trueCenter: [number, number]): [number, number] {
  const h = strHash(id);
  const bearing = (h % 360) - 180;
  const distM = 50 + ((h >>> 9) % 100);
  const [x, y] = turfDestination(point(trueCenter), distM, bearing, { units: 'meters' }).geometry.coordinates;
  return [Number(x.toFixed(6)), Number(y.toFixed(6))];
}

/** Features of the map tiles loaded around a box (see Scene.tileFeaturesIn). */
export type TileQuery = (sourceLayer: string, bbox: BBox) => Feature<Geometry>[];

const TILE_OBSTACLES: [string, string][] = [
  ['buildings', 'um prédio'],
  ['roads', 'uma via'],
  ['water', 'água'],
  ['green', 'uma área verde'],
];

/**
 * Checks a new lot against the region boundary and the mapped buildings, roads, water and green areas.
 * Those come from the vector tiles loaded on screen (the lot is chosen up close, so its tiles are loaded).
 */
export class PlacementChecker {
  constructor(
    private data: AppData,
    private queryTiles: TileQuery,
  ) {}

  private obstaclesNear(bbox: BBox): Obstacle[] {
    return [
      ...TILE_OBSTACLES.flatMap(([layer, kind]) => this.queryTiles(layer, bbox).map((g) => ({ kind, g }))),
      ...this.data.developments.map((d) => ({ kind: `o terreno do ${d.name}`, g: d.footprint })),
    ].map((o) => ({ ...o, bbox: turfBbox(o.g) as BBox }));
  }

  insideBoundary(p: [number, number]): boolean {
    return this.data.boundary.features.some((b) => turfBooleanPointInPolygon(point(p), b));
  }

  /** Why the lot cannot be placed there, or null when it fits. `others`: lots of other listings. */
  lotProblem(lot: Polygon, others: (Polygon | MultiPolygon)[] = []): string | null {
    if (lot.coordinates[0].some((c) => !this.insideBoundary(c as [number, number])))
      return 'O terreno precisa ficar inteiro dentro da região do mapa.';
    const lb = turfBbox(lot) as BBox;
    const hit = this.obstaclesNear(lb).find((o) => bboxOverlap(lb, o.bbox) && turfBooleanIntersects(lot, o.g));
    if (hit) return `O terreno encostaria em ${hit.kind}. Escolha um espaço livre ou diminua a área.`;
    if (others.some((g) => turfBooleanIntersects(lot, g))) return 'O terreno encostaria em outro terreno à venda.';
    return null;
  }
}
