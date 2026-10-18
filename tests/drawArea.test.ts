import { describe, expect, it } from 'vitest';
import clipping from 'polygon-clipping';
import { EMPTY_CRITERIA, filterListings, inRing } from '../src/state/filters';
import { formatArea, parseArea, sameCriteria, searchToState, stateToSearch } from '../src/state/url';
import { growRing } from '../src/map/drawArea';
import { distanceM } from '../src/data/services';
import type { Listing } from '../src/data/types';

const DX = 1 / (111_320 * Math.cos((26.3 * Math.PI) / 180));
const DY = 1 / 110_540;
const O: [number, number] = [-48.85, -26.3];
const at = (mx: number, my: number): [number, number] => [O[0] + mx * DX, O[1] + my * DY];
// a 1 km square
const square = [at(0, 0), at(1000, 0), at(1000, 1000), at(0, 1000)];
const listing = (id: string, p: [number, number], approx = false): Listing =>
  ({ id, type: 'house', price: 1, bedrooms: 1, bathrooms: 1, parkingSpots: 0, areaM2: 50, agency: 'A', title: 't', status: 'ready',
    features: [], description: '', approximateLocation: approx, ...(approx ? { approxCenter: p } : { footprint: { type: 'Polygon', coordinates: [[p, [p[0] + DX, p[1]], [p[0] + DX, p[1] + DY], p]] } }) }) as Listing;

describe('área desenhada no mapa', () => {
  it('imóveis dentro dela, pelo ponto do imóvel (o centro do círculo quando o endereço é oculto)', () => {
    const list = [listing('dentro', at(500, 500)), listing('fora', at(1500, 500)), listing('circulo', at(200, 800), true), listing('sem-ponto', at(0, 0), true)];
    delete list[3].approxCenter;
    expect(filterListings(list, { ...EMPTY_CRITERIA, area: square }).map((l) => l.id)).toEqual(['dentro', 'circulo']);
    // a concave shape (an L): the corner cut out is outside
    const L = [at(0, 0), at(1000, 0), at(1000, 400), at(400, 400), at(400, 1000), at(0, 1000)];
    expect(inRing(at(700, 700), L)).toBe(false);
    expect(inRing(at(200, 700), L)).toBe(true);
  });

  it('vai e volta pelo endereço, com 5 casas; um valor inválido descarta a área toda', () => {
    const state = { criteria: { ...EMPTY_CRITERIA, area: square }, listingId: null, sort: 'relevance' as const };
    const q = stateToSearch(state);
    const back = searchToState(q, { agencyIds: new Set(), listingIds: new Set() }).criteria;
    expect(back.area).toHaveLength(4);
    expect(distanceM(back.area[2], square[2])).toBeLessThan(2);
    expect(sameCriteria(back, { ...EMPTY_CRITERIA, area: parseArea(formatArea(square)) })).toBe(true);
    expect(parseArea('1,2;3,4')).toEqual([]);
    expect(parseArea('1,2;3,4;x,5')).toEqual([]);
    expect(parseArea('1,2;3,4;5,95')).toEqual([]);
    expect(parseArea(Array.from({ length: 41 }, (_, i) => `${i},1`).join(';'))).toEqual([]);
    expect(parseArea('1,2;3,4;5,6')).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it('a margem de 100 m em volta: inclui o que está a até 100 m de um lado ou de um canto, não além', () => {
    const grown = growRing(square, 100, clipping.union);
    const inside = (p: [number, number]) => grown.some((poly) => inRing(p, poly[0]) && !poly.slice(1).some((h) => inRing(p, h)));
    expect(inside(at(500, -90))).toBe(true);
    expect(inside(at(500, -110))).toBe(false);
    expect(inside(at(1060, 1060))).toBe(true); // 85 m from the corner
    expect(inside(at(1080, 1080))).toBe(false); // 113 m
    expect(inside(at(500, 500))).toBe(true);
  });
});
