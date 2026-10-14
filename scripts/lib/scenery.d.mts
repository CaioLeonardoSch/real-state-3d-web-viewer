import type { Feature, Geometry, LineString, MultiPolygon, Point, Polygon } from 'geojson';

export type SurfaceClass = 'a' | 'c' | 'p' | 'u' | '';
export function surfaceClass(highway: string, surface: string | undefined): SurfaceClass;
export function frame(lat0: number): { kx: number; ky: number; dx: (m: number) => number; dy: (m: number) => number };
export function rng(seed: number): () => number;
export function hash(str: string): number;
export interface UrbanMask {
  has: (p: [number, number]) => boolean;
  size: number;
  cellW: number;
  cellH: number;
}
export function urbanMask(points: [number, number][], cellM?: number, grow?: number, lat0?: number): UrbanMask;
export function polygonTester(geometry: Polygon | MultiPolygon, buckets?: number): (p: [number, number]) => boolean;
export const TREE_DENSITY: Record<string, { spacing: number; keep: number }>;
export const WOOD_EDGE_STEP_M: number;
export const WOOD_EDGE_INSET_M: number;
export const WOOD_CANOPY_M: number;
export interface TreeSpot {
  x: number;
  y: number;
  kind: 'broad' | 'edge' | 'bush' | 'canopy';
  scale: number;
  mapped?: boolean;
}
export function sampleTrees(
  green: Feature<Polygon | MultiPolygon, { kind: string; osmId?: string }>[],
  osmTrees: Feature<Point | LineString>[],
  mask: UrbanMask,
  options?: { lat0?: number; max?: number },
): TreeSpot[];
export function treeShapes(t: TreeSpot, lat0?: number): Feature<Polygon, { p: string; b: number; h: number; v: number }>[];
export const LAMP_ROADS: Record<string, number>;
export const LAMP_SPACING_M: number;
export const LAMP_HEIGHT_M: number;
export interface LampSpot {
  x: number;
  y: number;
  angle: number;
  mapped?: boolean;
}
export function lampPositions(
  roads: Feature<Geometry, { highway: string; surface?: string; lit?: string; tunnel?: string; bridge?: string; osmId?: string }>[],
  osmLamps: Feature<Point>[],
  mask: UrbanMask,
  lat0?: number,
): LampSpot[];
export function lampShapes(l: LampSpot, lat0?: number): { shapes: Feature<Polygon, { p: string; b: number; h: number }>[]; light: Feature<Point> };
export function simplifyRing(ring: [number, number][], tol: number): [number, number][];
export function simplifyGeometry<G extends Geometry>(g: G, tol: number): G;
