// Trees of the 3D map as tiles of plain numbers (<região>-arvores.pmtiles): each z15 tile lists the trees standing
// in it, 8 bytes a tree, and the map repeats one low-poly model for each (src/map/cityTrees.ts). Read by the build
// (scripts/build-tiles.mjs) and by the map, so both sides share this one description of the bytes.
//
// Per tree, little-endian:
//   0–1  x: where it stands in the tile, west → east, 0–65535
//   2–3  y: north → south, 0–65535
//   4    kind (TREE_KINDS index) × 4 + crown shade v (0–2)
//   5    height, decimetres (up to 25.5 m)
//   6    crown radius, decimetres
//   7    turn, 256ths of a full turn

export const TREE_TILE_ZOOM = 15;
export const TREE_BYTES = 8;
export const TREE_KINDS = ['broad', 'edge', 'canopy', 'bush'];

const u8 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** Tile x, y (fractional) of a point at zoom z (web mercator). */
export function tileXY(lng, lat, z = TREE_TILE_ZOOM) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lng + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

/**
 * Trees ({ lng, lat, kind, v, h, r, rot }) → one byte buffer per z15 tile, as { z, x, y, data, count } (data not
 * compressed), in a stable order (west to east, then north to south) so the same trees give the same bytes.
 */
export function encodeTreeTiles(trees) {
  const byTile = new Map();
  for (const t of trees) {
    const [fx, fy] = tileXY(t.lng, t.lat);
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const key = `${x}/${y}`;
    let list = byTile.get(key);
    if (!list) byTile.set(key, (list = { x, y, items: [] }));
    list.items.push({ t, px: Math.min(65535, Math.floor((fx - x) * 65536)), py: Math.min(65535, Math.floor((fy - y) * 65536)) });
  }
  const out = [];
  for (const { x, y, items } of byTile.values()) {
    items.sort((a, b) => a.py - b.py || a.px - b.px);
    const data = Buffer.alloc(items.length * TREE_BYTES);
    items.forEach(({ t, px, py }, i) => {
      const o = i * TREE_BYTES;
      const kind = TREE_KINDS.indexOf(t.kind);
      if (kind < 0) throw new Error(`árvore de tipo desconhecido: ${t.kind}`);
      data.writeUInt16LE(px, o);
      data.writeUInt16LE(py, o + 2);
      data.writeUInt8(kind * 4 + (t.v & 3), o + 4);
      data.writeUInt8(u8(t.h * 10), o + 5);
      data.writeUInt8(u8(t.r * 10), o + 6);
      const turn = (((t.rot / (2 * Math.PI)) % 1) + 1) % 1;
      data.writeUInt8(Math.round(turn * 256) & 255, o + 7);
    });
    out.push({ z: TREE_TILE_ZOOM, x, y, data, count: items.length });
  }
  return out.sort((a, b) => a.x - b.x || a.y - b.y);
}

/**
 * One tile's bytes → its trees: fx, fy (0–1 within the tile, from its north-west corner), kind (TREE_KINDS index),
 * v, h and r (metres), rot (radians).
 */
export function decodeTreeTile(buffer) {
  const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer instanceof ArrayBuffer ? 0 : buffer.byteOffset, buffer.byteLength);
  const n = Math.floor(view.byteLength / TREE_BYTES);
  const out = { count: n, fx: new Float32Array(n), fy: new Float32Array(n), kind: new Uint8Array(n), v: new Uint8Array(n), h: new Float32Array(n), r: new Float32Array(n), rot: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const o = i * TREE_BYTES;
    out.fx[i] = (view.getUint16(o, true) + 0.5) / 65536;
    out.fy[i] = (view.getUint16(o + 2, true) + 0.5) / 65536;
    const kv = view.getUint8(o + 4);
    out.kind[i] = kv >> 2;
    out.v[i] = kv & 3;
    out.h[i] = view.getUint8(o + 5) / 10;
    out.r[i] = view.getUint8(o + 6) / 10;
    out.rot[i] = (view.getUint8(o + 7) / 256) * 2 * Math.PI;
  }
  return out;
}
