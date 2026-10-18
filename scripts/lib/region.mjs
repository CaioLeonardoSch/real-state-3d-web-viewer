// The map region (scripts/data/region.json), for the data pipeline: which OpenStreetMap extract to download, which
// city cadastre gives the heights (null: OSM only) and the default city of the forms. docs/nova-regiao.md explains
// how to prepare another one.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGION = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'data', 'region.json'), 'utf8'));

/** Local copy of the region's OpenStreetMap extract. */
export const osmFile = () => path.join(ROOT, '.cache', 'osm-pbf', path.basename(new URL(REGION.osmExtract).pathname));

/** Cadastres the pipeline can read (scripts/download-cadastre.mjs); another city needs its own downloader. */
export const CADASTRE_SOURCES = ['joinville-simgeo'];
