// Listing page of the client's site: gallery, details, construction progress, map and contact form.
import { AMENITY_LABELS, AVAILABILITY_LABELS, STATUS_LABELS, TRANSACTION_LABELS, TYPE_LABELS, USAGE_LABELS, priceIn, priceReduction, isForRent, type Listing, type Photo } from '../../data/types';
import { addressLabel, formatDate, safeUrl, videoEmbedUrl } from '../../data/listingText';
import { CONSTRUCTION_SOURCE_LABELS, builtShare, formatMonth, progressLabel } from '../../data/construction';
import { description as seoDescription, structuredData } from '../../seo/listingPage';
import { escapeHtml, formatArea, formatBRL } from '../../utils/format';
import { photoSrcset } from '../../utils/images';
import { formatPhone, telHref, whatsappHref } from '../config';
import { cardHtml, photosOf, placeOf, priceHtml, specsHtml } from '../cards';
import { leadFormHtml, wireLeadForm } from '../forms';
import type { LeadInput } from '../../backend/remote';
import { financingHtml, wireFinancing } from '../../ui/financingSim';
import { ICONS } from '../icons';
import { codeOf, listingPath } from '../routes';
import type { SiteApp } from '../app';
import { $ } from './util';
import { mapUrl } from './search';
import { DEMO } from '../../data/demo';

/**
 * The gallery's photo: phones get up to the 1024 px version, wider screens up to the 1920 px one (photos stored in
 * three sizes; others, the one they have).
 */
function galleryPhoto(p: Photo, alt: string): string {
  const wide = photoSrcset(p);
  const img = (set: string | null) => `<img src="${escapeHtml(p.src)}"${set ? ` srcset="${escapeHtml(set)}" sizes="100vw"` : ''} alt="${escapeHtml(alt)}">`;
  return wide ? `<picture><source media="(min-width: 700px)" srcset="${escapeHtml(wide)}" sizes="(max-width: 1240px) 100vw, 1200px">${img(photoSrcset(p, 'src'))}</picture>` : img(null);
}


// ---------------------------------------------------------------- listing page

export function detail(app: SiteApp, main: HTMLElement): void {
  const c = app.config;
  const l = app.data.listings.find((x) => x.id === app.params.get('id'));
  if (!l) {
    app.setPage('imovel-nao-encontrado');
    main.innerHTML = `<div class="wrap narrow"><h1>Imóvel não encontrado</h1><p>Ele pode ter sido vendido ou retirado do site.</p><a class="btn btn-primary" href="${escapeHtml(app.menuHref('venda'))}" data-nav>Ver os imóveis disponíveis</a></div>`;
    return;
  }
  const rent = !isForRent(l) ? false : app.params.get('negocio') === 'alugar' || l.transaction === 'rent';
  const photos = photosOf(l, c);
  const red = priceReduction(l);
  const addr = addressLabel(l) ?? placeOf(l);
  const url = location.href;
  const pages = (window as unknown as { __sitePages?: Record<string, string> }).__sitePages;
  // the listing's address on the client's domain; elsewhere its page built at publish time, when there is one
  const canonical = app.paths
    ? location.origin + listingPath(l)
    : pages?.[l.id]
      ? new URL(`${import.meta.env.BASE_URL}${pages[l.id]}`, location.href).href
      : undefined;
  app.setMeta(`${l.title} · ${c.name}`, seoDescription(l, c.name), canonical);
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
  const similar = app.data.listings
    .filter((x) => x.id !== l.id && x.type === l.type && Math.abs(x.price - l.price) / l.price < 0.35)
    .sort((a, b) => Number(b.address?.bairro === l.address?.bairro) - Number(a.address?.bairro === l.address?.bairro) || Math.abs(a.price - l.price) - Math.abs(b.price - l.price))
    .slice(0, 8);
  main.innerHTML = `<div class="wrap">
    <nav class="crumbs" aria-label="Você está em"><a href="${escapeHtml(app.href('inicio'))}" data-nav>Início</a> › <a href="${escapeHtml(app.menuHref(rent ? 'locacao' : 'venda'))}" data-nav>${rent ? 'Alugar' : 'Comprar'}</a>${
      l.address?.bairro ? ` › <a href="${escapeHtml(app.searchHref(app.bairroSearch(l.address.bairro)))}" data-nav>${escapeHtml(l.address.bairro)}</a>` : ''
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
          <p class="d-addr"><a href="#mapa-3d" data-map-jump title="Ver no mapa 3D">${ICONS.pin}${escapeHtml(addr)}</a></p>
          <div class="d-price-mobile">${priceHtml(l, rent)}</div>
          ${
            l.availability === 'reserved'
              ? '<p class="d-avail">Este imóvel está <strong>reservado</strong>. Fale com a gente: a reserva pode cair, e mostramos opções parecidas.</p>'
              : l.availability === 'sold'
                ? '<p class="d-avail">Este imóvel já foi <strong>vendido</strong>. Veja abaixo imóveis parecidos ou fale com a gente.</p>'
                : ''
          }
          <div class="d-actions">
            <button type="button" class="btn btn-ghost fav" data-fav="${escapeHtml(l.id)}" aria-pressed="${app.saved.isFavorite(l.id)}">${ICONS.heart} Favorito</button>
            <label class="btn btn-ghost cmp"><input type="checkbox" data-cmp="${escapeHtml(l.id)}"${app.saved.isCompared(l.id) ? ' checked' : ''}> Comparar</label>
            <button type="button" class="btn btn-ghost share">${ICONS.share} Compartilhar</button>
            <a class="btn btn-ghost" href="#mapa-3d" data-map-jump>${ICONS.cube} Mapa 3D</a>
          </div>
        </header>
        ${specsHtml(l, true)}
        ${progressHtml(l)}
        <section id="mapa-3d" class="d-map" tabindex="-1"><h2>No mapa 3D</h2><p class="muted">${l.approximateLocation ? 'Localização aproximada: o anunciante preferiu não mostrar o endereço exato.' : 'O prédio em destaque é o do imóvel.'}</p>
          <div class="map-frame detail" data-src="${escapeHtml(mapUrl(app, { foco: l.id }))}"><button type="button" class="btn btn-ghost map-load">${ICONS.cube} Ver o prédio no mapa 3D</button></div></section>
        ${red ? `<p class="d-red">${ICONS.down} O preço baixou ${red.percent}%${red.since ? ` em ${formatDate(red.since)}` : ''}: era ${formatBRL(red.previous)}. Valor anterior do histórico registrado na plataforma.</p>` : ''}
        <section><h2>Descrição</h2><p class="d-desc">${escapeHtml(l.description)}</p></section>
        ${l.features.length ? `<section><h2>Características</h2><ul class="d-feats">${l.features.map((f) => `<li>${AMENITY_LABELS[f]}</li>`).join('')}</ul></section>` : ''}
        <section><h2>Ficha do imóvel</h2><dl class="d-facts">${facts.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl></section>
        ${!rent && l.availability !== 'sold' && (priceIn(l, false) ?? 0) > 0 ? `<section class="d-fin">${financingHtml(priceIn(l, false)!, 'fld', leadFormHtml({ orgName: c.name, message: `Olá! Quero ver as parcelas do imóvel ${codeOf(l)}.`, submitLabel: 'Ver parcelas', captcha: !app.data.demo }))}</section>` : ''}
        ${video ? `<section><h2>Vídeo</h2><div class="d-video"><iframe src="${escapeHtml(video)}" title="Vídeo do imóvel" loading="lazy" allowfullscreen></iframe></div></section>` : ''}
        ${l.floorPlanImage ? `<section><h2>Planta</h2><img class="d-plan" src="${escapeHtml(l.floorPlanImage)}" alt="Planta do imóvel" loading="lazy"></section>` : ''}
        ${tour ? `<p><a class="btn btn-ghost" href="${escapeHtml(tour)}" target="_blank" rel="noopener">Tour virtual 360° ↗</a></p>` : ''}
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
          ${leadFormHtml({ orgName: c.name, message: `Olá! Tenho interesse no imóvel ${codeOf(l)}. Gostaria de mais informações.`, submitLabel: 'Enviar mensagem', captcha: !app.data.demo, visit: true })}
        </div>
      </aside>
    </div>
    ${similar.length ? `<section class="home-sec"><div class="sec-head"><h2>Imóveis parecidos</h2></div><div class="rail">${similar.map((x) => cardHtml(x, app.cardCtx(rent))).join('')}</div></section>` : ''}
  </div>
  <div class="d-cta" role="group" aria-label="Contato sobre este imóvel">
    ${c.contacts.whatsapp ? `<a class="btn btn-wa" data-contact data-listing="${escapeHtml(l.id)}" href="${escapeHtml(whatsappHref(c.contacts.whatsapp, waText))}" target="_blank" rel="noopener">${ICONS.whatsapp} WhatsApp</a>` : ''}
    <a class="btn btn-primary" href="#contato-imovel">${ICONS.mail} Mensagem</a>
  </div>`;
  wireGallery(main, photos);
  const loadMap = lazyMap(main);
  // "Mapa 3D" and the address go to the map, no hash navigation (it would re-render the page)
  main.querySelectorAll('[data-map-jump]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      loadMap();
      const sec = $(main, '#mapa-3d');
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      sec.focus({ preventScroll: true });
    }),
  );
  const fin = wireFinancing(main);
  // no hash navigation here: it would re-render the page (popstate) and lose the ticked box
  main.querySelector('[data-visit]')?.addEventListener('click', (e) => {
    e.preventDefault();
    const box = main.querySelector<HTMLInputElement>('form.lead input[name="visit"]');
    if (box && !box.checked) box.click();
    main.querySelector('#contato-imovel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    box?.focus({ preventScroll: true });
  });
  const sendLead = async (input: LeadInput) => {
    if (app.data.demo || !app.data.remote) return null;
    await app.data.remote.submitLead(l.id, input);
    return null;
  };
  // the installments of the simulation: shown once the visitor leaves a contact, which carries the simulation
  const finForm = main.querySelector<HTMLFormElement>('.fin-lock form.lead');
  if (fin && finForm)
    wireLeadForm(
      finForm,
      async (input) => {
        const error = await sendLead({ ...input, message: `${input.message}
${fin.summary()}`.trim() });
        if (!error) fin.reveal();
        return error;
      },
      'Pronto! As parcelas estão abaixo, e um corretor vai falar com você.',
    );
  wireLeadForm(
    $(main, '.side-card form.lead'),
    sendLead,
    (visit) =>
      DEMO && app.data.demo
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
        app.toast('Link copiado.');
      }
    } catch {
      /* cancelled */
    }
  });
}

/** Works under way: floors built, month and source (the 3D map below shows the rest translucent). */
function progressHtml(l: Listing): string {
  const p = l.construction;
  if (!p || l.status !== 'under_construction' || l.type === 'land') return '';
  const total = l.floors ?? Math.max(1, Math.round((l.buildingHeightM ?? 6) / 3));
  const pct = Math.round(builtShare(p, total) * 100);
  return `<section class="d-obra" aria-label="Andamento da obra">
    <p><strong>Obra: ${escapeHtml(progressLabel(p, total))}</strong></p>
    <div class="obra-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Andamento da obra"><span style="width:${pct}%"></span></div>
    <p class="muted small">${escapeHtml(formatMonth(p.updatedAt))} · ${escapeHtml(CONSTRUCTION_SOURCE_LABELS[p.source])}. No mapa 3D, o que falta construir aparece translúcido.</p>
  </section>`;
}

/**
 * The 3D map (1.2 MB of code plus tiles) loads only when its box comes into view or on click: the listing page
 * is the one people open from Google and WhatsApp, often on a phone.
 */
function lazyMap(main: HTMLElement): () => void {
  const box = main.querySelector<HTMLElement>('.map-frame[data-src]');
  if (!box) return () => {};
  const load = () => {
    if (box.querySelector('iframe')) return;
    box.innerHTML = `<iframe title="Mapa 3D do imóvel" src="${escapeHtml(box.dataset.src!)}" allow="fullscreen"></iframe>`;
    io?.disconnect();
  };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && load()) : null;
  io?.observe(box);
  box.querySelector('.map-load')?.addEventListener('click', load);
  return load;
}

function wireGallery(main: HTMLElement, photos: { src: string; caption?: string }[]): void {
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
