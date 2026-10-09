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
      criteria: {
        ...EMPTY_CRITERIA,
        types: ['house' as const, 'land' as const],
        priceMin: 300000,
        priceMax: 900000,
        bedroomsMin: 2,
        areaMin: 80,
        agency: 'agency-b',
      },
      listingId: 'land-13',
      sort: 'area-desc' as const,
      developmentId: null,
      unitId: null,
    };
    const search = stateToSearch(state);
    expect(search).toBe('?imovel=land-13&tipo=casa%2Cterreno&precoMin=300000&precoMax=900000&quartos=2&area=80&imob=agency-b&ordem=maior-area');
    expect(searchToState(search, known)).toEqual(state);
  });
  it('round-trips the advanced filters', () => {
    const state = {
      criteria: {
        ...EMPTY_CRITERIA,
        bathroomsMin: 2,
        parkingMin: 1,
        areaMax: 200,
        pricePerM2Max: 9000,
        statuses: ['under_construction' as const],
        features: ['pool' as const, 'pets' as const],
      },
      listingId: null,
      sort: 'ppm2-asc' as const,
      developmentId: null,
      unitId: null,
    };
    const search = stateToSearch(state);
    expect(search).toBe(
      '?banheiros=2&vagas=1&areaMax=200&m2Max=9000&situacao=em-construcao&comodidades=piscina%2Cpets&ordem=menor-preco-m2',
    );
    expect(searchToState(search, known)).toEqual(state);
  });
  it('round-trips the open development and unit (unit by number)', () => {
    const k = { ...known, developments: new Map([['cora', new Set(['cora-1502', 'cora-501'])]]) };
    const state = { criteria: EMPTY_CRITERIA, listingId: null, sort: 'price-asc' as const, developmentId: 'cora', unitId: 'cora-1502' };
    const search = stateToSearch(state);
    expect(search).toBe('?empreendimento=cora&unidade=1502');
    expect(searchToState(search, k)).toEqual(state);
    expect(searchToState('?empreendimento=cora&unidade=9999', k)).toMatchObject({ developmentId: 'cora', unitId: null });
    expect(searchToState('?empreendimento=nada&unidade=1502', k)).toMatchObject({ developmentId: null, unitId: null });
  });
  it('round-trips the reduced-price filter', () => {
    const state = { criteria: { ...EMPTY_CRITERIA, reducedOnly: true as const }, listingId: null, sort: 'price-asc' as const, developmentId: null, unitId: null };
    expect(stateToSearch(state)).toBe('?reduzido=1');
    expect(searchToState('?reduzido=1', known)).toEqual(state);
    expect(searchToState('?reduzido=sim', known).criteria.reducedOnly).toBeNull();
  });
  it('ignores unknown or invalid values', () => {
    const s = searchToState('?tipo=castelo,casa,casa&precoMin=-5&precoMax=abc&quartos=2.7&imob=agency-x&imovel=nope&ordem=xyz&comodidades=heliponto&situacao=x', known);
    expect(s).toEqual({
      criteria: { ...EMPTY_CRITERIA, types: ['house'], bedroomsMin: 2 },
      listingId: null,
      sort: 'price-asc',
      developmentId: null,
      unitId: null,
    });
  });
  it('sameCriteria ignores type order', () => {
    expect(sameCriteria({ ...EMPTY_CRITERIA, types: ['land', 'house'] }, { ...EMPTY_CRITERIA, types: ['house', 'land'] })).toBe(true);
    expect(sameCriteria({ ...EMPTY_CRITERIA, priceMax: 1 }, EMPTY_CRITERIA)).toBe(false);
    expect(sameCriteria({ ...EMPTY_CRITERIA, features: ['pool', 'gym'] }, { ...EMPTY_CRITERIA, features: ['gym', 'pool'] })).toBe(true);
    expect(sameCriteria({ ...EMPTY_CRITERIA, statuses: ['ready'] }, EMPTY_CRITERIA)).toBe(false);
  });
});
