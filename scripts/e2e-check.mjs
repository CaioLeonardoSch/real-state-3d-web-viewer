#!/usr/bin/env node
// Browser verification with Playwright: builds nothing, serves dist/ with `vite preview`,
// runs the checks listed in the README and saves screenshots to docs/screenshots/.
// Usage: npm run build && npm run verify:e2e
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const PORT = 4178;
const URL_ = `http://127.0.0.1:${PORT}/`;
// Use a pre-installed Chromium when the Playwright-bundled one is not downloaded
const EXEC =
  process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// Expected values come from the data, so the checks keep working when listings.json is regenerated.
const DATA = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', 'listings.json'), 'utf8')).listings;
const TOTAL = DATA.length;
const ALL_HEADING = `${TOTAL} imóveis à venda`;
const LANDS = DATA.filter((l) => l.type === 'land');
const brl = (n) => `R$ ${n.toLocaleString('pt-BR')}`;
const RESIDENTIAL = ['yes', 'house', 'residential', 'apartments', 'detached', 'semidetached_house', 'terrace'];

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sha = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(URL_);
      if (r.ok) return proc;
    } catch {}
    await sleep(500);
  }
  proc.kill();
  throw new Error('vite preview did not start');
}

async function waitIdle(page) {
  await page.waitForFunction(() => {
    const m = window.__demo?.map;
    return m && m.loaded() && !m.isMoving() && m.areTilesLoaded();
  }, null, { timeout: 30000 });
  await sleep(400);
}

async function openPage(browser, viewport, label, query = '') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto(URL_ + query);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
  await waitIdle(page);
  return { ctx, page, errors, label };
}

const renderedCount = (page, layer) =>
  page.evaluate((l) => window.__demo.map.queryRenderedFeatures({ layers: [l] }).length, layer);

/** Finds a matched listing on the given layers that is visible on screen (page coordinates). */
async function findListingTarget(page, kindFilter = ['listing-buildings']) {
  return page.evaluate((layers) => {
    const map = window.__demo.map;
    const fs = map.queryRenderedFeatures({ layers });
    const canvas = map.getCanvas().getBoundingClientRect();
    for (const f of fs) {
      const p = window.__demo.project(f.properties.listingId);
      if (!p || p.x < 20 || p.y < 20 || p.x > canvas.width - 20 || p.y > canvas.height - 20) continue;
      // skip points covered by UI (results list, drawer, controls)
      if (document.elementFromPoint(p.x + canvas.left, p.y + canvas.top) !== map.getCanvas()) continue;
      const hit = map.queryRenderedFeatures([p.x, p.y], { layers }).find((h) => h.properties.listingId === f.properties.listingId);
      if (hit) return { id: f.properties.listingId, x: p.x + canvas.left, y: p.y + canvas.top };
    }
    return null;
  }, kindFilter);
}

/** Finds a matched, non-approximate building listing that is visible on screen and clicks it. */
async function clickSomeListing(page, kindFilter = ['listing-buildings']) {
  const target = await findListingTarget(page, kindFilter);
  if (!target) return null;
  await page.mouse.click(target.x, target.y);
  await sleep(500);
  return target;
}

async function emptyPoint(page) {
  return page.evaluate(() => {
    const map = window.__demo.map;
    const r = map.getCanvas().getBoundingClientRect();
    const layers = ['listing-buildings', 'listing-land', 'listing-approx-fill'];
    for (let y = r.height * 0.3; y < r.height * 0.9; y += 23) {
      for (let x = r.width * 0.3; x < r.width * 0.65; x += 29) {
        if (map.queryRenderedFeatures([x, y], { layers }).length === 0 && document.elementFromPoint(x + r.left, y + r.top) === map.getCanvas())
          return { x: x + r.left, y: y + r.top };
      }
    }
    return null;
  });
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    // ------------------------------------------------ desktop
    const d = await openPage(browser, { width: 1440, height: 900 }, 'desktop');
    const { page } = d;
    const camera = () =>
      page.evaluate(() => {
        const m = window.__demo.map;
        const c = m.getCenter();
        return { lng: c.lng, lat: c.lat, zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
      });
    const initialCam = await camera();
    const ctxCount = await renderedCount(page, 'context-buildings');
    const listingCount = await renderedCount(page, 'listing-buildings');
    check('desktop: context building layer rendered', ctxCount > 0, `${ctxCount} features`);
    check('desktop: listing layer rendered', listingCount > 0, `${listingCount} features`);
    const attrib = await page.textContent('.maplibregl-ctrl-attrib');
    check('attribution shows OSM and MapLibre', /OpenStreetMap contributors/.test(attrib) && /MapLibre/.test(attrib), attrib?.trim());
    check('demo banner visible', await page.isVisible('text=Demonstração. Imóveis e valores fictícios.'));
    const initialList = await page.evaluate(() => ({
      heading: document.querySelector('#results .results-title')?.textContent,
      rows: document.querySelectorAll('#results button[data-id]').length,
      visible: !document.querySelector('#results .results-body').hidden,
    }));
    check('desktop: list of all listings is available without searching',
      initialList.heading === ALL_HEADING && initialList.rows === TOTAL && initialList.visible, JSON.stringify(initialList));
    await page.screenshot({ path: path.join(SHOTS, 'desktop-morning.png') });

    // pins in the overview
    const pinIds = await page.evaluate(() =>
      [...new Set(window.__demo.map.queryRenderedFeatures({ layers: ['listing-pins'] }).map((f) => f.properties.listingId))],
    );
    const totalListings = await page.evaluate(() => window.__demo.listingIds.length);
    check('overview: a pin is rendered for every listing', pinIds.length === totalListings, `${pinIds.length}/${totalListings}`);
    const pinTarget = await findListingTarget(page, ['listing-pins']);
    if (pinTarget) {
      await page.mouse.move(pinTarget.x, pinTarget.y, { steps: 4 });
      await sleep(300);
      const pinTip = await page.evaluate(() => !document.querySelector('#hover-tooltip').hidden);
      await page.mouse.click(pinTarget.x, pinTarget.y);
      await sleep(400);
      const pinDrawer = await page.evaluate(() => document.querySelector('#drawer').classList.contains('open'));
      check('pin: hover shows tooltip and click opens the drawer', pinTip && pinDrawer, pinTarget.id);
      await page.keyboard.press('Escape');
      await sleep(300);
    } else check('pin: hover shows tooltip and click opens the drawer', false, 'no pin on screen');
    const pinsZoomedIn = await page.evaluate(async () => {
      const m = window.__demo.map;
      const cam = { center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
      m.jumpTo({ zoom: 17.5 });
      await new Promise((r) => m.once('idle', r));
      const n = m.queryRenderedFeatures({ layers: ['listing-pins'] }).length;
      m.jumpTo(cam);
      await new Promise((r) => m.once('idle', r));
      return n;
    });
    check('pins are hidden when zoomed in (zoom 17.5)', pinsZoomedIn === 0, `${pinsZoomedIn} pins`);

    // hover tooltip
    const hoverTarget = await findListingTarget(page);
    if (hoverTarget) {
      await page.mouse.move(hoverTarget.x, hoverTarget.y, { steps: 4 });
      await sleep(300);
      const expectedPrice = await page.evaluate(async (id) => {
        const d = await (await fetch('data/listings.json')).json();
        const l = d.listings.find((x) => x.id === id);
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(l.price).replace(/\s+/g, ' ');
      }, hoverTarget.id);
      const tt = await page.evaluate(() => {
        const el = document.querySelector('#hover-tooltip');
        return { hidden: el.hidden, text: el.textContent.replace(/\s+/g, ' ').trim() };
      });
      const cursor = await page.evaluate(() => window.__demo.map.getCanvas().style.cursor);
      check('hover shows tooltip with the listing price and pointer cursor',
        !tt.hidden && tt.text.includes(expectedPrice) && tt.text.includes('Clique para ver detalhes') && cursor === 'pointer',
        `${hoverTarget.id}: "${tt.text}" (expected ${expectedPrice}), cursor=${cursor}`);
      await page.screenshot({ path: path.join(SHOTS, 'desktop-hover-tooltip.png') });
      const emptyForHover = await emptyPoint(page);
      if (emptyForHover) await page.mouse.move(emptyForHover.x, emptyForHover.y, { steps: 4 });
      await sleep(300);
      check('tooltip hides when the mouse leaves the listing',
        !!emptyForHover && (await page.evaluate(() => document.querySelector('#hover-tooltip').hidden)));
    } else check('hover shows tooltip', false, 'no visible listing to hover');

    // click opens drawer
    const clicked = await clickSomeListing(page);
    const drawerOpen = await page.evaluate(() => document.querySelector('#drawer').classList.contains('open'));
    check('click on a listing opens the drawer', !!clicked && drawerOpen, clicked?.id ?? 'no clickable listing found');
    check('drawer shows fictional badge', await page.isVisible('#drawer >> text=Imóvel fictício para demonstração'));
    check('drawer shows "Planta ilustrativa" and "Simulação ilustrativa"',
      (await page.isVisible('#drawer >> text=Planta ilustrativa')) && (await page.isVisible('#drawer >> text=Simulação ilustrativa')));
    await page.screenshot({ path: path.join(SHOTS, 'desktop-drawer.png') });
    await page.keyboard.press('Escape');
    await sleep(400);
    check('Esc closes the drawer', !(await page.evaluate(() => document.querySelector('#drawer').classList.contains('open'))));

    // close button
    await clickSomeListing(page);
    await page.click('#drawer [data-action="close"]');
    await sleep(400);
    check('close button closes the drawer', !(await page.evaluate(() => document.querySelector('#drawer').classList.contains('open'))));

    // click on empty map
    await clickSomeListing(page);
    const empty = await emptyPoint(page);
    if (empty) await page.mouse.click(empty.x, empty.y);
    await sleep(400);
    check('click on empty map closes the drawer', !!empty && !(await page.evaluate(() => document.querySelector('#drawer').classList.contains('open'))));

    // URL + browser back
    const opened = await clickSomeListing(page);
    const urlOpen = await page.evaluate(() => location.search);
    await page.goBack();
    await sleep(500);
    const afterBack = await page.evaluate(() => ({
      search: location.search,
      open: document.querySelector('#drawer').classList.contains('open'),
    }));
    check('opening a listing writes ?imovel= and browser back closes the drawer',
      !!opened && urlOpen === `?imovel=${opened.id}` && !afterBack.open && afterBack.search === '',
      `${urlOpen} → back → "${afterBack.search}", drawer open=${afterBack.open}`);

    // approximate listing opens drawer with notice
    const approxClicked = await clickSomeListing(page, ['listing-approx-fill']);
    if (approxClicked) {
      check('approximate listing shows "Localização aproximada"', await page.isVisible('#drawer >> text=Localização aproximada'), approxClicked.id);
      await page.screenshot({ path: path.join(SHOTS, 'desktop-drawer-approx.png') });
      await page.keyboard.press('Escape');
    } else check('approximate listing clickable', false, 'no approximate circle visible on screen');

    // ------------------------------------------------ filters: pending vs applied
    const dimBefore = await renderedCount(page, 'listing-dimmed');
    const stateBefore = await page.evaluate(() => JSON.stringify(window.__demo.map.getCenter()) + window.__demo.map.getZoom());
    await page.click('label.chip:has-text("Terreno")');
    await page.fill('input[name="priceMax"]', '2000000');
    await sleep(800);
    const dimAfterEdit = await renderedCount(page, 'listing-dimmed');
    const stateAfterEdit = await page.evaluate(() => JSON.stringify(window.__demo.map.getCenter()) + window.__demo.map.getZoom());
    const headingAfterEdit = await page.textContent('#results .results-title');
    const resultsHidden = headingAfterEdit === ALL_HEADING;
    check('editing filters does NOT change the map', dimBefore === dimAfterEdit && stateBefore === stateAfterEdit && resultsHidden,
      `dimmed ${dimBefore}→${dimAfterEdit}, camera unchanged=${stateBefore === stateAfterEdit}, list unchanged=${resultsHidden}`);
    check('"Alterações não aplicadas" hint shown', await page.isVisible('text=Alterações não aplicadas'));
    await page.screenshot({ path: path.join(SHOTS, 'desktop-filters-pending.png') });

    await page.click('button:has-text("Buscar")');
    await sleep(300);
    await waitIdle(page);
    const header = await page.textContent('#results .results-title');
    const landCount = await page.evaluate(() => window.__demo.listingIds.filter((id) => id.startsWith('land')).length);
    const dimAfterApply = await page.evaluate(() =>
      window.__demo.map.querySourceFeatures('listings').filter((f) => f.properties.matched === false).length,
    );
    await sleep(200);
    const announced = await page.textContent('#announcer');
    check('search result count is announced to screen readers', announced === `${landCount} imóveis encontrados`, `"${announced}"`);
    const searchUrl = await page.evaluate(() => location.search);
    check('search writes the applied filters to the URL', searchUrl === '?tipo=terreno&precoMax=2000000', searchUrl);
    check('"Buscar" applies filters (results list + dimmed listings)',
      header?.startsWith(`${landCount} `) && dimAfterApply > 0, `${header}; ${dimAfterApply} dimmed source features`);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-search-results.png') });

    // hover sync: list -> map and map -> list
    const firstRow = await page.$('#results li button >> nth=0');
    const firstId = await firstRow.getAttribute('data-id');
    await firstRow.hover();
    await sleep(200);
    const mapLit = await page.evaluate((id) => window.__demo.isHighlighted(id), firstId);
    await page.mouse.move(700, 880); // leave the list
    await sleep(200);
    const mapCleared = !(await page.evaluate((id) => window.__demo.isHighlighted(id), firstId));
    check('hovering a result row highlights that listing on the map', mapLit && mapCleared, firstId);
    const onMap = await findListingTarget(page, ['listing-pins', 'listing-land', 'listing-approx-fill']);
    if (onMap) {
      await page.mouse.move(onMap.x, onMap.y, { steps: 4 });
      await sleep(250);
      const rowLit = await page.evaluate(
        (id) => document.querySelector(`#results button[data-id="${id}"]`)?.classList.contains('is-hover') ?? false,
        onMap.id,
      );
      check('hovering a listing on the map highlights its result row', rowLit, onMap.id);
      await page.mouse.move(700, 880);
    } else check('hovering a listing on the map highlights its result row', false, 'no listing on screen');

    // sorting + price summary
    const rowPrices = () =>
      page.$$eval('#results li .r-meta b', (bs) => bs.map((b) => Number(b.textContent.replace(/\D/g, ''))));
    const ascPrices = await rowPrices();
    const range = await page.textContent('#results .results-range');
    const dimBeforeSort = await page.evaluate(() =>
      window.__demo.map.querySourceFeatures('listings').filter((f) => f.properties.matched === false).length,
    );
    await page.selectOption('#results select[name="sort"]', 'price-desc');
    await sleep(300);
    const descPrices = await rowPrices();
    const sortUrl = await page.evaluate(() => location.search);
    const dimAfterSort = await page.evaluate(() =>
      window.__demo.map.querySourceFeatures('listings').filter((f) => f.properties.matched === false).length,
    );
    const isSorted = (a, dir) => a.every((v, i) => i === 0 || (dir > 0 ? a[i - 1] <= v : a[i - 1] >= v));
    check('results show a price range and sort by price (asc/desc) without changing the map',
      /^R\$ .+ – R\$ .+$/.test(range ?? '') && isSorted(ascPrices, 1) && isSorted(descPrices, -1) &&
        descPrices[0] === Math.max(...ascPrices) && sortUrl.includes('ordem=maior-preco') && dimBeforeSort === dimAfterSort,
      `"${range}" asc=${ascPrices} desc=${descPrices} url=${sortUrl}`);
    await page.selectOption('#results select[name="sort"]', 'price-asc');
    await sleep(300);

    // result list click flies + opens drawer
    await page.click('#results li button >> nth=0');
    await sleep(300);
    await waitIdle(page);
    check('clicking a result opens the drawer', await page.evaluate(() => document.querySelector('#drawer').classList.contains('open')));
    await page.screenshot({ path: path.join(SHOTS, 'desktop-result-land-closeup.png') });

    // previous / next inside the drawer
    const navInfo = async () =>
      page.evaluate(() => ({
        pos: document.querySelector('#drawer .nav-pos')?.textContent,
        title: document.querySelector('#drawer h2')?.textContent,
        prevDisabled: document.querySelector('#drawer [data-action="prev"]')?.disabled,
        nextDisabled: document.querySelector('#drawer [data-action="next"]')?.disabled,
      }));
    const n0 = await navInfo();
    await page.click('#drawer [data-action="next"]');
    await sleep(300);
    const n1 = await navInfo();
    await page.focus('#drawer');
    await page.keyboard.press('ArrowLeft');
    await sleep(300);
    const n2 = await navInfo();
    check('drawer previous/next browses the results (buttons and arrow keys)',
      n0.pos === `1 de ${landCount}` && n0.prevDisabled === true && n1.pos === `2 de ${landCount}` && n1.title !== n0.title &&
        n2.pos === n0.pos && n2.title === n0.title,
      `${n0.pos} → ${n1.pos} → ${n2.pos}`);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-drawer-nav.png') });
    await page.keyboard.press('Escape');

    // close-up of a highlighted apartment
    await page.click('label.chip:has-text("Terreno")');
    await page.click('label.chip:has-text("Apartamento")');
    await page.click('button:has-text("Buscar")');
    await sleep(300);
    await waitIdle(page);
    await page.click('#results li button >> nth=0');
    await sleep(300);
    await waitIdle(page);
    await page.keyboard.press('Escape');
    await sleep(400);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-apartment-closeup.png') });

    await page.click('button:has-text("Limpar")');
    await sleep(300);
    await waitIdle(page);
    const dimAfterClear = await page.evaluate(() =>
      window.__demo.map.querySourceFeatures('listings').filter((f) => f.properties.matched === false).length,
    );
    check('"Limpar" restores all listings', dimAfterClear === 0);

    // empty search with a useful suggestion
    await page.click('label.chip:has-text("Terreno")');
    await page.fill('input[name="priceMax"]', '500000');
    await page.click('button:has-text("Buscar")');
    await sleep(400);
    const emptyState = await page.evaluate(() => ({
      header: document.querySelector('#results .results-title')?.textContent,
      relax: [...document.querySelectorAll('#results [data-relax]')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
    }));
    await page.screenshot({ path: path.join(SHOTS, 'desktop-empty-search.png') });
    const dimmedPins = await page.evaluate(() => new Set(window.__demo.map.queryRenderedFeatures({ layers: ['listing-pins-dimmed'] }).map((f) => f.properties.listingId)).size);
    check('empty search keeps every listing visible as a grey pin', dimmedPins === TOTAL, `${dimmedPins} dimmed pins`);
    check('empty search suggests the blocking filter with the closest value',
      emptyState.header?.startsWith('0 ') && emptyState.relax[0]?.includes('Remover o preço máximo') &&
        emptyState.relax[0]?.replace(/\s/g, ' ').includes(`o mais barato custa ${brl(Math.min(...LANDS.map((l) => l.price)))}`),
      JSON.stringify(emptyState));
    await page.click('#results [data-relax="priceMax"]');
    await sleep(400);
    await waitIdle(page);
    const relaxed = await page.evaluate(() => ({
      header: document.querySelector('#results .results-title')?.textContent,
      priceMax: document.querySelector('input[name="priceMax"]').value,
      search: location.search,
    }));
    check('clicking the suggestion removes that filter and searches again',
      relaxed.header?.startsWith(`${LANDS.length} `) && relaxed.priceMax === '' && relaxed.search === '?tipo=terreno', JSON.stringify(relaxed));
    await page.click('button:has-text("Limpar")');
    await sleep(300);
    await waitIdle(page);

    // ------------------------------------------------ "Mais filtros"
    await page.click('.f-more-toggle');
    await sleep(200);
    const moreVisible = await page.isVisible('#filters-more');
    await page.click('#filters-more label.chip:has-text("Piscina")');
    await page.selectOption('select[name="bathroomsMin"]', '2');
    await sleep(200);
    const moreLabel = (await page.textContent('.f-more-toggle'))?.trim();
    await page.screenshot({ path: path.join(SHOTS, 'desktop-more-filters.png') });
    await page.click('button:has-text("Buscar")');
    await sleep(400);
    await waitIdle(page);
    const poolCount = DATA.filter((l) => l.features.includes('pool') && l.bathrooms >= 2).length;
    const more = await page.evaluate(() => ({
      header: document.querySelector('#results .results-title')?.textContent,
      search: location.search,
      panelHidden: document.querySelector('#filters-more').hidden,
    }));
    check('"Mais filtros" opens, counts active criteria and filters by amenity and bathrooms',
      moreVisible && moreLabel === 'Mais filtros (2)' && more.header?.startsWith(`${poolCount} `) &&
        more.search === '?banheiros=2&comodidades=piscina' && more.panelHidden,
      `${moreLabel}; ${JSON.stringify(more)}; expected ${poolCount}`);
    await page.click('button:has-text("Limpar")');
    await sleep(300);
    await waitIdle(page);

    // ------------------------------------------------ "Anunciar imóvel"
    const rowCount = () => page.evaluate(() => document.querySelectorAll('#results button[data-id]').length);
    const placeStatus = () => page.textContent('#add-panel .a-place-status');
    /** Clicks map points (grid scan) accepted by `accept` until the form reports a chosen place. */
    async function pickOnMap(accept, maxTries = 40) {
      const candidates = await page.evaluate(({ accept, residential }) => {
        const map = window.__demo.map;
        const r = map.getCanvas().getBoundingClientRect();
        const out = [];
        for (let y = r.height * 0.2; y < r.height * 0.85; y += 24) {
          for (let x = r.width * 0.3; x < r.width * 0.7; x += 24) {
            if (document.elementFromPoint(x + r.left, y + r.top) !== map.getCanvas()) continue;
            const hits = map.queryRenderedFeatures([x, y]);
            const ok =
              accept === 'building'
                ? hits[0]?.layer.id === 'context-buildings' && residential.includes(hits[0].properties.building) &&
                  !['name', 'amenity', 'shop', 'office'].some((k) => k in hits[0].properties)
                : // free ground: nothing but background around the point
                  [[0, 0], [-8, 0], [8, 0], [0, -8], [0, 8]].every(
                    ([dx, dy]) => map.queryRenderedFeatures([x + dx, y + dy]).every((h) => h.layer.id === 'boundary-line'),
                  );
            if (ok) out.push({ x: x + r.left, y: y + r.top, d: Math.hypot(x - r.width / 2, y - r.height / 2) });
          }
        }
        // the middle of the view is inside the neighbourhood; the top rows may be beyond its limit
        return out.sort((a, b) => a.d - b.d);
      }, { accept, residential: RESIDENTIAL });
      for (const c of candidates.slice(0, maxTries)) {
        await page.mouse.click(c.x, c.y);
        await sleep(250);
        if ((await placeStatus())?.startsWith('✓')) return true;
      }
      return false;
    }

    await page.click('.add-toggle');
    await sleep(200);
    check('"Anunciar" opens the form', await page.isVisible('#add-panel .add-form'));
    await page.selectOption('#add-panel select[name="type"]', 'house');
    await page.fill('#add-panel input[name="price"]', '987000');
    await page.fill('#add-panel input[name="areaM2"]', '180');
    await page.fill('#add-panel input[name="title"]', 'Casa de teste automatizado');
    await page.click('#add-panel label.chip:has-text("Churrasqueira")');
    await page.click('#add-panel [data-action="pick"]');
    await sleep(200);
    const pickingUi = await page.evaluate(() => document.querySelector('#add-panel').classList.contains('picking'));
    const pickedBuilding = await pickOnMap('building');
    await page.screenshot({ path: path.join(SHOTS, 'desktop-add-listing.png') });
    await page.click('#add-panel button:has-text("Salvar anúncio")');
    await sleep(700);
    await waitIdle(page);
    const added = await page.evaluate(() => ({
      title: document.querySelector('#drawer.open h2')?.textContent ?? null,
      badge: document.querySelector('#drawer .badge-user')?.textContent ?? null,
      panelHidden: document.querySelector('#add-panel').hidden,
      stored: JSON.parse(localStorage.getItem('mapa3d-america:user-listings:v1') ?? '[]').length,
    }));
    check('a new house is placed on a grey building, saved and opened',
      pickingUi && pickedBuilding && added.title === 'Casa de teste automatizado' && !!added.badge && added.panelHidden &&
        added.stored === 1 && (await rowCount()) === TOTAL + 1,
      JSON.stringify(added));
    await page.screenshot({ path: path.join(SHOTS, 'desktop-added-listing.png') });
    await page.keyboard.press('Escape');
    await sleep(300);

    // back to the overview: the whole neighbourhood is visible, with more free ground than the close-up
    await page.click('.overview-btn');
    await sleep(300);
    await waitIdle(page);
    await page.click('.add-toggle');
    await page.selectOption('#add-panel select[name="type"]', 'land');
    await page.fill('#add-panel input[name="price"]', '450000');
    await page.fill('#add-panel input[name="areaM2"]', '300');
    await page.click('#add-panel [data-action="pick"]');
    await sleep(200);
    const pickedLot = await pickOnMap('land');
    await page.click('#add-panel button:has-text("Salvar anúncio")');
    await sleep(700);
    await waitIdle(page);
    const lotAdded = await page.evaluate(() => document.querySelector('#drawer.open h2')?.textContent ?? null);
    check('a new lot is placed on free ground (no building, road, water or green) and saved',
      pickedLot && lotAdded === 'Terreno de 300 m²' && (await rowCount()) === TOTAL + 2, `${pickedLot} ${lotAdded}`);
    await page.keyboard.press('Escape');
    await sleep(300);

    // persisted across reloads, then deleted from the drawer
    await page.reload();
    await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
    await waitIdle(page);
    const afterReload = await rowCount();
    page.once('dialog', (dlg) => dlg.accept());
    await page.click('#results button:has-text("Casa de teste automatizado")');
    await sleep(600);
    await page.click('#drawer [data-action="delete"]');
    await sleep(500);
    const afterDelete = await page.evaluate(() => ({
      rows: document.querySelectorAll('#results button[data-id]').length,
      open: document.querySelector('#drawer').classList.contains('open'),
      stored: JSON.parse(localStorage.getItem('mapa3d-america:user-listings:v1') ?? '[]').length,
    }));
    check('added listings survive a reload and can be deleted',
      afterReload === TOTAL + 2 && afterDelete.rows === TOTAL + 1 && !afterDelete.open && afterDelete.stored === 1,
      `after reload ${afterReload}; ${JSON.stringify(afterDelete)}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
    await waitIdle(page);

    // keyboard-only path: Tab → skip link → first row → Enter opens → Esc closes and focus returns
    // start sequential focus from the top of the document, as on a freshly loaded page
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    const firstFocus = await page.evaluate(() => document.activeElement?.className);
    await page.keyboard.press('Enter');
    await sleep(200);
    const rowFocus = await page.evaluate(() => document.activeElement?.dataset?.id ?? null);
    await page.keyboard.press('Enter');
    await sleep(500);
    const kbOpen = await page.evaluate(() => document.querySelector('#drawer').classList.contains('open'));
    await page.keyboard.press('Escape');
    await sleep(500);
    const kbAfter = await page.evaluate(() => ({
      open: document.querySelector('#drawer').classList.contains('open'),
      focus: document.activeElement?.dataset?.id ?? null,
    }));
    check('keyboard: skip link → list row → Enter opens drawer → Esc closes and returns focus to the row',
      firstFocus === 'skip-link' && !!rowFocus && kbOpen && !kbAfter.open && kbAfter.focus === rowFocus,
      `first=${firstFocus} row=${rowFocus} open=${kbOpen} after=${JSON.stringify(kbAfter)}`);
    await page.click('[data-action="toggle-results"]');
    const collapsedState = await page.evaluate(() => ({
      hidden: document.querySelector('#results .results-body').hidden,
      expanded: document.querySelector('[data-action="toggle-results"]').getAttribute('aria-expanded'),
    }));
    await page.click('[data-action="toggle-results"]');
    const reopenedState = await page.evaluate(() => !document.querySelector('#results .results-body').hidden);
    check('list can be collapsed and expanded', collapsedState.hidden && collapsedState.expanded === 'false' && reopenedState,
      JSON.stringify(collapsedState));

    // "Visão geral" button restores the initial framing
    await page.evaluate(() => window.__demo.map.jumpTo({ zoom: 18, bearing: 120, pitch: 30, center: [-48.85, -26.285] }));
    await waitIdle(page);
    await page.click('.overview-btn');
    await sleep(300);
    await waitIdle(page);
    const backCam = await camera();
    check('"Visão geral" button returns to the initial overview',
      Math.abs(backCam.zoom - initialCam.zoom) < 0.05 && Math.abs(backCam.bearing - initialCam.bearing) < 0.5 &&
        Math.abs(backCam.pitch - initialCam.pitch) < 0.5 && Math.abs(backCam.lng - initialCam.lng) < 5e-4 && Math.abs(backCam.lat - initialCam.lat) < 5e-4,
      `${JSON.stringify(initialCam)} → ${JSON.stringify(backCam)}`);

    // ------------------------------------------------ lighting
    await page.evaluate(() => window.__demo.map.jumpTo({ zoom: window.__demo.map.getZoom() })); // no-op, keep camera
    const shots = { morning: null, afternoon: null, night: null };
    const light = {};
    for (const [tod, label] of [['morning', 'Manhã'], ['afternoon', 'Tarde'], ['night', 'Noite']]) {
      await page.click(`.time-of-day button:has-text("${label}")`);
      await sleep(600);
      await waitIdle(page);
      shots[tod] = await page.screenshot({ path: path.join(SHOTS, `desktop-${tod}.png`) });
      light[tod] = await page.evaluate(() => ({
        light: window.__demo.map.getLight(),
        bg: window.__demo.map.getPaintProperty('background', 'background-color'),
      }));
    }
    const sun = await page.evaluate(() => ({ m: window.__demo.sun('morning'), a: window.__demo.sun('afternoon'), n: window.__demo.sun('night') }));
    console.log('  sun (suncalc):', JSON.stringify(sun));
    console.log('  light:', JSON.stringify(light));
    check('morning/afternoon/night produce different renders',
      new Set([sha(shots.morning), sha(shots.afternoon), sha(shots.night)]).size === 3);
    check('night: sun below horizon', sun.n.altitude < 0, `altitude ${sun.n.altitude.toFixed(1)}°`);
    check('morning sun from the east, afternoon from the west', sun.m.azimuth > 0 && sun.m.azimuth < 180 && sun.a.azimuth > 180 && sun.a.azimuth < 360,
      `morning az ${sun.m.azimuth.toFixed(0)}°, afternoon az ${sun.a.azimuth.toFixed(0)}°`);
    check('no console errors (desktop)', d.errors.length === 0, d.errors.join(' | '));
    await d.ctx.close();

    // ------------------------------------------------ shared links
    const sharedId = LANDS[LANDS.length - 1].id;
    const shared = await openPage(browser, { width: 1440, height: 900 }, 'shared', `?tipo=terreno&imovel=${sharedId}`);
    const sharedState = await shared.page.evaluate(() => ({
      title: document.querySelector('#drawer.open h2')?.textContent ?? null,
      pos: document.querySelector('#drawer .nav-pos')?.textContent ?? null,
      header: document.querySelector('#results .results-title')?.textContent ?? null,
      chip: document.querySelector('input[name="type"][value="land"]').checked,
      search: location.search,
    }));
    check('shared link restores filters, results and the open listing',
      sharedState.title !== null && sharedState.header?.startsWith(`${LANDS.length} `) && sharedState.chip && sharedState.search === `?imovel=${sharedId}&tipo=terreno`,
      JSON.stringify(sharedState));
    await shared.page.screenshot({ path: path.join(SHOTS, 'desktop-shared-link.png') });
    check('no console errors (shared link)', shared.errors.length === 0, shared.errors.join(' | '));
    await shared.ctx.close();
    const bad = await openPage(browser, { width: 1440, height: 900 }, 'bad-link', '?imovel=nao-existe&tipo=castelo&precoMax=abc');
    const badState = await bad.page.evaluate(() => ({
      open: document.querySelector('#drawer').classList.contains('open'),
      search: location.search,
    }));
    check('invalid link is ignored and the URL normalised', !badState.open && badState.search === '' && bad.errors.length === 0,
      JSON.stringify(badState) + bad.errors.join(' | '));
    await bad.ctx.close();

    // ------------------------------------------------ mobile
    const m = await openPage(browser, { width: 390, height: 844 }, 'mobile');
    const mp = m.page;
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('mobile: no horizontal overflow', overflow <= 0, `${overflow}px`);
    check('mobile: filters collapsed behind toggle', !(await mp.isVisible('#filters')) && (await mp.isVisible('.filters-toggle')));
    await mp.screenshot({ path: path.join(SHOTS, 'mobile-map.png') });
    await mp.click('.filters-toggle');
    await sleep(300);
    check('mobile: filters open on toggle', await mp.isVisible('#filters'));
    await mp.screenshot({ path: path.join(SHOTS, 'mobile-filters.png') });
    await mp.click('.filters-toggle');
    await sleep(300);
    await waitIdle(mp);
    const mClicked = await clickSomeListing(mp);
    const sheetInfo = () =>
      mp.evaluate(() => {
        const d = document.querySelector('#drawer');
        const r = d.getBoundingClientRect();
        const attrib = document.querySelector('.maplibregl-ctrl-attrib').getBoundingClientRect();
        return { open: d.classList.contains('open'), expanded: d.classList.contains('expanded'), top: Math.round(r.top), width: r.width, attribBottom: Math.round(attrib.bottom) };
      });
    await sleep(400);
    const peek = await sheetInfo();
    check('mobile: drawer opens collapsed (summary strip, map visible)',
      !!mClicked && peek.open && !peek.expanded && peek.width === 390 && Math.abs(peek.top - (844 - 166)) <= 4 && peek.attribBottom <= peek.top,
      JSON.stringify(peek));
    await mp.screenshot({ path: path.join(SHOTS, 'mobile-drawer.png') });
    await mp.click('#drawer .drawer-handle');
    await sleep(400);
    const expanded = await sheetInfo();
    check('mobile: tapping the handle expands the sheet', expanded.expanded && expanded.top < 300, JSON.stringify(expanded));
    await mp.screenshot({ path: path.join(SHOTS, 'mobile-drawer-expanded.png') });
    const swipe = async (dy) => {
      const h = await mp.$eval('#drawer .drawer-handle', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await mp.mouse.move(h.x, h.y);
      await mp.mouse.down();
      await mp.mouse.move(h.x, h.y + dy, { steps: 5 });
      await mp.mouse.up();
      await sleep(400);
    };
    await swipe(120);
    const collapsed = await sheetInfo();
    await swipe(-120);
    const reExpanded = await sheetInfo();
    await swipe(120);
    await swipe(120);
    const closedBySwipe = await sheetInfo();
    check('mobile: swipe down collapses, swipe up expands, swipe down when collapsed closes',
      collapsed.open && !collapsed.expanded && reExpanded.expanded && !closedBySwipe.open,
      `${JSON.stringify(collapsed)} / ${reExpanded.expanded} / open=${closedBySwipe.open}`);
    const mList0 = await mp.evaluate(() => ({
      collapsed: document.querySelector('#results').classList.contains('collapsed'),
      heading: document.querySelector('#results .results-title')?.textContent,
    }));
    await mp.click('[data-action="toggle-results"]');
    await sleep(300);
    const mRows = await mp.evaluate(() => document.querySelectorAll('#results button[data-id]').length);
    await mp.screenshot({ path: path.join(SHOTS, 'mobile-list.png') });
    await mp.click('#results button[data-id] >> nth=1');
    await sleep(600);
    const mList1 = await mp.evaluate(() => ({
      drawer: document.querySelector('#drawer').classList.contains('open'),
      collapsed: document.querySelector('#results').classList.contains('collapsed'),
    }));
    check('mobile: list starts collapsed, expands on tap and collapses when a listing is opened',
      mList0.collapsed && mList0.heading === ALL_HEADING && mRows === TOTAL && mList1.drawer && mList1.collapsed,
      `${JSON.stringify(mList0)} rows=${mRows} ${JSON.stringify(mList1)}`);
    check('no console errors (mobile)', m.errors.length === 0, m.errors.join(' | '));
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
