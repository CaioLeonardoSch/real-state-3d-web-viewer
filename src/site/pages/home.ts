// Home page of the client's site: banner with the quick search, featured listings and neighbourhoods.
import { LISTING_TYPES, TYPE_LABELS, priceReduction, isForRent, type Listing } from '../../data/types';
import { EMPTY_CRITERIA, filterListings, normalizeName } from '../../state/filters';
import { escapeHtml, parseNumberInput } from '../../utils/format';
import { cardHtml } from '../cards';
import { ICONS } from '../icons';
import { bairroCounts, emptySearch, runSearch, type SiteSearch } from '../search';
import { REGION } from '../../config/region';
import type { SiteApp } from '../app';
import { $, plural } from './util';
import { wantedHtml, wireWanted } from '../wanted';

// ---------------------------------------------------------------- home

export function home(app: SiteApp, main: HTMLElement): void {
  const c = app.config;
  const all = app.data.listings;
  app.setPage('inicio');
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
  quickSearch(app, $(main, '.quick'));
  const sections = $(main, '.home-sections');
  const ctx = app.cardCtx();
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
      parts.push(row('Imóveis em destaque', (list.length ? list : forSale).slice(0, 12), app.searchHref({ ...base, sort: 'relevance' })));
    } else if (sec === 'descontos') {
      const list = forSale.filter((l) => priceReduction(l)).sort((a, b) => priceReduction(b)!.percent - priceReduction(a)!.percent);
      parts.push(row('Baixaram o preço', list.slice(0, 12), app.searchHref({ ...base, criteria: { ...base.criteria, reducedOnly: true } })));
    } else if (sec === 'lancamentos') {
      const list = forSale.filter((l) => l.status === 'under_construction');
      parts.push(row('Lançamentos', list.slice(0, 12), app.searchHref({ ...base, criteria: { ...base.criteria, statuses: ['under_construction'] } })));
    } else if (sec === 'recentes') {
      const list = [...forSale].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
      parts.push(row('Anunciados recentemente', list.slice(0, 12), app.searchHref({ ...base, sort: 'recent' })));
    } else if (sec === 'mapa') {
      parts.push(`<section class="wrap home-sec"><a class="map-cta" href="${escapeHtml(app.searchHref({ ...base, view: 'mapa' }))}" data-nav>
        <span class="map-cta-icon">${ICONS.cube}</span>
        <span><strong>Veja os imóveis no mapa 3D de ${escapeHtml(REGION.city)}</strong><span>Os prédios de verdade, a rua, o sol da manhã e da tarde, o que tem por perto. Coisa que fotos não mostram.</span></span>
        <span class="btn btn-primary">Abrir o mapa</span></a></section>`);
    } else if (sec === 'bairros') {
      const top = bairroCounts(all, false).slice(0, 8);
      if (top.length)
        parts.push(`<section class="wrap home-sec"><div class="sec-head"><h2>Bairros com mais imóveis</h2></div><ul class="bairros">${top
          .map((b) => `<li><a href="${escapeHtml(app.searchHref({ ...base, criteria: { ...base.criteria, bairros: [b.name] } }))}" data-nav><strong>${escapeHtml(b.name)}</strong><span>${plural(b.count, 'imóvel', 'imóveis')}</span></a></li>`)
          .join('')}</ul></section>`);
    } else if (sec === 'sobre' && c.about.text) {
      parts.push(`<section class="wrap home-sec about-teaser"><div><h2>${escapeHtml(c.about.title)}</h2><p>${escapeHtml(c.about.text.split('\n')[0])}</p>
        <a href="${escapeHtml(app.href('sobre'))}" data-nav class="more">Conheça ${ICONS.right}</a></div>${c.about.image ? `<img src="${escapeHtml(c.about.image)}" alt="" loading="lazy">` : ''}</section>`);
    } else if (sec === 'depoimentos') {
      parts.push(proofHtml(app));
    } else if (sec === 'encomenda') {
      parts.push(`<div class="wrap home-sec">${wantedHtml(app, null)}</div>`);
    } else if (sec === 'anunciar') {
      parts.push(`<section class="cta-band"><div class="wrap"><div><h2>Quer vender ou alugar seu imóvel?</h2><p>Anuncie com a ${escapeHtml(c.name)}: seu imóvel no site, no mapa 3D e nos portais.</p></div>
        <a class="btn btn-light" href="${escapeHtml(app.href('anunciar'))}" data-nav>Anunciar meu imóvel</a></div></section>`);
    }
  }
  sections.innerHTML = parts.join('');
  wireWanted(app, sections, null);
  sections.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-rail]');
    if (!b) return;
    const rail = b.closest('.home-sec')!.querySelector<HTMLElement>('.rail')!;
    rail.scrollBy({ left: Number(b.dataset.rail) * rail.clientWidth * 0.9, behavior: 'smooth' });
  });
}

/** Quick search over the cover (636 style): deal tabs, type, neighbourhood, live count, optional filters. */
function quickSearch(app: SiteApp, box: HTMLElement): void {
  const c = app.config;
  const all = app.data.listings;
  const hasRent = all.some(isForRent);
  let s = emptySearch(c.search.sort, c.search.view);
  const bairros = bairroCounts(all, false).map((b) => b.name);
  box.innerHTML = `
    <div class="q-tabs" role="group" aria-label="O que você procura">
      <button type="button" aria-pressed="true" data-deal="sale">Comprar</button>
      ${hasRent ? '<button type="button" aria-pressed="false" data-deal="rent">Alugar</button>' : ''}
      ${c.menu.includes('anunciar') ? `<a href="${escapeHtml(app.href('anunciar'))}" data-nav>Vender</a>` : ''}
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
        ${countGroup('Quartos', 'quartos', null)}
        ${countGroup('Vagas', 'vagas', null)}
        <button type="button" class="link-btn q-clear">Limpar filtros</button>
      </div>
    </div>`;
  const go = $<HTMLAnchorElement>(box, '.q-go');
  const update = () => {
    const n = runSearch(all, s).length;
    $(box, '.q-count').textContent = String(n);
    go.href = app.searchHref(s);
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
  wireCountGroups(box, (field, v) => set({}, field === 'quartos' ? { bedroomsMin: v } : { parkingMin: v }));
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
export function countGroup(label: string, name: string, value: number | null): string {
  return `<fieldset class="box count" data-count="${name}"><legend>${label}</legend>${[1, 2, 3, 4]
    .map((n) => `<button type="button" data-v="${n}" aria-pressed="${value === n}" aria-label="${n === 4 ? '4+' : n}: ${n} ou mais ${label.toLowerCase()}">${n === 4 ? '4+' : n}</button>`)
    .join('')}</fieldset>`;
}

export function wireCountGroups(root: HTMLElement, onChange: (name: string, v: number | null) => void): void {
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

/** The agency's numbers and its clients' words, as filled in the editor; nothing when both are empty. */
function proofHtml(app: SiteApp): string {
  const c = app.config;
  const stats = c.proof.stats.filter((s) => s.value && s.label);
  const quotes = c.proof.testimonials.filter((t) => t.text && t.name);
  if (!stats.length && !quotes.length) return '';
  return `<section class="wrap home-sec proof" aria-labelledby="proof-title">
    <div class="sec-head"><h2 id="proof-title">${quotes.length ? 'O que dizem nossos clientes' : `${escapeHtml(c.name)} em números`}</h2></div>
    ${stats.length ? `<ul class="proof-stats">${stats.map((s) => `<li><strong>${escapeHtml(s.value)}</strong><span>${escapeHtml(s.label)}</span></li>`).join('')}</ul>` : ''}
    ${
      quotes.length
        ? `<div class="proof-quotes">${quotes
            .map(
              (t) => `<figure class="quote"><blockquote><p>${escapeHtml(t.text)}</p></blockquote>
          <figcaption><strong>${escapeHtml(t.name)}</strong>${t.detail ? `<span>${escapeHtml(t.detail)}</span>` : ''}</figcaption></figure>`,
            )
            .join('')}</div>`
        : ''
    }
  </section>`;
}
