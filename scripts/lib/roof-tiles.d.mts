import type { RoofRecord } from './roofs.mjs';

export const ROOF_TILE_ZOOM: number;
export const ROOF_BYTES: number;
export const ROOF_KINDS: readonly ['gable', 'hip', 'tank'];
export function encodeRoofTiles(roofs: RoofRecord[]): { z: number; x: number; y: number; data: Uint8Array; count: number }[];
export interface DecodedRoofs {
  count: number;
  fx: Float32Array;
  fy: Float32Array;
  angle: Float32Array;
  kind: Uint8Array;
  v: Uint8Array;
  rise: Float32Array;
  length: Float32Array;
  width: Float32Array;
  base: Float32Array;
  id: Float64Array;
}
export function decodeRoofTile(buffer: ArrayBuffer | Uint8Array): DecodedRoofs;
