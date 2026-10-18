import { beforeEach, describe, expect, it } from 'vitest';
import type { Listing } from '../src/data/types';
import { EMPTY_CRITERIA } from '../src/state/filters';
import { ALERT_MAX_LISTED, confirmMail, newForAlert, newListingsMail, siteHref } from '../src/site/alerts';
import { SavedLists, unseen } from '../src/site/saved';
import { alertQuery, emptySearch, searchLabel } from '../src/site/search';

const base: Listing = {
  id: 'a', type: 'apartment', title: 'Apto Glória', agency: 'org', price: 500000, areaM2: 80, bedrooms: 2, bathrooms: 1, parkingSpots: 1,
  status: 'ready', features: [], approximateLocation: true, description: '', address: { bairro: 'Glória', city: 'Joinville' },
};
const L = (patch: Partial<Listing>): Listing => ({ ...base, ...patch });
const list = [L({ id: 'a' }), L({ id: 'b', title: 'Casa América', type: 'house', address: { bairro: 'América' } }), L({ id: 'c', title: 'Apto novo' }), L({ id: 'd', transaction: 'rent', rentPrice: 2500 })];
const published = new Map([
  ['a', '2026-10-01T10:00:00Z'],
  ['b', '2026-10-20T10:00:00Z'],
  ['c', '2026-10-20T11:00:00Z'],
  ['d', '2026-10-20T12:00:00Z'],
]);
const defaults = { sort: 'relevance' as const, view: 'grade' as const };
const site = { id: 'org', name: 'Imobiliária X', slug: 'imob-x', customDomain: null };

describe('alertas de imóveis novos', () => {
  it('a chave da busca ignora página, vista e ordem; o nome lista os filtros', () => {
    const s = { ...emptySearch('price-desc', 'lista'), page: 3, criteria: { ...EMPTY_CRITERIA, bairros: ['Glória'], types: ['apartment' as const] } };
    expect(alertQuery(s, defaults)).toBe(alertQuery({ ...s, page: 1, view: 'mapa', sort: 'recent' }, defaults));
    expect(alertQuery(s, defaults)).not.toMatch(/pagina|vista|ordem/);
    expect(searchLabel(s)).toBe('Venda · Apartamento · Glória');
  });

  it('só os imóveis da busca publicados depois do último e-mail', () => {
    const q = alertQuery({ ...emptySearch(), criteria: { ...EMPTY_CRITERIA, bairros: ['Glória'] } }, defaults);
    const ids = (since: string) => newForAlert(list, published, q, since, { id: 'org', search: defaults }).map((l) => l.id);
    expect(ids('2026-10-10T00:00:00Z')).toEqual(['c']);
    expect(ids('2026-09-01T00:00:00Z').sort()).toEqual(['a', 'c']);
    expect(ids('2026-10-21T00:00:00Z')).toEqual([]);
    // the rent search sees the rent listing
    const rent = newForAlert(list, published, 'negocio=alugar', '2026-10-10T00:00:00Z', { id: 'org', search: defaults });
    expect(rent.map((l) => l.id)).toEqual(['d']);
  });

  it('links no domínio do cliente ou no endereço da plataforma', () => {
    expect(siteHref({ ...site, customDomain: 'imobx.com.br' }, 'https://p.app', 'imovel', { id: 'a' })).toBe('https://imobx.com.br/imovel?id=a');
    expect(siteHref(site, 'https://p.app/', 'favoritos', { alerta: 'confirmar', token: 't' })).toBe('https://p.app/site.html?imobiliaria=imob-x&p=favoritos&alerta=confirmar&token=t');
  });

  it('e-mails: confirmação com o link, e os imóveis novos com preço, link de cada um e o de saída', () => {
    const c = confirmMail(site, 'Venda · Glória', 'tok', 'https://p.app');
    expect(c.text).toContain('alerta=confirmar&token=tok');
    expect(c.html).toContain('alerta=cancelar&amp;token=tok');
    const many = Array.from({ length: ALERT_MAX_LISTED + 2 }, (_, i) => L({ id: `x${i}`, title: `Apto <${i}>` }));
    const m = newListingsMail(site, 'Venda', '', many, 'tok', 'https://p.app');
    expect(m.subject).toBe(`${ALERT_MAX_LISTED + 2} imóveis novos na sua busca: Venda`);
    expect(m.text).toContain('R$');
    expect(m.text).toContain('E mais 2.');
    expect(m.html).toContain('Apto &lt;0&gt;');
    expect(m.html).not.toContain(`x${ALERT_MAX_LISTED}`);
    const r = newListingsMail(site, 'Aluguel', 'negocio=alugar', [list[3]], 'tok', 'https://p.app');
    expect(r.subject).toBe('1 imóvel novo na sua busca: Aluguel');
    expect(r.text).toMatch(/2\.500\/mês/);
    expect(r.text).toContain('negocio=alugar');
  });
});

describe('buscas salvas no navegador', () => {
  // the tests run in Node: a minimal localStorage
  beforeEach(() => {
    const m = new Map<string, string>();
    globalThis.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as Storage;
  });

  it('salva com o que a busca tem agora; novos são os que aparecem depois; abrir a busca zera', () => {
    const saved = new SavedLists('t');
    expect(saved.toggleSearch('bairro=Gl%C3%B3ria', 'Venda · Glória', ['a'])).toBe(true);
    const again = new SavedLists('t');
    const s = again.savedSearch('bairro=Gl%C3%B3ria')!;
    expect(unseen(s, ['a', 'c'])).toEqual(['c']);
    again.markSeen(s.query, ['a', 'c']);
    expect(unseen(again.savedSearch(s.query)!, ['a', 'c'])).toEqual([]);
    again.toggleSearch(s.query, '', []);
    expect(again.searches).toEqual([]);
  });

  it('no máximo 10 buscas', () => {
    const saved = new SavedLists('t');
    for (let i = 0; i < 10; i++) expect(saved.toggleSearch(`q=${i}`, `${i}`, [])).toBe(true);
    expect(saved.toggleSearch('q=10', '10', [])).toBe(false);
  });
});
