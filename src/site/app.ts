// The client's site: header, pages and footer built from its configuration (src/site/config.ts). Pages are
// rendered in the browser from the listings already loaded, so moving around the site needs no request.
// Routes live in the query string (?p=imoveis&bairro=Glória), so every page and search is a real, shareable URL.
import {
  AMENITIES,
  AMENITY_LABELS,
  AVAILABILITY_LABELS,
  LISTING_TYPES,
  STATUS_LABELS,
  TRANSACTION_LABELS,
  TYPE_LABELS,
  USAGE_LABELS,
  hasBedrooms,
  priceIn,
  priceReduction,
  isForRent,
  type Listing,
  type Photo,
} from '../data/types';
import { addressLabel, formatDate, safeUrl, videoEmbedUrl } from '../data/listingText';
import { CONSTRUCTION_SOURCE_LABELS, builtShare, formatMonth, progressLabel } from '../data/construction';
import { EMPTY_CRITERIA, cloneCriteria, filterListings, normalizeName } from '../state/filters';
import { SORT_KEYS, SORT_LABELS } from '../state/sort';
import { description as seoDescription, structuredData } from '../seo/listingPage';
import { escapeHtml, formatArea, formatBRL, parseNumberInput } from '../utils/format';
import { photoSrcset } from '../utils/images';
import {
  MENU_LABELS,
  SOCIALS,
  SOCIAL_LABELS,
  formatPhone,
  telHref,
  themeVars,
  whatsappHref,
  type MenuItem,
  type SiteConfig,
} from './config';
import { cardHtml, photosOf, placeOf, priceHtml, specsHtml, wireCarousels, type CardContext } from './cards';
import type { SiteData } from './data';
import { fontFaceCss } from './fonts';
import { leadFormHtml, wireLeadForm } from './forms';
import { financingHtml, wireFinancing } from '../ui/financingSim';
import { ICONS } from './icons';
import { ROUTES, codeOf, listingPath, pageMeta, parsePath, routePath, type Route } from './routes';
import { MAX_COMPARE, SavedLists } from './saved';
import { bairroCounts, chipsOf, emptySearch, pageOf, queryToSearch, resultsTitle, runSearch, searchToQuery, type SiteSearch } from './search';


const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel)!;

/**
 * The gallery's photo: phones get up to the 1024 px version, wider screens up to the 1920 px one (photos stored in
 * three sizes; others, the one they have).
 */
function galleryPhoto(p: Photo, alt: string): string {
  const wide = photoSrcset(p);
  const img = (set: string | null) => `<img src="${escapeHtml(p.src)}"${set ? ` srcset="${escapeHtml(set)}" sizes="100vw"` : ''} alt="${escapeHtml(alt)}">`;
  return wide ? `<picture><source media="(min-width: 700px)" srcset="${escapeHtml(wide)}" sizes="(max-width: 1240px) 100vw, 1200px">${img(photoSrcset(p, 'src'))}</picture>` : img(null);
}
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

export class SiteApp {
  config: SiteConfig;
  readonly saved: SavedLists;
  private route: Route = 'inicio';
  /** The address names a page that does not exist (shown as "Página não encontrada", out of search engines). */
  private notFound = false;
  /** The last search was for rentals (the comparison opens in the same mode). */
  private lastRent = false;
  private liveTimer = 0;
  private live = Object.assign(document.createElement('div'), { id: 'site-live', className: 'sr-only' });
  private params = new URLSearchParams();
  private search: SiteSearch;
  /** Map frame of the search page (kept while only the results change). */
  private mapFrame: HTMLIFrameElement | null = null;
  private mapReady = false;
  /** Keeps ?imobiliaria= in links when the site was opened that way (not on the client's own domain). */
  private keep: Record<string, string> = {};
  /** On the client's own domain the server (src/seo/siteServer.ts) marks the page: clean addresses (./routes). */
  private readonly paths = !!document.querySelector('meta[name="site-paths"]');
  private fitBound = false;
  private fitTimer = 0;
  private wireHeaderFit: () => void = () => {};

  constructor(
    private root: HTMLElement,
    readonly data: SiteData,
  ) {
    this.config = data.config;
    this.live.setAttribute('aria-live', 'polite');
    document.body.append(this.live);
    this.saved = new SavedLists(data.slug);
    this.saved.prune(new Set(data.listings.map((l) => l.id)));
    const first = new URLSearchParams(location.search);
    if (first.get('imobiliaria')) this.keep.imobiliaria = first.get('imobiliaria')!;
    this.search = emptySearch(this.config.search.sort, this.config.search.view);
    this.saved.onChange(() => this.refreshSavedUi());
    window.addEventListener('popstate', () => this.load());
    // Esc closes the open panel: the phone menu, then the filters
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || document.body.classList.contains('editing')) return;
      const toggle = this.root.querySelector<HTMLButtonElement>('.nav-toggle[aria-expanded="true"]');
      if (toggle) {
        this.setMenu(false);
        toggle.focus();
        return;
      }
      const filters = this.root.querySelector<HTMLButtonElement>('.filters-btn[aria-expanded="true"]');
      if (filters) {
        filters.click();
        filters.focus();
      }
    });
    window.addEventListener('message', (e) => this.onMapMessage(e));
    // internal links: no reload
    document.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-nav]');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      this.go(a.getAttribute('href')!);
    });
    // demo: fictional contacts never open a real WhatsApp conversation or phone call
    document.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-contact]');
      if (!a || !this.data.demo) return;
      e.preventDefault();
      this.toast('Demonstração: no site de uma imobiliária de verdade, este botão abre o WhatsApp (ou a ligação) com ela.');
    });
    document.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-contact][data-listing]');
      if (a && !this.data.demo) this.data.remote?.whatsappClick(a.dataset.listing!);
    });
    this.root.addEventListener('click', (e) => this.onSavedClick(e));
    this.root.addEventListener('change', (e) => this.onSavedChange(e));
    wireCarousels(this.root);
  }

  // ---------------------------------------------------------------- routing

  href(route: string, params: Record<string, string> | URLSearchParams = {}): string {
    const p = new URLSearchParams(this.paths ? {} : { ...this.keep });
    if (route !== 'inicio' && !this.paths) p.set('p', route);
    for (const [k, v] of params instanceof URLSearchParams ? params : Object.entries(params)) p.append(k, v);
    let path = location.pathname;
    if (this.paths) {
      // a listing's own address, when it is known (the map's "__ID__" template stays "/imovel?id=")
      const l = route === 'imovel' ? this.data.listings.find((x) => x.id === p.get('id')) : undefined;
      if (l) p.delete('id');
      path = l ? listingPath(l) : routePath(route as Route);
    }
    const s = p.toString();
    return `${path}${s ? `?${s}` : ''}`;
  }

  /** Search of one neighbourhood (default order and view). */
  private bairroSearch(bairro: string): SiteSearch {
    const s = emptySearch(this.config.search.sort, this.config.search.view);
    s.criteria.bairros = [bairro];
    return s;
  }

  private searchHref(s: SiteSearch): string {
    return this.href('imoveis', searchToQuery(s, this.config.search));
  }

  go(url: string, replace = false): void {
    const next = new URL(url, location.href);
    const samePage = (this.paths ? next.pathname === location.pathname : next.searchParams.get('p') === this.params.get('p')) && this.route !== 'imovel';
    if (replace) history.replaceState(null, '', next);
    else history.pushState(null, '', next);
    this.load(!samePage);
  }

  /**
   * Renders the page the address bar points to. After navigating to another page, the focus goes to its heading and
   * screen readers hear the new title (a single-page site would otherwise leave them on the old link).
   */
  load(scrollTop = true, focus = scrollTop): void {
    this.params = new URLSearchParams(location.search);
    if (this.paths) {
      const page = parsePath(location.pathname, this.data.listings);
      this.notFound = !page;
      this.route = page?.route ?? 'inicio';
      if (page?.listing) this.params.set('id', page.listing.id);
    } else {
      const p = this.params.get('p') as Route | null;
      this.notFound = !!p && !ROUTES.includes(p);
      this.route = p && ROUTES.includes(p) ? p : 'inicio';
    }
    this.render();
    if (this.route === 'imovel' && !this.data.demo && this.params.get('id')) this.data.remote?.trackView(this.params.get('id')!, 'site');
    if (scrollTop) window.scrollTo({ top: 0 });
    if (focus) {
      const h1 = this.root.querySelector<HTMLElement>('main h1');
      if (h1) {
        h1.tabIndex = -1;
        h1.focus({ preventScroll: true });
      }
      this.say(document.title);
    }
  }

  /**
   * Message for screen readers: a polite live region outside the page (which is redrawn), created with the app so it
   * is already in the accessibility tree when the first message arrives.
   */
  say(text: string, delay = 0): void {
    clearTimeout(this.liveTimer);
    this.liveTimer = window.setTimeout(() => (this.live.textContent = text), delay);
  }

  /** Re-applies the configuration (editor preview) without leaving the page. */
  setConfig(c: SiteConfig): void {
    this.config = c;
    this.render();
  }

  // ---------------------------------------------------------------- shell

  render(): void {
    const c = this.config;
    this.applyTheme();
    if (this.route !== 'imoveis') this.mapFrame = null;
    const parked = this.parkMap();
    this.root.innerHTML = `
      <a class="skip" href="#conteudo">Pular para o conteúdo</a>
      ${this.data.demo ? `<div class="demo-note" role="note">Site de demonstração: imobiliária, contatos e imóveis fictícios. <button type="button" class="link-btn" data-open-editor>Personalizar este site</button></div>` : ''}
      ${this.headerHtml()}
      <main id="conteudo" tabindex="-1" class="page page-${this.route}"></main>
      ${this.footerHtml()}
      ${c.whatsappButton.enabled && c.contacts.whatsapp ? `<a class="wa-float" data-contact href="${escapeHtml(whatsappHref(c.contacts.whatsapp, c.whatsappButton.message))}" target="_blank" rel="noopener" aria-label="Conversar no WhatsApp">${ICONS.whatsapp}</a>` : ''}
      <div class="compare-bar" hidden></div>`;
    const main = $<HTMLElement>(this.root, 'main');
    const pages: Record<Route, (el: HTMLElement) => void> = {
      inicio: (el) => this.home(el),
      imoveis: (el) => this.searchPage(el),
      imovel: (el) => this.detail(el),
      sobre: (el) => this.about(el),
      contato: (el) => this.contact(el),
      anunciar: (el) => this.announce(el),
      favoritos: (el) => this.favorites(el),
      comparar: (el) => this.compare(el),
    };
    if (this.notFound) this.missingPage(main);
    else pages[this.route](main);
    // the new page did not take the map back
    if (parked?.parentElement === document.body) parked.remove();
    this.wireHeader();
    this.refreshSavedUi();
  }

  /**
   * Redrawing the page (the editor's preview redraws it as the agency types) would reload the search's 3D map: a frame
   * reloads when it leaves the document. Where the browser can move a frame without reloading it (moveBefore), the map
   * waits outside the page and the new page takes it back (showMap).
   */
  private parkMap(): HTMLIFrameElement | null {
    const frame = this.mapFrame;
    if (!frame?.isConnected || !('moveBefore' in Element.prototype)) return null;
    document.body.moveBefore(frame, null);
    return frame;
  }

  private applyTheme(): void {
    const c = this.config;
    const html = document.documentElement;
    for (const [k, v] of Object.entries(themeVars(c))) html.style.setProperty(k, v);
    html.dataset.theme = c.theme;
    html.dataset.template = c.template;
    // the chosen fonts, served by the site itself (./fonts)
    const faces = fontFaceCss(c);
    let style = document.querySelector<HTMLStyleElement>('style[data-fonts]');
    if (faces) {
      if (!style) {
        style = document.createElement('style');
        style.dataset.fonts = '';
        document.head.append(style);
      }
      if (style.textContent !== faces) style.textContent = faces;
    } else style?.remove();
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', c.colors.header);
    // tab icon: the client's logo, or a house in its colour
    const icon = document.querySelector<HTMLLinkElement>('link[rel=icon]');
    if (icon)
      icon.href =
        c.logo ||
        `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 1 1 7v8h5v-5h4v5h5V7z" fill="${c.colors.primary}"/></svg>`)}`;
  }

  /** Title and description of a page without a listing (./routes, the same the server sends). */
  private setPage(page: Parameters<typeof pageMeta>[0]): void {
    const m = pageMeta(page, this.config);
    this.setMeta(m.title, m.description, undefined, m.noindex);
  }

  private setMeta(title: string, description: string, canonical?: string, noindex = false): void {
    document.title = title;
    // on the client's domain each page has its own address (a search leaves its filters out of it)
    if (this.paths && !noindex) canonical ??= location.origin + routePath(this.route);
    // pages that do not exist stay out of search engines (the demo's site-wide noindex is a separate tag)
    document.querySelector('meta[name=robots][data-page]')?.remove();
    if (noindex) document.head.insertAdjacentHTML('beforeend', '<meta name="robots" content="noindex" data-page>');
    document.querySelector('meta[name=description]')?.setAttribute('content', description.slice(0, 300));
    let link = document.querySelector<HTMLLinkElement>('link[rel=canonical]');
    if (canonical) {
      if (!link) {
        link = document.createElement('link');
        link.rel = 'canonical';
        document.head.append(link);
      }
      link.href = canonical;
    } else link?.remove();
    document.querySelector('script[data-ld]')?.remove();
  }

  private menuHref(item: MenuItem): string {
    const s = emptySearch(this.config.search.sort, this.config.search.view);
    switch (item) {
      case 'venda':
        return this.searchHref(s);
      case 'locacao':
        return this.searchHref({ ...s, criteria: { ...s.criteria, transaction: 'rent' } });
      case 'lancamentos':
        return this.searchHref({ ...s, criteria: { ...s.criteria, statuses: ['under_construction'] } });
      case 'descontos':
        return this.searchHref({ ...s, criteria: { ...s.criteria, reducedOnly: true } });
      case 'mapa':
        return this.searchHref({ ...s, view: 'mapa' });
      default:
        return this.href(item);
    }
  }

  /** Menu item matching the current page (aria-current). */
  private activeItem(): MenuItem | null {
    if (this.route === 'imoveis') {
      const s = this.search;
      if (s.view === 'mapa') return 'mapa';
      if (s.criteria.reducedOnly) return 'descontos';
      if (s.criteria.statuses.length === 1 && s.criteria.statuses[0] === 'under_construction') return 'lancamentos';
      return s.criteria.transaction === 'rent' ? 'locacao' : 'venda';
    }
    return (['sobre', 'anunciar', 'contato', 'favoritos'] as const).find((x) => x === this.route) ?? null;
  }

  private brandHtml(): string {
    const c = this.config;
    return c.logo
      ? `<img src="${escapeHtml(c.logo)}" alt="${escapeHtml(c.name)}" style="height:${c.logoHeight}px">`
      : `<span class="brand-name">${escapeHtml(c.name)}</span>`;
  }

  private socialHtml(): string {
    const c = this.config;
    return SOCIALS.filter((s) => c.social[s])
      .map((s) => `<a href="${escapeHtml(c.social[s])}" target="_blank" rel="noopener" aria-label="${SOCIAL_LABELS[s]}">${ICONS[s]}</a>`)
      .join('');
  }

  private headerHtml(): string {
    const c = this.config;
    const active = this.activeItem();
    const strip = ['classico', 'lateral', 'escuro'].includes(c.template) && (c.contacts.phone || c.contacts.email || c.contacts.whatsapp);
    const favCount = this.saved.favorites.length;
    return `<header class="site-header">
      ${
        strip
          ? `<div class="strip"><div class="wrap">
              ${c.contacts.whatsapp ? `<a data-contact href="${escapeHtml(whatsappHref(c.contacts.whatsapp, c.whatsappButton.message))}" target="_blank" rel="noopener">${ICONS.whatsapp}${escapeHtml(formatPhone(c.contacts.whatsapp))}</a>` : ''}
              ${c.contacts.phone ? `<a data-contact href="${escapeHtml(telHref(c.contacts.phone))}">${ICONS.phone}${escapeHtml(formatPhone(c.contacts.phone))}</a>` : ''}
              ${c.contacts.email ? `<a href="mailto:${escapeHtml(c.contacts.email)}">${ICONS.mail}${escapeHtml(c.contacts.email)}</a>` : ''}
              <span class="strip-social">${this.socialHtml()}</span>
            </div></div>`
          : ''
      }
      <div class="wrap bar">
        <a class="brand" href="${escapeHtml(this.href('inicio'))}" data-nav>${this.brandHtml()}${c.creci ? `<small class="brand-creci">CRECI ${escapeHtml(c.creci)}</small>` : ''}</a>
        <button type="button" class="icon-btn nav-toggle" aria-expanded="false" aria-controls="site-nav" aria-label="Menu">${ICONS.menu}</button>
        <nav id="site-nav" class="nav" aria-label="Principal">
          <ul>${c.menu
            .map((m) => `<li><a href="${escapeHtml(this.menuHref(m))}" data-nav${m === active ? ' aria-current="page"' : ''}>${MENU_LABELS[m]}${m === 'favoritos' ? ` <span class="nav-count"${favCount ? '' : ' hidden'}>${favCount}</span>` : ''}</a></li>`)
            .join('')}</ul>
        </nav>
        <div class="bar-actions">
          ${c.menu.includes('favoritos') ? '' : `<a class="icon-btn fav-link" href="${escapeHtml(this.href('favoritos'))}" data-nav>${ICONS.heart}<span class="sr-only">Favoritos </span><span class="nav-count" ${favCount ? '' : 'hidden'}>${favCount}</span></a>`}
          ${c.contacts.whatsapp ? `<a class="btn btn-wa" data-contact href="${escapeHtml(whatsappHref(c.contacts.whatsapp, c.whatsappButton.message))}" target="_blank" rel="noopener" aria-label="Conversar no WhatsApp">${ICONS.whatsapp}<span>WhatsApp</span></a>` : ''}
        </div>
      </div>
    </header>`;
  }

  private wireHeader(): void {
    // a long menu (or a long name) that does not fit collapses into the menu button, at any width
    const header = this.root.querySelector<HTMLElement>('.site-header');
    const bar = this.root.querySelector<HTMLElement>('.site-header .bar');
    const fit = () => {
      if (!header || !bar) return;
      header.classList.remove('compact');
      if (bar.scrollWidth > bar.clientWidth + 1) header.classList.add('compact');
    };
    fit();
    if (!this.fitBound) {
      this.fitBound = true;
      window.addEventListener('resize', () => {
        clearTimeout(this.fitTimer);
        this.fitTimer = window.setTimeout(() => this.wireHeaderFit(), 120);
      });
    }
    this.wireHeaderFit = fit;
    const toggle = this.root.querySelector<HTMLButtonElement>('.nav-toggle');
    toggle?.addEventListener('click', () => this.setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  }

  /** Phone menu: while open, the page behind it is inert (Tab stays in the menu; Esc closes it). */
  private setMenu(open: boolean): void {
    const toggle = this.root.querySelector<HTMLButtonElement>('.nav-toggle');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', String(open));
    this.root.querySelector('.site-header')!.classList.toggle('nav-open', open);
    for (const el of this.root.querySelectorAll<HTMLElement>('main, footer, .wa-float, .compare-bar')) el.inert = open;
    if (open) this.root.querySelector<HTMLAnchorElement>('#site-nav a')?.focus();
  }

  private footerHtml(): string {
    const c = this.config;
    const year = new Date().getFullYear();
    return `<footer class="site-footer"><div class="wrap foot-grid">
      <div>
        <a class="brand" href="${escapeHtml(this.href('inicio'))}" data-nav>${this.brandHtml()}</a>
        ${c.creci ? `<p>CRECI ${escapeHtml(c.creci)}</p>` : ''}
        <p class="foot-social">${this.socialHtml()}</p>
      </div>
      <div>
        <h2>Atendimento</h2>
        <ul class="foot-list">
          ${c.contacts.whatsapp ? `<li><a data-contact href="${escapeHtml(whatsappHref(c.contacts.whatsapp, c.whatsappButton.message))}" target="_blank" rel="noopener">${ICONS.whatsapp}${escapeHtml(formatPhone(c.contacts.whatsapp))}</a></li>` : ''}
          ${c.contacts.phone ? `<li><a data-contact href="${escapeHtml(telHref(c.contacts.phone))}">${ICONS.phone}${escapeHtml(formatPhone(c.contacts.phone))}</a></li>` : ''}
          ${c.contacts.email ? `<li><a href="mailto:${escapeHtml(c.contacts.email)}">${ICONS.mail}${escapeHtml(c.contacts.email)}</a></li>` : ''}
          ${c.contacts.address ? `<li>${ICONS.pin}<span>${escapeHtml(c.contacts.address)}</span></li>` : ''}
          ${c.contacts.hours ? `<li>${ICONS.clock}<span>${escapeHtml(c.contacts.hours)}</span></li>` : ''}
        </ul>
      </div>
      <div>
        <h2>Navegue</h2>
        <ul class="foot-list">${c.menu.map((m) => `<li><a href="${escapeHtml(this.menuHref(m))}" data-nav>${MENU_LABELS[m]}</a></li>`).join('')}
          <li><a href="${escapeHtml(this.href('favoritos'))}" data-nav>Favoritos</a></li></ul>
      </div>
    </div>
    <div class="wrap foot-legal"><span>© ${year} ${escapeHtml(c.name)}. Seus dados só são usados para o atendimento que você pedir (LGPD).</span><span>Mapa 3D da cidade com dados © OpenStreetMap.</span></div>
    </footer>`;
  }

  /** Short notice; lives outside the page, so a re-render (editor preview) does not erase it. */
  toast(text: string): void {
    let t = document.querySelector<HTMLElement>('body > .toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.append(t);
    }
    t.textContent = text;
    t.hidden = false;
    clearTimeout(Number(t.dataset.timer));
    const el = t;
    t.dataset.timer = String(setTimeout(() => (el.hidden = true), 4500));
  }

  // ---------------------------------------------------------------- favourites and compare

  private cardCtx(rent = false): CardContext {
    return {
      config: this.config,
      href: (r, p) => this.href(r, p),
      isFavorite: this.saved.isFavorite,
      isCompared: this.saved.isCompared,
      rent,
    };
  }

  private onSavedClick(e: Event): void {
    const fav = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fav]');
    if (fav) {
      e.preventDefault();
      const on = this.saved.toggleFavorite(fav.dataset.fav!);
      this.toast(on ? 'Salvo nos favoritos (neste navegador).' : 'Removido dos favoritos.');
      if (this.route === 'favoritos') this.render();
    }
  }

  private onSavedChange(e: Event): void {
    const box = (e.target as HTMLElement).closest<HTMLInputElement>('[data-cmp]');
    if (!box) return;
    if (!this.saved.toggleCompare(box.dataset.cmp!)) {
      box.checked = false;
      this.toast(`Compare até ${MAX_COMPARE} imóveis por vez.`);
    }
  }

  private refreshSavedUi(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-fav]').forEach((b) => {
      const on = this.saved.isFavorite(b.dataset.fav!);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-cmp]').forEach((b) => (b.checked = this.saved.isCompared(b.dataset.cmp!)));
    const n = this.saved.favorites.length;
    this.root.querySelectorAll<HTMLElement>('.site-header .nav-count').forEach((el) => {
      el.textContent = String(n);
      el.hidden = n === 0;
    });
    const bar = this.root.querySelector<HTMLElement>('.compare-bar');
    if (bar) {
      const k = this.saved.compared.length;
      bar.hidden = k === 0 || this.route === 'comparar';
      bar.innerHTML = `<span>${plural(k, 'imóvel selecionado', 'imóveis selecionados')} para comparar</span>
        <a class="btn btn-primary" href="${escapeHtml(this.href('comparar', this.lastRent ? { negocio: 'alugar' } : {}))}" data-nav>Comparar</a>
        <button type="button" class="btn btn-ghost" data-clear-cmp>Limpar</button>`;
      bar.querySelector('[data-clear-cmp]')?.addEventListener('click', () => this.saved.clearCompare());
    }
  }

  // ---------------------------------------------------------------- home

  private home(main: HTMLElement): void {
    const c = this.config;
    const all = this.data.listings;
    this.setPage('inicio');
    const hero = c.home.heroImage
      ? `style="--hero-img:url('${escapeHtml(c.home.heroImage.replace(/'/g, '%27').replace(/\\/g, '%5C'))}')"`
      : '';
    main.innerHTML = `
      <section class="hero${c.home.heroImage ? ' with-img' : ''}" ${hero}>
        <div class="wrap hero-text">
          <h1>${escapeHtml(c.home.title)}</h1>
          ${c.home.subtitle ? `<p>${escapeHtml(c.home.subtitle)}</p>` : ''}
        </div>
        <div class="wrap"><div class="quick" role="search"></div></div>
      </section>
      <div class="home-sections"></div>`;
    this.quickSearch($(main, '.quick'));
    const sections = $(main, '.home-sections');
    const ctx = this.cardCtx();
    const row = (title: string, list: Listing[], more: string) =>
      list.length
        ? `<section class="wrap home-sec"><div class="sec-head"><h2>${escapeHtml(title)}</h2><a href="${escapeHtml(more)}" data-nav class="more">Ver todos ${ICONS.right}</a></div>
            <div class="rail" tabindex="0" aria-label="${escapeHtml(title)}">${list.map((l) => cardHtml(l, ctx)).join('')}</div>
            <div class="rail-nav"><button type="button" class="icon-btn" data-rail="-1" aria-label="Anteriores">${ICONS.left}</button><button type="button" class="icon-btn" data-rail="1" aria-label="Próximos">${ICONS.right}</button></div></section>`
        : '';
    const base = emptySearch(c.search.sort, c.search.view);
    const forSale = filterListings(all, EMPTY_CRITERIA);
    const parts: string[] = [];
    for (const sec of c.home.sections) {
      if (sec === 'destaques') {
        const list = forSale.filter((l) => l.highlight && l.highlight !== 'standard');
        parts.push(row('Imóveis em destaque', (list.length ? list : forSale).slice(0, 12), this.searchHref({ ...base, sort: 'relevance' })));
      } else if (sec === 'descontos') {
        const list = forSale.filter((l) => priceReduction(l)).sort((a, b) => priceReduction(b)!.percent - priceReduction(a)!.percent);
        parts.push(row('Baixaram o preço', list.slice(0, 12), this.searchHref({ ...base, criteria: { ...base.criteria, reducedOnly: true } })));
      } else if (sec === 'lancamentos') {
        const list = forSale.filter((l) => l.status === 'under_construction');
        parts.push(row('Lançamentos', list.slice(0, 12), this.searchHref({ ...base, criteria: { ...base.criteria, statuses: ['under_construction'] } })));
      } else if (sec === 'recentes') {
        const list = [...forSale].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
        parts.push(row('Anunciados recentemente', list.slice(0, 12), this.searchHref({ ...base, sort: 'recent' })));
      } else if (sec === 'mapa') {
        parts.push(`<section class="wrap home-sec"><a class="map-cta" href="${escapeHtml(this.searchHref({ ...base, view: 'mapa' }))}" data-nav>
          <span class="map-cta-icon">${ICONS.cube}</span>
          <span><strong>Veja os imóveis no mapa 3D de Joinville</strong><span>Os prédios de verdade, a rua, o sol da manhã e da tarde, o que tem por perto. Coisa que fotos não mostram.</span></span>
          <span class="btn btn-primary">Abrir o mapa</span></a></section>`);
      } else if (sec === 'bairros') {
        const top = bairroCounts(all, false).slice(0, 8);
        if (top.length)
          parts.push(`<section class="wrap home-sec"><div class="sec-head"><h2>Bairros com mais imóveis</h2></div><ul class="bairros">${top
            .map((b) => `<li><a href="${escapeHtml(this.searchHref({ ...base, criteria: { ...base.criteria, bairros: [b.name] } }))}" data-nav><strong>${escapeHtml(b.name)}</strong><span>${plural(b.count, 'imóvel', 'imóveis')}</span></a></li>`)
            .join('')}</ul></section>`);
      } else if (sec === 'sobre' && c.about.text) {
        parts.push(`<section class="wrap home-sec about-teaser"><div><h2>${escapeHtml(c.about.title)}</h2><p>${escapeHtml(c.about.text.split('\n')[0])}</p>
          <a href="${escapeHtml(this.href('sobre'))}" data-nav class="more">Conheça ${ICONS.right}</a></div>${c.about.image ? `<img src="${escapeHtml(c.about.image)}" alt="" loading="lazy">` : ''}</section>`);
      } else if (sec === 'anunciar') {
        parts.push(`<section class="cta-band"><div class="wrap"><div><h2>Quer vender ou alugar seu imóvel?</h2><p>Anuncie com a ${escapeHtml(c.name)}: seu imóvel no site, no mapa 3D e nos portais.</p></div>
          <a class="btn btn-light" href="${escapeHtml(this.href('anunciar'))}" data-nav>Anunciar meu imóvel</a></div></section>`);
      }
    }
    sections.innerHTML = parts.join('');
    sections.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-rail]');
      if (!b) return;
      const rail = b.closest('.home-sec')!.querySelector<HTMLElement>('.rail')!;
      rail.scrollBy({ left: Number(b.dataset.rail) * rail.clientWidth * 0.9, behavior: 'smooth' });
    });
  }

  /** Quick search over the cover (636 style): deal tabs, type, neighbourhood, live count, optional filters. */
  private quickSearch(box: HTMLElement): void {
    const c = this.config;
    const all = this.data.listings;
    const hasRent = all.some(isForRent);
    let s = emptySearch(c.search.sort, c.search.view);
    const bairros = bairroCounts(all, false).map((b) => b.name);
    box.innerHTML = `
      <div class="q-tabs" role="group" aria-label="O que você procura">
        <button type="button" aria-pressed="true" data-deal="sale">Comprar</button>
        ${hasRent ? '<button type="button" aria-pressed="false" data-deal="rent">Alugar</button>' : ''}
        ${c.menu.includes('anunciar') ? `<a href="${escapeHtml(this.href('anunciar'))}" data-nav>Vender</a>` : ''}
      </div>
      <div class="q-row">
        <label class="fld"><span class="sr-only">Tipo de imóvel</span><select name="tipo"><option value="">Tipo de imóvel</option>${LISTING_TYPES.map((t) => `<option value="${t}">${TYPE_LABELS[t]}</option>`).join('')}</select></label>
        <label class="fld grow"><span class="sr-only">Bairro</span><input name="bairro" list="q-bairros" placeholder="Digite o bairro" autocomplete="off"><datalist id="q-bairros">${bairros.map((b) => `<option value="${escapeHtml(b)}">`).join('')}</datalist></label>
        <a class="btn btn-primary q-go" data-nav href="#">${ICONS.search}<span>Buscar</span> <span class="q-count"></span></a>
        <button type="button" class="btn btn-ghost q-more" aria-expanded="false" aria-controls="q-extra">Filtros ${ICONS.down}</button>
      </div>
      <div class="q-extra" id="q-extra" hidden>
        <div class="q-line">
          <div class="tabs" role="group" aria-label="Situação">
            <button type="button" data-st="" aria-pressed="true">Todos</button><button type="button" data-st="ready" aria-pressed="false">Prontos</button><button type="button" data-st="under_construction" aria-pressed="false">Lançamentos</button>
          </div>
          <label class="switch"><input type="checkbox" name="reduzido"><span class="track"></span> Apenas com desconto</label>
          <label class="fld code"><span class="sr-only">Código do imóvel</span><input name="codigo" placeholder="Buscar pelo código" maxlength="30"></label>
        </div>
        <div class="q-line">
          <fieldset class="box"><legend>Valor</legend><input name="precoMin" inputmode="numeric" placeholder="Mínimo" aria-label="Valor mínimo"><input name="precoMax" inputmode="numeric" placeholder="Máximo" aria-label="Valor máximo"></fieldset>
          ${this.countGroup('Quartos', 'quartos', null)}
          ${this.countGroup('Vagas', 'vagas', null)}
          <button type="button" class="link-btn q-clear">Limpar filtros</button>
        </div>
      </div>`;
    const go = $<HTMLAnchorElement>(box, '.q-go');
    const update = () => {
      const n = runSearch(all, s).length;
      $(box, '.q-count').textContent = String(n);
      go.href = this.searchHref(s);
      go.setAttribute('aria-label', `Buscar: ${plural(n, 'imóvel', 'imóveis')}`);
    };
    const set = (patch: Partial<SiteSearch>, crit: Partial<SiteSearch['criteria']> = {}) => {
      s = { ...s, ...patch, criteria: { ...s.criteria, ...crit } };
      update();
    };
    box.querySelectorAll<HTMLButtonElement>('[data-deal]').forEach((b) =>
      b.addEventListener('click', () => {
        box.querySelectorAll('[data-deal]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        set({}, { transaction: b.dataset.deal === 'rent' ? 'rent' : null });
      }),
    );
    box.querySelector<HTMLSelectElement>('[name=tipo]')!.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value as Listing['type'] | '';
      set({}, { types: v ? [v] : [] });
    });
    const bairro = box.querySelector<HTMLInputElement>('[name=bairro]')!;
    bairro.addEventListener('input', () => {
      const match = bairros.find((b) => normalizeName(b) === normalizeName(bairro.value));
      set({}, { bairros: match ? [match] : [] });
    });
    bairro.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        go.click();
      }
    });
    const more = $<HTMLButtonElement>(box, '.q-more');
    more.addEventListener('click', () => {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      $(box, '.q-extra').hidden = !open;
    });
    box.querySelectorAll<HTMLButtonElement>('[data-st]').forEach((b) =>
      b.addEventListener('click', () => {
        box.querySelectorAll('[data-st]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        set({}, { statuses: b.dataset.st ? [b.dataset.st as Listing['status']] : [] });
      }),
    );
    box.querySelector<HTMLInputElement>('[name=reduzido]')!.addEventListener('change', (e) => set({}, { reducedOnly: (e.target as HTMLInputElement).checked ? true : null }));
    box.querySelector<HTMLInputElement>('[name=codigo]')!.addEventListener('input', (e) => set({ code: (e.target as HTMLInputElement).value.trim() || null }));
    box.querySelector<HTMLInputElement>('[name=precoMin]')!.addEventListener('input', (e) => set({}, { priceMin: parseNumberInput((e.target as HTMLInputElement).value) }));
    box.querySelector<HTMLInputElement>('[name=precoMax]')!.addEventListener('input', (e) => set({}, { priceMax: parseNumberInput((e.target as HTMLInputElement).value) }));
    this.wireCountGroups(box, (field, v) => set({}, field === 'quartos' ? { bedroomsMin: v } : { parkingMin: v }));
    $(box, '.q-clear').addEventListener('click', () => {
      const deal = s.criteria.transaction;
      s = emptySearch(c.search.sort, c.search.view);
      s.criteria.transaction = deal;
      box.querySelectorAll<HTMLInputElement>('.q-extra input, .q-row input').forEach((i) => (i.type === 'checkbox' ? (i.checked = false) : (i.value = '')));
      box.querySelector<HTMLSelectElement>('[name=tipo]')!.value = '';
      box.querySelectorAll('[data-st]').forEach((x, i) => x.setAttribute('aria-pressed', String(i === 0)));
      box.querySelectorAll('[data-count] button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      update();
    });
    update();
  }

  /** "1 2 3 4+" buttons (minimum count); clicking the selected one clears it. */
  private countGroup(label: string, name: string, value: number | null): string {
    return `<fieldset class="box count" data-count="${name}"><legend>${label}</legend>${[1, 2, 3, 4]
      .map((n) => `<button type="button" data-v="${n}" aria-pressed="${value === n}" aria-label="${n === 4 ? '4+' : n}: ${n} ou mais ${label.toLowerCase()}">${n === 4 ? '4+' : n}</button>`)
      .join('')}</fieldset>`;
  }

  private wireCountGroups(root: HTMLElement, onChange: (name: string, v: number | null) => void): void {
    root.querySelectorAll<HTMLElement>('[data-count]').forEach((g) =>
      g.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
        if (!b) return;
        const on = b.getAttribute('aria-pressed') !== 'true';
        g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(on && x === b)));
        onChange(g.dataset.count!, on ? Number(b.dataset.v) : null);
      }),
    );
  }

  // ---------------------------------------------------------------- search

  private searchPage(main: HTMLElement): void {
    const c = this.config;
    // unknown neighbourhood names in the address are dropped (no arbitrary text in the page title)
    this.search = queryToSearch(location.search, c.search, new Set([this.data.agencyId]), bairroCounts(this.data.listings, false).map((b) => b.name));
    const s = this.search;
    const hasRent = this.data.listings.some(isForRent);
    const lateral = c.search.filters === 'lateral';
    main.innerHTML = `
      <div class="search-top"><div class="wrap">
        <div class="tabs deal" role="group" aria-label="Negócio">
          <button type="button" data-deal="sale" aria-pressed="${s.criteria.transaction !== 'rent'}">Comprar</button>
          ${hasRent ? `<button type="button" data-deal="rent" aria-pressed="${s.criteria.transaction === 'rent'}">Alugar</button>` : ''}
        </div>
        <div class="tabs" role="group" aria-label="Situação">
          ${[['', 'Todos'], ['ready', 'Prontos'], ['under_construction', 'Lançamentos']]
            .map(([v, t]) => `<button type="button" data-st="${v}" aria-pressed="${v ? s.criteria.statuses.length === 1 && s.criteria.statuses[0] === v : s.criteria.statuses.length !== 1}">${t}</button>`)
            .join('')}
        </div>
        <label class="switch"><input type="checkbox" name="reduzido"${s.criteria.reducedOnly ? ' checked' : ''}><span class="track"></span> Apenas com desconto</label>
        <div class="bairro-box"><label class="sr-only" for="f-bairro">Bairro</label>
          <span class="bairro-chips"></span>
          <input id="f-bairro" list="f-bairros" placeholder="Bairro" autocomplete="off"><datalist id="f-bairros"></datalist></div>
        ${lateral ? `<button type="button" class="btn btn-ghost filters-btn only-mobile" aria-expanded="false" aria-controls="f-panel">${ICONS.filter} Filtros <span class="fcount"></span></button>` : `<button type="button" class="btn btn-ghost filters-btn" aria-expanded="false" aria-controls="f-panel">${ICONS.filter} Filtros <span class="fcount"></span></button>`}
      </div></div>
      <div class="wrap search-body${lateral ? ' lateral' : ''}">
        <aside id="f-panel" class="f-panel" ${lateral ? '' : 'hidden'} aria-label="Filtros"></aside>
        <section class="results" aria-labelledby="r-title">
          <div class="r-head">
            <div><h1 id="r-title"></h1><p class="r-sub"></p></div>
            <div class="r-tools">
              <label class="fld sort"><span class="sr-only">Ordenar</span><select name="ordem">${SORT_KEYS.map((k) => `<option value="${k}"${k === s.sort ? ' selected' : ''}>${SORT_LABELS[k]}</option>`).join('')}</select></label>
              <div class="tabs views" role="group" aria-label="Exibir em">
                <button type="button" data-view="grade" aria-label="Grade">${ICONS.grid}</button><button type="button" data-view="lista" aria-label="Lista">${ICONS.list}</button><button type="button" data-view="mapa" aria-label="Mapa 3D">${ICONS.map}<span>Mapa 3D</span></button>
              </div>
            </div>
          </div>
          <div class="chips" role="group" aria-label="Filtros aplicados"></div>
          <div class="r-list"></div>
          <nav class="pager" aria-label="Páginas"></nav>
        </section>
      </div>`;
    this.renderFilterPanel();
    this.renderBairroChips();
    this.renderResults();
    const top = $(main, '.search-top');
    top.querySelectorAll<HTMLButtonElement>('[data-deal]').forEach((b) =>
      b.addEventListener('click', () => {
        top.querySelectorAll('[data-deal]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        // prices change meaning (sale price × monthly rent): price bounds are dropped
        this.update({}, { transaction: b.dataset.deal === 'rent' ? 'rent' : null, priceMin: null, priceMax: null }, true);
      }),
    );
    top.querySelectorAll<HTMLButtonElement>('[data-st]').forEach((b) =>
      b.addEventListener('click', () => {
        top.querySelectorAll('[data-st]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        this.update({}, { statuses: b.dataset.st ? [b.dataset.st as Listing['status']] : [] });
      }),
    );
    top.querySelector<HTMLInputElement>('[name=reduzido]')!.addEventListener('change', (e) => this.update({}, { reducedOnly: (e.target as HTMLInputElement).checked ? true : null }));
    const bInput = $<HTMLInputElement>(top, '#f-bairro');
    const addBairro = () => {
      const all = bairroCounts(this.data.listings, this.search.criteria.transaction === 'rent').map((b) => b.name);
      const match = all.find((b) => normalizeName(b) === normalizeName(bInput.value));
      if (!match) return false;
      bInput.value = '';
      if (!this.search.criteria.bairros.includes(match)) this.update({}, { bairros: [...this.search.criteria.bairros, match] });
      this.renderBairroChips();
      return true;
    };
    bInput.addEventListener('input', addBairro);
    bInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addBairro();
      } else if (e.key === 'Backspace' && !bInput.value && this.search.criteria.bairros.length) {
        this.update({}, { bairros: this.search.criteria.bairros.slice(0, -1) });
        this.renderBairroChips();
      }
    });
    top.querySelector('.filters-btn')?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      main.querySelector('.search-body')!.classList.toggle('panel-open', open);
      if (!lateral) $(main, '#f-panel').hidden = !open;
    });
    main.querySelector<HTMLSelectElement>('[name=ordem]')!.addEventListener('change', (e) => this.update({ sort: (e.target as HTMLSelectElement).value as SiteSearch['sort'] }));
    main.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.addEventListener('click', () => this.update({ view: b.dataset.view as SiteSearch['view'] }, {}, false, true)));
  }

  /** Changes the search, writes the URL and refreshes the results (not the controls being used). */
  private update(patch: Partial<SiteSearch>, crit: Partial<SiteSearch['criteria']> = {}, refreshPanel = false, keepPage = false): void {
    this.search = { ...this.search, ...patch, criteria: { ...cloneCriteria(this.search.criteria), ...crit } };
    if (!keepPage && patch.page === undefined) this.search.page = 1;
    history.replaceState(null, '', this.searchHref(this.search));
    if (refreshPanel) this.renderFilterPanel();
    this.renderResults();
  }

  private renderBairroChips(): void {
    const box = this.root.querySelector<HTMLElement>('.bairro-chips');
    if (!box) return;
    box.innerHTML = this.search.criteria.bairros
      .map((b) => `<button type="button" class="chip chip-solid" data-b="${escapeHtml(b)}" aria-label="Remover o bairro ${escapeHtml(b)}">${escapeHtml(b)} ${ICONS.close}</button>`)
      .join('');
    box.querySelectorAll<HTMLButtonElement>('[data-b]').forEach((b) =>
      b.addEventListener('click', () => {
        this.update({}, { bairros: this.search.criteria.bairros.filter((x) => x !== b.dataset.b) });
        this.renderBairroChips();
        this.root.querySelector<HTMLInputElement>('#f-bairro')?.focus();
      }),
    );
    const list = this.root.querySelector('#f-bairros');
    if (list)
      list.innerHTML = bairroCounts(this.data.listings, this.search.criteria.transaction === 'rent')
        .filter((b) => !this.search.criteria.bairros.includes(b.name))
        .map((b) => `<option value="${escapeHtml(b.name)}">${plural(b.count, 'imóvel', 'imóveis')}</option>`)
        .join('');
  }

  private renderFilterPanel(): void {
    const panel = this.root.querySelector<HTMLElement>('#f-panel');
    if (!panel) return;
    const s = this.search;
    const c = s.criteria;
    const rent = c.transaction === 'rent';
    const num = (v: number | null) => (v === null ? '' : v.toLocaleString('pt-BR'));
    const presentTypes = LISTING_TYPES.filter((t) => this.data.listings.some((l) => l.type === t));
    const presentFeatures = AMENITIES.filter((a) => this.data.listings.some((l) => l.features.includes(a)));
    panel.innerHTML = `
      <div class="f-group"><h2>Tipo</h2><div class="pills">${presentTypes
        .map((t) => `<label class="pill"><input type="checkbox" name="tipo" value="${t}"${c.types.includes(t) ? ' checked' : ''}><span>${TYPE_LABELS[t]}</span></label>`)
        .join('')}</div></div>
      <fieldset class="f-group box"><legend>${rent ? 'Aluguel por mês' : 'Valor'}</legend>
        <input name="precoMin" inputmode="numeric" placeholder="Mínimo" aria-label="Valor mínimo" value="${num(c.priceMin)}">
        <input name="precoMax" inputmode="numeric" placeholder="Máximo" aria-label="Valor máximo" value="${num(c.priceMax)}"></fieldset>
      <fieldset class="f-group box"><legend>Área (m²)</legend>
        <input name="areaMin" inputmode="numeric" placeholder="Mínima" aria-label="Área mínima" value="${num(c.areaMin)}">
        <input name="areaMax" inputmode="numeric" placeholder="Máxima" aria-label="Área máxima" value="${num(c.areaMax)}"></fieldset>
      ${this.countGroup('Quartos', 'quartos', c.bedroomsMin === null ? null : Math.min(4, c.bedroomsMin))}
      ${this.countGroup('Suítes', 'suites', s.suitesMin === null ? null : Math.min(4, s.suitesMin))}
      ${this.countGroup('Banheiros', 'banheiros', c.bathroomsMin === null ? null : Math.min(4, c.bathroomsMin))}
      ${this.countGroup('Vagas', 'vagas', c.parkingMin === null ? null : Math.min(4, c.parkingMin))}
      ${presentFeatures.length ? `<div class="f-group"><h2>Características</h2><div class="pills">${presentFeatures
        .map((a) => `<label class="pill"><input type="checkbox" name="comodidade" value="${a}"${c.features.includes(a) ? ' checked' : ''}><span>${AMENITY_LABELS[a]}</span></label>`)
        .join('')}</div></div>` : ''}
      <label class="f-group fld"><span>Código do imóvel</span><input name="codigo" value="${escapeHtml(s.code ?? '')}" maxlength="30" placeholder="Ex.: ${escapeHtml(codeOf(this.data.listings[0] ?? ({ id: 'abc' } as Listing)))}"></label>
      <button type="button" class="link-btn f-clear">Limpar filtros</button>
      <button type="button" class="btn btn-primary f-apply">Ver imóveis</button>`;
    // phones: the panel covers the results; this closes it and shows them
    $(panel, '.f-apply').addEventListener('click', () => {
      const btn = this.root.querySelector<HTMLButtonElement>('.filters-btn[aria-expanded="true"]');
      btn?.click();
      this.root.querySelector<HTMLElement>('#r-title')?.focus();
      this.root.querySelector('.results')?.scrollIntoView({ block: 'start' });
    });
    panel.querySelectorAll<HTMLInputElement>('[name=tipo]').forEach((i) =>
      i.addEventListener('change', () => this.update({}, { types: [...panel.querySelectorAll<HTMLInputElement>('[name=tipo]:checked')].map((x) => x.value as Listing['type']) })),
    );
    panel.querySelectorAll<HTMLInputElement>('[name=comodidade]').forEach((i) =>
      i.addEventListener('change', () =>
        this.update({}, { features: [...panel.querySelectorAll<HTMLInputElement>('[name=comodidade]:checked')].map((x) => x.value as (typeof AMENITIES)[number]) }),
      ),
    );
    // one timer per field: typing the minimum and then the maximum quickly must keep both
    const timers = new Map<string, number>();
    const later = (key: string, fn: () => void, ms: number) => {
      clearTimeout(timers.get(key));
      timers.set(key, window.setTimeout(fn, ms));
    };
    const numbers: [string, keyof SiteSearch['criteria']][] = [
      ['precoMin', 'priceMin'],
      ['precoMax', 'priceMax'],
      ['areaMin', 'areaMin'],
      ['areaMax', 'areaMax'],
    ];
    for (const [name, field] of numbers) {
      panel.querySelector<HTMLInputElement>(`[name=${name}]`)!.addEventListener('input', (e) => {
        const v = parseNumberInput((e.target as HTMLInputElement).value);
        later(name, () => this.update({}, { [field]: v }), 350);
      });
    }
    panel.querySelector<HTMLInputElement>('[name=codigo]')!.addEventListener('input', (e) => {
      const v = (e.target as HTMLInputElement).value.trim() || null;
      later('codigo', () => this.update({ code: v }), 300);
    });
    this.wireCountGroups(panel, (name, v) => {
      if (name === 'suites') this.update({ suitesMin: v });
      else this.update({}, name === 'quartos' ? { bedroomsMin: v } : name === 'banheiros' ? { bathroomsMin: v } : { parkingMin: v });
    });
    $(panel, '.f-clear').addEventListener('click', () => {
      const keep = this.search;
      this.search = emptySearch(keep.sort, keep.view);
      this.search.criteria.bairros = keep.criteria.bairros;
      this.search.criteria.transaction = keep.criteria.transaction;
      this.search.criteria.statuses = keep.criteria.statuses;
      this.search.criteria.reducedOnly = keep.criteria.reducedOnly;
      this.update({}, {}, true);
    });
  }

  private renderResults(): void {
    const main = this.root.querySelector<HTMLElement>('main.page-imoveis');
    if (!main) return;
    const s = this.search;
    const c = this.config;
    const found = runSearch(this.data.listings, s);
    const rent = s.criteria.transaction === 'rent';
    this.lastRent = rent;
    const title = resultsTitle(found.length, s);
    // screen readers hear the new count once the typing stops
    this.say(title, 600);
    main.querySelectorAll<HTMLElement>('.f-apply').forEach((b) => (b.textContent = found.length ? `Ver ${plural(found.length, 'imóvel', 'imóveis')}` : 'Nenhum imóvel com esses filtros'));
    const panelCount = chipsOf(s).filter((ch) => !s.criteria.bairros.includes(ch.label) && ch.label !== 'Lançamentos' && ch.label !== 'Pronto' && ch.label !== 'Baixou o preço').length;
    main.querySelectorAll<HTMLElement>('.fcount').forEach((el) => (el.textContent = panelCount ? `(${panelCount})` : ''));
    $(main, '#r-title').textContent = title;
    $(main, '#r-title').tabIndex = -1;
    $(main, '.r-sub').textContent = found.length
      ? s.view === 'mapa'
        ? 'Clique num imóvel no mapa para ver os detalhes. Gire com o botão direito (ou dois dedos).'
        : 'Salve favoritos, compare até 4 imóveis e veja cada um no mapa 3D.'
      : '';
    this.setMeta(`${resultsTitle(found.length, s)} · ${c.name}`, `${resultsTitle(found.length, s)}. ${c.seo.description || c.home.subtitle}`);
    main.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === s.view)));
    // menu highlight follows the search
    const active = this.activeItem();
    this.root.querySelectorAll<HTMLAnchorElement>('.nav a').forEach((a) => a.removeAttribute('aria-current'));
    if (active) {
      const i = c.menu.indexOf(active);
      this.root.querySelectorAll<HTMLAnchorElement>('.nav a')[i]?.setAttribute('aria-current', 'page');
    }
    const chips = chipsOf(s);
    $(main, '.chips').innerHTML = chips.length
      ? chips.map((ch, i) => `<button type="button" class="chip" data-chip="${i}">${escapeHtml(ch.label)} ${ICONS.close}<span class="sr-only">(remover)</span></button>`).join('') +
        `<button type="button" class="link-btn" data-chip="all">Limpar tudo</button>`
      : '';
    $(main, '.chips')
      .querySelectorAll<HTMLButtonElement>('[data-chip]')
      .forEach((b) =>
        b.addEventListener('click', () => {
          const next = b.dataset.chip === 'all' ? { ...emptySearch(s.sort, s.view), criteria: { ...cloneCriteria(EMPTY_CRITERIA), transaction: s.criteria.transaction } } : chips[Number(b.dataset.chip)].without;
          this.search = next;
          history.replaceState(null, '', this.searchHref(next));
          this.render();
        }),
      );
    const list = $(main, '.r-list');
    const pager = $(main, '.pager');
    if (s.view === 'mapa') {
      list.className = 'r-list r-map';
      pager.innerHTML = '';
      this.showMap(list, found);
      return;
    }
    this.mapFrame = null;
    if (!found.length) {
      const tips = chips
        .map((ch) => ({ ch, n: runSearch(this.data.listings, ch.without).length }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n)
        .slice(0, 3);
      list.className = 'r-list r-empty';
      list.innerHTML = `<div class="empty"><h2>Nenhum imóvel com todos esses filtros</h2>${
        tips.length
          ? `<p>Tente tirar um deles:</p><ul>${tips.map((t, i) => `<li><button type="button" class="chip" data-tip="${i}">Sem "${escapeHtml(t.ch.label)}": ${plural(t.n, 'imóvel', 'imóveis')}</button></li>`).join('')}</ul>`
          : ''
      }<p>Ou <a href="${escapeHtml(this.href('contato'))}" data-nav>fale com a gente</a>: avisamos quando entrar um imóvel assim.</p></div>`;
      list.querySelectorAll<HTMLButtonElement>('[data-tip]').forEach((b) =>
        b.addEventListener('click', () => {
          this.search = tips[Number(b.dataset.tip)].ch.without;
          history.replaceState(null, '', this.searchHref(this.search));
          this.render();
        }),
      );
      pager.innerHTML = '';
      return;
    }
    const pg = pageOf(found, s.page, c.search.perPage);
    // a page past the end (pagina=99) shows the last one: the address says so too
    if (pg.page !== s.page) {
      this.search = { ...s, page: pg.page };
      history.replaceState(null, '', this.searchHref(this.search));
    }
    list.className = `r-list r-${s.view}`;
    // cards under the page's h1 are h2 (on the home page, under a section's h2, they are h3)
    list.innerHTML = pg.items.map((l) => cardHtml(l, this.cardCtx(rent), s.view === 'lista' ? 'lista' : 'grade', 2)).join('');
    pager.innerHTML =
      pg.pages > 1
        ? Array.from({ length: pg.pages }, (_, i) => i + 1)
            .filter((n) => n === 1 || n === pg.pages || Math.abs(n - pg.page) <= 2)
            .map((n, i, arr) => `${i > 0 && n - arr[i - 1] > 1 ? '<span class="gap">…</span>' : ''}<a href="${escapeHtml(this.searchHref({ ...s, page: n }))}" data-page="${n}"${n === pg.page ? ' aria-current="page"' : ''}>${n}</a>`)
            .join('')
        : '';
    // each page is a history entry (Back returns to the previous page); Ctrl/middle click opens a new tab
    pager.querySelectorAll<HTMLAnchorElement>('[data-page]').forEach((a) =>
      a.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        this.search = { ...this.search, page: Number(a.dataset.page) };
        history.pushState(null, '', this.searchHref(this.search));
        this.renderResults();
        main.querySelector('.results')!.scrollIntoView({ behavior: 'smooth' });
        $(main, '#r-title').focus({ preventScroll: true });
      }),
    );
  }

  // ---------------------------------------------------------------- 3D map (the map app in a frame)

  private mapUrl(extra: Record<string, string> = {}): string {
    const detail = new URL(this.href('imovel', { id: '__ID__' }), location.href).href;
    const p = new URLSearchParams({ embed: '1', site: this.data.agencyId, cor: this.config.colors.primary.slice(1), pagina: detail, ...extra });
    return new URL(`${this.paths ? '/' : import.meta.env.BASE_URL}index.html?${p}`, location.href).href;
  }

  private showMap(box: HTMLElement, found: Listing[]): void {
    const ids = found.map((l) => l.id);
    if (this.mapFrame && box.contains(this.mapFrame)) {
      this.postResults(ids);
      return;
    }
    // the map of the page before the redraw (parkMap), if it still shows the same thing
    const parked = this.mapFrame;
    if (parked?.parentElement === document.body && parked.getAttribute('src') === this.mapUrl()) {
      box.innerHTML = '<div class="map-frame"></div>';
      box.firstElementChild!.moveBefore(parked, null);
      this.postResults(ids);
      return;
    }
    box.innerHTML = `<div class="map-frame"><iframe title="Mapa 3D com os imóveis encontrados" src="${escapeHtml(this.mapUrl())}" allow="fullscreen"></iframe></div>`;
    this.mapFrame = box.querySelector('iframe');
    this.mapReady = false;
    this.pendingIds = ids;
  }

  private pendingIds: string[] = [];

  private postResults(ids: string[]): void {
    this.pendingIds = ids;
    if (this.mapReady)
      this.mapFrame?.contentWindow?.postMessage(
        { type: 'site-results', ids, rent: this.search.criteria.transaction === 'rent', bairros: this.search.criteria.bairros },
        location.origin,
      );
  }

  private onMapMessage(e: MessageEvent): void {
    if (e.origin !== location.origin || !this.mapFrame || e.source !== this.mapFrame.contentWindow) return;
    if ((e.data as { type?: string })?.type === 'map-ready') {
      this.mapReady = true;
      this.postResults(this.pendingIds);
    }
  }

  // ---------------------------------------------------------------- listing page

  private detail(main: HTMLElement): void {
    const c = this.config;
    const l = this.data.listings.find((x) => x.id === this.params.get('id'));
    if (!l) {
      this.setPage('imovel-nao-encontrado');
      main.innerHTML = `<div class="wrap narrow"><h1>Imóvel não encontrado</h1><p>Ele pode ter sido vendido ou retirado do site.</p><a class="btn btn-primary" href="${escapeHtml(this.menuHref('venda'))}" data-nav>Ver os imóveis disponíveis</a></div>`;
      return;
    }
    const rent = !isForRent(l) ? false : this.params.get('negocio') === 'alugar' || l.transaction === 'rent';
    const photos = photosOf(l, c);
    const red = priceReduction(l);
    const addr = addressLabel(l) ?? placeOf(l);
    const url = location.href;
    const pages = (window as unknown as { __sitePages?: Record<string, string> }).__sitePages;
    // the listing's address on the client's domain; elsewhere its page built at publish time, when there is one
    const canonical = this.paths
      ? location.origin + listingPath(l)
      : pages?.[l.id]
        ? new URL(`${import.meta.env.BASE_URL}${pages[l.id]}`, location.href).href
        : undefined;
    this.setMeta(`${l.title} · ${c.name}`, seoDescription(l, c.name), canonical);
    const ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.dataset.ld = '';
    ld.textContent = JSON.stringify(structuredData(l, { siteUrl: location.origin + '/', agencyName: c.name, siteName: c.name }, canonical ?? url)).replace(/</g, '\\u003c');
    document.head.append(ld);
    const waText = `Olá! Tenho interesse no imóvel ${codeOf(l)} (${l.title}): ${canonical ?? url}`;
    const video = videoEmbedUrl(l.videoUrl);
    const tour = safeUrl(l.tourUrl);
    const facts: [string, string][] = [
      ['Código', codeOf(l)],
      ['Negócio', TRANSACTION_LABELS[l.transaction ?? 'sale']],
      ['Tipo', `${TYPE_LABELS[l.type]}${l.usage ? ` ${USAGE_LABELS[l.usage].toLowerCase()}` : ''}`],
      ['Situação', STATUS_LABELS[l.status]],
      [l.type === 'land' ? 'Área do terreno' : 'Área privativa', formatArea(l.areaM2)],
      ...(l.totalAreaM2 ? [['Área total', formatArea(l.totalAreaM2)] as [string, string]] : []),
      ...(l.landAreaM2 && l.type !== 'land' ? [['Terreno', formatArea(l.landAreaM2)] as [string, string]] : []),
      ...(l.unitFloor ? [['Andar', `${l.unitFloor}º`] as [string, string]] : []),
      ...(l.coveredParking ? [['Vagas cobertas', String(l.coveredParking)] as [string, string]] : []),
      ...(l.yearBuilt ? [[l.status === 'under_construction' ? 'Entrega prevista' : 'Ano de construção', String(l.yearBuilt)] as [string, string]] : []),
      ...(l.condoFee ? [['Condomínio', `${formatBRL(l.condoFee)}/mês`] as [string, string]] : []),
      ...(l.iptu ? [['IPTU', `${formatBRL(l.iptu.value)}/${l.iptu.period === 'year' ? 'ano' : 'mês'}`] as [string, string]] : []),
      ...(!rent && l.type !== 'land' ? [['Valor do m²', formatBRL(Math.round(l.price / l.areaM2))] as [string, string]] : []),
      ...(l.updatedAt ? [['Atualizado em', formatDate(l.updatedAt)] as [string, string]] : []),
    ];
    const similar = this.data.listings
      .filter((x) => x.id !== l.id && x.type === l.type && Math.abs(x.price - l.price) / l.price < 0.35)
      .sort((a, b) => Number(b.address?.bairro === l.address?.bairro) - Number(a.address?.bairro === l.address?.bairro) || Math.abs(a.price - l.price) - Math.abs(b.price - l.price))
      .slice(0, 8);
    main.innerHTML = `<div class="wrap">
      <nav class="crumbs" aria-label="Você está em"><a href="${escapeHtml(this.href('inicio'))}" data-nav>Início</a> › <a href="${escapeHtml(this.menuHref(rent ? 'locacao' : 'venda'))}" data-nav>${rent ? 'Alugar' : 'Comprar'}</a>${
        l.address?.bairro ? ` › <a href="${escapeHtml(this.searchHref(this.bairroSearch(l.address.bairro)))}" data-nav>${escapeHtml(l.address.bairro)}</a>` : ''
      } › <span>Cód. ${escapeHtml(codeOf(l))}</span></nav>
      <div class="gallery" data-index="0">
        <figure class="g-main${photos[0].illustration ? ' illus' : ''}">${galleryPhoto(photos[0], photos[0].caption ?? `${l.title}: foto 1`)}
          ${photos.length > 1 ? `<button type="button" class="icon-btn g-prev" aria-label="Foto anterior">${ICONS.left}</button><button type="button" class="icon-btn g-next" aria-label="Próxima foto">${ICONS.right}</button>` : ''}
          <figcaption><span class="g-count">1 / ${photos.length}</span> <span class="g-cap">${escapeHtml(photos[0].caption ?? '')}</span></figcaption></figure>
        ${photos.length > 1 ? `<div class="g-thumbs">${photos.map((p, i) => `<button type="button" data-i="${i}" aria-label="Foto ${i + 1}"${i === 0 ? ' aria-current="true"' : ''}><img src="${escapeHtml(p.thumb ?? p.src)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
      </div>
      <div class="detail-grid">
        <div class="detail-main">
          <header class="d-head">
            <p class="d-kicker">${TYPE_LABELS[l.type]} · Cód. ${escapeHtml(codeOf(l))}${l.status === 'under_construction' ? ' · <span class="badge">Lançamento</span>' : ''}${
              l.availability && l.availability !== 'active' ? ` · <span class="badge badge-off">${AVAILABILITY_LABELS[l.availability]}</span>` : ''
            }</p>
            <h1>${escapeHtml(l.title)}</h1>
            <p class="d-addr">${ICONS.pin}${escapeHtml(addr)}</p>
            <div class="d-price-mobile">${priceHtml(l, rent)}</div>
            ${
              l.availability === 'reserved'
                ? '<p class="d-avail">Este imóvel está <strong>reservado</strong>. Fale com a gente: a reserva pode cair, e mostramos opções parecidas.</p>'
                : l.availability === 'sold'
                  ? '<p class="d-avail">Este imóvel já foi <strong>vendido</strong>. Veja abaixo imóveis parecidos ou fale com a gente.</p>'
                  : ''
            }
            <div class="d-actions">
              <button type="button" class="btn btn-ghost fav" data-fav="${escapeHtml(l.id)}" aria-pressed="${this.saved.isFavorite(l.id)}">${ICONS.heart} Favorito</button>
              <label class="btn btn-ghost cmp"><input type="checkbox" data-cmp="${escapeHtml(l.id)}"${this.saved.isCompared(l.id) ? ' checked' : ''}> Comparar</label>
              <button type="button" class="btn btn-ghost share">${ICONS.share} Compartilhar</button>
            </div>
          </header>
          ${specsHtml(l, true)}
          ${this.progressHtml(l)}
          ${red ? `<p class="d-red">${ICONS.down} O preço baixou ${red.percent}%${red.since ? ` em ${formatDate(red.since)}` : ''}: era ${formatBRL(red.previous)}. Valor anterior do histórico registrado na plataforma.</p>` : ''}
          <section><h2>Descrição</h2><p class="d-desc">${escapeHtml(l.description)}</p></section>
          ${l.features.length ? `<section><h2>Características</h2><ul class="d-feats">${l.features.map((f) => `<li>${AMENITY_LABELS[f]}</li>`).join('')}</ul></section>` : ''}
          <section><h2>Ficha do imóvel</h2><dl class="d-facts">${facts.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl></section>
          ${!rent && l.availability !== 'sold' && (priceIn(l, false) ?? 0) > 0 ? `<section class="d-fin">${financingHtml(priceIn(l, false)!, 'fld')}</section>` : ''}
          ${video ? `<section><h2>Vídeo</h2><div class="d-video"><iframe src="${escapeHtml(video)}" title="Vídeo do imóvel" loading="lazy" allowfullscreen></iframe></div></section>` : ''}
          ${l.floorPlanImage ? `<section><h2>Planta</h2><img class="d-plan" src="${escapeHtml(l.floorPlanImage)}" alt="Planta do imóvel" loading="lazy"></section>` : ''}
          ${tour ? `<p><a class="btn btn-ghost" href="${escapeHtml(tour)}" target="_blank" rel="noopener">Tour virtual 360° ↗</a></p>` : ''}
          <section><h2>No mapa 3D</h2><p class="muted">${l.approximateLocation ? 'Localização aproximada: o anunciante preferiu não mostrar o endereço exato.' : 'O prédio em destaque é o do imóvel.'}</p>
            <div class="map-frame small" data-src="${escapeHtml(this.mapUrl({ foco: l.id }))}"><button type="button" class="btn btn-ghost map-load">${ICONS.cube} Ver o prédio no mapa 3D</button></div></section>
        </div>
        <aside class="detail-side">
          <div class="side-card">
            <p class="d-deal">${rent || l.transaction === 'rent' ? 'Aluguel' : 'Venda'}</p>
            ${priceHtml(l, rent)}
            ${l.condoFee || l.iptu ? `<p class="muted small">${[l.condoFee ? `Condomínio ${formatBRL(l.condoFee)}` : '', l.iptu ? `IPTU ${formatBRL(l.iptu.value)}/${l.iptu.period === 'year' ? 'ano' : 'mês'}` : ''].filter(Boolean).join(' · ')}</p>` : ''}
            ${c.contacts.whatsapp ? `<a class="btn btn-wa btn-block" data-contact data-listing="${escapeHtml(l.id)}" href="${escapeHtml(whatsappHref(c.contacts.whatsapp, waText))}" target="_blank" rel="noopener">${ICONS.whatsapp} Conversar no WhatsApp</a>` : ''}
            ${c.contacts.phone ? `<a class="btn btn-ghost btn-block" data-contact href="${escapeHtml(telHref(c.contacts.phone))}">${ICONS.phone} ${escapeHtml(formatPhone(c.contacts.phone))}</a>` : ''}
            <a class="btn btn-ghost btn-block" href="#contato-imovel" data-visit>${ICONS.calendar} Agendar visita</a>
            <h2 class="side-title" id="contato-imovel">Quero saber mais</h2>
            ${leadFormHtml({ orgName: c.name, message: `Olá! Tenho interesse no imóvel ${codeOf(l)}. Gostaria de mais informações.`, submitLabel: 'Enviar mensagem', captcha: !this.data.demo, visit: true })}
          </div>
        </aside>
      </div>
      ${similar.length ? `<section class="home-sec"><div class="sec-head"><h2>Imóveis parecidos</h2></div><div class="rail">${similar.map((x) => cardHtml(x, this.cardCtx(rent))).join('')}</div></section>` : ''}
    </div>
    <div class="d-cta" role="group" aria-label="Contato sobre este imóvel">
      ${c.contacts.whatsapp ? `<a class="btn btn-wa" data-contact data-listing="${escapeHtml(l.id)}" href="${escapeHtml(whatsappHref(c.contacts.whatsapp, waText))}" target="_blank" rel="noopener">${ICONS.whatsapp} WhatsApp</a>` : ''}
      <a class="btn btn-primary" href="#contato-imovel">${ICONS.mail} Mensagem</a>
    </div>`;
    this.wireGallery(main, photos);
    this.lazyMap(main);
    wireFinancing(main);
    // no hash navigation here: it would re-render the page (popstate) and lose the ticked box
    main.querySelector('[data-visit]')?.addEventListener('click', (e) => {
      e.preventDefault();
      const box = main.querySelector<HTMLInputElement>('form.lead input[name="visit"]');
      if (box && !box.checked) box.click();
      main.querySelector('#contato-imovel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      box?.focus({ preventScroll: true });
    });
    wireLeadForm(
      $(main, 'form.lead'),
      async (input) => {
        if (this.data.demo || !this.data.remote) return null;
        await this.data.remote.submitLead(l.id, input);
        return null;
      },
      (visit) =>
        this.data.demo
          ? 'Demonstração: nada foi enviado. No site real, a mensagem chega ao corretor e em Minha conta → Contatos.'
          : visit
            ? 'Pedido de visita enviado. O corretor vai confirmar o horário com você.'
            : 'Mensagem enviada. O corretor vai responder em breve.',
    );
    main.querySelector('.share')!.addEventListener('click', async () => {
      const link = canonical ?? url;
      try {
        if (navigator.share) await navigator.share({ title: l.title, url: link });
        else {
          await navigator.clipboard.writeText(link);
          this.toast('Link copiado.');
        }
      } catch {
        /* cancelled */
      }
    });
  }

  /** Works under way: floors built, month and source (the 3D map below shows the rest translucent). */
  private progressHtml(l: Listing): string {
    const p = l.construction;
    if (!p || l.status !== 'under_construction' || l.type === 'land') return '';
    const total = l.floors ?? Math.max(1, Math.round((l.buildingHeightM ?? 6) / 3));
    const pct = Math.round(builtShare(p, total) * 100);
    return `<section class="d-obra" aria-label="Andamento da obra">
      <p><strong>Obra: ${escapeHtml(progressLabel(p, total))}</strong></p>
      <div class="obra-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Andamento da obra"><span style="width:${pct}%"></span></div>
      <p class="muted small">${escapeHtml(formatMonth(p.updatedAt))} · ${escapeHtml(CONSTRUCTION_SOURCE_LABELS[p.source])}. No mapa 3D abaixo, o que falta construir aparece translúcido.</p>
    </section>`;
  }

  /**
   * The 3D map (1.2 MB of code plus tiles) loads only when its box comes into view or on click: the listing page
   * is the one people open from Google and WhatsApp, often on a phone.
   */
  private lazyMap(main: HTMLElement): void {
    const box = main.querySelector<HTMLElement>('.map-frame[data-src]');
    if (!box) return;
    const load = () => {
      if (box.querySelector('iframe')) return;
      box.innerHTML = `<iframe title="Mapa 3D do imóvel" src="${escapeHtml(box.dataset.src!)}" allow="fullscreen"></iframe>`;
      io?.disconnect();
    };
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && load()) : null;
    io?.observe(box);
    box.querySelector('.map-load')?.addEventListener('click', load);
  }

  private wireGallery(main: HTMLElement, photos: { src: string; caption?: string }[]): void {
    const g = main.querySelector<HTMLElement>('.gallery');
    if (!g || photos.length < 2) return;
    const show = (i: number) => {
      const k = (i + photos.length) % photos.length;
      g.dataset.index = String(k);
      (g.querySelector('.g-main picture') ?? $(g, '.g-main img')).outerHTML = galleryPhoto(photos[k], photos[k].caption ?? `Foto ${k + 1}`);
      $(g, '.g-count').textContent = `${k + 1} / ${photos.length}`;
      $(g, '.g-cap').textContent = photos[k].caption ?? '';
      g.querySelectorAll('.g-thumbs button').forEach((b, j) => (j === k ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
    };
    const cur = () => Number(g.dataset.index);
    g.querySelector('.g-prev')!.addEventListener('click', () => show(cur() - 1));
    g.querySelector('.g-next')!.addEventListener('click', () => show(cur() + 1));
    g.querySelectorAll<HTMLButtonElement>('.g-thumbs button').forEach((b) => b.addEventListener('click', () => show(Number(b.dataset.i))));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(cur() - 1);
      if (e.key === 'ArrowRight') show(cur() + 1);
    });
  }

  // ---------------------------------------------------------------- institutional pages

  private about(main: HTMLElement): void {
    const c = this.config;
    this.setPage('sobre');
    const paragraphs = (c.about.text || `A ${c.name} ajuda você a comprar, vender e alugar imóveis em Joinville.`).split(/\n+/).filter(Boolean);
    main.innerHTML = `<div class="wrap narrow about">
      <h1>${escapeHtml(c.about.title)}</h1>
      ${c.about.image ? `<img class="about-img" src="${escapeHtml(c.about.image)}" alt="">` : ''}
      ${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
      ${c.creci ? `<p class="muted">CRECI ${escapeHtml(c.creci)}</p>` : ''}
      <p><a class="btn btn-primary" href="${escapeHtml(this.href('contato'))}" data-nav>Fale com a gente</a></p>
    </div>`;
  }

  private contact(main: HTMLElement): void {
    const c = this.config;
    this.setPage('contato');
    const maps = c.contacts.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.contacts.address)}` : '';
    main.innerHTML = `<div class="wrap two-col">
      <div>
        <h1>Contato</h1>
        <p>Mande sua mensagem: respondemos pelo canal que você preferir.</p>
        ${leadFormHtml({
          orgName: c.name,
          submitLabel: 'Enviar',
          captcha: !this.data.demo,
          extra: [{ name: 'assunto', label: 'Assunto', type: 'select', options: ['Quero comprar', 'Quero alugar', 'Quero vender ou alugar meu imóvel', 'Outro assunto'] }],
        })}
      </div>
      <aside class="side-card contact-card">
        <h2>Atendimento</h2>
        <ul class="foot-list">
          ${c.contacts.whatsapp ? `<li><a data-contact href="${escapeHtml(whatsappHref(c.contacts.whatsapp, c.whatsappButton.message))}" target="_blank" rel="noopener">${ICONS.whatsapp}${escapeHtml(formatPhone(c.contacts.whatsapp))}</a></li>` : ''}
          ${c.contacts.phone ? `<li><a data-contact href="${escapeHtml(telHref(c.contacts.phone))}">${ICONS.phone}${escapeHtml(formatPhone(c.contacts.phone))}</a></li>` : ''}
          ${c.contacts.email ? `<li><a href="mailto:${escapeHtml(c.contacts.email)}">${ICONS.mail}${escapeHtml(c.contacts.email)}</a></li>` : ''}
          ${c.contacts.address ? `<li>${ICONS.pin}<a href="${escapeHtml(maps)}" target="_blank" rel="noopener">${escapeHtml(c.contacts.address)}</a></li>` : ''}
          ${c.contacts.hours ? `<li>${ICONS.clock}<span>${escapeHtml(c.contacts.hours)}</span></li>` : ''}
        </ul>
        <p class="foot-social">${this.socialHtml()}</p>
      </aside>
    </div>`;
    this.wireSiteForm(main, 'contact', 'Mensagem enviada. Vamos responder em breve.');
  }

  private announce(main: HTMLElement): void {
    const c = this.config;
    this.setPage('anunciar');
    const bairros = bairroCounts(this.data.listings, false).map((b) => b.name);
    main.innerHTML = `<div class="wrap two-col">
      <div>
        <h1>Anuncie seu imóvel</h1>
        <p>Conte um pouco sobre o imóvel. Um corretor entra em contato para combinar a avaliação. Sem compromisso.</p>
        ${leadFormHtml({
          orgName: c.name,
          submitLabel: 'Quero anunciar',
          captcha: !this.data.demo,
          messageLabel: 'Algo mais que devemos saber?',
          extra: [
            { name: 'finalidade', label: 'Quero', type: 'select', options: ['Vender', 'Alugar', 'Vender ou alugar'] },
            { name: 'tipo', label: 'Tipo do imóvel', type: 'select', options: [...LISTING_TYPES.map((t) => TYPE_LABELS[t]), 'Outro'] },
            { name: 'bairro', label: 'Bairro', placeholder: bairros[0] ?? 'Centro' },
            { name: 'valor', label: 'Valor pretendido (opcional)', inputmode: 'numeric', placeholder: 'R$' },
            { name: 'area', label: 'Área aproximada, m² (opcional)', inputmode: 'numeric' },
            { name: 'quartos', label: 'Quartos (opcional)', inputmode: 'numeric' },
          ],
        })}
      </div>
      <aside class="side-card">
        <h2>Por que anunciar com a ${escapeHtml(c.name)}</h2>
        <ul class="checks">
          <li>Seu imóvel no nosso site e no mapa 3D da cidade, com o prédio de verdade.</li>
          <li>Divulgação nos principais portais.</li>
          <li>Você decide se mostra o endereço exato ou só o bairro.</li>
          <li>Redução de preço exibida só a partir do histórico real: sem "desconto" inventado.</li>
        </ul>
      </aside>
    </div>`;
    this.wireSiteForm(main, 'owner', 'Recebemos os dados do seu imóvel. Um corretor vai entrar em contato.');
  }

  private wireSiteForm(main: HTMLElement, kind: 'contact' | 'owner', done: string): void {
    wireLeadForm(
      $(main, 'form.lead'),
      async (input, details) => {
        if (this.data.demo || !this.data.remote) return null;
        await this.data.remote.submitSiteLead(this.data.agencyId, kind, input, details);
        return null;
      },
      this.data.demo ? 'Demonstração: nada foi enviado. No site real, o contato chega aos administradores e em Minha conta → Contatos.' : done,
    );
  }

  /** An address that is not a page of the site (out of search engines). */
  private missingPage(main: HTMLElement): void {
    this.setPage('nao-encontrada');
    main.innerHTML = `<div class="wrap narrow"><h1>Página não encontrada</h1><p>O endereço pode estar errado ou a página foi retirada.</p>
      <p><a class="btn btn-primary" href="${escapeHtml(this.menuHref('venda'))}" data-nav>Ver os imóveis</a> <a class="btn btn-ghost" href="${escapeHtml(this.href('inicio'))}" data-nav>Página inicial</a></p></div>`;
  }

  private favorites(main: HTMLElement): void {
    this.setPage('favoritos');
    const list = this.saved.favorites.map((id) => this.data.listings.find((l) => l.id === id)).filter((l): l is Listing => !!l);
    main.innerHTML = `<div class="wrap"><h1>Favoritos</h1>${
      list.length
        ? `<p class="muted">Salvos neste navegador. ${plural(list.length, 'imóvel', 'imóveis')}.</p><div class="r-list r-grade">${list.map((l) => cardHtml(l, this.cardCtx())).join('')}</div>`
        : `<div class="empty"><p>Você ainda não salvou nenhum imóvel. Toque no ${ICONS.heart} de um imóvel para guardá-lo aqui.</p><a class="btn btn-primary" href="${escapeHtml(this.menuHref('venda'))}" data-nav>Ver imóveis</a></div>`
    }</div>`;
  }

  private compare(main: HTMLElement): void {
    const c = this.config;
    this.setPage('comparar');
    const list = this.saved.compared.map((id) => this.data.listings.find((l) => l.id === id)).filter((l): l is Listing => !!l);
    if (!list.length) {
      main.innerHTML = `<div class="wrap"><h1>Comparar imóveis</h1><div class="empty"><p>Marque "Comparar" em até ${MAX_COMPARE} imóveis para vê-los lado a lado.</p><a class="btn btn-primary" href="${escapeHtml(this.menuHref('venda'))}" data-nav>Ver imóveis</a></div></div>`;
      return;
    }
    // in the mode of the search: rentals compare the monthly rent (the value per m² is a sale measure)
    const rent = this.params.get('negocio') === 'alugar';
    const salePrice = (l: Listing) => priceIn(l, false);
    const rows: [string, (l: Listing) => string][] = [
      [rent ? 'Aluguel' : 'Preço', (l) => (priceIn(l, rent) === null ? `<span class="muted">${rent ? 'Só venda' : 'Só aluguel'}</span>` : priceHtml(l, rent, true))],
      ['Tipo', (l) => TYPE_LABELS[l.type]],
      ['Bairro', (l) => escapeHtml(l.address?.bairro ?? '—')],
      ['Área', (l) => formatArea(l.areaM2)],
      ...(rent ? [] : ([['Valor do m²', (l: Listing) => (salePrice(l) === null ? '—' : formatBRL(Math.round(salePrice(l)! / l.areaM2)))]] as [string, (l: Listing) => string][])),
      ['Quartos', (l) => (hasBedrooms(l.type) ? String(l.bedrooms) : '—')],
      ['Suítes', (l) => (l.suites === undefined ? '—' : String(l.suites))],
      ['Banheiros', (l) => (l.type === 'land' ? '—' : String(l.bathrooms))],
      ['Vagas', (l) => (l.type === 'land' ? '—' : String(l.parkingSpots))],
      ['Condomínio', (l) => (l.condoFee ? formatBRL(l.condoFee) : '—')],
      ['IPTU', (l) => (l.iptu ? `${formatBRL(l.iptu.value)}/${l.iptu.period === 'year' ? 'ano' : 'mês'}` : '—')],
      ['Situação', (l) => STATUS_LABELS[l.status]],
      ['Características', (l) => (l.features.length ? l.features.map((f) => AMENITY_LABELS[f]).join(', ') : '—')],
    ];
    // best value of each numeric row is marked
    const best = (vals: number[], low: boolean) => (low ? Math.min(...vals) : Math.max(...vals));
    const perM2 = list.map(salePrice).filter((p): p is number => p !== null);
    const bestOf: Record<string, number> = {
      ...(rent || !perM2.length ? {} : { 'Valor do m²': best(list.filter((l) => salePrice(l) !== null).map((l) => salePrice(l)! / l.areaM2), true) }),
      Área: best(list.map((l) => l.areaM2), false),
    };
    const isBest = (row: string, l: Listing) =>
      list.length > 1 && row in bestOf && (row === 'Área' ? l.areaM2 : salePrice(l) === null ? NaN : salePrice(l)! / l.areaM2) === bestOf[row];
    const both = list.some((l) => priceIn(l, !rent) !== null);
    main.innerHTML = `<div class="wrap"><h1>Comparar imóveis</h1>
      <div class="cmp-wrap"><table class="cmp-table">
        <thead><tr><th scope="col"><span class="sr-only">Item</span></th>${list
          .map(
            (l) => `<th scope="col"><a href="${escapeHtml(this.href('imovel', { id: l.id, ...(rent ? { negocio: 'alugar' } : {}) }))}" data-nav><img src="${escapeHtml(photosOf(l, c)[0].thumb ?? photosOf(l, c)[0].src)}" alt=""><span>${escapeHtml(l.title)}</span></a>
            <button type="button" class="link-btn" data-uncmp="${escapeHtml(l.id)}">Remover</button></th>`,
          )
          .join('')}</tr></thead>
        <tbody>${rows.map(([k, f]) => `<tr><th scope="row">${k}</th>${list.map((l) => `<td${isBest(k, l) ? ' class="best"' : ''}>${f(l)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <p class="muted small">Em destaque: ${rent ? 'a maior área' : 'a maior área e o menor valor do m²'} entre os selecionados.${
        both ? ` <a href="${escapeHtml(this.href('comparar', rent ? {} : { negocio: 'alugar' }))}" data-nav>${rent ? 'Comparar os preços de venda' : 'Comparar os aluguéis'}</a>` : ''
      }</p></div>`;
    main.querySelectorAll<HTMLButtonElement>('[data-uncmp]').forEach((b) =>
      b.addEventListener('click', () => {
        this.saved.toggleCompare(b.dataset.uncmp!);
        this.render();
      }),
    );
  }
}
