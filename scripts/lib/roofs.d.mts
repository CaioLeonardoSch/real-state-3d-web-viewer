import type { Feature, Polygon } from 'geojson';

export declare const ROOF_PITCH: number;
export declare const EAVE_M: number;
export declare const MIN_RECT_FILL: number;
export interface OrientedRect {
  center: [number, number];
  /** Unit vector of the long side (east, north). */
  axis: [number, number];
  length: number;
  width: number;
  fill: number;
}
export type RoofKind = 'gable' | 'hip' | 'flat' | 'tank';
export function orientedRect(ring: [number, number][], lat0?: number): OrientedRect | null;
export function roofKind(
  props: { osmId: string; 'roof:shape'?: string; residential?: boolean },
  b: { area: number; height: number; floors: number; rect: OrientedRect | null },
): RoofKind;
export function roofShapes(
  osmId: string,
  rect: OrientedRect | null,
  kind: RoofKind,
  height: number,
  lat0?: number,
): Feature<Polygon, { b: number; h: number; v: number }>[];
