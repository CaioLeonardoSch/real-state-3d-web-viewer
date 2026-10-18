// The sales mirror as a spreadsheet, both ways: the developer downloads it, edits status and prices in Excel or
// Google Sheets and sends it back (public.import_development_units). Same CSV as the contacts: ";" between
// columns, BOM, no formulas. Reading also takes "," as separator and the column names without accents.
import { csvCell } from './leadsCsv';
import type { UnitStatus } from '../data/developments';

/** A unit as the team sees it (public.team_development_units plus the drawing). */
export interface TeamUnit {
  tower: string;
  floor: number;
  number: string;
  plan: string;
  areaM2: number;
  bedrooms: number;
  suites: number;
  parkingSpots: number;
  price: number | null;
  status: UnitStatus;
  reservedUntil: string | null;
  reservedByName: string | null;
  reservedNote: string | null;
}

/** One row to import: only the number is required; what is missing stays as it is. */
export interface UnitImportRow {
  tower: string;
  number: string;
  plan?: string;
  areaM2?: number;
  bedrooms?: number;
  suites?: number;
  parkingSpots?: number;
  /** null clears the price ("sob consulta"). */
  price?: number | null;
  status?: UnitStatus;
  reservedUntil?: string | null;
}

const HEAD = ['Torre', 'Andar', 'Unidade', 'Planta', 'Área (m²)', 'Quartos', 'Suítes', 'Vagas', 'Preço', 'Situação', 'Reservada até', 'Reservada por', 'Observação da reserva'];
const STATUS_TEXT: Record<UnitStatus, string> = { available: 'Disponível', reserved: 'Reservada', sold: 'Vendida' };

const brNumber = (n: number) => String(n).replace('.', ',');
/** "17/10/2026 14:30" in the region's time. */
const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');

export function unitsCsv(units: TeamUnit[]): string {
  const rows = units.map((u) => [
    u.tower,
    String(u.floor),
    u.number,
    u.plan,
    brNumber(u.areaM2),
    String(u.bedrooms),
    String(u.suites),
    String(u.parkingSpots),
    u.price === null ? '' : brNumber(u.price),
    STATUS_TEXT[u.status],
    u.reservedUntil ? when(u.reservedUntil) : '',
    u.reservedByName ?? '',
    u.reservedNote ?? '',
  ]);
  return `﻿${[HEAD, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

// ------------------------------------------------------------------ reading

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Column name (without accents, units or case) → field. */
const COLUMNS: Record<string, keyof UnitImportRow | 'floor' | 'ignore'> = {
  torre: 'tower',
  bloco: 'tower',
  andar: 'floor',
  unidade: 'number',
  apto: 'number',
  apartamento: 'number',
  numero: 'number',
  planta: 'plan',
  tipologia: 'plan',
  area: 'areaM2',
  'area privativa': 'areaM2',
  quartos: 'bedrooms',
  dormitorios: 'bedrooms',
  suites: 'suites',
  vagas: 'parkingSpots',
  preco: 'price',
  valor: 'price',
  situacao: 'status',
  status: 'status',
  'reservada ate': 'reservedUntil',
  'reservado ate': 'reservedUntil',
  'reservada por': 'ignore',
  'observacao da reserva': 'ignore',
};

const STATUS_WORDS: Record<string, UnitStatus> = {
  disponivel: 'available',
  livre: 'available',
  'a venda': 'available',
  reservada: 'reserved',
  reservado: 'reserved',
  reserva: 'reserved',
  vendida: 'sold',
  vendido: 'sold',
  indisponivel: 'sold',
};

/** Splits CSV text into rows of cells (quotes, "" inside quotes, line breaks inside a quoted cell). */
export function splitCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** "R$ 1.234.567,89", "1234567.89", "1.234.567" → number; "" → null. */
export function parseBrNumber(raw: string): number | null {
  let s = raw.replace(/^'/, '').replace(/r\$|\s|m²|m2/gi, '');
  if (s === '' || s === '-') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** "17/10/2026", "17/10/2026 14:30" (region's time, UTC−03:00) or ISO → ISO; a date alone ends at 23:59. */
export function parseBrDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (br) {
    const [, d, m, y, hh, mm] = br;
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${hh ? `${hh.padStart(2, '0')}:${mm}` : '23:59'}:00-03:00`;
    return Number.isNaN(Date.parse(iso)) ? '' : new Date(iso).toISOString();
  }
  return Number.isNaN(Date.parse(s)) ? '' : new Date(s).toISOString();
}

export interface ParsedUnits {
  rows: UnitImportRow[];
  /** "Linha 5: preço inválido", in the order of the file. */
  errors: string[];
}

/** Reads the spreadsheet; any error means nothing should be sent (the caller shows the list). */
export function parseUnitsCsv(text: string): ParsedUnits {
  const table = splitCsv(text);
  const errors: string[] = [];
  if (table.length < 2) return { rows: [], errors: ['A planilha está vazia (falta a linha de títulos ou as unidades).'] };
  const fields = table[0].map((h) => COLUMNS[plain(h)] ?? null);
  if (!fields.includes('number')) return { rows: [], errors: ['Falta a coluna "Unidade" (o número do apartamento).'] };
  const rows: UnitImportRow[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const row: UnitImportRow = { tower: '', number: '' };
    const err = (msg: string) => errors.push(`Linha ${line}: ${msg}`);
    fields.forEach((f, j) => {
      const v = (cells[j] ?? '').trim();
      if (!f || f === 'floor' || f === 'ignore') return;
      if (f === 'tower') row.tower = v.slice(0, 20);
      else if (f === 'number') row.number = v.replace(/^'/, '');
      else if (f === 'plan') {
        if (v) row.plan = v.slice(0, 60);
      } else if (f === 'status') {
        if (!v) return;
        const st = STATUS_WORDS[plain(v)];
        if (st) row.status = st;
        else err(`situação "${v}" desconhecida (use Disponível, Reservada ou Vendida)`);
      } else if (f === 'reservedUntil') {
        const iso = parseBrDate(v);
        if (iso === '') err(`data "${v}" inválida (use dd/mm/aaaa ou dd/mm/aaaa hh:mm)`);
        else if (iso) row.reservedUntil = iso;
      } else if (f === 'price') {
        const n = parseBrNumber(v);
        if (Number.isNaN(n) || (n !== null && n <= 0)) err(`preço "${v}" inválido`);
        else row.price = n;
      } else {
        if (!v) return;
        const n = parseBrNumber(v);
        const int = f !== 'areaM2';
        if (n === null || Number.isNaN(n) || n < 0 || (int && !Number.isInteger(n)) || (f === 'areaM2' && n <= 0))
          err(`${f === 'areaM2' ? 'área' : f === 'bedrooms' ? 'quartos' : f === 'suites' ? 'suítes' : 'vagas'} "${v}" inválido`);
        else row[f] = n;
      }
    });
    if (!row.number) return err('falta o número da unidade');
    if (!/^[0-9A-Za-z-]{1,12}$/.test(row.number)) return err(`unidade "${row.number}" inválida`);
    const key = `${row.tower}|${row.number}`;
    if (seen.has(key)) return err(`unidade ${row.tower ? `${row.tower} ` : ''}${row.number} repetida`);
    seen.add(key);
    if (row.reservedUntil && row.status !== 'reserved') delete row.reservedUntil;
    if (row.status === 'reserved' && row.reservedUntil && Date.parse(row.reservedUntil) <= Date.now())
      return err('a reserva já venceu (mude a data ou a situação)');
    rows.push(row);
  });
  return { rows, errors };
}
