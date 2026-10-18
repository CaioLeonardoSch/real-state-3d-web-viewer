// Conversion between the database rows of the sales mirror (supabase/migrations/20261030000001_developments.sql)
// and the app's Development. Pure functions, unit-tested; scripts/upload-developments.mjs uses the other direction.
import type { Polygon } from 'geojson';
import { parseProgress } from '../data/construction.ts';
import type { DevStage, Development, Level, LevelUse, Unit, UnitStatus } from '../data/developments';

/** Row of public.public_developments (or public.developments for the team). */
export interface DevelopmentRow {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  developer: string;
  address: string;
  stage: DevStage;
  delivery: string;
  show_prices: boolean;
  layout: DevelopmentLayout;
  info: DevelopmentInfo;
  progress: unknown;
  published?: boolean;
  reservation_hours?: number;
}

/** Row of public.public_development_units (the team's rows have more columns). */
export interface UnitRow {
  id: string;
  development_id: string;
  tower: string;
  floor: number;
  number: string;
  plan: string;
  area_m2: number | string;
  bedrooms: number;
  suites: number;
  parking_spots: number;
  shape: number;
  cells: number;
  price: number | string | null;
  status: UnitStatus;
}

/** The tower as drawn: everything of Development that is not sales nor text. */
export interface DevelopmentLayout {
  location: [number, number];
  center: [number, number];
  footprint: Polygon;
  grid: { cols: number; rows: number };
  shapes: { polygon: Polygon; facing: number }[];
  hiddenBuildingIds: string[];
  floorHeightM: number;
  levels: { level: number; use: LevelUse; base: number; top: number }[];
}

export interface DevelopmentInfo {
  facts?: string[];
  estimates?: string[];
  sources?: { label: string; url: string }[];
  locationNote?: string;
}

const isPoint = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));

/** The drawing can be shown on the map (a broken row is left out instead of breaking the whole map). */
export function hasDrawing(L: unknown): L is DevelopmentLayout {
  const l = L as Partial<DevelopmentLayout> | null;
  return (
    !!l &&
    isPoint(l.location) &&
    isPoint(l.center) &&
    l.footprint?.type === 'Polygon' &&
    !!l.grid &&
    Array.isArray(l.shapes) &&
    Array.isArray(l.levels) &&
    Array.isArray(l.hiddenBuildingIds) &&
    typeof l.floorHeightM === 'number'
  );
}

/** Id of a unit in the app (and in the address bar): readable and stable, e.g. "cora-1502" or "vista-b-1502". */
export const unitAppId = (slug: string, tower: string, number: string) =>
  `${slug}-${tower ? `${tower.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-` : ''}${number}`;

/** Final of a unit number on its floor: "1502" on the 15th → 2. */
export function unitFinal(number: string, floor: number): number {
  const rest = number.startsWith(String(floor)) ? number.slice(String(floor).length) : number;
  const n = parseInt(rest.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

const num = (v: number | string | null): number | null => (v === null || v === '' ? null : Number(v));

/** Development of the map from its rows; units outside the drawing (no level or shape) are left out. */
export function rowsToDevelopment(d: DevelopmentRow, units: UnitRow[]): Development {
  const L = d.layout;
  const levels: Level[] = L.levels.map((l) => ({ ...l, units: [] }));
  const byLevel = new Map(levels.map((l) => [l.level, l]));
  const sorted = [...units].sort((a, b) => a.tower.localeCompare(b.tower) || a.floor - b.floor || a.number.localeCompare(b.number, 'pt-BR', { numeric: true }));
  for (const r of sorted) {
    const level = byLevel.get(r.floor);
    if (!level || !L.shapes[r.shape]) continue;
    const u: Unit = {
      id: unitAppId(d.slug, r.tower, r.number),
      dbId: r.id,
      number: r.number,
      final: unitFinal(r.number, r.floor),
      plan: r.plan,
      areaM2: Number(r.area_m2),
      bedrooms: r.bedrooms,
      suites: r.suites,
      parkingSpots: r.parking_spots,
      shape: r.shape,
      cells: r.cells,
      price: num(r.price),
      status: r.status,
      ...(r.tower ? { tower: r.tower } : {}),
    };
    level.units.push(u);
  }
  const progress = parseProgress(d.progress);
  return {
    id: d.slug,
    name: d.name,
    developer: d.developer,
    address: d.address,
    location: L.location,
    locationNote: d.info.locationNote ?? '',
    stage: d.stage,
    delivery: d.delivery,
    floorHeightM: L.floorHeightM,
    facts: d.info.facts ?? [],
    estimates: d.info.estimates ?? [],
    sources: d.info.sources ?? [],
    footprint: L.footprint,
    center: L.center,
    grid: L.grid,
    shapes: L.shapes,
    hiddenBuildingIds: L.hiddenBuildingIds,
    levels,
    ...(progress ? { progress } : {}),
    backend: { id: d.id, orgId: d.org_id, showPrices: d.show_prices },
  };
}

/** Database row of a drawn development (scripts/upload-developments.mjs): drawing, texts and progress. */
export function developmentRow(d: Development) {
  return {
    slug: d.id,
    name: d.name,
    developer: d.developer,
    address: d.address,
    stage: d.stage,
    delivery: d.delivery,
    layout: {
      location: d.location,
      center: d.center,
      footprint: d.footprint,
      grid: d.grid,
      shapes: d.shapes,
      hiddenBuildingIds: d.hiddenBuildingIds,
      floorHeightM: d.floorHeightM,
      levels: d.levels.map(({ level, use, base, top }) => ({ level, use, base, top })),
    } satisfies DevelopmentLayout,
    info: { facts: d.facts, estimates: d.estimates, sources: d.sources, locationNote: d.locationNote } satisfies DevelopmentInfo,
    progress: d.progress ?? null,
  };
}

/**
 * Unit rows of a drawn development. Without `withSales` they start available and without price (the developer fills
 * them in); with it, price and status come from the file (a reservation gets the development's deadline).
 */
export function unitRows(d: Development, withSales: boolean, reservationHours = 24, now = new Date()) {
  return d.levels.flatMap((l) =>
    l.units.map((u) => ({
      tower: u.tower ?? '',
      floor: l.level,
      number: u.number,
      plan: u.plan,
      area_m2: u.areaM2,
      bedrooms: u.bedrooms,
      suites: u.suites,
      parking_spots: u.parkingSpots,
      shape: u.shape,
      cells: u.cells,
      price: withSales ? u.price : null,
      status: withSales ? u.status : ('available' as UnitStatus),
      reserved_until: withSales && u.status === 'reserved' ? new Date(now.getTime() + reservationHours * 3600_000).toISOString() : null,
    })),
  );
}
