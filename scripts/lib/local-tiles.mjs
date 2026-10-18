// Local copy of the published map tiles, for the scripts that read them (import of feeds, the monthly comparison).
// meta.json names either a file of public/data or, once the tiles live in the back end's bucket (scripts/upload-tiles.mjs),
// its URL: then the file is downloaded to public/data/<região>[-detalhe].pmtiles unless the copy there is already that
// version (the name carries the first 10 hex digits of the file's SHA-256).
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Path of the tiles named by `entry` (meta.tiles or meta.detailTiles), downloading them when needed. */
export async function localTiles(dataDir, meta, entry = meta.tiles, suffix = '') {
  if (!/^https?:\/\//.test(entry)) return path.join(dataDir, entry);
  const file = path.join(dataDir, `${meta.region}${suffix}.pmtiles`);
  const want = /-([0-9a-f]{10})\.pmtiles$/.exec(entry)?.[1];
  const have = await readFile(file).then((b) => createHash('sha256').update(b).digest('hex').slice(0, 10)).catch(() => null);
  if (want && have === want) return file;
  const res = await fetch(entry);
  if (!res.ok) throw new Error(`${entry}: ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.error(`Baixado ${entry} → ${path.relative(process.cwd(), file)}`);
  return file;
}

// node scripts/lib/local-tiles.mjs: prints the path of the published base map tiles (the monthly workflow)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = path.join(process.cwd(), 'public', 'data');
  console.log(await localTiles(dir, JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'))));
}
