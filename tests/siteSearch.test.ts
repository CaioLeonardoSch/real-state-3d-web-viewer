import { describe, expect, it } from 'vitest';
import type { Listing } from '../src/data/types';
import { EMPTY_CRITERIA } from '../src/state/filters';
import { bairroCounts, chipsOf, emptySearch, pageOf, queryToSearch, resultsTitle, runSearch, searchToQuery } from '../src/site/search';

const base: Listing = {
  id: 'a', type: 'apartment', title: 'A', agency: 'x', price: 500000, areaM2: 80, bedrooms: 2, bathrooms: 1, parkingSpots: 1,
  status: 'ready', features: [], approximateLocation: true, description: '', address: { bairro: 'Glória', city: 'Joinville' },
};
const L = (patch: Partial<Listing>): Listing => ({ ...base, ...patch });
const list = [
  L({ id: 'a', referenceCode: 'AP-1001', suites: 1 }),
  L({ id: 'b', type: 'house', price: 900000, bedrooms: 3, suites: 2, address: { bairro: 'América' }, previousPrice: 990000, referenceCode: 'CA-2002' }),
  L({ id: 'c', price: 700000, status: 'under_construction', address: { bairro: 'Glória' }, highlight: 'super' }),
  L({ id: 'd', transaction: 'rent', price: 2500, rentPrice: 2500, address: { bairro: 'Centro' } }),
];
const defaults = { sort: 'relevance' as const, view: 'grade' as const };

describe('busca do site', () => {
  it('filtra por bairro (sem acento e maiúsculas), código e suítes', () => {
    const s = emptySearch('price-asc');
    expect(runSearch(list, { ...s, bairros: ['gloria'] }).map((l) => l.id)).toEqual(['a', 'c']);
    expect(runSearch(list, { ...s, code: 'ca-2' }).map((l) => l.id)).toEqual(['b']);
    expect(runSearch(list, { ...s, suitesMin: 2 }).map((l) => l.id)).toEqual(['b']);
    expect(runSearch(list, { ...s, criteria: { ...EMPTY_CRITERIA, reducedOnly: true } }).map((l) => l.id)).toEqual(['b']);
    expect(runSearch(list, { ...s, criteria: { ...EMPTY_CRITERIA, transaction: 'rent' } }).map((l) => l.id)).toEqual(['d']);
  });

  it('a URL guarda a busca e volta igual', () => {
    const s = { ...emptySearch('relevance'), bairros: ['Glória', 'América'], code: 'AP', suitesMin: 1, page: 2, view: 'mapa' as const, sort: 'price-desc' as const };
    s.criteria = { ...s.criteria, types: ['apartment'], priceMax: 800000, statuses: ['under_construction'], reducedOnly: true };
    const q = searchToQuery(s, defaults);
    expect(q.getAll('bairro')).toEqual(['Glória', 'América']);
    expect(q.get('vista')).toBe('mapa');
    expect(q.get('ordem')).toBe('maior-preco');
    expect(queryToSearch(`?${q}`, defaults, new Set())).toEqual(s);
    // padrões não poluem a URL
    expect(searchToQuery(emptySearch('relevance'), defaults).toString()).toBe('');
    // valores inválidos são ignorados
    const bad = queryToSearch('?pagina=-3&suites=abc&vista=3d&ordem=xyz', defaults, new Set());
    expect(bad).toMatchObject({ page: 1, suitesMin: null, view: 'grade' });
  });

  it('chips removíveis, um por critério', () => {
    const s = { ...emptySearch(), bairros: ['Glória'], suitesMin: 2 };
    s.criteria = { ...s.criteria, types: ['house', 'apartment'], priceMax: 800000 };
    const chips = chipsOf(s);
    expect(chips.map((c) => c.label)).toEqual(['Casa', 'Apartamento', 'Glória', 'Até R$ 800 mil', '2+ suítes']);
    expect(chips[0].without.criteria.types).toEqual(['apartment']);
    expect(chips[2].without.bairros).toEqual([]);
  });

  it('bairros mais procurados, paginação e título', () => {
    expect(bairroCounts(list, false)).toEqual([{ name: 'Glória', count: 2 }, { name: 'América', count: 1 }]);
    expect(pageOf([1, 2, 3, 4, 5], 9, 2)).toEqual({ items: [5], page: 3, pages: 3 });
    const s = { ...emptySearch(), bairros: ['Glória'] };
    s.criteria = { ...s.criteria, types: ['apartment'] };
    expect(resultsTitle(2, s)).toBe('2 apartamentos à venda em Glória');
    expect(resultsTitle(1, emptySearch())).toBe('1 imóvel à venda');
    expect(resultsTitle(0, emptySearch())).toBe('Nenhum imóvel encontrado');
  });
});
