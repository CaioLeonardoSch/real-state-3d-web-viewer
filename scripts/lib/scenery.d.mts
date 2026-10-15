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
export const BUILDING_CLEARING_M: number;
export const ROAD_HALF_M: Record<string, number>;
export const ROAD_CLEARING_M: number;
/** What trees and the canopy of woods keep clear of (buildings, road carriageways). */
export interface Clearings {
  blocked: (p: [number, number]) => boolean;
  near: (bbox: [number, number, number, number]) => unknown[];
  frame: ReturnType<typeof frame>;
}
export function clearings(
  buildings: Feature<Geometry>[],
  roads: Feature<Geometry, { highway: string; tunnel?: string }>[],
  options?: { lat0?: number; cellM?: number },
): Clearings;
export function cutCanopy<P>(
  canopy: Feature<Polygon | MultiPolygon, P>[],
  index: Clearings,
  minAreaM2?: number,
): { features: Feature<Polygon | MultiPolygon, P>[]; cut: number; failed: number };
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
  options?: { lat0?: number; max?: number; blocked?: (p: [number, number]) => boolean },
): TreeSpot[];
export function treeShapes(t: TreeSpot, lat0?: number): Feature<Polygon, { p: string; b: number; h: number; v: number }>[];
export const LAMP_ROADS: Record<string, number>;
export const LAMP_SPACING_M: number;
export const LAMP_HEIGHT_M: number;
export const SODIUM_SHARE: number;
export interface LampSpot {
  x: number;
  y: number;
  angle: number;
  mapped?: boolean;
  /** Kind of lamp: 'n' neutral white LED (main streets), 'w' warm white LED, 's' sodium. */
  t?: 'n' | 'w' | 's';
  /** Strength of its pool of light. */
  k?: number;
}
export function lampPositions(
  roads: Feature<Geometry, { highway: string; surface?: string; lit?: string; tunnel?: string; bridge?: string; osmId?: string }>[],
  osmLamps: Feature<Point>[],
  mask: UrbanMask,
  lat0?: number,
): LampSpot[];
export function lampShapes(
  l: LampSpot,
  lat0?: number,
): { shapes: Feature<Polygon, { p: string; b: number; h: number; t?: string }>[]; light: Feature<Point, { t?: string; k: number }> };
export function simplifyRing(ring: [number, number][], tol: number): [number, number][];
export function simplifyGeometry<G extends Geometry>(g: G, tol: number): G;
