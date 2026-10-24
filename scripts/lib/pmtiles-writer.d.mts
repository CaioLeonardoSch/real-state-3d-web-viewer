export declare const COMPRESSION: { none: number; gzip: number };
export declare const TILE_TYPE: { unknown: number; mvt: number; png: number; webp: number };
export declare function writePmtiles(
  tiles: { z: number; x: number; y: number; data: Uint8Array }[],
  opts: {
    minZoom: number;
    maxZoom: number;
    bounds: number[];
    center: number[];
    centerZoom: number;
    metadata: object;
    tileCompression?: number;
    tileType?: number;
  },
): Uint8Array;
