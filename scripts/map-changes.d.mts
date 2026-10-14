import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

export interface MapBuilding {
  height: number;
  residential: boolean;
  /** [lon, lat] of the building's largest piece in the tiles. */
  center: [number, number];
  size: number;
}
export interface BuildingDiffs {
  added: ({ id: string } & MapBuilding)[];
  removed: ({ id: string } & MapBuilding)[];
  redrawn: { from: string; to: string; center: [number, number]; heightFrom: number; heightTo: number }[];
  changed: { id: string; center: [number, number]; from: number; to: number }[];
}
export declare const HEIGHT_STEP_M: number;
export declare const REDRAWN_M: number;
export function readBuildings(file: string | URL): Promise<Map<string, MapBuilding>>;
export function compareBuildings(before: Map<string, MapBuilding>, after: Map<string, MapBuilding>, lat0?: number): BuildingDiffs;
export function bairroLocator(areas: FeatureCollection<Polygon | MultiPolygon, { name: string }>): (p: [number, number]) => string | null;
export function listingsAffected(
  listings: { id: string; title?: string; referenceCode?: string; buildingOsmId?: string }[],
  developments: { id: string; name: string; hiddenBuildingIds?: string[] }[],
  diffs: BuildingDiffs,
): { id: string; label: string; what: string }[];
export function report(input: {
  diffs: BuildingDiffs;
  beforeMeta: { osmTimestamp?: string; counts?: Record<string, unknown> } | null;
  afterMeta: { osmTimestamp?: string; regionName?: string; region?: string; counts?: Record<string, unknown> } | null;
  bairroOf: (p: [number, number]) => string | null;
  listings?: { id: string; title?: string; referenceCode?: string; buildingOsmId?: string }[];
  developments?: { id: string; name: string; hiddenBuildingIds?: string[] }[];
}): string;
