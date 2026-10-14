export declare const MAX_FLOORS: number;
export declare const MAIN_SHARE: number;
export declare const MIN_RATIO: number;
export declare const TOWER_FLOORS: number;
export declare const TOWER_MIN_AREA_M2: number;
export declare const TOWER_MIN_INSIDE: number;
export declare function floorsForLot(builtArea: number, footprints: number[]): number[] | null;
export declare function shareInside(building: import('geojson').Polygon | import('geojson').MultiPolygon, lot: import('geojson').Polygon | import('geojson').MultiPolygon): number;
