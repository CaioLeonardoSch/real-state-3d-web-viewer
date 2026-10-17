import type { Feature, FeatureCollection, Geometry, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';

/** Characters the map's labels cannot draw (outside the Latin-1 glyph range). */
export const OUTSIDE_FONT: RegExp;
export function displayName(raw: string | null | undefined): string;
export const NOT_ADDRESS_ROADS: Set<string>;
export function isAddressRoad(highway: string | null | undefined): boolean;
export function roadMergeKey(p: { name?: string; highway: string; s?: string }): string | null;
export function mergeLines<G extends Geometry | null, P>(
  features: Feature<G, P>[],
  keyOf: (p: P) => string | null | undefined,
): Feature<G | LineString, P>[];
export function lineLengthM(g: Geometry | null | undefined, lat0?: number): number;
export function lineMiddle(g: Geometry | null | undefined, lat0?: number): [number, number] | null;

export type RoadFeature = Feature<LineString | MultiLineString, { highway: string; name?: string }>;

/** Areas of the region: kind 'bairro' (default), 'distrito' or 'cidade'. */
export type AreaFeature = Feature<Polygon | MultiPolygon, { name: string; kind?: string }>;
/** [bairro (or distrito, or ''), city]. */
export type Place = [string, string];
export function placeLocator(areas: FeatureCollection<Polygon | MultiPolygon, { name: string; kind?: string }> | AreaFeature[]): (p: Position) => Place | null;
export type Locate = (p: Position) => Place | null;
/** A stretch of a line inside one place: the line's own points plus the points where it crosses the borders. */
export interface PlaceStretch {
  place: Place;
  line: Position[];
}
export function splitByPlace(line: Position[], locate: Locate, options?: { stepM?: number; lat0?: number }): PlaceStretch[];
/** The stretches of one street name in one place within `gapM` of each other (runs: joined where they continue). */
export interface StreetPart {
  name: string;
  place: Place;
  lengthM: number;
  runs: Position[][];
}
export function streetParts(roads: RoadFeature[], locate: Locate, options?: { gapM?: number; stepM?: number; lat0?: number }): StreetPart[];

/** [name, placeIndex, west, south, east, north, x, y] */
export type StreetEntry = [string, number, number, number, number, number, number, number];
export interface StreetIndex {
  v: 1;
  places: Place[];
  streets: StreetEntry[];
}
export function streetIndex(
  roads: RoadFeature[],
  areas: FeatureCollection<Polygon | MultiPolygon, { name: string; kind?: string }> | AreaFeature[],
  options?: { gapM?: number; tailM?: number; stepM?: number; lat0?: number },
): StreetIndex;
export function streetIndexJson(index: StreetIndex): string;
