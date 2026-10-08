import { describe, expect, it } from 'vitest';
import { EMPTY_CRITERIA } from '../src/state/filters';
import { sameCriteria, searchToState, stateToSearch } from '../src/state/url';

const known = { agencyIds: new Set(['agency-a', 'agency-b']), listingIds: new Set(['apt-01', 'land-13']) };

describe('URL state', () => {
  it('empty state produces an empty query string', () => {
    expect(stateToSearch({ criteria: EMPTY_CRITERIA, listingId: null, sort: 'price-asc' })).toBe('');
  });
  it('round-trips criteria and the open listing', () => {
    const state = {
      criteria: { types: ['house' as const, 'land' as const], priceMin: 300000, priceMax: 900000, bedroomsMin: 2, areaMin: 80, agency: 'agency-b' },
      listingId: 'land-13',
      sort: 'area-desc' as const,
    };
    const search = stateToSearch(state);
    expect(search).toBe('?imovel=land-13&tipo=casa%2Cterreno&precoMin=300000&precoMax=900000&quartos=2&area=80&imob=agency-b&ordem=maior-area');
    expect(searchToState(search, known)).toEqual(state);
  });
  it('ignores unknown or invalid values', () => {
    const s = searchToState('?tipo=castelo,casa,casa&precoMin=-5&precoMax=abc&quartos=2.7&imob=agency-x&imovel=nope&ordem=xyz', known);
    expect(s).toEqual({ criteria: { ...EMPTY_CRITERIA, types: ['house'], bedroomsMin: 2 }, listingId: null, sort: 'price-asc' });
  });
  it('sameCriteria ignores type order', () => {
    expect(sameCriteria({ ...EMPTY_CRITERIA, types: ['land', 'house'] }, { ...EMPTY_CRITERIA, types: ['house', 'land'] })).toBe(true);
    expect(sameCriteria({ ...EMPTY_CRITERIA, priceMax: 1 }, EMPTY_CRITERIA)).toBe(false);
  });
});
