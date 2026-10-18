// Addresses and titles of the pages of a client's site. On the client's own domain the pages have clean paths that
// search engines index ("/", "/imoveis", "/imovel/casa-com-piscina-ref-102", "/sobre"...), and src/seo/siteServer.ts
// sends each one with its title already in the HTML. Elsewhere (the demo, the provisional ?imobiliaria= address) they
// stay "?p=<page>" on site.html. Loaded by the site and by the server (Node), hence the ".ts" imports.
import type { Listing } from '../data/types.ts';
import { slugify } from '../seo/listingPage.ts';
import { formatPhone, type SiteConfig } from './config.ts';
import { REGION } from '../config/region.ts';

export const ROUTES = ['inicio', 'imoveis', 'imovel', 'sobre', 'contato', 'anunciar', 'favoritos', 'comparar'] as const;
export type Route = (typeof ROUTES)[number];

type Ref = Pick<Listing, 'id' | 'title' | 'referenceCode'>;

/** Code shown to visitors: the advertiser's reference, else the listing id. */
export const codeOf = (l: Pick<Listing, 'id' | 'referenceCode'>) => l.referenceCode ?? l.id.toUpperCase();

/** Code part of a listing's address: its reference (unique in the client), else the start of its id. */
const codeSlug = (l: Ref) => slugify(l.referenceCode ?? '') || slugify(l.id.slice(0, 8));

/** Address of a listing: its title and its code, which is what finds it ("/imovel/casa-com-piscina-ref-102"). */
export const listingPath = (l: Ref) => `/imovel/${[slugify(l.title), codeSlug(l)].filter(Boolean).join('-')}`;

export const routePath = (r: Route) => (r === 'inicio' ? '/' : `/${r}`);

/**
 * The page of a clean path: its route and, under "/imovel/", the listing, found by the code at the end of the address
 * so that a link with an older title still works ("listing" absent: no such listing). Null: no such page.
 */
export function parsePath<L extends Ref>(pathname: string, listings: readonly L[]): { route: Route; listing?: L } | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname).toLowerCase().replace(/\/+$/, '');
  } catch {
    return null;
  }
  const slug = /^\/imovel\/([^/]+)$/.exec(path)?.[1];
  if (slug) {
    // the longest code that ends the address wins ("...-ap-102" before "...-102")
    let found: L | undefined;
    for (const l of listings) {
      const code = codeSlug(l);
      if ((slug === code || slug.endsWith(`-${code}`)) && code.length > (found ? codeSlug(found).length : 0)) found = l;
    }
    return { route: 'imovel', listing: found };
  }
  const route = (path.slice(1) || 'inicio') as Route;
  return ROUTES.includes(route) ? { route } : null;
}

export interface PageMeta {
  title: string;
  description: string;
  /** Kept out of search engines. */
  noindex?: boolean;
}

/**
 * Title and description of the pages that are not a listing, the same on the server and on the site (the search page
 * replaces its own with the number of results once it runs).
 */
export function pageMeta(page: Exclude<Route, 'imovel'> | 'nao-encontrada' | 'imovel-nao-encontrado', c: SiteConfig): PageMeta {
  const intro = c.seo.description || c.home.subtitle || `Imóveis de ${c.name}.`;
  switch (page) {
    case 'inicio':
      return { title: `${c.name} · Imóveis em ${REGION.city}`, description: intro };
    case 'imoveis':
      return { title: `Imóveis à venda e para alugar · ${c.name}`, description: intro };
    case 'sobre':
      return { title: `${c.about.title} · ${c.name}`, description: c.about.text.slice(0, 200) || `Conheça a ${c.name}.` };
    case 'contato':
      return {
        title: `Contato · ${c.name}`,
        description: `Fale com a ${c.name}: ${[c.contacts.phone && formatPhone(c.contacts.phone), c.contacts.email].filter(Boolean).join(' · ')}`,
      };
    case 'anunciar':
      return { title: `Anuncie seu imóvel · ${c.name}`, description: `Quer vender ou alugar? Anuncie com a ${c.name}: site, mapa 3D e portais.` };
    // lists kept in the visitor's own browser: nothing for a search engine
    case 'favoritos':
      return { title: `Favoritos · ${c.name}`, description: 'Imóveis que você salvou.', noindex: true };
    case 'comparar':
      return { title: `Comparar imóveis · ${c.name}`, description: 'Compare imóveis lado a lado.', noindex: true };
    case 'imovel-nao-encontrado':
      return { title: `Imóvel não encontrado · ${c.name}`, description: '', noindex: true };
    default:
      return { title: `Página não encontrada · ${c.name}`, description: '', noindex: true };
  }
}
