// Body of a client's page as the server sends it (src/seo/siteServer.ts): the heading, the listing's price, facts,
// description and first photo, and links to every listing, so robots that do not run JavaScript (and the Google
// before it renders) read the page's content and follow its links. The site replaces it as soon as its script runs
// (app.ts renders into #site). Plain HTML with the site's classes; loaded by Node, hence the ".ts" imports.
import type { Listing } from '../data/types.ts';
import { TYPE_LABELS } from '../data/types.ts';
import { MENU_LABELS, formatPhone, type SiteConfig } from '../site/config.ts';
import { listingPath, routePath, type PageMeta, type Route } from '../site/routes.ts';
import { escapeHtml as esc } from '../utils/format.ts';
import { brl, listingFacts, shownAddress } from './listingPage.ts';

/** Links listed on a page of listings: enough for a crawler to reach them all on a client's site. */
const MAX_LINKS = 500;
const LATEST = 12;

export interface BodyPage {
  route: Route | 'nao-encontrada';
  listing?: Listing;
}

const price = (l: Listing) => (l.transaction === 'rent' ? `${brl(l.rentPrice ?? l.price)}/mês` : brl(l.price));

function listingLinks(listings: readonly Listing[], max: number): string {
  if (!listings.length) return '<p>Nenhum imóvel publicado no momento.</p>';
  const items = listings.slice(0, max).map((l) => {
    const where = l.address?.bairro ? ` · ${esc(l.address.bairro)}` : '';
    return `<li><a href="${esc(listingPath(l))}">${esc(l.title)}</a> — ${esc(TYPE_LABELS[l.type])}, ${esc(price(l))}${where}</li>`;
  });
  return `<ul class="ssr-list">${items.join('')}</ul>`;
}

function listingMain(l: Listing, c: SiteConfig): string {
  const addr = shownAddress(l).line;
  const cover = l.photos?.[0];
  return `<h1>${esc(l.title)}</h1>
<p class="ssr-price">${esc(price(l))}</p>
${addr ? `<p>${esc(addr)}</p>` : ''}
${cover ? `<img src="${esc(cover.src)}" alt="${esc(cover.caption ?? l.title)}" width="960" height="640">` : ''}
<dl class="ssr-facts">${listingFacts(l).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
<p>${esc(l.description).replace(/\n/g, '<br>')}</p>
<p>Anunciado por <strong>${esc(c.name)}</strong>${c.creci ? ` · CRECI ${esc(c.creci)}` : ''}.</p>
<p><a href="${routePath('imoveis')}">Ver todos os imóveis</a></p>`;
}

function contacts(c: SiteConfig): string {
  const k = c.contacts;
  const lines = [
    k.phone && `Telefone: ${esc(formatPhone(k.phone))}`,
    k.whatsapp && `WhatsApp: ${esc(formatPhone(k.whatsapp))}`,
    k.email && `E-mail: <a href="mailto:${esc(k.email)}">${esc(k.email)}</a>`,
    k.address && esc(k.address),
    k.hours && esc(k.hours),
  ].filter(Boolean);
  return lines.length ? `<p>${lines.join('<br>')}</p>` : '';
}

/** The page's content inside #site: header with the menu, main and footer. */
export function renderSiteBody(c: SiteConfig, page: BodyPage, meta: PageMeta, listings: readonly Listing[]): string {
  const menu = [
    `<li><a href="/">Início</a></li>`,
    `<li><a href="${routePath('imoveis')}">Imóveis</a></li>`,
    ...(['sobre', 'contato', 'anunciar'] as const).filter((r) => c.menu.includes(r)).map((r) => `<li><a href="${routePath(r)}">${esc(MENU_LABELS[r])}</a></li>`),
  ];
  let main: string;
  if (page.route === 'imovel' && page.listing) main = listingMain(page.listing, c);
  else if (page.route === 'imovel') main = `<h1>Imóvel não encontrado</h1><p>Ele pode ter sido vendido ou retirado do site.</p><p><a href="${routePath('imoveis')}">Ver os imóveis disponíveis</a></p>`;
  else if (page.route === 'nao-encontrada') main = `<h1>Página não encontrada</h1><p><a href="/">Página inicial</a></p>`;
  else if (page.route === 'imoveis') main = `<h1>Imóveis à venda e para alugar</h1>${listingLinks(listings, MAX_LINKS)}`;
  else if (page.route === 'inicio')
    main = `<h1>${esc(c.home.title || c.name)}</h1>${meta.description ? `<p>${esc(meta.description)}</p>` : ''}<h2>Imóveis recentes</h2>${listingLinks(
      [...listings].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')),
      LATEST,
    )}<p><a href="${routePath('imoveis')}">Ver todos os imóveis</a></p>`;
  else if (page.route === 'sobre') main = `<h1>${esc(c.about.title)}</h1>${c.about.text ? `<p>${esc(c.about.text).replace(/\n/g, '<br>')}</p>` : ''}`;
  else if (page.route === 'contato') main = `<h1>Contato</h1>${contacts(c)}`;
  else main = `<h1>${esc(meta.title.split(' · ')[0])}</h1>${meta.description ? `<p>${esc(meta.description)}</p>` : ''}`;
  return `<header class="ssr-header"><a href="/"><strong>${esc(c.name)}</strong></a><nav aria-label="Menu"><ul>${menu.join('')}</ul></nav></header>
<main class="wrap ssr">${main}</main>
<footer class="ssr-footer"><p>${esc(c.name)}${c.creci ? ` · CRECI ${esc(c.creci)}` : ''}</p>${page.route === 'contato' ? '' : contacts(c)}</footer>`;
}
