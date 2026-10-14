// Progress of a building under construction, updated about once a month. The map draws the floors already built
// solid and the rest of the building translucent, with a tower crane; the listing shows "12 de 20 andares".
// Who said so matters (the developer, an inspection, aerial imagery), so the source is always shown.

export const CONSTRUCTION_SOURCES = ['anunciante', 'vistoria', 'imagem', 'ilustrativo'] as const;
export type ConstructionSource = (typeof CONSTRUCTION_SOURCES)[number];
export const CONSTRUCTION_SOURCE_LABELS: Record<ConstructionSource, string> = {
  anunciante: 'informado pelo anunciante',
  vistoria: 'vistoria no local',
  imagem: 'estimado por imagem aérea',
  ilustrativo: 'ilustrativo (demonstração)',
};

export interface ConstructionProgress {
  /** Floors with the structure already built (0 = foundations). */
  floorsBuilt: number;
  /** Month of the information, YYYY-MM. */
  updatedAt: string;
  source: ConstructionSource;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "set/2026" from "2026-09". */
export function formatMonth(ym: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym);
  return m ? `${MONTHS[Number(m[2]) - 1]}/${m[1]}` : ym;
}

/** Share built (0–1), given the total number of floors. */
export const builtShare = (p: ConstructionProgress, totalFloors: number) =>
  totalFloors > 0 ? Math.max(0, Math.min(1, p.floorsBuilt / totalFloors)) : 0;

/** "12 de 20 andares (60%)" (or "fundação" when nothing is built yet). */
export function progressLabel(p: ConstructionProgress, totalFloors: number): string {
  if (p.floorsBuilt <= 0) return 'fundação';
  const pct = Math.round(builtShare(p, totalFloors) * 100);
  return `${Math.min(p.floorsBuilt, totalFloors)} de ${totalFloors} ${totalFloors === 1 ? 'andar' : 'andares'} (${pct}%)`;
}

/** A valid progress, or null (data files and the back end are checked the same way). */
export function parseProgress(raw: unknown): ConstructionProgress | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const floors = Number(r.floorsBuilt);
  if (!Number.isInteger(floors) || floors < 0 || floors > 200) return null;
  if (typeof r.updatedAt !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.updatedAt)) return null;
  const source = CONSTRUCTION_SOURCES.includes(r.source as ConstructionSource) ? (r.source as ConstructionSource) : 'anunciante';
  return { floorsBuilt: floors, updatedAt: r.updatedAt, source };
}

/** Months since the information (to flag old progress: the map is only as current as its data). */
export function monthsOld(p: ConstructionProgress, today = new Date()): number {
  const [y, m] = p.updatedAt.split('-').map(Number);
  return (today.getFullYear() - y) * 12 + (today.getMonth() + 1 - m);
}
