// Search page of the client's site: filters, results (list or 3D map in a frame) and their paging.
import { AMENITIES, AMENITY_LABELS, LISTING_TYPES, TYPE_LABELS, isForRent, type Listing } from '../../data/types';
import { EMPTY_CRITERIA, cloneCriteria, normalizeName } from '../../state/filters';
import { SORT_KEYS, SORT_LABELS } from '../../state/sort';
import { escapeHtml, parseNumberInput } from '../../utils/format';
import { cardHtml } from '../cards';
import { ICONS } from '../icons';
import { codeOf } from '../routes';
import { alertQuery, bairroCounts, chipsOf, emptySearch, pageOf, queryToSearch, resultsTitle, runSearch, searchLabel, type SiteSearch } from '../search';
import { MAX_SEARCHES } from '../saved';
import { captchaBox, formCaptcha } from '../../backend/captcha';
import type { SiteApp } from '../app';
import { $, plural } from './util';
import { countGroup, wireCountGroups } from './home';
import { wantedHtml, wireWanted } from '../wanted';

// ---------------------------------------------------------------- search

export function searchPage(app: SiteApp, main: HTMLElement): void {
  const c = app.config;
  // unknown neighbourhood names in the address are dropped (no arbitrary text in the page title)
  app.search = queryToSearch(location.search, c.search, new Set([app.data.agencyId]), bairroCounts(app.data.listings, false).map((b) => b.name));
  const s = app.search;
  const hasRent = app.data.listings.some(isForRent);
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
            <button type="button" class="btn btn-ghost save-search" aria-pressed="false">${ICONS.bell}<span>Salvar busca</span></button>
            <div class="tabs views" role="group" aria-label="Exibir em">
              <button type="button" data-view="grade" aria-label="Grade">${ICONS.grid}</button><button type="button" data-view="lista" aria-label="Lista">${ICONS.list}</button><button type="button" data-view="mapa" aria-label="Mapa 3D">${ICONS.map}<span>Mapa 3D</span></button>
            </div>
          </div>
        </div>
        <div class="chips" role="group" aria-label="Filtros aplicados"></div>
        <div class="alert-slot"></div>
        <div class="r-list"></div>
        <nav class="pager" aria-label="Páginas"></nav>
      </section>
    </div>`;
  renderFilterPanel(app);
  renderBairroChips(app);
  renderResults(app);
  $(main, '.save-search').addEventListener('click', () => {
    const s = app.search;
    const ids = runSearch(app.data.listings, s).map((l) => l.id);
    if (!app.saved.toggleSearch(alertQuery(s, c.search), searchLabel(s), ids)) {
      app.toast(`Salve até ${MAX_SEARCHES} buscas; apague alguma em Favoritos.`);
      return;
    }
    app.toast(app.saved.savedSearch(alertQuery(s, c.search)) ? 'Busca salva neste navegador: veja em Favoritos quando entrar imóvel novo.' : 'Busca removida.');
    renderSaveState(app, main);
  });
  const top = $(main, '.search-top');
  top.querySelectorAll<HTMLButtonElement>('[data-deal]').forEach((b) =>
    b.addEventListener('click', () => {
      top.querySelectorAll('[data-deal]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      // prices change meaning (sale price × monthly rent): price bounds are dropped
      update(app, {}, { transaction: b.dataset.deal === 'rent' ? 'rent' : null, priceMin: null, priceMax: null }, true);
    }),
  );
  top.querySelectorAll<HTMLButtonElement>('[data-st]').forEach((b) =>
    b.addEventListener('click', () => {
      top.querySelectorAll('[data-st]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      update(app, {}, { statuses: b.dataset.st ? [b.dataset.st as Listing['status']] : [] });
    }),
  );
  top.querySelector<HTMLInputElement>('[name=reduzido]')!.addEventListener('change', (e) => update(app, {}, { reducedOnly: (e.target as HTMLInputElement).checked ? true : null }));
  const bInput = $<HTMLInputElement>(top, '#f-bairro');
  const addBairro = () => {
    const all = bairroCounts(app.data.listings, app.search.criteria.transaction === 'rent').map((b) => b.name);
    const match = all.find((b) => normalizeName(b) === normalizeName(bInput.value));
    if (!match) return false;
    bInput.value = '';
    if (!app.search.criteria.bairros.includes(match)) update(app, {}, { bairros: [...app.search.criteria.bairros, match] });
    renderBairroChips(app);
    return true;
  };
  bInput.addEventListener('input', addBairro);
  bInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addBairro();
    } else if (e.key === 'Backspace' && !bInput.value && app.search.criteria.bairros.length) {
      update(app, {}, { bairros: app.search.criteria.bairros.slice(0, -1) });
      renderBairroChips(app);
    }
  });
  top.querySelector('.filters-btn')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    main.querySelector('.search-body')!.classList.toggle('panel-open', open);
    if (!lateral) $(main, '#f-panel').hidden = !open;
  });
  main.querySelector<HTMLSelectElement>('[name=ordem]')!.addEventListener('change', (e) => update(app, { sort: (e.target as HTMLSelectElement).value as SiteSearch['sort'] }));
  main.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.addEventListener('click', () => update(app, { view: b.dataset.view as SiteSearch['view'] }, {}, false, true)));
}

/** Changes the search, writes the URL and refreshes the results (not the controls being used). */
function update(app: SiteApp, patch: Partial<SiteSearch>, crit: Partial<SiteSearch['criteria']> = {}, refreshPanel = false, keepPage = false): void {
  app.search = { ...app.search, ...patch, criteria: { ...cloneCriteria(app.search.criteria), ...crit } };
  if (!keepPage && patch.page === undefined) app.search.page = 1;
  history.replaceState(null, '', app.searchHref(app.search));
  if (refreshPanel) renderFilterPanel(app);
  renderResults(app);
}

function renderBairroChips(app: SiteApp): void {
  const box = app.root.querySelector<HTMLElement>('.bairro-chips');
  if (!box) return;
  box.innerHTML = app.search.criteria.bairros
    .map((b) => `<button type="button" class="chip chip-solid" data-b="${escapeHtml(b)}" aria-label="Remover o bairro ${escapeHtml(b)}">${escapeHtml(b)} ${ICONS.close}</button>`)
    .join('');
  box.querySelectorAll<HTMLButtonElement>('[data-b]').forEach((b) =>
    b.addEventListener('click', () => {
      update(app, {}, { bairros: app.search.criteria.bairros.filter((x) => x !== b.dataset.b) });
      renderBairroChips(app);
      app.root.querySelector<HTMLInputElement>('#f-bairro')?.focus();
    }),
  );
  const list = app.root.querySelector('#f-bairros');
  if (list)
    list.innerHTML = bairroCounts(app.data.listings, app.search.criteria.transaction === 'rent')
      .filter((b) => !app.search.criteria.bairros.includes(b.name))
      .map((b) => `<option value="${escapeHtml(b.name)}">${plural(b.count, 'imóvel', 'imóveis')}</option>`)
      .join('');
}

function renderFilterPanel(app: SiteApp): void {
  const panel = app.root.querySelector<HTMLElement>('#f-panel');
  if (!panel) return;
  const s = app.search;
  const c = s.criteria;
  const rent = c.transaction === 'rent';
  const num = (v: number | null) => (v === null ? '' : v.toLocaleString('pt-BR'));
  const presentTypes = LISTING_TYPES.filter((t) => app.data.listings.some((l) => l.type === t));
  const presentFeatures = AMENITIES.filter((a) => app.data.listings.some((l) => l.features.includes(a)));
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
    ${countGroup('Quartos', 'quartos', c.bedroomsMin === null ? null : Math.min(4, c.bedroomsMin))}
    ${countGroup('Suítes', 'suites', s.suitesMin === null ? null : Math.min(4, s.suitesMin))}
    ${countGroup('Banheiros', 'banheiros', c.bathroomsMin === null ? null : Math.min(4, c.bathroomsMin))}
    ${countGroup('Vagas', 'vagas', c.parkingMin === null ? null : Math.min(4, c.parkingMin))}
    ${presentFeatures.length ? `<div class="f-group"><h2>Características</h2><div class="pills">${presentFeatures
      .map((a) => `<label class="pill"><input type="checkbox" name="comodidade" value="${a}"${c.features.includes(a) ? ' checked' : ''}><span>${AMENITY_LABELS[a]}</span></label>`)
      .join('')}</div></div>` : ''}
    <label class="f-group fld"><span>Código do imóvel</span><input name="codigo" value="${escapeHtml(s.code ?? '')}" maxlength="30" placeholder="Ex.: ${escapeHtml(codeOf(app.data.listings[0] ?? ({ id: 'abc' } as Listing)))}"></label>
    <button type="button" class="link-btn f-clear">Limpar filtros</button>
    <button type="button" class="btn btn-primary f-apply">Ver imóveis</button>`;
  // phones: the panel covers the results; this closes it and shows them
  $(panel, '.f-apply').addEventListener('click', () => {
    const btn = app.root.querySelector<HTMLButtonElement>('.filters-btn[aria-expanded="true"]');
    btn?.click();
    app.root.querySelector<HTMLElement>('#r-title')?.focus();
    app.root.querySelector('.results')?.scrollIntoView({ block: 'start' });
  });
  panel.querySelectorAll<HTMLInputElement>('[name=tipo]').forEach((i) =>
    i.addEventListener('change', () => update(app, {}, { types: [...panel.querySelectorAll<HTMLInputElement>('[name=tipo]:checked')].map((x) => x.value as Listing['type']) })),
  );
  panel.querySelectorAll<HTMLInputElement>('[name=comodidade]').forEach((i) =>
    i.addEventListener('change', () =>
      update(app, {}, { features: [...panel.querySelectorAll<HTMLInputElement>('[name=comodidade]:checked')].map((x) => x.value as (typeof AMENITIES)[number]) }),
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
      later(name, () => update(app, {}, { [field]: v }), 350);
    });
  }
  panel.querySelector<HTMLInputElement>('[name=codigo]')!.addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value.trim() || null;
    later('codigo', () => update(app, { code: v }), 300);
  });
  wireCountGroups(panel, (name, v) => {
    if (name === 'suites') update(app, { suitesMin: v });
    else update(app, {}, name === 'quartos' ? { bedroomsMin: v } : name === 'banheiros' ? { bathroomsMin: v } : { parkingMin: v });
  });
  $(panel, '.f-clear').addEventListener('click', () => {
    const keep = app.search;
    app.search = emptySearch(keep.sort, keep.view);
    app.search.criteria.bairros = keep.criteria.bairros;
    app.search.criteria.transaction = keep.criteria.transaction;
    app.search.criteria.statuses = keep.criteria.statuses;
    app.search.criteria.reducedOnly = keep.criteria.reducedOnly;
    update(app, {}, {}, true);
  });
}

function renderResults(app: SiteApp): void {
  const main = app.root.querySelector<HTMLElement>('main.page-imoveis');
  if (!main) return;
  const s = app.search;
  const c = app.config;
  const found = runSearch(app.data.listings, s);
  const rent = s.criteria.transaction === 'rent';
  app.lastRent = rent;
  const title = resultsTitle(found.length, s);
  // screen readers hear the new count once the typing stops
  app.say(title, 600);
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
  app.setMeta(`${resultsTitle(found.length, s)} · ${c.name}`, `${resultsTitle(found.length, s)}. ${c.seo.description || c.home.subtitle}`);
  main.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === s.view)));
  // menu highlight follows the search
  const active = app.activeItem();
  app.root.querySelectorAll<HTMLAnchorElement>('.nav a').forEach((a) => a.removeAttribute('aria-current'));
  if (active) {
    const i = c.menu.indexOf(active);
    app.root.querySelectorAll<HTMLAnchorElement>('.nav a')[i]?.setAttribute('aria-current', 'page');
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
        app.search = next;
        history.replaceState(null, '', app.searchHref(next));
        app.render();
      }),
    );
  renderSaveState(app, main, found.map((l) => l.id));
  const list = $(main, '.r-list');
  const pager = $(main, '.pager');
  if (s.view === 'mapa') {
    list.className = 'r-list r-map';
    pager.innerHTML = '';
    showMap(app, list, found);
    return;
  }
  app.mapFrame = null;
  if (!found.length) {
    const tips = chips
      .map((ch) => ({ ch, n: runSearch(app.data.listings, ch.without).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3);
    list.className = 'r-list r-empty';
    list.innerHTML = `<div class="empty"><h2>Nenhum imóvel com todos esses filtros</h2>${
      tips.length
        ? `<p>Tente tirar um deles:</p><ul>${tips.map((t, i) => `<li><button type="button" class="chip" data-tip="${i}">Sem "${escapeHtml(t.ch.label)}": ${plural(t.n, 'imóvel', 'imóveis')}</button></li>`).join('')}</ul>`
        : ''
    }</div>${wantedHtml(app, searchLabel(s))}`;
    wireWanted(app, list, searchLabel(s));
    list.querySelectorAll<HTMLButtonElement>('[data-tip]').forEach((b) =>
      b.addEventListener('click', () => {
        app.search = tips[Number(b.dataset.tip)].ch.without;
        history.replaceState(null, '', app.searchHref(app.search));
        app.render();
      }),
    );
    pager.innerHTML = '';
    return;
  }
  const pg = pageOf(found, s.page, c.search.perPage);
  // a page past the end (pagina=99) shows the last one: the address says so too
  if (pg.page !== s.page) {
    app.search = { ...s, page: pg.page };
    history.replaceState(null, '', app.searchHref(app.search));
  }
  list.className = `r-list r-${s.view}`;
  // cards under the page's h1 are h2 (on the home page, under a section's h2, they are h3)
  list.innerHTML = pg.items.map((l) => cardHtml(l, app.cardCtx(rent), s.view === 'lista' ? 'lista' : 'grade', 2)).join('');
  pager.innerHTML =
    pg.pages > 1
      ? Array.from({ length: pg.pages }, (_, i) => i + 1)
          .filter((n) => n === 1 || n === pg.pages || Math.abs(n - pg.page) <= 2)
          .map((n, i, arr) => `${i > 0 && n - arr[i - 1] > 1 ? '<span class="gap">…</span>' : ''}<a href="${escapeHtml(app.searchHref({ ...s, page: n }))}" data-page="${n}"${n === pg.page ? ' aria-current="page"' : ''}>${n}</a>`)
          .join('')
      : '';
  // each page is a history entry (Back returns to the previous page); Ctrl/middle click opens a new tab
  pager.querySelectorAll<HTMLAnchorElement>('[data-page]').forEach((a) =>
    a.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      app.search = { ...app.search, page: Number(a.dataset.page) };
      history.pushState(null, '', app.searchHref(app.search));
      renderResults(app);
      main.querySelector('.results')!.scrollIntoView({ behavior: 'smooth' });
      $(main, '#r-title').focus({ preventScroll: true });
    }),
  );
}

// ---------------------------------------------------------------- saved search and e-mail alert

/** "Salvar busca" pressed or not, and (on a client's site with backend) the form of the e-mail alert. */
function renderSaveState(app: SiteApp, main: HTMLElement, matchIds?: string[]): void {
  const query = alertQuery(app.search, app.config.search);
  const saved = !!app.saved.savedSearch(query);
  // opening a saved search: what it shows now is no longer new
  if (saved && matchIds) app.saved.markSeen(query, matchIds);
  const btn = $(main, '.save-search');
  btn.setAttribute('aria-pressed', String(saved));
  btn.querySelector('span')!.textContent = saved ? 'Busca salva' : 'Salvar busca';
  const slot = $(main, '.alert-slot');
  const remote = app.data.demo ? null : app.data.remote;
  if (!remote || slot.dataset.query === query) return;
  slot.dataset.query = query;
  slot.innerHTML = `<details class="alert-box"><summary>${ICONS.mail} Receber por e-mail os imóveis novos desta busca</summary>
    <form novalidate>
      <label class="fld"><span>E-mail</span><input name="email" type="email" autocomplete="email" maxlength="120" required></label>
      <label class="hp" aria-hidden="true">Não preencha<input name="website" tabindex="-1" autocomplete="off"></label>
      <label class="consent"><input type="checkbox" name="consent"> <span>Quero receber de ${escapeHtml(app.config.name)} um e-mail quando entrar imóvel novo nesta busca. Posso cancelar pelo link de cada e-mail.</span></label>
      ${captchaBox()}
      <p class="form-msg" role="status" aria-live="polite"></p>
      <button type="submit" class="btn btn-primary">Avisar por e-mail</button>
    </form></details>`;
  const form = slot.querySelector('form')!;
  const msg = $(form, '.form-msg');
  const captcha = formCaptcha(form, 'lead');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = String(new FormData(form).get('email') ?? '').trim();
    const consent = form.querySelector<HTMLInputElement>('[name=consent]')!;
    msg.className = 'form-msg err';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return void (msg.textContent = 'Informe um e-mail válido.');
    if (!consent.checked) return void (msg.textContent = 'Marque a concordância para receber os avisos.');
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    submit.disabled = true;
    msg.className = 'form-msg';
    msg.textContent = 'Enviando…';
    const error = await (captcha ? captcha.getToken() : Promise.resolve(undefined))
      .then((captchaToken) =>
        remote.subscribeAlert(app.data.agencyId, {
          email,
          query,
          label: searchLabel(app.search),
          consentText: consent.nextElementSibling!.textContent!.trim(),
          trap: String(new FormData(form).get('website') ?? ''),
          captchaToken,
        }),
      )
      .then(() => null, (err: Error) => err.message);
    captcha?.reset();
    submit.disabled = false;
    msg.className = `form-msg ${error ? 'err' : 'ok'}`;
    msg.textContent = error ?? `Quase lá: até amanhã chega em ${email} um link para confirmar. Os avisos começam depois da confirmação.`;
    if (!error) form.reset();
  });
}

// ---------------------------------------------------------------- 3D map (the map app in a frame)

export function mapUrl(app: SiteApp, extra: Record<string, string> = {}): string {
  const detail = new URL(app.href('imovel', { id: '__ID__' }), location.href).href;
  const p = new URLSearchParams({ embed: '1', site: app.data.agencyId, cor: app.config.colors.primary.slice(1), pagina: detail, ...extra });
  return new URL(`${app.paths ? '/' : import.meta.env.BASE_URL}mapa.html?${p}`, location.href).href;
}

function showMap(app: SiteApp, box: HTMLElement, found: Listing[]): void {
  const ids = found.map((l) => l.id);
  if (app.mapFrame && box.contains(app.mapFrame)) {
    postResults(app, ids);
    return;
  }
  // the map of the page before the redraw (parkMap), if it still shows the same thing
  const parked = app.mapFrame;
  if (parked?.parentElement === document.body && parked.getAttribute('src') === mapUrl(app)) {
    box.innerHTML = '<div class="map-frame search"></div>';
    box.firstElementChild!.moveBefore(parked, null);
    postResults(app, ids);
    return;
  }
  box.innerHTML = `<div class="map-frame search"><iframe title="Mapa 3D com os imóveis encontrados" src="${escapeHtml(mapUrl(app))}" allow="fullscreen"></iframe></div>`;
  app.mapFrame = box.querySelector('iframe');
  app.mapReady = false;
  app.pendingIds = ids;
}
function postResults(app: SiteApp, ids: string[]): void {
  app.pendingIds = ids;
  if (app.mapReady)
    app.mapFrame?.contentWindow?.postMessage(
      { type: 'site-results', ids, rent: app.search.criteria.transaction === 'rent', bairros: app.search.criteria.bairros },
      location.origin,
    );
}

export function onMapMessage(app: SiteApp, e: MessageEvent): void {
  if (e.origin !== location.origin || !app.mapFrame || e.source !== app.mapFrame.contentWindow) return;
  if ((e.data as { type?: string })?.type === 'map-ready') {
    app.mapReady = true;
    postResults(app, app.pendingIds);
  }
}
