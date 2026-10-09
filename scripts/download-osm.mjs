#!/usr/bin/env node
// Downloads the Santa Catarina OpenStreetMap extract (≈140 MB) to .cache/osm-pbf/ and checks its MD5.
// Source: OpenStreetMap France extracts (updated daily). Skips the download when the file is current.
// Behind a proxy, Node's fetch needs NODE_USE_ENV_PROXY=1.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, '.cache', 'osm-pbf');
const URL_ = 'https://download.openstreetmap.fr/extracts/south-america/brazil/south/santa-catarina-latest.osm.pbf';
const FILE = path.join(DIR, 'santa-catarina-latest.osm.pbf');
const UA = { 'User-Agent': 'real-state-3d-web-viewer-prototype/0.1 (+https://github.com/caioleonardosch/real-state-3d-web-viewer)' };

const md5 = async (f) => createHash('md5').update(await readFile(f)).digest('hex');
const expected = (await (await fetch(URL_.replace('-latest.osm.pbf', '.osm.pbf.md5'), { headers: UA })).text()).split(/\s+/)[0];

await mkdir(DIR, { recursive: true });
if (existsSync(FILE) && !process.argv.includes('--refresh') && (await md5(FILE)) === expected) {
  console.log(`${path.relative(ROOT, FILE)} já está atualizado (md5 ${expected}).`);
  process.exit(0);
}
console.log(`Baixando ${URL_}…`);
const res = await fetch(URL_, { headers: UA });
if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
await pipeline(Readable.fromWeb(res.body), createWriteStream(`${FILE}.part`));
await rename(`${FILE}.part`, FILE);
const got = await md5(FILE);
if (got !== expected) throw new Error(`MD5 não confere: ${got} ≠ ${expected} (o extrato pode ter sido atualizado durante o download; rode de novo)`);
console.log(`OK (md5 ${got})`);
