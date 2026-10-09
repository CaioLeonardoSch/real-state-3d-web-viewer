// Minimal PMTiles v3 writer (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md):
// one file with a header, a gzip-compressed directory, JSON metadata and the tiles, read by the browser
// with HTTP range requests. Identical tiles are stored once. Supports leaf directories when the root
// directory does not fit in the first 16 KiB.
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { zxyToTileId } from 'pmtiles';

const HEADER_BYTES = 127;
const ROOT_LIMIT = 16384 - HEADER_BYTES;
export const COMPRESSION = { none: 1, gzip: 2 };
export const TILE_TYPE = { mvt: 1 };

function varint(out, n) {
  // non-negative integers up to 2^53
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
}

/** Directory entries → bytes (gzip). Entries must be sorted by tileId. */
function serializeDirectory(entries) {
  const b = [];
  varint(b, entries.length);
  let last = 0;
  for (const e of entries) {
    varint(b, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) varint(b, e.runLength);
  for (const e of entries) varint(b, e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    varint(b, i > 0 && e.offset === prev.offset + prev.length ? 0 : e.offset + 1);
  });
  return gzipSync(Buffer.from(b));
}

/** Root (and leaf) directories; leaves only when the root alone would not fit. */
function buildDirectories(entries) {
  const root = serializeDirectory(entries);
  if (root.length <= ROOT_LIMIT) return { root, leaves: Buffer.alloc(0) };
  for (let leafSize = 4096; ; leafSize *= 2) {
    const rootEntries = [];
    const leafBufs = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const leaf = serializeDirectory(entries.slice(i, i + leafSize));
      rootEntries.push({ tileId: entries[i].tileId, offset, length: leaf.length, runLength: 0 });
      leafBufs.push(leaf);
      offset += leaf.length;
    }
    const r = serializeDirectory(rootEntries);
    if (r.length <= ROOT_LIMIT) return { root: r, leaves: Buffer.concat(leafBufs) };
  }
}

/**
 * @param {{ z: number, x: number, y: number, data: Buffer }[]} tiles already compressed with `tileCompression`
 * @param {{ minZoom: number, maxZoom: number, bounds: number[], center: number[], centerZoom: number,
 *   metadata: object, tileCompression?: number }} opts
 * @returns {Buffer}
 */
export function writePmtiles(tiles, opts) {
  const withIds = tiles.map((t) => ({ ...t, tileId: zxyToTileId(t.z, t.x, t.y) })).sort((a, b) => a.tileId - b.tileId);
  const entries = [];
  const blobs = [];
  const byHash = new Map();
  let offset = 0;
  for (const t of withIds) {
    const h = createHash('sha1').update(t.data).digest('hex');
    let stored = byHash.get(h);
    if (!stored) {
      stored = { offset, length: t.data.length };
      byHash.set(h, stored);
      blobs.push(t.data);
      offset += t.data.length;
    }
    const prev = entries.at(-1);
    // consecutive ids with the same content collapse into one run
    if (prev && prev.offset === stored.offset && prev.tileId + prev.runLength === t.tileId) prev.runLength++;
    else entries.push({ tileId: t.tileId, offset: stored.offset, length: stored.length, runLength: 1 });
  }
  const tileData = Buffer.concat(blobs);
  const { root, leaves } = buildDirectories(entries);
  const metadata = gzipSync(Buffer.from(JSON.stringify(opts.metadata)));

  const rootOffset = HEADER_BYTES;
  const metaOffset = rootOffset + root.length;
  const leavesOffset = metaOffset + metadata.length;
  const dataOffset = leavesOffset + leaves.length;
  const h = Buffer.alloc(HEADER_BYTES);
  h.write('PMTiles', 0, 'ascii');
  h.writeUInt8(3, 7);
  const u64 = (pos, n) => h.writeBigUInt64LE(BigInt(n), pos);
  u64(8, rootOffset);
  u64(16, root.length);
  u64(24, metaOffset);
  u64(32, metadata.length);
  u64(40, leavesOffset);
  u64(48, leaves.length);
  u64(56, dataOffset);
  u64(64, tileData.length);
  u64(72, withIds.length);
  u64(80, entries.length);
  u64(88, blobs.length);
  h.writeUInt8(1, 96); // clustered: tiles are written in tileId order
  h.writeUInt8(COMPRESSION.gzip, 97);
  h.writeUInt8(opts.tileCompression ?? COMPRESSION.gzip, 98);
  h.writeUInt8(TILE_TYPE.mvt, 99);
  h.writeUInt8(opts.minZoom, 100);
  h.writeUInt8(opts.maxZoom, 101);
  const e7 = (v) => Math.round(v * 1e7);
  h.writeInt32LE(e7(opts.bounds[0]), 102);
  h.writeInt32LE(e7(opts.bounds[1]), 106);
  h.writeInt32LE(e7(opts.bounds[2]), 110);
  h.writeInt32LE(e7(opts.bounds[3]), 114);
  h.writeUInt8(opts.centerZoom, 118);
  h.writeInt32LE(e7(opts.center[0]), 119);
  h.writeInt32LE(e7(opts.center[1]), 123);
  return Buffer.concat([h, root, metadata, leaves, tileData]);
}
