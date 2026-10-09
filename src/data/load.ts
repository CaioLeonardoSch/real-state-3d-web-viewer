import type { FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';
import { validateListingsFile, type ListingsFile } from './types';
import { validateDevelopmentsFile, type Development } from './developments';

/** meta.json, written by scripts/build-tiles.mjs. */
export interface DataMeta {
  region: string;
  regionName: string;
  bairros: string[];
  center: [number, number];
  boundaryBbox: [number, number, number, number];
  /** Vector tiles file (PMTiles) next to meta.json. */
  tiles: string;
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
  listings: ListingsFile;
  /** Developments with units (empty when the file is missing). */
  developments: Development[];
}

const dataUrl = (name: string) => new URL(`${import.meta.env.BASE_URL}data/${name}`, location.href).href;

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(dataUrl(name));
  if (!res.ok) throw new Error(`Falha ao carregar ${name} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

export async function loadData(): Promise<AppData> {
  const [meta, boundary, bairros, rawListings] = await Promise.all([
    getJson<DataMeta>('meta.json'),
    getJson<AppData['boundary']>('boundary.geojson'),
    getJson<AppData['bairros']>('bairros.geojson'),
    getJson<unknown>('listings.json'),
  ]);
  const listings = validateListingsFile(rawListings);
  // optional layer: the map works without it
  const developments = await getJson<unknown>('developments.json')
    .then((raw) => validateDevelopmentsFile(raw).developments)
    .catch((err: Error) => {
      console.warn(`Empreendimentos indisponíveis: ${err.message}`);
      return [];
    });
  return { meta, boundary, bairros, tilesUrl: dataUrl(meta.tiles), listings, developments };
}
