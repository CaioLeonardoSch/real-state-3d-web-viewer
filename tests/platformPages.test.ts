import { describe, expect, it } from 'vitest';
import { pageCode, pagePath } from '../src/seo/listingPage';
import { NOT_FOUND_SCRIPT, movedPage } from '../src/seo/platformPages';

const listings = [
  { id: 'apt-18', title: 'Apartamento com vista' },
  { id: '18', title: 'Casa' },
  { id: '5c1e9a2b-0000-4000-8000-000000000001', title: 'Sala comercial' },
];
const codes = Object.fromEntries(listings.map((l) => [pageCode(l.id), pagePath(l)]));

describe('páginas estáticas da plataforma', () => {
  it('título antigo leva à página atual pelo código; o que saiu do site não leva a lugar nenhum', () => {
    expect(movedPage('/imovel/apartamento-reformado-apt-18/', codes)).toBe('imovel/apartamento-com-vista-apt-18/');
    expect(movedPage('/imovel/casa-antiga-18', codes)).toBe('imovel/casa-18/');
    expect(movedPage('/imovel/sala-5c1e9a2b/', codes)).toBe('imovel/sala-comercial-5c1e9a2b/');
    expect(movedPage('/imovel/vendido-apt-99/', codes)).toBeNull();
    expect(movedPage('/sobre/', codes)).toBeNull();
    expect(movedPage('/imovel/%E0%A4%A/', codes)).toBeNull();
    expect(movedPage('/imovel/constructor/', codes)).toBeNull();
  });

  it('o script do 404.html faz o mesmo no navegador', async () => {
    const run = (pathname: string) =>
      new Promise<string | null>((resolve) => {
        const doc = { currentScript: { dataset: { base: 'https://x.dev/r/' } } };
        const loc = { pathname, replace: (u: string) => resolve(u) };
        const fetchFn = async () => ({ json: async () => codes });
        new Function('document', 'location', 'fetch', NOT_FOUND_SCRIPT)(doc, loc, fetchFn);
        setTimeout(() => resolve(null), 20);
      });
    expect(await run('/r/imovel/apartamento-reformado-apt-18/')).toBe('https://x.dev/r/imovel/apartamento-com-vista-apt-18/');
    expect(await run('/r/imovel/vendido-apt-99/')).toBeNull();
  });
});
