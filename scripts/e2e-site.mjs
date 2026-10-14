#!/usr/bin/env node
// Browser checks of the clients' sites (site.html) with Playwright, on the demo data: quick search, filters and
// chips, URL, favourites, comparison, listing page, forms, the embedded 3D map, the editor and phone layout.
// Screenshots go to docs/screenshots/site-*.png. Usage: npm run build && npm run verify:site
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
// its own port: the other browser checks use 4178 and 4179
const PORT = 4177;
const BASE = `http://127.0.0.1:${PORT}/site.html`;
const EXEC = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// expected values come from the demo data
const DATA = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', 'listings.json'), 'utf8')).listings;
const SITES = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', 'sites.json'), 'utf8')).sites;
const A = DATA.filter((l) => l.agency === SITES[0].agency);
const forSale = A.filter((l) => (l.transaction ?? 'sale') !== 'rent');
const reduced = forSale.filter((l) => l.previousPrice > l.price);
const houses = forSale.filter((l) => l.type === 'house');

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  // vite itself, not through npx: killing npx would leave the server running on the port
  const proc = spawn(path.join(ROOT, 'node_modules', '.bin', 'vite'), ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return proc;
    } catch {}
    await sleep(500);
  }
  proc.kill();
  throw new Error('vite preview did not start');
}

async function open(browser, query = '', viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`));
  await page.goto(BASE + query);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
  return { ctx, page, errors };
}

const title = (page) => page.locator('#r-title').textContent();
const cardCount = (page) => page.locator('.r-list .card').count();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: EXEC, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    // ------------------------------------------------ home and quick search
    const h = await open(browser);
    const { page } = h;
    const home = await page.evaluate(() => ({
      template: document.documentElement.dataset.template,
      primary: getComputedStyle(document.documentElement).getPropertyValue('--s-primary').trim(),
      h1: document.querySelector('h1').textContent,
      count: document.querySelector('.q-count').textContent,
      robots: document.querySelector('meta[name=robots]')?.content,
    }));
    check('home: modelo, cores e título da configuração; contagem ao vivo no "Buscar"; demonstração fora do Google',
      home.template === 'leve' && home.primary === '#1f4fd1' && home.h1 === 'Imóveis com desconto de verdade' && home.count === String(forSale.length) && home.robots === 'noindex',
      JSON.stringify(home));
    await page.screenshot({ path: path.join(SHOTS, 'site-home.png') });
    await page.click('.q-more');
    await page.click('.quick .switch');
    const qReduced = await page.locator('.q-count').textContent();
    await page.selectOption('.quick [name=tipo]', 'house');
    const qHouses = await page.locator('.q-count').textContent();
    check('busca rápida: "Apenas com desconto" e o tipo atualizam a contagem', qReduced === String(reduced.length) && qHouses === String(reduced.filter((l) => l.type === 'house').length), `${qReduced} ${qHouses}`);
    await page.selectOption('.quick [name=tipo]', '');
    await page.click('.q-go');
    await page.waitForSelector('main.page-imoveis');
    const afterQuick = { url: page.url(), title: await title(page), cards: await cardCount(page), discount: await page.locator('.r-list .p-red').count() };
    check('"Buscar" abre a busca com o filtro de desconto na URL e só imóveis com redução registrada',
      afterQuick.url.includes('reduzido=1') && afterQuick.title.startsWith(`${reduced.length} `) && afterQuick.discount === Math.min(12, reduced.length),
      JSON.stringify(afterQuick));

    // ------------------------------------------------ search page
    await page.goto(`${BASE}?p=imoveis`);
    await page.waitForSelector('main.page-imoveis');
    const first = { title: await title(page), cards: await cardCount(page), pages: Number(await page.locator('.pager a').last().textContent()), panelHidden: await page.locator('#f-panel').isHidden() };
    check('busca: todos os imóveis à venda, 12 por página, filtros fechados no modelo "leve"',
      first.title === `${forSale.length} imóveis à venda` && first.cards === 12 && first.pages === Math.ceil(forSale.length / 12) && first.panelHidden, JSON.stringify(first));
    await page.click('.filters-btn');
    await page.click('#f-panel .pill:has-text("Casa")');
    await page.waitForFunction((n) => document.querySelector('#r-title').textContent.startsWith(`${n} `), houses.length);
    await page.click('#f-panel [data-count=quartos] button[data-v="3"]');
    const h3 = houses.filter((l) => l.bedrooms >= 3);
    await page.waitForFunction((n) => document.querySelector('#r-title').textContent.startsWith(n === 0 ? 'Nenhum' : `${n} `), h3.length);
    const filtered = { url: page.url(), chips: await page.locator('.chips .chip').allTextContents(), fcount: await page.locator('.fcount').first().textContent() };
    check('filtros aplicam na hora, sem botão "Aplicar"; chips e contador "Filtros (2)"; a URL guarda tudo',
      filtered.url.includes('tipo=casa') && filtered.url.includes('quartos=3') && filtered.chips.length === 2 && filtered.fcount === '(2)', JSON.stringify(filtered));
    // shared link restores the same search
    const shared = await browser.newPage();
    await shared.goto(filtered.url);
    await shared.waitForSelector('body[data-ready="true"]');
    check('link compartilhado abre a mesma busca', (await title(shared)) === (await title(page)), await title(shared));
    await shared.close();
    await page.click('.chips .chip >> nth=1');
    await page.waitForFunction((n) => document.querySelector('#r-title').textContent.startsWith(`${n} `), houses.length);
    check('chip remove só o seu critério', !page.url().includes('quartos=') && page.url().includes('tipo=casa'), page.url());
    // neighbourhood chip input
    const bairro = houses.find((l) => l.address?.bairro).address.bairro;
    await page.fill('#f-bairro', bairro);
    await page.waitForFunction(() => document.querySelectorAll('.bairro-chips .chip').length === 1);
    const nB = houses.filter((l) => l.address?.bairro === bairro).length;
    check('bairro escolhido vira um chip no campo e filtra', (await title(page)).startsWith(`${nB} `) && (await title(page)).includes(bairro), await title(page));
    await page.click('.chips [data-chip=all]');
    await page.waitForFunction((n) => document.querySelector('#r-title').textContent.startsWith(`${n} `), forSale.length);
    // empty search suggests what to remove
    await page.goto(`${BASE}?p=imoveis&tipo=terreno&quartos=4`);
    await page.waitForSelector('.empty');
    check('busca sem resultado sugere qual filtro tirar', (await page.locator('.empty [data-tip]').count()) > 0);
    await page.locator('.empty [data-tip]').first().click();
    check('a sugestão refaz a busca', (await cardCount(page)) > 0);
    // pagination and list view
    await page.goto(`${BASE}?p=imoveis`);
    await page.waitForSelector('main.page-imoveis');
    await page.click('.pager a[data-page="2"]');
    const p2 = { url: page.url(), cards: await cardCount(page), current: await page.locator('.pager [aria-current=page]').textContent() };
    await page.click('[data-view=lista]');
    const lista = await page.locator('.r-list.r-lista .card-lista').count();
    check('paginação e visualização em lista', p2.url.includes('pagina=2') && p2.current === '2' && lista > 0, JSON.stringify({ ...p2, lista }));
    await page.click('[data-view=grade]');
    await page.screenshot({ path: path.join(SHOTS, 'site-busca.png') });

    // ------------------------------------------------ favourites and comparison
    const ids = await page.locator('.r-list .card').evaluateAll((cs) => cs.slice(0, 3).map((c) => c.dataset.id));
    await page.click(`.card[data-id="${ids[0]}"] [data-fav]`);
    await page.click(`.card[data-id="${ids[1]}"] [data-cmp]`);
    await page.click(`.card[data-id="${ids[2]}"] [data-cmp]`);
    const bar = await page.locator('.compare-bar').textContent();
    await page.click('.compare-bar a');
    await page.waitForSelector('.cmp-table');
    const cmp = { cols: await page.locator('.cmp-table thead th').count(), best: await page.locator('.cmp-table td.best').count() };
    check('comparar: barra flutuante e tabela lado a lado com o melhor valor destacado', bar.includes('2 imóveis') && cmp.cols === 3 && cmp.best >= 2, JSON.stringify(cmp));
    await page.screenshot({ path: path.join(SHOTS, 'site-comparar.png') });
    await page.reload();
    await page.waitForSelector('body[data-ready="true"]');
    await page.goto(`${BASE}?p=favoritos`);
    await page.waitForSelector('main.page-favoritos');
    check('favoritos ficam salvos no navegador', (await page.locator('.card').count()) === 1 && (await page.locator('.card').getAttribute('data-id')) === ids[0]);

    // ------------------------------------------------ listing page
    const red = reduced[0];
    await page.goto(`${BASE}?p=imovel&id=${red.id}`);
    await page.waitForSelector('main.page-imovel h1');
    const det = await page.evaluate(() => ({
      h1: document.querySelector('main h1').textContent,
      ld: JSON.parse(document.querySelector('script[data-ld]')?.textContent ?? 'null'),
      red: document.querySelector('.d-red')?.textContent ?? '',
      title: document.title,
      wa: document.querySelector('.side-card .btn-wa')?.getAttribute('href') ?? '',
      map: document.querySelector('.map-frame[data-src]')?.dataset.src ?? '',
    }));
    check('página do imóvel: título, dados para o Google (JSON-LD), redução com o preço anterior, WhatsApp com o código, mapa 3D focado',
      det.h1 === red.title && det.ld?.['@type'] === 'RealEstateListing' && det.red.includes(`${Math.round((100 * (red.previousPrice - red.price)) / red.previousPrice)}%`) &&
        det.title.startsWith(red.title) && decodeURIComponent(det.wa).includes(red.referenceCode) && det.map.includes(`foco=${red.id}`),
      JSON.stringify({ ...det, ld: det.ld?.['@type'] }));
    await page.click('.side-card form.lead button[type=submit]');
    const err = await page.locator('.side-card .form-msg').textContent();
    await page.fill('.side-card [name=name]', 'Maria Teste');
    await page.fill('.side-card [name=phone]', '(47) 99999-0000');
    await page.click('.side-card form.lead button[type=submit]');
    const err2 = await page.locator('.side-card .form-msg').textContent();
    await page.check('.side-card [name=consent]');
    await page.click('.side-card form.lead button[type=submit]');
    await page.waitForSelector('.side-card .form-msg.ok');
    check('formulário: valida nome, contato e consentimento (LGPD); na demonstração avisa que nada foi enviado',
      err === 'Informe seu nome.' && err2.startsWith('Marque a concordância') && (await page.locator('.side-card .form-msg').textContent()).startsWith('Demonstração'), `${err} / ${err2}`);
    await page.click('.side-card .btn-wa');
    check('contatos fictícios não abrem WhatsApp de verdade', (await page.locator('.toast').textContent()).startsWith('Demonstração') && page.url().startsWith(BASE));
    await page.screenshot({ path: path.join(SHOTS, 'site-imovel.png') });

    // ------------------------------------------------ embedded 3D map
    await page.goto(`${BASE}?p=imoveis&tipo=casa&vista=mapa`);
    const frameEl = await page.waitForSelector('.map-frame iframe');
    const frame = await frameEl.contentFrame();
    await frame.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
    await frame.waitForFunction((ids) => window.__demo && ids.every((id) => window.__demo.isMatched(id)), houses.map((l) => l.id), { timeout: 20000 });
    const emb = await frame.evaluate((other) => ({
      embed: document.body.classList.contains('embed'),
      topbar: getComputedStyle(document.querySelector('.topbar')).display,
      ids: window.__demo.listingIds.length,
      otherLit: other.some((id) => window.__demo.isMatched(id)),
    }), A.filter((l) => l.type !== 'house').map((l) => l.id));
    check('mapa 3D embutido: só os imóveis desta imobiliária, sem a barra do mapa, e só os resultados da busca acesos',
      emb.embed && emb.topbar === 'none' && emb.ids === A.length && !emb.otherLit, JSON.stringify(emb));
    // changing the search lights other listings without reloading the map
    await page.click('[data-view=mapa]');
    await page.click('.search-top [data-st=under_construction]');
    const launches = forSale.filter((l) => l.type === 'house' && l.status === 'under_construction').map((l) => l.id);
    const notLaunch = houses.filter((l) => l.status !== 'under_construction').map((l) => l.id);
    await frame.waitForFunction(([on, off]) => on.every((id) => window.__demo.isMatched(id)) && off.every((id) => !window.__demo.isMatched(id)), [launches, notLaunch], { timeout: 10000 });
    check('mudar a busca atualiza o mapa sem recarregar', (await page.locator('.map-frame iframe').count()) === 1);
    // the map rewrites its own address as it is used: it must keep the embed parameters, or reloading only the frame
    // would show the whole portal inside the client's site
    const frameUrl = new URL(frame.url());
    check('o endereço do mapa embutido mantém embed e site depois de usar a busca',
      frameUrl.searchParams.get('embed') === '1' && frameUrl.searchParams.has('site'), frame.url());
    await sleep(1500);
    await page.screenshot({ path: path.join(SHOTS, 'site-mapa.png') });

    // ------------------------------------------------ editor
    await page.goto(`${BASE}?editar=1`);
    await page.waitForSelector('.editor .ed-body');
    await page.click('.editor [data-template=lateral]');
    const tpl = await page.evaluate(() => ({ t: document.documentElement.dataset.template, header: getComputedStyle(document.documentElement).getPropertyValue('--s-header').trim() }));
    await page.click('.editor summary:has-text("Página inicial")');
    await page.fill('.editor [data-k="home.title"]', 'Título novo da capa');
    await page.waitForFunction(() => document.querySelector('.hero h1').textContent === 'Título novo da capa');
    await page.locator('.editor [data-k="colors.primary"]').evaluate((el) => {
      el.value = '#f7f3a0';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForSelector('.editor .ed-warn');
    const warn = await page.evaluate(() => ({
      ink: getComputedStyle(document.documentElement).getPropertyValue('--s-primary-ink').trim(),
      text: getComputedStyle(document.documentElement).getPropertyValue('--s-primary-text').trim(),
    }));
    check('editor: modelo, textos e cores mudam o site na hora; cor clara demais gera aviso e o texto é corrigido',
      tpl.t === 'lateral' && tpl.header === '#0f3d2e' && warn.ink === '#16181d' && warn.text !== '#f7f3a0', JSON.stringify({ tpl, warn }));
    await page.screenshot({ path: path.join(SHOTS, 'site-editor.png') });
    await page.click('.editor [data-save]');
    await page.reload();
    await page.waitForSelector('body[data-ready="true"]');
    const kept = await page.evaluate(() => ({ t: document.documentElement.dataset.template, h1: document.querySelector('.hero h1').textContent }));
    check('salvar (demonstração: neste navegador) mantém a personalização ao recarregar', kept.t === 'lateral' && kept.h1 === 'Título novo da capa', JSON.stringify(kept));
    // the confirmation is the only dialog: no "leave the site?" prompt while reloading
    const dialogs = [];
    const onDialog = (d) => {
      dialogs.push(d.type());
      void d.accept();
    };
    page.on('dialog', onDialog);
    await page.click('.editor [data-reset]');
    await page.waitForFunction(() => document.documentElement.dataset.template === 'leve', null, { timeout: 20000 });
    await page.waitForSelector('body[data-ready="true"]');
    page.off('dialog', onDialog);
    const resetState = await page.evaluate(() => ({ t: document.documentElement.dataset.template, h1: document.querySelector('.hero h1')?.textContent }));
    check('"Voltar ao original" desfaz a personalização, sem perguntar se quer sair do site',
      resetState.t === 'leve' && resetState.h1 === 'Imóveis com desconto de verdade' && dialogs.join() === 'confirm', JSON.stringify({ ...resetState, dialogs }));
    check('sem erros no console (computador)', h.errors.length === 0, h.errors.join(' | '));
    await h.ctx.close();

    // ------------------------------------------------ another client: dark template, other menu
    const b = await open(browser, `?imobiliaria=${SITES[1].slug}&p=imoveis`);
    const bInfo = await b.page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      menu: [...document.querySelectorAll('.nav a')].map((a) => a.textContent.trim()),
      ids: [...document.querySelectorAll('.card')].map((c) => c.dataset.id),
    }));
    const bIds = new Set(DATA.filter((l) => l.agency === SITES[1].agency).map((l) => l.id));
    check('outra imobiliária: tema escuro, o menu dela e só os imóveis dela', bInfo.theme === 'dark' && !bInfo.menu.includes('Alugar') && bInfo.ids.every((id) => bIds.has(id)), JSON.stringify(bInfo.menu));
    await b.page.screenshot({ path: path.join(SHOTS, 'site-escuro.png') });
    check('sem erros no console (outra imobiliária)', b.errors.length === 0, b.errors.join(' | '));
    await b.ctx.close();

    // ------------------------------------------------ phone
    const m = await open(browser, '', { width: 390, height: 844 });
    const pages = ['', '?p=imoveis', `?p=imovel&id=${A[0].id}`, '?p=contato', '?p=anunciar', '?p=comparar'];
    const widths = [];
    for (const q of pages) {
      await m.page.goto(BASE + q);
      await m.page.waitForSelector('body[data-ready="true"]');
      widths.push(await overflow(m.page));
    }
    check('celular: nenhuma página rola para o lado', widths.every((w) => w <= 0), widths.join(','));
    await m.page.goto(BASE);
    await m.page.waitForSelector('body[data-ready="true"]');
    await m.page.click('.nav-toggle');
    check('celular: menu abre pelo botão', await m.page.locator('#site-nav').isVisible());
    await m.page.click('#site-nav a:has-text("Anunciar imóvel")');
    await m.page.waitForSelector('main.page-anunciar');
    await m.page.selectOption('[name=x-finalidade]', 'Vender');
    await m.page.fill('main [name=name]', 'João');
    await m.page.fill('main [name=email]', 'joao@teste.com');
    await m.page.check('main [name=consent]');
    await m.page.click('main form.lead button[type=submit]');
    await m.page.waitForSelector('main .form-msg.ok');
    check('celular: "Anunciar imóvel" (captação de proprietário) envia', true);
    await m.page.goto(BASE);
    await m.page.waitForSelector('body[data-ready="true"]');
    await m.page.screenshot({ path: path.join(SHOTS, 'site-celular.png') });
    check('sem erros no console (celular)', m.errors.length === 0, m.errors.join(' | '));
    await m.ctx.close();
  } finally {
    await browser.close();
    server.kill();
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
