// Street names for the map (scripts/build-tiles.mjs): the display name kept on the close-up road tiles, connected
// pieces of one street merged into longer lines (so the label fits along them), and the street index of the search
// box (public/data/ruas.json): one entry per street name and place (bairro or distrito, and city), a street through
// several bairros being in each of them.
// Pure functions: same input, same output, so the monthly rebuild only changes what changed in OpenStreetMap.
import { frame, polygonTester } from './scenery.mjs';

// ---------------------------------------------------------------- display name

const QUOTE_1 = /[\u2018\u2019\u201A\u201B\u02BC\u00B4\u0060]/g;
const QUOTE_2 = /[\u201C\u201D\u201E\u201F]/g;
const DASHES = /[\u2010-\u2015\u2212]/g;
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
/** Characters the map's labels cannot draw (outside the Latin-1 glyph range). */
export const OUTSIDE_FONT = /[^\u0000-\u00FF]/;

/**
 * Street name as shown on the map and in the search box: NFC, typographic quotes and dashes as plain ASCII (‘’´` → ',
 * “” → ", – — → -), whitespace collapsed and trimmed. The map's font only covers Latin-1 (U+0000–U+00FF): a letter
 * outside it loses its accent (ő → o), so the label never asks for a glyph range that does not exist.
 */
export function displayName(raw) {
  const s = String(raw ?? '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(QUOTE_1, "'")
    .replace(QUOTE_2, '"')
    .replace(DASHES, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!OUTSIDE_FONT.test(s)) return s;
  // a letter with an accent loses the accent; a loose accent goes; anything else stays (the build reports it)
  const fold = (c) => {
    const d = c.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
    return OUTSIDE_FONT.test(d) ? c : d;
  };
  return s.replace(/[^\u0000-\u00FF]/g, fold).normalize('NFC');
}

// ---------------------------------------------------------------- which roads are addresses

/** Ways nobody gives as an address (paths, steps, platforms…): on the map with their name, not in the search box. */
export const NOT_ADDRESS_ROADS = new Set([
  'footway', 'path', 'steps', 'cycleway', 'bridleway', 'corridor', 'platform', 'bus_stop', 'elevator', 'proposed', 'construction',
]);
export const isAddressRoad = (highway) => !!highway && !NOT_ADDRESS_ROADS.has(highway);

// ---------------------------------------------------------------- merging connected pieces

const partsOf = (g) => (g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : null);
const pointKey = (c) => `${c[0]},${c[1]}`;

/** Merge key of a road in the close-up tiles: only named pieces of the same class and pavement are joined. */
export const roadMergeKey = (p) => (p.name ? `${p.name}\u0000${p.highway}\u0000${p.s ?? ''}` : null);

/**
 * Joins lines that continue each other: same key (`keyOf`, null = never joined) and an end exactly on the same
 * point (the shared OSM node). Only where exactly two ends of that key meet: forks, crossings and closed ways stay
 * as they are. Joined pieces become one LineString (reversed where needed); a closed chain of pieces becomes a
 * ring. Features without any join come back as the same objects, in their order; each merged line takes the
 * position of its first piece.
 */
export function mergeLines(features, keyOf) {
  const groups = new Map();
  const parts = []; // { f, i (feature index), line }
  features.forEach((f, i) => {
    const key = keyOf(f.properties ?? {});
    const lines = partsOf(f.geometry);
    if (key == null || !lines) return;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { ends: new Map(), parts: [] }));
    for (const line of lines) {
      if (line.length < 2) continue;
      const p = parts.length;
      parts.push({ f, i, line });
      g.parts.push(p);
      for (const [e, c] of [[0, line[0]], [1, line[line.length - 1]]]) {
        const k = pointKey(c);
        const at = g.ends.get(k);
        if (at) at.push({ p, e });
        else g.ends.set(k, [{ p, e }]);
      }
    }
  });
  if (!parts.length) return features.slice();
  const groupOf = new Map();
  for (const g of groups.values()) for (const p of g.parts) groupOf.set(p, g);
  // the piece joined to piece p at its end e (0 start, 1 end), and at which of its own ends
  const next = (p, e) => {
    const line = parts[p].line;
    const at = groupOf.get(p).ends.get(pointKey(e ? line[line.length - 1] : line[0]));
    if (at.length !== 2) return null;
    const o = at[0].p === p && at[0].e === e ? at[1] : at[0];
    return o.p === p ? null : o;
  };
  const used = new Set();
  const chains = [];
  for (let p0 = 0; p0 < parts.length; p0++) {
    if (used.has(p0)) continue;
    // back to the first piece of the chain (a ring starts at this piece)…
    let start = { p: p0, rev: false };
    const seen = new Set([p0]);
    for (;;) {
      const o = next(start.p, start.rev ? 1 : 0);
      if (!o) break;
      if (seen.has(o.p)) {
        start = { p: p0, rev: false };
        break;
      }
      seen.add(o.p);
      start = { p: o.p, rev: o.e === 0 };
    }
    // …then forward to its end
    const chain = [];
    for (let cur = start; cur; ) {
      chain.push(cur);
      used.add(cur.p);
      const o = next(cur.p, cur.rev ? 0 : 1);
      cur = o && !used.has(o.p) ? { p: o.p, rev: o.e === 1 } : null;
    }
    chains.push(chain);
  }
  // a feature whose pieces all stay alone is kept as it is
  const joined = new Set();
  for (const chain of chains) if (chain.length > 1) for (const { p } of chain) joined.add(parts[p].f);
  const out = features.map((f) => (joined.has(f) ? null : f));
  const extra = new Map(); // feature index → merged lines placed there
  for (const chain of chains) {
    if (chain.length === 1 && !joined.has(parts[chain[0].p].f)) continue;
    const coordinates = [];
    for (const { p, rev } of chain) {
      const line = rev ? parts[p].line.slice().reverse() : parts[p].line;
      for (let k = coordinates.length ? 1 : 0; k < line.length; k++) coordinates.push(line[k]);
    }
    const first = Math.min(...chain.map(({ p }) => parts[p].i));
    const f = parts[chain[0].p].f;
    const merged = { type: 'Feature', properties: { ...f.properties }, geometry: { type: 'LineString', coordinates } };
    const list = extra.get(first);
    if (list) list.push(merged);
    else extra.set(first, [merged]);
  }
  return out.flatMap((f, i) => [...(f ? [f] : []), ...(extra.get(i) ?? [])]);
}

// ---------------------------------------------------------------- geometry in metres

const metric = (lat0) => {
  const { kx, ky } = frame(lat0);
  return (c) => [c[0] * kx, c[1] * ky];
};

/** Length of a line or multi-line in metres. */
export function lineLengthM(g, lat0 = -26.3) {
  const { kx, ky } = frame(lat0);
  let m = 0;
  for (const line of partsOf(g) ?? []) for (let i = 1; i < line.length; i++) m += Math.hypot((line[i][0] - line[i - 1][0]) * kx, (line[i][1] - line[i - 1][1]) * ky);
  return m;
}

/** Point `m` metres along a line or multi-line (its pieces in order), always on it; its last point past the end. */
function pointAlong(g, m, lat0 = -26.3) {
  const { kx, ky } = frame(lat0);
  const lines = (partsOf(g) ?? []).filter((l) => l.length);
  if (!lines.length) return null;
  let left = Math.max(0, m);
  for (const line of lines)
    for (let i = 1; i < line.length; i++) {
      const [a, b] = [line[i - 1], line[i]];
      const d = Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky);
      if (d > 0 && left <= d) return [a[0] + ((b[0] - a[0]) * left) / d, a[1] + ((b[1] - a[1]) * left) / d];
      left -= d;
    }
  const last = lines[lines.length - 1];
  return [last[last.length - 1][0], last[last.length - 1][1]];
}

/** Point halfway along a line (by length), always on the line. Multi-lines: halfway along their pieces in order. */
export const lineMiddle = (g, lat0 = -26.3) => pointAlong(g, lineLengthM(g, lat0) / 2, lat0);

const sqDistPointSeg = (p, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return x * x + y * y;
};
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const segmentsCross = (a, b, c, d) => {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};
const sqDistSegSeg = (a, b, c, d) =>
  segmentsCross(a, b, c, d) ? 0 : Math.min(sqDistPointSeg(a, c, d), sqDistPointSeg(b, c, d), sqDistPointSeg(c, a, b), sqDistPointSeg(d, a, b));

/** Whether two lines (each a list of pieces, in metres) come within `gapM` of each other. */
function linesWithin(a, b, gapM) {
  const g2 = gapM * gapM;
  // a piece of a single point counts as a segment of length zero
  const segs = (l) => (l.length === 1 ? [l[0], l[0]] : l);
  for (const la of a.map(segs))
    for (const lb of b.map(segs))
      for (let i = 1; i < la.length; i++) for (let j = 1; j < lb.length; j++) if (sqDistSegSeg(la[i - 1], la[i], lb[j - 1], lb[j]) <= g2) return true;
  return false;
}

// ---------------------------------------------------------------- bairro and city of a point

const bboxOfPolys = (g) => {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) for (const [x, y] of poly[0]) (w = Math.min(w, x)), (e = Math.max(e, x)), (s = Math.min(s, y)), (n = Math.max(n, y));
  return [w, s, e, n];
};

/**
 * Place of a point from the region's areas (`.cache/region/bairros.geojson`: kind 'bairro', 'distrito' and
 * 'cidade'): [bairro, city]; [distrito, city] outside every bairro; ['', city] outside both; null outside every
 * city. A bairro's city is the city around most of its outline, so "Centro" and "Itinga", which exist in both
 * Joinville and Araquari, each get their own.
 */
export function placeLocator(areas) {
  const polys = (areas.features ?? areas).filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
  const tester = (f) => ({ name: f.properties?.name ?? '', bbox: bboxOfPolys(f.geometry), inside: polygonTester(f.geometry) });
  const hit = (t, p) => p[0] >= t.bbox[0] && p[0] <= t.bbox[2] && p[1] >= t.bbox[1] && p[1] <= t.bbox[3] && t.inside(p);
  const cities = polys.filter((f) => f.properties?.kind === 'cidade').map(tester);
  const cityOf = (f) => {
    const votes = cities.map(() => 0);
    for (const poly of f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
      for (const ring of poly) for (const c of ring) cities.forEach((t, k) => hit(t, c) && votes[k]++);
    const best = votes.reduce((b, v, k) => (v > votes[b] ? k : b), 0);
    return votes[best] ? cities[best].name : '';
  };
  const within = (kind) => polys.filter((f) => (f.properties?.kind ?? 'bairro') === kind).map((f) => ({ ...tester(f), city: cityOf(f) }));
  const bairros = within('bairro');
  const distritos = within('distrito');
  return (p) => {
    const b = bairros.find((t) => hit(t, p)) ?? distritos.find((t) => hit(t, p));
    if (b) return [b.name, b.city];
    const c = cities.find((t) => hit(t, p));
    return c ? ['', c.name] : null;
  };
}

// ---------------------------------------------------------------- a street's parts in each place

const placeKey = (p) => `${p[0]}\u0000${p[1]}`;

/** Box [w, s, e, n] of lines (each a list of points), grown by `grow`. */
const boxOfLines = (lines, grow = 0) => {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const l of lines) for (const [x, y] of l) (w = Math.min(w, x)), (e = Math.max(e, x)), (s = Math.min(s, y)), (n = Math.max(n, y));
  return [w - grow, s - grow, e + grow, n + grow];
};
// boxes grown by half the gap overlap whenever their lines come within the gap: a cheap test before the exact one
const boxesMeet = (a, b) => !(a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3]);

/**
 * Lines (each a list of pieces, in metres) in clusters: lines within `gapM` of each other, directly or through other
 * lines, are one cluster. The clusters as lists of line indices, in the order of their first line.
 */
function clusters(lines, gapM) {
  const boxes = lines.map((ls) => boxOfLines(ls, gapM / 2));
  const parent = lines.map((_, i) => i);
  const root = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      if (!boxesMeet(boxes[i], boxes[j])) continue;
      const [ri, rj] = [root(i), root(j)];
      if (ri !== rj && linesWithin(lines[i], lines[j], gapM)) parent[Math.max(ri, rj)] = Math.min(ri, rj);
    }
  const byRoot = new Map();
  lines.forEach((_, i) => {
    const r = root(i);
    const c = byRoot.get(r);
    if (c) c.push(i);
    else byRoot.set(r, [i]);
  });
  return [...byRoot.values()];
}

/**
 * A line (lng/lat points) cut where it goes from one place to another (`placeLocator`): [{ place, line }] in order
 * along it, each with the line's own points plus one where it crosses the border. The line is looked at every
 * `stepM` metres and each change of place is narrowed down to half a metre, so a place it is in for less than
 * `stepM` may be missed. Stretches outside every city (place null) are left out, and so are stretches shorter than
 * half a metre of a line that was cut (slivers of the cut itself).
 */
export function splitByPlace(line, locate, { stepM = 10, lat0 = -26.3 } = {}) {
  const { kx, ky } = frame(lat0);
  const keyOf = (p) => (p ? placeKey(p) : null);
  const out = [];
  let cur = null;
  const startAt = (place, c) => {
    cur = place ? { place, line: [c] } : null;
    if (cur) out.push(cur);
  };
  if (!line.length) return out;
  let place = locate(line[0]);
  let key = keyOf(place);
  startAt(place, line[0]);
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const d = Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky);
    const along = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const steps = Math.max(1, Math.ceil(d / stepM));
    let t0 = 0;
    for (let k = 1; k <= steps; k++) {
      const t1 = k / steps;
      const p1 = k === steps ? locate(b) : locate(along(t1));
      const k1 = keyOf(p1);
      // the place changes between t0 and t1 (maybe more than once): halve until the border is within half a metre
      while (k1 !== key) {
        let [lo, hi, pHi] = [t0, t1, p1];
        while ((hi - lo) * d > 0.5) {
          const mid = (lo + hi) / 2;
          const pm = locate(along(mid));
          if (keyOf(pm) === key) lo = mid;
          else [hi, pHi] = [mid, pm];
        }
        const c = along((lo + hi) / 2);
        if (cur) cur.line.push(c);
        startAt(pHi, c);
        [t0, place, key] = [hi, pHi, keyOf(pHi)];
      }
      t0 = t1;
    }
    if (cur) cur.line.push(b);
  }
  // where the line was cut, a stretch shorter than the precision of the cut (half a metre) is no stretch at all
  const cut = out.length > 1 || out[0]?.line[0] !== line[0] || out[0]?.line.at(-1) !== line.at(-1);
  const lengthOf = (l) => lineLengthM({ type: 'LineString', coordinates: l }, lat0);
  return out.filter((p) => p.line.length > 1 && (!cut || lengthOf(p.line) >= 0.5));
}

/**
 * The streets people give as an address (`isAddressRoad`, with a name) in parts: each road cut at the borders of
 * places (`splitByPlace`); the stretches of one name in one place joined where they continue each other into runs
 * (`mergeLines`); and runs of that name and place within `gapM` of each other (directly or through other runs) one
 * part. Each part: { name, place, lengthM, runs (lng/lat lines) }, by name and place in the order of the roads.
 */
export function streetParts(roads, locate, { gapM = 300, stepM = 10, lat0 = -26.3 } = {}) {
  const pieces = [];
  for (const f of roads) {
    const name = f.properties?.name;
    if (!name || !isAddressRoad(f.properties.highway)) continue;
    for (const line of partsOf(f.geometry) ?? [])
      for (const { place, line: l } of splitByPlace(line, locate, { stepM, lat0 }))
        pieces.push({ type: 'Feature', properties: { name, place, k: `${name}\u0000${placeKey(place)}` }, geometry: { type: 'LineString', coordinates: l } });
  }
  const byKey = new Map();
  for (const run of mergeLines(pieces, (p) => p.k)) {
    const list = byKey.get(run.properties.k);
    if (list) list.push(run);
    else byKey.set(run.properties.k, [run]);
  }
  const toM = metric(lat0);
  const parts = [];
  for (const list of byKey.values())
    for (const c of clusters(list.map((r) => [r.geometry.coordinates.map(toM)]), gapM)) {
      const runs = c.map((i) => list[i].geometry.coordinates);
      const { name, place } = list[c[0]].properties;
      parts.push({ name, place, lengthM: runs.reduce((m, r) => m + lineLengthM({ type: 'LineString', coordinates: r }, lat0), 0), runs });
    }
  return parts;
}

// ---------------------------------------------------------------- the search box's street index

const collator = new Intl.Collator('pt-BR');
const floor5 = (v) => Math.floor(Math.round(v * 1e7) / 100) / 1e5;
const ceil5 = (v) => Math.ceil(Math.round(v * 1e7) / 100) / 1e5;
const round5 = (v) => Math.round(v * 1e5) / 1e5;

/**
 * Street index of the search box (public/data/ruas.json):
 *   { v: 1, places: [[bairro, city], …], streets: [[name, placeIndex, west, south, east, north, x, y], …] }
 * One entry per street name and place: the bairro (else distrito, else '') and city each stretch of the street is
 * in (`streetParts`), so a street through four bairros is in each of them; parts of the same name and place far
 * apart are one entry. Border tails are left out: a part shorter than `tailM` is no entry when a longer part of the
 * same name in another place is within `gapM` of it (the same street, crossing the border); a short street wholly
 * in one place keeps its entry. Streets outside the region's cities are left out. The box contains every part of
 * the entry and [x, y] is on the street, inside the place: the middle (by length) of its longest run there (moved
 * along the run where the rounding would take it out of the place). Lng/lat with 5 decimals (the box rounded
 * outwards). Sorted by name (Portuguese order), then by place.
 */
export function streetIndex(roads, areas, { gapM = 300, tailM = 80, stepM = 10, lat0 = -26.3 } = {}) {
  const locate = placeLocator(areas);
  const parts = streetParts(roads, locate, { gapM, stepM, lat0 });
  const toM = metric(lat0);
  const metres = new Map();
  const linesM = (p) => {
    let m = metres.get(p);
    if (!m) {
      const lines = p.runs.map((r) => r.map(toM));
      metres.set(p, (m = { lines, box: boxOfLines(lines, gapM / 2) }));
    }
    return m;
  };
  const byName = new Map();
  for (const p of parts) {
    const list = byName.get(p.name);
    if (list) list.push(p);
    else byName.set(p.name, [p]);
  }
  // the longer part first; equal lengths by place, so one of them always stays
  const before = (a, b) => b.lengthM < a.lengthM || (b.lengthM === a.lengthM && placeKey(a.place) < placeKey(b.place));
  const entries = new Map();
  for (const list of byName.values())
    for (const p of list) {
      if (p.lengthM < tailM) {
        const tail = list.some((q) => {
          if (placeKey(q.place) === placeKey(p.place) || !before(q, p)) return false;
          const [mq, mp] = [linesM(q), linesM(p)];
          return boxesMeet(mq.box, mp.box) && linesWithin(mq.lines, mp.lines, gapM);
        });
        if (tail) continue;
      }
      const k = `${p.name}\u0000${placeKey(p.place)}`;
      const e = entries.get(k);
      if (e) e.runs.push(...p.runs);
      else entries.set(k, { name: p.name, place: p.place, runs: [...p.runs] });
    }
  const rows = [];
  for (const { name, place, runs } of entries.values()) {
    const [w, s, e, n] = boxOfLines(runs);
    // the middle of the longest run; where the rounding takes it over the border (a street along the border of the
    // place), the point of that run nearest to its middle, metre by metre, that is still inside the place once
    // rounded; failing that (a run hugging the border all along), the same on the next longest run
    const rounded = (c) => [round5(c[0]), round5(c[1])];
    const inPlace = (c) => placeKey(locate(c) ?? ['', '']) === placeKey(place);
    const byLength = runs
      .map((r) => ({ g: { type: 'LineString', coordinates: r }, m: lineLengthM({ type: 'LineString', coordinates: r }, lat0) }))
      .sort((p, q) => q.m - p.m);
    const insideOn = ({ g, m }) => {
      for (let d = 0; d <= m / 2; d++) {
        const c = (d ? [m / 2 - d, m / 2 + d] : [m / 2]).map((t) => rounded(pointAlong(g, t, lat0))).find(inPlace);
        if (c) return c;
      }
      return null;
    };
    let point = null;
    for (const r of byLength) if ((point = insideOn(r))) break;
    point ??= rounded(pointAlong(byLength[0].g, byLength[0].m / 2, lat0));
    rows.push({ name, place, box: [floor5(w), floor5(s), ceil5(e), ceil5(n)], point });
  }
  const byPlace = (a, b) => collator.compare(a[1], b[1]) || (a[0] === '') - (b[0] === '') || collator.compare(a[0], b[0]);
  rows.sort((a, b) => collator.compare(a.name, b.name) || byPlace(a.place, b.place) || a.box[0] - b.box[0] || a.box[1] - b.box[1]);
  const places = [...new Map(rows.map((r) => [placeKey(r.place), r.place])).values()].sort(byPlace);
  const placeIndex = new Map(places.map((p, i) => [placeKey(p), i]));
  return {
    v: 1,
    places: places.map((p) => [p[0], p[1]]),
    streets: rows.map((r) => [r.name, placeIndex.get(placeKey(r.place)), ...r.box, ...r.point]),
  };
}

/** The index as JSON with one place and one street per line (the monthly pull request shows a readable diff). */
export function streetIndexJson(index) {
  const rows = (list) => list.map((r) => JSON.stringify(r)).join(',\n');
  return `{"v":${index.v},\n"places":[\n${rows(index.places)}\n],\n"streets":[\n${rows(index.streets)}\n]}\n`;
}
