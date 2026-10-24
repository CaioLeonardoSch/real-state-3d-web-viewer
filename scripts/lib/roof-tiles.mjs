// Roofs of the 3D map as tiles of plain numbers (<região>-telhados.pmtiles): each z15 tile lists the roofs whose
// middle stands in it, 18 bytes a roof, and the map stretches one model per kind over each (src/map/cityRoofs.ts).
// Read by the build (scripts/build-tiles.mjs) and by the map: one description of the bytes for both.
//
// Per roof, little-endian:
//   0–1    x: the roof's middle in the tile, west → east, 0–65535
//   2–3    y: north → south, 0–65535
//   4–5    turn of the long side, radians from east towards north, 0–π in 65536 steps
//   6      kind (ROOF_KINDS index) × 4 + colour v (0–3)
//   7      rise above the walls, decimetres
//   8–9    length, centimetres (eaves included)
//   10–11  width, centimetres
//   12–13  height of the walls (the roof's base), decimetres
//   14–17  the building's numeric id (src/data/osmId.ts)
import { tileXY } from './tree-tiles.mjs';

export const ROOF_TILE_ZOOM = 15;
export const ROOF_BYTES = 18;
export const ROOF_KINDS = ['gable', 'hip', 'tank'];

const clamp16 = (v) => Math.max(0, Math.min(65535, Math.round(v)));

/**
 * Roofs ({ lng, lat, angle, kind, v, length, width, rise, base, id }) → one byte buffer per z15 tile, as
 * { z, x, y, data, count } (data not compressed), in a stable order so the same roofs give the same bytes.
 */
export function encodeRoofTiles(roofs) {
  const byTile = new Map();
  for (const r of roofs) {
    const [fx, fy] = tileXY(r.lng, r.lat, ROOF_TILE_ZOOM);
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const key = `${x}/${y}`;
    let list = byTile.get(key);
    if (!list) byTile.set(key, (list = { x, y, items: [] }));
    list.items.push({ r, px: Math.min(65535, Math.floor((fx - x) * 65536)), py: Math.min(65535, Math.floor((fy - y) * 65536)) });
  }
  const out = [];
  for (const { x, y, items } of byTile.values()) {
    items.sort((a, b) => a.py - b.py || a.px - b.px || a.r.id - b.r.id);
    const data = Buffer.alloc(items.length * ROOF_BYTES);
    items.forEach(({ r, px, py }, i) => {
      const o = i * ROOF_BYTES;
      const kind = ROOF_KINDS.indexOf(r.kind);
      if (kind < 0) throw new Error(`telhado de tipo desconhecido: ${r.kind}`);
      if (!(r.id >= 0 && r.id < 2 ** 32)) throw new Error(`id de prédio fora de 32 bits: ${r.id}`);
      const turn = ((r.angle % Math.PI) + Math.PI) % Math.PI;
      data.writeUInt16LE(px, o);
      data.writeUInt16LE(py, o + 2);
      data.writeUInt16LE(Math.round((turn / Math.PI) * 65536) & 65535, o + 4);
      data.writeUInt8(kind * 4 + (r.v & 3), o + 6);
      data.writeUInt8(Math.max(0, Math.min(255, Math.round(r.rise * 10))), o + 7);
      data.writeUInt16LE(clamp16(r.length * 100), o + 8);
      data.writeUInt16LE(clamp16(r.width * 100), o + 10);
      data.writeUInt16LE(clamp16(r.base * 10), o + 12);
      data.writeUInt32LE(r.id, o + 14);
    });
    out.push({ z: ROOF_TILE_ZOOM, x, y, data, count: items.length });
  }
  return out.sort((a, b) => a.x - b.x || a.y - b.y);
}

/**
 * One tile's bytes → its roofs: fx, fy (0–1 within the tile, from its north-west corner), angle (radians), kind
 * (ROOF_KINDS index), v, length, width, rise and base (metres), id.
 */
export function decodeRoofTile(buffer) {
  const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer instanceof ArrayBuffer ? 0 : buffer.byteOffset, buffer.byteLength);
  const n = Math.floor(view.byteLength / ROOF_BYTES);
  const out = {
    count: n,
    fx: new Float32Array(n),
    fy: new Float32Array(n),
    angle: new Float32Array(n),
    kind: new Uint8Array(n),
    v: new Uint8Array(n),
    rise: new Float32Array(n),
    length: new Float32Array(n),
    width: new Float32Array(n),
    base: new Float32Array(n),
    id: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const o = i * ROOF_BYTES;
    out.fx[i] = (view.getUint16(o, true) + 0.5) / 65536;
    out.fy[i] = (view.getUint16(o + 2, true) + 0.5) / 65536;
    out.angle[i] = (view.getUint16(o + 4, true) / 65536) * Math.PI;
    const kv = view.getUint8(o + 6);
    out.kind[i] = kv >> 2;
    out.v[i] = kv & 3;
    out.rise[i] = view.getUint8(o + 7) / 10;
    out.length[i] = view.getUint16(o + 8, true) / 100;
    out.width[i] = view.getUint16(o + 10, true) / 100;
    out.base[i] = view.getUint16(o + 12, true) / 10;
    out.id[i] = view.getUint32(o + 14, true);
  }
  return out;
}
