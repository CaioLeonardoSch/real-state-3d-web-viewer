// Address lookup of the "Anunciar imóvel" form: street + number → a point inside the lot, from the city cadastre
// (public/data/enderecos.json, scripts/build-addresses.mjs).

/** enderecos.json as served. */
export interface AddressFile {
  v: 1;
  origin: [number, number];
  bairros: string[];
  /** [cadastre name, [number, x, y, bairro index, built m²][]] */
  streets: [string, [number, number, number, number, number][]][];
}

export interface AddressIndex {
  origin: [number, number];
  bairros: string[];
  /** Normalized key → streets with that key (rarely more than one). */
  byKey: Map<string, AddressFile['streets'][number][]>;
  keys: string[];
}

export type Located =
  | { kind: 'found'; exact: boolean; street: string; number: number; bairro: string; point: [number, number]; builtM2: number }
  | { kind: 'no-street' }
  /** `near`: the lot of the street with the nearest number (for an approximate place). */
  | { kind: 'no-number'; street: string; near: [number, number] };

const TYPE_WORDS = new Set(['RUA', 'R', 'AV', 'AVENIDA', 'TRAVESSA', 'TV', 'TRAV', 'ESTRADA', 'EST', 'RODOVIA', 'ROD', 'ALAMEDA', 'AL', 'PRACA', 'PC', 'SERVIDAO', 'SERV', 'SD', 'VIELA', 'LARGO']);
const STOP = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'D']);
const ABBREV: Record<string, string> = {
  DR: 'DOUTOR', DRA: 'DOUTORA', PROF: 'PROFESSOR', PROFA: 'PROFESSORA', PRES: 'PRESIDENTE', SEN: 'SENADOR',
  GOV: 'GOVERNADOR', CEL: 'CORONEL', GAL: 'GENERAL', GEN: 'GENERAL', ENG: 'ENGENHEIRO', MAL: 'MARECHAL',
  DEP: 'DEPUTADO', VER: 'VEREADOR', PE: 'PADRE', CAP: 'CAPITAO', TEN: 'TENENTE', SGT: 'SARGENTO', STO: 'SANTO',
  STA: 'SANTA', S: 'SAO', SAO: 'SAO', DNA: 'DONA', D: 'DOM', MONS: 'MONSENHOR', CMTE: 'COMANDANTE', ALM: 'ALMIRANTE',
  BR: 'BR', VISC: 'VISCONDE', BAR: 'BARAO', DUQ: 'DUQUE', IRMA: 'IRMA', FREI: 'FREI',
};
const UNITS = ['', 'UM', 'DOIS', 'TRES', 'QUATRO', 'CINCO', 'SEIS', 'SETE', 'OITO', 'NOVE', 'DEZ', 'ONZE', 'DOZE', 'TREZE', 'QUATORZE', 'QUINZE', 'DEZESSEIS', 'DEZESSETE', 'DEZOITO', 'DEZENOVE'];
const TENS = ['', '', 'VINTE', 'TRINTA'];
const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17, XVIII: 18, XIX: 19, XX: 20 };

/** A day-of-month number in words, as the cadastre writes it ("29" → "VINTE NOVE" once the "E" is dropped). */
function inWords(n: number): string[] {
  if (n < 20) return [UNITS[n]];
  return [TENS[Math.floor(n / 10)], UNITS[n % 10]].filter(Boolean);
}

/** Street name → matching key: no accents, no "Rua"/"Av.", abbreviations spelled out, numbers in words, no "de/da". */
export function streetKey(name: string): string {
  const raw = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  // "Rua", "Av." at the start only (keeps "Praça" inside a name like "Rua da Praça")
  while (raw.length > 1 && TYPE_WORDS.has(raw[0])) raw.shift();
  const out: string[] = [];
  raw.forEach((t, i) => {
    // the "D" of "D. Pedro" is "Dom", but a lone "D" between words is a "de"
    if (t === 'D' && i > 0) return;
    if (/^\d+$/.test(t) && Number(t) > 0 && Number(t) <= 39 && raw.length > 1) return out.push(...inWords(Number(t)));
    if (ROMAN[t] && i === 0 && raw.length > 1) return out.push(...inWords(ROMAN[t]));
    if (STOP.has(t)) return;
    out.push(ABBREV[t] ?? t);
  });
  return out.join(' ');
}

export const bairroKey = (b: string) => b.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

export function buildAddressIndex(f: AddressFile): AddressIndex {
  if (f?.v !== 1 || !Array.isArray(f.streets) || !Array.isArray(f.bairros)) throw new Error('enderecos.json inválido');
  const byKey = new Map<string, AddressFile['streets'][number][]>();
  for (const s of f.streets) {
    const k = streetKey(s[0]);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(s);
  }
  return { origin: f.origin, bairros: f.bairros, byKey, keys: [...byKey.keys()] };
}

/** How far (house numbers) the nearest number may be from the typed one, on the same side of the street. */
const NEAR_NUMBERS = 40;

/**
 * Lot at street + number. The street must match by key, or be the only one whose key holds every typed word
 * ("João Colin" → "Doutor João Colin"); a number missing from the cadastre takes the nearest one on the same side
 * (even or odd) up to NEAR_NUMBERS away. `bairro` breaks ties (the same name in two places, a number twice).
 */
export function locateAddress(ix: AddressIndex, street: string, number: number, bairro = ''): Located {
  const k = streetKey(street);
  if (!k) return { kind: 'no-street' };
  let streets = ix.byKey.get(k);
  if (!streets) {
    const words = k.split(' ');
    const keys = ix.keys.filter((x) => {
      const xs = x.split(' ');
      return words.every((w) => xs.includes(w));
    });
    if (keys.length === 1) streets = ix.byKey.get(keys[0]);
    else if (keys.length > 1 && bairro) {
      // several streets hold the words: the one in the typed bairro, when only one is
      const bk = bairroKey(bairro);
      const inBairro = keys.filter((x) => ix.byKey.get(x)!.some((s) => s[1].some((r) => bairroKey(ix.bairros[r[3]]) === bk)));
      if (inBairro.length === 1) streets = ix.byKey.get(inBairro[0]);
    }
  }
  if (!streets) return { kind: 'no-street' };
  const bk = bairro ? bairroKey(bairro) : '';
  type Row = AddressFile['streets'][number][1][number];
  const rows: { name: string; r: Row }[] = streets.flatMap((s) => s[1].map((r) => ({ name: s[0], r })));
  const score = (x: { r: Row }) => (bk && bairroKey(ix.bairros[x.r[3]]) === bk ? 0 : 1);
  const exact = rows.filter((x) => x.r[0] === number).sort((a, b) => score(a) - score(b));
  let best = exact[0];
  if (!best) {
    const side = rows
      .filter((x) => x.r[0] % 2 === number % 2 && Math.abs(x.r[0] - number) <= NEAR_NUMBERS)
      .sort((a, b) => score(a) - score(b) || Math.abs(a.r[0] - number) - Math.abs(b.r[0] - number));
    best = side[0];
  }
  const at = (r: Row): [number, number] => [Number((ix.origin[0] + r[1] / 1e5).toFixed(5)), Number((ix.origin[1] + r[2] / 1e5).toFixed(5))];
  if (!best) {
    const near = [...rows].sort((a, b) => score(a) - score(b) || Math.abs(a.r[0] - number) - Math.abs(b.r[0] - number))[0];
    return { kind: 'no-number', street: displayStreet(streets[0][0]), near: at(near.r) };
  }
  const [n, , , b, built] = best.r;
  return { kind: 'found', exact: n === number, street: displayStreet(best.name), number: n, bairro: titleCase(ix.bairros[b] ?? ''), point: at(best.r), builtM2: built };
}

const LOWER = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);
const titleCase = (s: string) =>
  s.toLowerCase().replace(/\S+/g, (w, i) => (i > 0 && LOWER.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)));
const displayStreet = (cadastreName: string) => titleCase(cadastreName);
