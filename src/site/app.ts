// The client's site: header, pages and footer built from its configuration (src/site/config.ts). Pages are
// rendered in the browser from the listings already loaded, so moving around the site needs no request.
// Routes live in the query string (?p=imoveis&bairro=Glória), so every page and search is a real, shareable URL.
// This class keeps the state, the routing and the frame (header, footer, saved lists); the pages are in ./pages/.
import { escapeHtml } from '../utils/format';
import { MENU_LABELS, SOCIALS, SOCIAL_LABELS, formatPhone, telHref, themeVars, whatsappHref, type MenuItem, type SiteConfig } from './config';
import { wireCarousels, type CardContext } from './cards';
import type { SiteData } from './data';
import { fontFaceCss } from './fonts';
import { ICONS } from './icons';
import { ROUTES, listingPath, pageMeta, parsePath, routePath, type Route } from './routes';
import { MAX_COMPARE, SavedLists } from './saved';
import { emptySearch, searchToQuery, type SiteSearch } from './search';
import { $, plural } from './pages/util';
import { home } from './pages/home';
import { searchPage, onMapMessage } from './pages/search';
import { detail } from './pages/detail';
import { about, contact, announce, missingPage, favorites, compare } from './pages/info';

export class SiteApp {
  config: SiteConfig;
  readonly saved: SavedLists;
  private route: Route = 'inicio';
  /** The address names a page that does not exist (shown as "Página não encontrada", out of search engines). */
  private notFound = false;
  /** The last search was for rentals (the comparison opens in the same mode). */
  lastRent = false;
  private liveTimer = 0;
  private live = Object.assign(document.createElement('div'), { id: 'site-live', className: 'sr-only' });
  params = new URLSearchParams();
  search: SiteSearch;
  /** Map frame of the search page (kept while only the results change). */
  mapFrame: HTMLIFrameElement | null = null;
  mapReady = false;
  /** Keeps ?imobiliaria= in links when the site was opened that way (not on the client's own domain). */
  private keep: Record<string, string> = {};
  /** On the client's own domain the server (src/seo/siteServer.ts) marks the page: clean addresses (./routes). */
  readonly paths = !!document.querySelector('meta[name="site-paths"]');
  private fitBound = false;
  private fitTimer = 0;
  private wireHeaderFit: () => void = () => {};

  constructor(
    readonly root: HTMLElement,
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
    window.addEventListener('message', (e) => onMapMessage(this, e));
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
  bairroSearch(bairro: string): SiteSearch {
    const s = emptySearch(this.config.search.sort, this.config.search.view);
    s.criteria.bairros = [bairro];
    return s;
  }

  searchHref(s: SiteSearch): string {
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
      inicio: (el) => home(this, el),
      imoveis: (el) => searchPage(this, el),
      imovel: (el) => detail(this, el),
      sobre: (el) => about(this, el),
      contato: (el) => contact(this, el),
      anunciar: (el) => announce(this, el),
      favoritos: (el) => favorites(this, el),
      comparar: (el) => compare(this, el),
    };
    if (this.notFound) missingPage(this, main);
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
  setPage(page: Parameters<typeof pageMeta>[0]): void {
    const m = pageMeta(page, this.config);
    this.setMeta(m.title, m.description, undefined, m.noindex);
  }

  setMeta(title: string, description: string, canonical?: string, noindex = false): void {
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

  menuHref(item: MenuItem): string {
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
  activeItem(): MenuItem | null {
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

  socialHtml(): string {
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

  cardCtx(rent = false): CardContext {
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

  pendingIds: string[] = [];
}
