// The other pages of the client's site: about, contact, "anunciar", favourites, comparison and "not found".
import { AMENITY_LABELS, STATUS_LABELS, LISTING_TYPES, TYPE_LABELS, hasBedrooms, priceIn, type Listing } from '../../data/types';
import { escapeHtml, formatArea, formatBRL } from '../../utils/format';
import { formatPhone, telHref, whatsappHref } from '../config';
import { cardHtml, photosOf, priceHtml } from '../cards';
import { leadFormHtml, wireLeadForm } from '../forms';
import { ICONS } from '../icons';
import { MAX_COMPARE } from '../saved';
import { bairroCounts } from '../search';
import { REGION } from '../../config/region';
import type { SiteApp } from '../app';
import { $, plural } from './util';

// ---------------------------------------------------------------- institutional pages

export function about(app: SiteApp, main: HTMLElement): void {
  const c = app.config;
  app.setPage('sobre');
  const paragraphs = (c.about.text || `A ${c.name} ajuda você a comprar, vender e alugar imóveis em ${REGION.city}.`).split(/\n+/).filter(Boolean);
  main.innerHTML = `<div class="wrap narrow about">
    <h1>${escapeHtml(c.about.title)}</h1>
    ${c.about.image ? `<img class="about-img" src="${escapeHtml(c.about.image)}" alt="">` : ''}
    ${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
    ${c.creci ? `<p class="muted">CRECI ${escapeHtml(c.creci)}</p>` : ''}
    <p><a class="btn btn-primary" href="${escapeHtml(app.href('contato'))}" data-nav>Fale com a gente</a></p>
  </div>`;
}

export function contact(app: SiteApp, main: HTMLElement): void {
  const c = app.config;
  app.setPage('contato');
  const maps = c.contacts.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.contacts.address)}` : '';
  main.innerHTML = `<div class="wrap two-col">
    <div>
      <h1>Contato</h1>
      <p>Mande sua mensagem: respondemos pelo canal que você preferir.</p>
      ${leadFormHtml({
        orgName: c.name,
        submitLabel: 'Enviar',
        captcha: !app.data.demo,
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
      <p class="foot-social">${app.socialHtml()}</p>
    </aside>
  </div>`;
  wireSiteForm(app, main, 'contact', 'Mensagem enviada. Vamos responder em breve.');
}

export function announce(app: SiteApp, main: HTMLElement): void {
  const c = app.config;
  app.setPage('anunciar');
  const bairros = bairroCounts(app.data.listings, false).map((b) => b.name);
  main.innerHTML = `<div class="wrap two-col">
    <div>
      <h1>Anuncie seu imóvel</h1>
      <p>Conte um pouco sobre o imóvel. Um corretor entra em contato para combinar a avaliação. Sem compromisso.</p>
      ${leadFormHtml({
        orgName: c.name,
        submitLabel: 'Quero anunciar',
        captcha: !app.data.demo,
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
  wireSiteForm(app, main, 'owner', 'Recebemos os dados do seu imóvel. Um corretor vai entrar em contato.');
}

function wireSiteForm(app: SiteApp, main: HTMLElement, kind: 'contact' | 'owner', done: string): void {
  wireLeadForm(
    $(main, 'form.lead'),
    async (input, details) => {
      if (app.data.demo || !app.data.remote) return null;
      await app.data.remote.submitSiteLead(app.data.agencyId, kind, input, details);
      return null;
    },
    app.data.demo ? 'Demonstração: nada foi enviado. No site real, o contato chega aos administradores e em Minha conta → Contatos.' : done,
  );
}

/** An address that is not a page of the site (out of search engines). */
export function missingPage(app: SiteApp, main: HTMLElement): void {
  app.setPage('nao-encontrada');
  main.innerHTML = `<div class="wrap narrow"><h1>Página não encontrada</h1><p>O endereço pode estar errado ou a página foi retirada.</p>
    <p><a class="btn btn-primary" href="${escapeHtml(app.menuHref('venda'))}" data-nav>Ver os imóveis</a> <a class="btn btn-ghost" href="${escapeHtml(app.href('inicio'))}" data-nav>Página inicial</a></p></div>`;
}

export function favorites(app: SiteApp, main: HTMLElement): void {
  app.setPage('favoritos');
  const list = app.saved.favorites.map((id) => app.data.listings.find((l) => l.id === id)).filter((l): l is Listing => !!l);
  // in the mode of the search (?negocio=alugar): rents on the cards and the listing pages open in rent mode
  const rent = app.params.get('negocio') === 'alugar';
  const both = list.some((l) => priceIn(l, false) !== null && priceIn(l, true) !== null);
  const toggle = both ? ` <a href="${escapeHtml(app.href('favoritos', rent ? {} : { negocio: 'alugar' }))}" data-nav>${rent ? 'Ver os preços de venda' : 'Ver os aluguéis'}</a>` : '';
  main.innerHTML = `<div class="wrap"><h1>Favoritos</h1>${
    list.length
      ? `<p class="muted">Salvos neste navegador. ${plural(list.length, 'imóvel', 'imóveis')}.${toggle}</p><div class="r-list r-grade">${list.map((l) => cardHtml(l, app.cardCtx(rent))).join('')}</div>`
      : `<div class="empty"><p>Você ainda não salvou nenhum imóvel. Toque no ${ICONS.heart} de um imóvel para guardá-lo aqui.</p><a class="btn btn-primary" href="${escapeHtml(app.menuHref('venda'))}" data-nav>Ver imóveis</a></div>`
  }</div>`;
}

export function compare(app: SiteApp, main: HTMLElement): void {
  const c = app.config;
  app.setPage('comparar');
  const list = app.saved.compared.map((id) => app.data.listings.find((l) => l.id === id)).filter((l): l is Listing => !!l);
  if (!list.length) {
    main.innerHTML = `<div class="wrap"><h1>Comparar imóveis</h1><div class="empty"><p>Marque "Comparar" em até ${MAX_COMPARE} imóveis para vê-los lado a lado.</p><a class="btn btn-primary" href="${escapeHtml(app.menuHref('venda'))}" data-nav>Ver imóveis</a></div></div>`;
    return;
  }
  // in the mode of the search: rentals compare the monthly rent (the value per m² is a sale measure)
  const rent = app.params.get('negocio') === 'alugar';
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
          (l) => `<th scope="col"><a href="${escapeHtml(app.href('imovel', { id: l.id, ...(rent ? { negocio: 'alugar' } : {}) }))}" data-nav><img src="${escapeHtml(photosOf(l, c)[0].thumb ?? photosOf(l, c)[0].src)}" alt=""><span>${escapeHtml(l.title)}</span></a>
          <button type="button" class="link-btn" data-uncmp="${escapeHtml(l.id)}">Remover</button></th>`,
        )
        .join('')}</tr></thead>
      <tbody>${rows.map(([k, f]) => `<tr><th scope="row">${k}</th>${list.map((l) => `<td${isBest(k, l) ? ' class="best"' : ''}>${f(l)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <p class="muted small">Em destaque: ${rent ? 'a maior área' : 'a maior área e o menor valor do m²'} entre os selecionados.${
      both ? ` <a href="${escapeHtml(app.href('comparar', rent ? {} : { negocio: 'alugar' }))}" data-nav>${rent ? 'Comparar os preços de venda' : 'Comparar os aluguéis'}</a>` : ''
    }</p></div>`;
  main.querySelectorAll<HTMLButtonElement>('[data-uncmp]').forEach((b) =>
    b.addEventListener('click', () => {
      app.saved.toggleCompare(b.dataset.uncmp!);
      app.render();
    }),
  );
}
