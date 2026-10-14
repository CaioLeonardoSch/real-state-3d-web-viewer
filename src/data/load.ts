import type { FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';
import { validateListingsFile, type ListingsFile } from './types';
import { DEMO } from './demo';
import { validateDevelopmentsFile, type Development } from './developments';

/** meta.json, written by scripts/build-tiles.mjs. */
export interface DataMeta {
  region: string;
  regionName: string;
  bairros: string[];
  center: [number, number];
  boundaryBbox: [number, number, number, number];
  /** Vector tiles file (PMTiles) next to meta.json (or an absolute https URL). */
  tiles: string;
  /** Close-up detail (roofs, trees, street lamps), same rules. */
  detailTiles?: string;
  osmTimestamp: string;
  counts: Record<string, number>;
  /** Where building heights come from (OSM; the city cadastre when it was used). */
  heightSources?: string[];
}

export interface AppData {
  meta: DataMeta;
  /** Outline of the mapped region (union of its neighbourhoods). */
  boundary: FeatureCollection<Polygon | MultiPolygon>;
  /** One label point per neighbourhood, district and city. */
  bairros: FeatureCollection<Point, { name: string; kind?: 'bairro' | 'distrito' | 'cidade' }>;
  /** Absolute URL of the PMTiles archive (buildings, roads, water, green, neighbourhood outlines). */
  tilesUrl: string;
  /** Absolute URL of the close-up detail archive, when there is one. */
  detailUrl: string | null;
  listings: ListingsFile;
  /** Developments with units (empty when the file is missing). */
  developments: Development[];
}

const NO_DEMO_LISTINGS: ListingsFile = { fictional: true, notice: '', seed: 0, agencies: [], listings: [] };

const dataUrl = (name: string) => new URL(`${import.meta.env.BASE_URL}data/${name}`, location.href).href;

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(dataUrl(name));
  if (!res.ok) throw new Error(`Falha ao carregar ${name} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

/** Neighbourhood areas (simplified polygons, scripts/build-tiles.mjs), loaded only when a "bairro" filter is used. */
export type BairroAreas = FeatureCollection<Polygon | MultiPolygon, { name: string; grown?: Polygon | MultiPolygon }>;
let bairroAreas: Promise<BairroAreas> | null = null;
export function loadBairroAreas(): Promise<BairroAreas> {
  bairroAreas ??= getJson<BairroAreas>('bairros-areas.geojson').catch((err: Error) => {
    bairroAreas = null;
    throw err;
  });
  return bairroAreas;
}

export async function loadData(): Promise<AppData> {
  const [meta, boundary, bairros, rawListings] = await Promise.all([
    getJson<DataMeta>('meta.json'),
    getJson<AppData['boundary']>('boundary.geojson'),
    getJson<AppData['bairros']>('bairros.geojson'),
    DEMO ? getJson<unknown>('listings.json') : Promise.resolve(NO_DEMO_LISTINGS),
  ]);
  const listings = validateListingsFile(rawListings);
  // optional layer: the map works without it
  const developments = DEMO
    ? await getJson<unknown>('developments.json')
        .then((raw) => validateDevelopmentsFile(raw).developments)
        .catch((err: Error) => {
          console.warn(`Empreendimentos indisponíveis: ${err.message}`);
          return [];
        })
    : [];
  // the tiles can live elsewhere (object storage, one file per monthly version): an absolute URL in meta.json
  const url = (name: string) => (/^https:\/\//.test(name) ? name : dataUrl(name));
  return { meta, boundary, bairros, tilesUrl: url(meta.tiles), detailUrl: meta.detailTiles ? url(meta.detailTiles) : null, listings, developments };
}
