export const TREE_TILE_ZOOM: number;
export const TREE_BYTES: number;
export const TREE_KINDS: readonly ['broad', 'edge', 'canopy', 'bush'];
export interface TreeRecord {
  lng: number;
  lat: number;
  kind: 'broad' | 'edge' | 'canopy' | 'bush';
  v: number;
  h: number;
  r: number;
  rot: number;
}
export function tileXY(lng: number, lat: number, z?: number): [number, number];
export function encodeTreeTiles(trees: TreeRecord[]): { z: number; x: number; y: number; data: Uint8Array; count: number }[];
export interface DecodedTrees {
  count: number;
  fx: Float32Array;
  fy: Float32Array;
  kind: Uint8Array;
  v: Uint8Array;
  h: Float32Array;
  r: Float32Array;
  rot: Float32Array;
}
export function decodeTreeTile(buffer: ArrayBuffer | Uint8Array): DecodedTrees;
