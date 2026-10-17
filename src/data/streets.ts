// Streets of the search box ("Bairro ou rua"): the street list built with the map tiles (public/data/ruas.json,
// scripts/build-tiles.mjs), a key that compares street names however they were typed, and the privacy gate for the
// street of a listing. Pure and with type imports only, so Node scripts, the map, the client site and the tests
// can all import it.
import type { Listing } from './types';

/**
 * One street of the list: a name in one place. A street crossing several neighbourhoods has one entry per
 * neighbourhood, and so does a name used for different streets.
 */
export interface StreetEntry {
  /** Name as on the map, e.g. "Rua XV de Novembro". */
  name: string;
  /** Neighbourhood (or district) of this stretch; '' when it has neither. */
  bairro: string;
  city: string;
  /** [west, south, east, north] of its segments (lng/lat). */
  bbox: [number, number, number, number];
  /** A point on the street itself (not the centre of the bbox), for a close-up when the whole street is too long. */
  point: [number, number];
}

const isCoord = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;

function bad(why: string): never {
  throw new Error(`Lista de ruas inválida: ${why}`);
}

/** Reads ruas.json ({ v: 1, places: [bairro, city][], streets: [name, place, w, s, e, n, x, y][] }); throws on a bad file. */
export function parseStreetsFile(raw: unknown): StreetEntry[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('não é um objeto');
  const file = raw as { v?: unknown; places?: unknown; streets?: unknown };
  if (file.v !== 1) bad(`versão ${String(file.v)} desconhecida`);
  if (!Array.isArray(file.places) || !Array.isArray(file.streets)) bad('faltam "places" ou "streets"');
  const places = (file.places as unknown[]).map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || !p[1]) bad(`lugar ${i}`);
    return p as [string, string];
  });
  return (file.streets as unknown[]).map((row, i) => {
    if (!Array.isArray(row) || row.length !== 8) bad(`rua ${i}`);
    const [name, place, w, s, e, n, x, y] = row as unknown[];
    if (typeof name !== 'string' || !name.trim()) bad(`rua ${i}: sem nome`);
    if (typeof place !== 'number' || !Number.isInteger(place) || !places[place]) bad(`rua ${i}: lugar ${String(place)}`);
    if (![w, e, x].every((v) => isCoord(v, 180)) || ![s, n, y].every((v) => isCoord(v, 90))) bad(`rua ${i}: coordenadas`);
    const [west, south, east, north, px, py] = [w, s, e, n, x, y] as number[];
    if (west > east || south > north) bad(`rua ${i}: retângulo invertido`);
    const [bairro, city] = places[place as number];
    return { name: name as string, bairro, city, bbox: [west, south, east, north], point: [px, py] };
  });
}

// ---------------------------------------------------------------- street key

/** Lower case without accents ("Glória" → "gloria"); the same as normalizeName in src/state/filters.ts. */
export const foldName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Type of street (first word), abbreviations included. */
const TYPES: Record<string, string> = {
  r: 'rua', rua: 'rua',
  av: 'avenida', ave: 'avenida', avda: 'avenida', avenida: 'avenida',
  tv: 'travessa', trav: 'travessa', travessa: 'travessa',
  serv: 'servidao', svd: 'servidao', servidao: 'servidao',
  al: 'alameda', alameda: 'alameda',
  estr: 'estrada', est: 'estrada', estrada: 'estrada',
  rod: 'rodovia', rodovia: 'rodovia',
  pc: 'praca', pca: 'praca', praca: 'praca',
  lgo: 'largo', largo: 'largo',
  via: 'via',
  vl: 'viela', viela: 'viela',
  bc: 'beco', beco: 'beco',
  lad: 'ladeira', ladeira: 'ladeira',
};
const TYPE_WORDS = new Set(Object.values(TYPES));

/**
 * Titles of the person a street is named after, abbreviated or not, the feminine folded into the masculine
 * ("Prof." = "Professora"). Ambiguous initials ("D.", "S.") are never expanded.
 */
const TITLES: Record<string, string> = {
  dr: 'doutor', dra: 'doutor', doutora: 'doutor',
  prof: 'professor', profa: 'professor', professora: 'professor',
  gen: 'general', cel: 'coronel', cap: 'capitao', ten: 'tenente', maj: 'major', mal: 'marechal', alm: 'almirante',
  brig: 'brigadeiro', cmte: 'comandante', sgt: 'sargento', alf: 'alferes',
  gov: 'governador', governadora: 'governador', pres: 'presidente', presidenta: 'presidente',
  sen: 'senador', senadora: 'senador', dep: 'deputado', deputada: 'deputado', ver: 'vereador', vereadora: 'vereador',
  pref: 'prefeito', prefeita: 'prefeito', eng: 'engenheiro', enga: 'engenheiro', engenheira: 'engenheiro',
  des: 'desembargador', desembargadora: 'desembargador', min: 'ministro', ministra: 'ministro',
  com: 'comendador', comendadora: 'comendador',
  mons: 'monsenhor', pe: 'padre', fr: 'frei', sta: 'santa', sto: 'santo', sr: 'senhor', sra: 'senhora', nsa: 'nossa',
  visc: 'visconde', bar: 'barao', dq: 'duque',
};

/** Number words of dates in street names ("Sete de Setembro" = "7 de Setembro"). */
const NUMBERS: Record<string, number> = {
  primeiro: 1, um: 1, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11,
  doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
  vinte: 20, trinta: 30,
};
const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50 };
/** "xv" → 15; null when the word is not a Roman numeral. */
function roman(w: string): number | null {
  if (!/^[ivxl]+$/.test(w)) return null;
  let total = 0;
  for (let i = 0; i < w.length; i++) {
    const v = ROMAN_VALUES[w[i]];
    total += v < (ROMAN_VALUES[w[i + 1]] ?? 0) ? -v : v;
  }
  return total;
}
/** A day number (1–31) written as a number word, a Roman numeral or digits; null otherwise. One letter is an initial ("V. de Souza"), not a numeral. */
function dayNumber(w: string): number | null {
  const n = /^\d+$/.test(w) ? Number(w) : (NUMBERS[w] ?? (w.length > 1 ? roman(w) : null));
  return n !== null && n >= 1 && n <= 31 ? n : null;
}
const STOP_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/** Words of a folded name: letters and digits only. */
const wordsOf = (folded: string) => folded.split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Key that compares street names however they were typed: "R. XV de Novembro", "RUA 15 DE NOVEMBRO, 1208" and
 * "Rua Quinze de Novembro" all give "rua 15 novembro". Accents and case are folded; anything after a comma, a
 * " - " or inside parentheses goes, and so does a trailing house number ("nº 1234", " 1234", "s/n"); the street
 * type and the titles are written in full (r → rua, dr → doutor); day numbers before "de" become digits; de, da,
 * do, das, dos and e are dropped. The type and the titles stay in the key: "Rua Blumenau" is not "Estrada
 * Blumenau", and "Rua Monsenhor Gercino" is not "Rua Major Gercino".
 */
export function streetKey(raw: string): string {
  const s = foldName(raw)
    .replace(/[‐-―−]/g, '-')
    .replace(/,.*$/s, '')
    .replace(/(\s-|-\s).*$/s, '')
    .replace(/\([^)]*\)?/g, ' ');
  let t = wordsOf(s);
  if (!t.length) return '';
  if (TYPES[t[0]]) t[0] = TYPES[t[0]];
  const typed = TYPE_WORDS.has(t[0]);
  // a house number at the end ("… 1234", "… nº 12a", "… s/n"; not "BR-101"), unless it is all that follows the type ("Rua 15")
  const minLength = typed ? 2 : 1;
  const tail = s.trim();
  if (/\ss\/?n\.?$/.test(tail) && t.length >= minLength + 2) t = t.slice(0, -2);
  else if (/\s(?:(?:n|no|nr|num|numero)[\s.°º]*)?\d+[a-z]?$/.test(tail)) {
    const cut = /^(n|no|nr|num|numero)$/.test(t[t.length - 2] ?? '') ? t.length - 2 : t.length - 1;
    if (cut >= minLength) t = t.slice(0, cut);
  }
  t = t.map((w, i) => (i === 0 && typed ? w : (TITLES[w] ?? w)));
  // day numbers before "de": "vinte e cinco de agosto" → "25 de agosto", "xv de novembro" → "15 de novembro"
  const out: string[] = [];
  for (let i = 0; i < t.length; i++) {
    const w = t[i];
    const tens = w === 'vinte' ? 20 : w === 'trinta' ? 30 : 0;
    const unit = tens && t[i + 1] === 'e' ? NUMBERS[t[i + 2]] : undefined;
    if (unit !== undefined && unit < 10 && t[i + 3] === 'de') {
      out.push(String(tens + unit));
      i += 2;
      continue;
    }
    const day = t[i + 1] === 'de' ? dayNumber(w) : null;
    out.push(day !== null ? String(day) : /^\d+$/.test(w) ? String(Number(w)) : w);
  }
  const kept = out.filter((w) => !STOP_WORDS.has(w));
  // "Rua E" keeps its name
  return (kept.length > (typed ? 1 : 0) ? kept : out).join(' ');
}

/** Whether a street name starts with its type ("Rua", "Av.", "Servidão"…). */
export const hasStreetType = (name: string) => TYPE_WORDS.has(streetKey(name).split(' ')[0]);

// ---------------------------------------------------------------- listings

/**
 * Street of a listing as the public sees it: only when its address shows the street ('full' or 'street'). A
 * missing display counts as 'neighborhood', as in addressLabel. Every street comparison and count goes through
 * this gate, so a hidden street never shows through a filter or a number.
 */
export function publicStreet(l: Pick<Listing, 'address' | 'addressDisplay'>): string | null {
  const display = l.addressDisplay ?? 'neighborhood';
  if (display !== 'full' && display !== 'street') return null;
  return l.address?.street?.trim() || null;
}

const keyCache = new Map<string, string>();
const cachedKey = (s: string) => {
  let k = keyCache.get(s);
  if (k === undefined) {
    if (keyCache.size > 2000) keyCache.clear();
    keyCache.set(s, (k = streetKey(s)));
  }
  return k;
};

/**
 * Whether a listing's street text names the street of the search (`criterionName`, the name on the map). Equal
 * keys match; a listing written without the type ("Gen. Andrade Neves") also matches the street with a type
 * ("Rua General Andrade Neves").
 */
export function sameStreet(listingStreet: string, criterionName: string): boolean {
  const a = cachedKey(listingStreet);
  const b = cachedKey(criterionName);
  if (!a || !b) return false;
  if (a === b) return true;
  const space = b.indexOf(' ');
  return space > 0 && !TYPE_WORDS.has(a.split(' ')[0]) && TYPE_WORDS.has(b.slice(0, space)) && b.slice(space + 1) === a;
}

// ---------------------------------------------------------------- suggestions of the search box

interface QueryWords {
  /** Street type typed first ("rua xv", "av. get"), or null. */
  type: string | null;
  /** Each word with its readings ("dr" → also "doutor", "quinze" → also "15"). */
  words: string[][];
}

function parseQuery(query: string, stripType: boolean): QueryWords {
  const folded = foldName(query);
  let words = wordsOf(folded);
  let type: string | null = null;
  // the type counts once something follows it ("rua " or "rua x"); "rua" alone may still be the start of a word
  if (stripType && words.length && TYPES[words[0]] && (words.length > 1 || /[\s.]$/.test(query))) {
    type = TYPES[words[0]];
    words = words.slice(1);
  }
  const significant = words.filter((w) => !STOP_WORDS.has(w));
  if (significant.length) words = significant;
  return {
    type,
    words: words.map((w) => {
      const alt = [w];
      if (TITLES[w]) alt.push(TITLES[w]);
      const n = dayNumber(w);
      if (n !== null && String(n) !== w) alt.push(String(n));
      return alt;
    }),
  };
}

/**
 * 0: the first word typed starts the name; 1: every word typed starts a different word of it ("sete set" is not
 * "Sete Lagoas"); -1: no match.
 */
function rank(q: QueryWords, words: readonly string[], lead: string): number {
  if (!q.words.length) return -1;
  const used = new Set<number>();
  for (const alt of q.words) {
    const j = words.findIndex((w, i) => !used.has(i) && alt.some((a) => w.startsWith(a)));
    if (j < 0) return -1;
    used.add(j);
  }
  return q.words[0].some((a) => lead.startsWith(a)) ? 0 : 1;
}

/** Neighbourhoods matching what was typed (word starts, accents and case ignored): names that start with it first, then shorter ones. */
export function findBairros(bairros: readonly string[], query: string, limit: number): string[] {
  const q = parseQuery(query, false);
  return bairros
    .map((name, i) => {
      const words = wordsOf(foldName(name));
      return { name, i, r: rank(q, words, words.find((w) => !STOP_WORDS.has(w)) ?? '') };
    })
    .filter((b) => b.r >= 0)
    .sort((a, b) => a.r - b.r || a.name.length - b.name.length || a.i - b.i)
    .slice(0, limit)
    .map((b) => b.name);
}

interface PreparedStreet {
  entry: StreetEntry;
  order: number;
  type: string | null;
  /** Words of the name without its type, plus the words of its key ("xv" and "15"). */
  words: string[];
  /** First significant word after the type ("Rua das Oliveiras" → "oliveiras"). */
  lead: string;
  bairro: string;
  key: string;
}

/**
 * One suggestion per name and place. The list has one entry per name and place, so this only guards against a
 * file with the same name and place twice, which would read as the same option twice: those become one entry
 * covering both (the point stays the first one's, on the street). The place is the neighbourhood and the city,
 * so entries of different places are never merged.
 */
function mergeSamePlace(entries: readonly StreetEntry[]): StreetEntry[] {
  const byPlace = new Map<string, StreetEntry>();
  for (const e of entries) {
    const id = `${e.name}\u0000${e.bairro}\u0000${e.city}`;
    const seen = byPlace.get(id);
    if (!seen) byPlace.set(id, e);
    else {
      const [w, s, east, n] = seen.bbox;
      const b = e.bbox;
      byPlace.set(id, { ...seen, bbox: [Math.min(w, b[0]), Math.min(s, b[1]), Math.max(east, b[2]), Math.max(n, b[3])] });
    }
  }
  return [...byPlace.values()];
}

/**
 * Finds streets of the list by what was typed: word starts, ignoring the street type, so "xv" and "oliveiras"
 * both work ("rua xv" keeps only "Rua …"). Streets whose name starts with the first word typed come first, then
 * shorter names. The list is prepared once.
 */
export class StreetFinder {
  // plain fields, no parameter properties: Node imports this file with type stripping only
  readonly entries: readonly StreetEntry[];
  private items: PreparedStreet[];

  constructor(entries: readonly StreetEntry[]) {
    this.entries = entries;
    this.items = mergeSamePlace(entries).map((entry, order) => {
      let words = wordsOf(foldName(entry.name));
      const type = TYPES[words[0]] ?? null;
      if (type) words = words.slice(1);
      const lead = words.find((w) => !STOP_WORDS.has(w)) ?? words[0] ?? '';
      const key = streetKey(entry.name);
      const extra = key.split(' ').filter((w) => !words.includes(w) && w !== type);
      return { entry, order, type, words: [...words, ...extra], lead, bairro: foldName(entry.bairro), key };
    });
  }

  /** At most `limit` streets; `inBairros` (any spelling) keeps only streets in those neighbourhoods. */
  find(query: string, limit: number, inBairros: readonly string[] = []): StreetEntry[] {
    const q = parseQuery(query, true);
    if (!q.words.length) return [];
    const only = inBairros.length ? new Set(inBairros.map(foldName)) : null;
    const found: { s: PreparedStreet; r: number }[] = [];
    for (const s of this.items) {
      if ((q.type && s.type !== q.type) || (only && !only.has(s.bairro))) continue;
      const r = rank(q, s.words, s.lead);
      if (r >= 0) found.push({ s, r });
    }
    return found
      .sort((a, b) => a.r - b.r || a.s.entry.name.length - b.s.entry.name.length || a.s.order - b.s.order)
      .slice(0, limit)
      .map((f) => f.s.entry);
  }

  /**
   * Whether the same street name (by key) is also listed in another place: the same street crossing into another
   * neighbourhood, or another street with the same name.
   */
  inOtherPlaces(street: StreetEntry): boolean {
    const key = streetKey(street.name);
    return this.items.some(({ entry: s, key: k }) => k === key && (s.bairro !== street.bairro || s.city !== street.city));
  }
}
