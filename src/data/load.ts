import type { FeatureCollection, Polygon, MultiPolygon, Geometry } from 'geojson';
import { validateListingsFile, type ListingsFile } from './types';
import { validateDevelopmentsFile, type Development } from './developments';

export interface BuildingProps {
  osmId: string;
  building: string;
  renderHeight: number;
  heightSource: 'height' | 'levels' | 'default';
  [k: string]: unknown;
}

export interface DataMeta {
  center: [number, number];
  boundaryKind: 'administrative' | 'approximate-bbox';
  boundaryBbox: [number, number, number, number];
  counts: Record<string, number>;
}

export interface AppData {
  meta: DataMeta;
  boundary: FeatureCollection<Polygon | MultiPolygon>;
  buildings: FeatureCollection<Polygon | MultiPolygon, BuildingProps>;
  roads: FeatureCollection<Geometry>;
  water: FeatureCollection<Geometry>;
  green: FeatureCollection<Geometry>;
  listings: ListingsFile;
  /** Developments with units (empty when the file is missing). */
  developments: Development[];
}

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok) throw new Error(`Falha ao carregar ${name} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

export async function loadData(): Promise<AppData> {
  const [meta, boundary, buildings, roads, water, green, rawListings] = await Promise.all([
    getJson<DataMeta>('meta.json'),
    getJson<AppData['boundary']>('boundary.geojson'),
    getJson<AppData['buildings']>('buildings.geojson'),
    getJson<AppData['roads']>('roads.geojson'),
    getJson<AppData['water']>('water.geojson'),
    getJson<AppData['green']>('green.geojson'),
    getJson<unknown>('listings.json'),
  ]);
  const buildingIds = new Set(buildings.features.map((f) => f.properties.osmId));
  const listings = validateListingsFile(rawListings, buildingIds);
  // optional layer: the map works without it
  const developments = await getJson<unknown>('developments.json')
    .then((raw) => validateDevelopmentsFile(raw).developments)
    .catch((err: Error) => {
      console.warn(`Empreendimentos indisponíveis: ${err.message}`);
      return [];
    });
  return { meta, boundary, buildings, roads, water, green, listings, developments };
}
