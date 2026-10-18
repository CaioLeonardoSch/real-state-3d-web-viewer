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
const DEVS = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', 'developments.json'), 'utf8')).developments;
const devUnits = (id) => DEVS.find((d) => d.id === id).levels.flatMap((l) => l.units);
const TOTAL = DATA.length;
const ALL_HEADING = `${TOTAL} imóveis à venda`;
const LANDS = DATA.filter((l) => l.type === 'land');
const brl = (n) => `R$ ${n.toLocaleString('pt-BR')}`;
// streets of the search box (written with the map tiles): [name, place, w, s, e, n, x, y], places [bairro, city]
const RUAS = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', 'ruas.json'), 'utf8'));
/** A street through the Centro and three other bairros: the box offers one option per bairro, each its own stretch. */
const XV = 'Rua XV de Novembro';
const placeLabel = ([bairro, city]) => (bairro ? `${bairro}, ${city}` : city);
/** The rows of ruas.json for a name: { place ("Centro, Joinville"), bbox [w, s, e, n], point [x, y] }. */
const streetRows = (name) =>
  RUAS.streets.filter((s) => s[0] === name).map((s) => ({ place: placeLabel(RUAS.places[s[1]]), bbox: s.slice(2, 6), point: s.slice(6, 8) }));
const XV_CENTRO = streetRows(XV).find((r) => r.place === 'Centro, Joinville');
/** Note of the street card when the name is also listed in another place (and some listing shows the street). */
const ELSEWHERE_NOTE = 'O nome também aparece em outros bairros; a busca inclui todos os trechos.';
/** Labels drawn at the default close-up of the Centro (zoom 17, pitch 55): about 34 were measured; this keeps a margin. */
const MIN_NAMES_3D = 20;
/** Shortest distance in metres from a point to the rings of a polygon (equirectangular: fine at a bairro's scale). */
function metresToRings([x, y], rings) {
  const my = 111320;
  const mx = my * Math.cos((y * Math.PI) / 180);
  let best = Infinity;
  for (const ring of rings)
    for (let i = 1; i < ring.length; i++) {
      const ax = (ring[i - 1][0] - x) * mx, ay = (ring[i - 1][1] - y) * my;
      const dx = (ring[i][0] - x) * mx - ax, dy = (ring[i][1] - y) * my - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  return best;
}
const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** How people abbreviate the street types ("R. Blumenau"): the search must still find the street. */
const ABBR = { Rua: 'R.', Avenida: 'Av.', Servidão: 'Serv.', Estrada: 'Estr.', Travessa: 'Trav.', Rodovia: 'Rod.', Alameda: 'Al.' };

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sha = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// accessibility: axe-core (WCAG 2.2 A/AA) in the main states of the map; findings are checked at the end
const AXE = readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const axeStates = [];
const axeFindings = [];
async function axe(page, label) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(AXE);
  const found = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'] } });
    // for each node: its selector and, when a check names them, the elements behind the failure (the focusable ones in
    // an aria-hidden box, say), with the box's own state
    const related = (n) => [...n.all, ...n.any, ...n.none].flatMap((c) => c.relatedNodes ?? []).slice(0, 2).map((x) => x.target.join(' '));
    const state = (sel) => {
      const el = document.querySelector(sel);
      return el ? `[aria-hidden=${el.getAttribute('aria-hidden')} inert=${el.inert} class=${el.className}]` : '';
    };
    return r.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => {
      const more = related(n);
      return `${n.target.join(' ')}${v.id === 'aria-hidden-focus' ? state(n.target.join(' ')) : ''}${more.length ? ` → ${more.join(', ')}` : ''}`;
    }).join(', ')}`);
  });
  axeStates.push(label);
  axeFindings.push(...found.map((f) => `${label}: ${f}`));
}

async function startServer() {
  // the vite binary itself (not npx): kill() reaches the server, and no unread pipes keep this process alive
  const proc = spawn(path.join(ROOT, 'node_modules', '.bin', 'vite'), ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: 'ignore',
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
  // every URL asked for (the street names' font must come from this site)
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
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
  return { ctx, page, errors, requests, label };
}

const renderedCount = (page, layer) =>
  page.evaluate((l) => window.__demo.map.queryRenderedFeatures({ layers: [l] }).length, layer);

/** Finds a matched listing on the given layers that is visible on screen (page coordinates). */
async function findListingTarget(page, kindFilter = ['listing-buildings']) {
  return page.evaluate(async (layers) => {
    const map = window.__demo.map;
    // the camera may still be easing (a click flies to the listing): pick once it is still
    if (map.isMoving() || !map.loaded()) await new Promise((r) => map.once('idle', r));
    const fs = map.queryRenderedFeatures({ layers });
    const canvas = map.getCanvas().getBoundingClientRect();
    for (const f of fs) {
      const c = window.__demo.project(f.properties.listingId);
      // the mouse moves in whole pixels: test the pixel it will land on (the center may sit on an edge)
      const p = c && { x: Math.round(c.x + canvas.left) - canvas.left, y: Math.round(c.y + canvas.top) - canvas.top };
      if (!p || p.x < 20 || p.y < 20 || p.x > canvas.width - 20 || p.y > canvas.height - 20) continue;
      // skip points covered by UI (results list, drawer, controls)
      if (document.elementFromPoint(p.x + canvas.left, p.y + canvas.top) !== map.getCanvas()) continue;
      // the listing must be the one the app picks there (the first matched one on top: another listing's pin may cover it)
      // a group of pins there takes the click
      if (map.getLayer('listing-clusters') && map.queryRenderedFeatures([p.x, p.y], { layers: ['listing-clusters'] }).length) continue;
      const top = map
        .queryRenderedFeatures([p.x, p.y], { layers: ['listing-pins', 'listing-buildings', 'listing-unbuilt', 'listing-land', 'listing-approx-fill'].filter((l) => map.getLayer(l)) })
        .find((h) => h.properties.matched === true);
      const hit = map.queryRenderedFeatures([p.x, p.y], { layers }).find((h) => h.properties.listingId === f.properties.listingId);
      if (hit && top?.properties.listingId === f.properties.listingId) return { id: f.properties.listingId, x: p.x + canvas.left, y: p.y + canvas.top };
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
    const layers = ['listing-buildings', 'listing-land', 'listing-approx-fill', 'dev-towers', 'dev-blocks'];
    for (let y = r.height * 0.3; y < r.height * 0.9; y += 23) {
      for (let x = r.width * 0.3; x < r.width * 0.65; x += 29) {
        if (map.queryRenderedFeatures([x, y], { layers }).length === 0 && document.elementFromPoint(x + r.left, y + r.top) === map.getCanvas())
          return { x: x + r.left, y: y + r.top };
      }
    }
    return null;
  });
}

/**
 * Types into the "Bairro ou rua" box (as a person would, key by key) and returns the options it suggests once the
 * street list is in: id, name, the line under it and the heading of its group.
 */
async function suggestions(page, text) {
  await page.click('#f-bairro-input');
  await page.fill('#f-bairro-input', '');
  await page.keyboard.type(text, { delay: 20 });
  await page.waitForFunction(() => {
    const list = document.querySelector('#f-place-list');
    return !list.hidden && !list.textContent.includes('Carregando ruas');
  }, null, { timeout: 20000 });
  return page.evaluate(() =>
    [...document.querySelectorAll('#f-place-list [role="option"][data-i]')].map((o) => ({
      id: o.id,
      name: o.querySelector('.f-place-name').textContent,
      sub: o.querySelector('.f-place-sub').textContent,
      group: o.closest('[role="group"]')?.querySelector('.f-place-head')?.textContent ?? '',
    })),
  );
}

/** Highlights the option `id` of the open list with ↓, as a keyboard user does; true once it is the active one. */
async function arrowTo(page, id) {
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('ArrowDown');
    if ((await page.getAttribute('#f-bairro-input', 'aria-activedescendant')) === id) return true;
  }
  return false;
}

/** State of the map and the page after a street was chosen in the box. */
const streetState = (page) =>
  page.evaluate(() => {
    const m = window.__demo.map;
    const card = document.querySelector('.street-card');
    return {
      zoom: Math.round(m.getZoom() * 100) / 100,
      search: location.search,
      pendingHint: !document.querySelector('.f-pending').hidden,
      listOpen: !document.querySelector('#f-place-list').hidden,
      card: card && !card.hidden ? card.querySelector('.street-card-name')?.textContent : null,
      place: card?.querySelector('.street-card-place')?.textContent ?? null,
      button: card?.querySelector('.street-card-search')?.textContent ?? null,
      empty: card?.querySelector('.street-card-empty')?.textContent ?? null,
      note: card?.querySelector('.street-card-note')?.textContent ?? null,
      center: [m.getCenter().lng, m.getCenter().lat],
      lit: window.__demo.highlightedStreet,
      litDrawn: [...new Set(m.queryRenderedFeatures({ layers: ['road-highlight'] }).map((f) => f.properties.name))],
      names: m.queryRenderedFeatures({ layers: ['road-names'] }).length,
      focus: document.activeElement?.id || document.activeElement?.className || null,
    };
  });

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
    const ctxCount = await renderedCount(page, 'buildings-flat');
    const listingCount = await renderedCount(page, 'listing-buildings');
    check('desktop: region overview shows flat building footprints (3D only up close)',
      ctxCount > 0 && (await renderedCount(page, 'context-buildings')) === 0, `${ctxCount} flat footprints`);
    check('desktop: listing layer rendered', listingCount > 0, `${listingCount} features`);
    const attrib = await page.textContent('.maplibregl-ctrl-attrib');
    check('attribution shows OSM and MapLibre', /OpenStreetMap contributors/.test(attrib) && /MapLibre/.test(attrib), attrib?.trim());
    check('demo banner visible', await page.isVisible('text=Demonstração. Imóveis e valores fictícios.'));
    const hint = await page.textContent('.map-hint span').catch(() => null);
    await page.click('.map-hint button');
    const hintGone = await page.evaluate(() => !document.querySelector('.map-hint') && localStorage.getItem('mapa3d-dica-vista') === '1');
    check('first visit: one-line navigation hint, gone for good on "Entendi"', /roda do mouse/.test(hint ?? '') && hintGone, hint ?? 'no hint');
    check('desktop: buttons of the map in Portuguese', (await page.getAttribute('.maplibregl-ctrl-zoom-in', 'title')) === 'Aproximar');
    await axe(page, 'mapa');
    const initialList = await page.evaluate(() => ({
      heading: document.querySelector('#results .results-title')?.textContent,
      rows: document.querySelectorAll('#results button[data-id]').length,
      visible: !document.querySelector('#results .results-body').hidden,
    }));
    check('desktop: list of all listings is available without searching',
      initialList.heading === ALL_HEADING && initialList.rows === TOTAL && initialList.visible, JSON.stringify(initialList));
    await page.screenshot({ path: path.join(SHOTS, 'desktop-morning.png') });

    // pins in the overview
    // pins that would overlap are grouped, with the count: every listing is in a pin or in a group
    const overview = await page.evaluate(() => {
      const m = window.__demo.map;
      const pins = new Set(m.queryRenderedFeatures({ layers: ['listing-pins'] }).map((f) => f.properties.listingId)).size;
      const groups = new Map(m.queryRenderedFeatures({ layers: ['listing-clusters'] }).map((f) => [f.properties.cluster_id, f]));
      const grouped = [...groups.values()].reduce((n, f) => n + f.properties.point_count, 0);
      // a group not covered by the results list or the controls
      const box = m.getCanvas().getBoundingClientRect();
      const at = [...groups.values()]
        .map((f) => m.project(f.geometry.coordinates))
        .map((p) => ({ x: p.x + box.left, y: p.y + box.top }))
        .find((p) => document.elementFromPoint(p.x, p.y) === m.getCanvas());
      return { pins, groups: groups.size, grouped, at: at ?? null, zoom: m.getZoom() };
    });
    const totalListings = await page.evaluate(() => window.__demo.listingIds.length);
    check('overview: every listing has a pin or is counted in a group of pins',
      overview.pins + overview.grouped === totalListings, `${overview.pins} pins + ${overview.grouped} in ${overview.groups} groups / ${totalListings}`);
    if (overview.at) {
      const cam = await page.evaluate(() => { const m = window.__demo.map; return { center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() }; });
      await page.mouse.click(overview.at.x, overview.at.y);
      await sleep(1200);
      const zoomed = await page.evaluate(() => window.__demo.map.getZoom());
      check('clicking a group of pins zooms in', zoomed > overview.zoom + 0.5, `${overview.zoom.toFixed(1)} → ${zoomed.toFixed(1)}`);
      await page.evaluate(async (c) => { const m = window.__demo.map; m.jumpTo(c); await new Promise((r) => m.once('idle', r)); }, cam);
    }
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

    // hover tooltip: closer in, where each listing has its own pin (in the overview a group may cover the building)
    await page.evaluate(async () => { const m = window.__demo.map; m.jumpTo({ zoom: 14 }); await new Promise((r) => m.once('idle', r)); });
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
    // sale: the financing simulator (opened before the accessibility check, so its form is checked too)
    const fin = await page.evaluate(() => {
      const d = document.querySelector('#drawer .fin-sim');
      if (!d) return { sale: false, rent: /\/mês/.test(document.querySelector('#drawer')?.textContent ?? '') };
      d.open = true;
      return { sale: true, sac: d.querySelector('.fin-out')?.textContent ?? '' };
    });
    if (fin.sale) {
      await page.selectOption('#drawer .fin-form select[name="system"]', 'price');
      await page.fill('#drawer .fin-form input[name="down"]', '0');
      fin.price = await page.textContent('#drawer .fin-out');
    }
    await axe(page, 'ficha do imóvel');
    check('drawer shows "Planta ilustrativa"; a sale has the financing simulator (SAC and Price, warning above 80%)',
      (await page.isVisible('#drawer >> text=Planta ilustrativa')) &&
        (fin.sale
          ? /Primeira parcela.*Última parcela/.test(fin.sac) && /Parcela/.test(fin.price) && !/Primeira/.test(fin.price) && /até 80%/.test(fin.price)
          : fin.rent),
      JSON.stringify(fin).slice(0, 300));
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
    await axe(page, 'filtros');
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
    const firstRow = await page.$('#results button[data-id] >> nth=0');
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
    await page.click('#results button[data-id] >> nth=0');
    await sleep(300);
    await waitIdle(page);
    check('clicking a result opens the drawer', await page.evaluate(() => document.querySelector('#drawer').classList.contains('open')));
    await page.screenshot({ path: path.join(SHOTS, 'desktop-result-land-closeup.png') });

    // previous / next inside the drawer
    const navInfo = async () =>
      page.evaluate(() => ({
        pos: document.querySelector('#drawer .nav-pos')?.textContent,
        title: document.querySelector('#drawer h2')?.textContent,
        id: new URLSearchParams(location.search).get('imovel'),
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
      n0.pos === `1 de ${landCount}` && n0.prevDisabled === true && n1.pos === `2 de ${landCount}` && n1.id !== n0.id &&
        n2.pos === n0.pos && n2.id === n0.id,
      `${n0.pos} → ${n1.pos} → ${n2.pos}`);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-drawer-nav.png') });
    await page.keyboard.press('Escape');

    // close-up of a highlighted apartment
    await page.click('label.chip:has-text("Terreno")');
    await page.click('label.chip:has-text("Apartamento")');
    await page.click('button:has-text("Buscar")');
    await sleep(300);
    await waitIdle(page);
    await page.click('#results button[data-id] >> nth=0');
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
    await axe(page, 'mais filtros');
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

    // reduced prices: filter + struck-through old price in the list
    await page.click('.f-more-toggle');
    await page.click('#filters-more label.chip:has-text("Preço reduzido")');
    await page.click('button:has-text("Buscar")');
    await sleep(400);
    await waitIdle(page);
    const reduced = await page.evaluate(() => ({
      header: document.querySelector('#results .results-title')?.textContent,
      struck: document.querySelectorAll('#results .price-old').length,
      search: location.search,
    }));
    const reducedCount = DATA.filter((l) => l.previousPrice > l.price).length;
    check('"Preço reduzido" lists only reduced listings, with the old price struck through',
      reduced.header?.startsWith(`${reducedCount} `) && reduced.struck === reducedCount && reduced.search === '?reduzido=1',
      `${JSON.stringify(reduced)}; expected ${reducedCount}`);
    await page.click('button:has-text("Limpar")');
    await sleep(300);
    await waitIdle(page);

    // rentals: "Alugar" lists listings also for rent, priced per month
    await page.click('#filters .f-deal label:has-text("Alugar")');
    await page.click('button:has-text("Buscar")');
    await sleep(400);
    await waitIdle(page);
    const rent = await page.evaluate(() => ({
      header: document.querySelector('#results .results-title')?.textContent,
      perMonth: [...document.querySelectorAll('#results .r-meta')].filter((m) => m.textContent.includes('/mês')).length,
      range: document.querySelector('#results .results-range')?.textContent ?? '',
      search: location.search,
    }));
    const rentCount = DATA.filter((l) => l.transaction === 'rent' || l.transaction === 'both').length;
    check('"Alugar" lists the listings for rent with monthly prices',
      rentCount > 0 && rent.header === `${rentCount} imóveis para alugar` && rent.perMonth === rentCount && rent.range.endsWith('/mês') &&
        rent.search === '?negocio=alugar',
      `${JSON.stringify(rent)}; expected ${rentCount}`);
    await page.click('button:has-text("Limpar")');
    await sleep(300);
    await waitIdle(page);

    // ------------------------------------------------ "Anunciar imóvel"
    const rowCount = () => page.evaluate(() => document.querySelectorAll('#results button[data-id]').length);
    const placeStatus = () => page.textContent('#add-panel .a-place-status');
    /** Clicks map points (grid scan) accepted by `accept` until the form reports a chosen place; returns that point or null. */
    async function pickOnMap(accept, maxTries = 40) {
      const candidates = await page.evaluate(({ accept }) => {
        const map = window.__demo.map;
        const r = map.getCanvas().getBoundingClientRect();
        const out = [];
        for (let y = r.height * 0.2; y < r.height * 0.85; y += 24) {
          for (let x = r.width * 0.3; x < r.width * 0.7; x += 24) {
            if (document.elementFromPoint(x + r.left, y + r.top) !== map.getCanvas()) continue;
            const hits = map.queryRenderedFeatures([x, y]);
            const ok =
              accept === 'building'
                ? hits[0]?.layer.id === 'context-buildings' && hits[0].properties.residential === true
                : // free ground: nothing but background around the point
                  [[0, 0], [-8, 0], [8, 0], [0, -8], [0, 8]].every(
                    ([dx, dy]) => map.queryRenderedFeatures([x + dx, y + dy]).every((h) => h.layer.id === 'boundary-line'),
                  );
            if (ok) out.push({ x: x + r.left, y: y + r.top, d: Math.hypot(x - r.width / 2, y - r.height / 2) });
          }
        }
        // the middle of the view is inside the neighbourhood; the top rows may be beyond its limit
        return out.sort((a, b) => a.d - b.d);
      }, { accept });
      for (const c of candidates.slice(0, maxTries)) {
        await page.mouse.click(c.x, c.y);
        await sleep(250);
        if ((await placeStatus())?.startsWith('✓')) return c;
      }
      return null;
    }
    /**
     * The street of the list (ruas.json) next to a point of the screen: named roads drawn around it, nearest first,
     * kept when the list has that name around there (its box grown by ~100 m). Prefers a type people abbreviate.
     */
    async function streetNear(point) {
      const near = await page.evaluate(({ x, y }) => {
        const map = window.__demo.map;
        const r = map.getCanvas().getBoundingClientRect();
        const p = { x: x - r.left, y: y - r.top };
        const best = new Map();
        for (const f of map.queryRenderedFeatures([[p.x - 160, p.y - 160], [p.x + 160, p.y + 160]], { layers: ['roads'] })) {
          if (!f.properties.name) continue;
          const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
          for (const line of lines) {
            for (let i = 1; i < line.length; i++) {
              const a = map.project(line[i - 1]);
              const b = map.project(line[i]);
              const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
              const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2)) : 0;
              const d = Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
              if (d < (best.get(f.properties.name) ?? Infinity)) best.set(f.properties.name, d);
            }
          }
        }
        return { at: map.unproject([p.x, p.y]).toArray(), names: [...best].sort((a, b) => a[1] - b[1]).map(([name]) => name) };
      }, point);
      const [lng, lat] = near.at;
      const pad = 0.001;
      const found = near.names.flatMap((name) => {
        const row = RUAS.streets.find((s) => s[0] === name && s[2] - pad <= lng && lng <= s[4] + pad && s[3] - pad <= lat && lat <= s[5] + pad);
        return row ? [{ name, bairro: RUAS.places[row[1]][0], city: RUAS.places[row[1]][1] }] : [];
      });
      return found.find((s) => ABBR[s.name.split(' ')[0]]) ?? found[0] ?? null;
    }

    // buildings are picked up close, where they are 3D
    const META = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', 'meta.json'), 'utf8'));
    const closeUp = () => page.evaluate((c) => window.__demo.map.jumpTo({ center: c, zoom: 16.3, pitch: 50, bearing: 0 }), META.center);
    await closeUp();
    await waitIdle(page);
    await page.click('.add-toggle');
    await sleep(200);
    check('"Anunciar" opens the form', await page.isVisible('#add-panel .add-form'));
    await axe(page, 'anunciar imóvel');
    // 1×1 PNG: the form shrinks photos in the browser, any image will do
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    /** Required fields other than price, area and place: photos, address, CRECI, WhatsApp. */
    async function fillRequired(photoCount = 5, street = 'Rua de Teste') {
      await page.setInputFiles('#add-panel input[name="photos"]',
        Array.from({ length: photoCount }, (_, i) => ({ name: `foto${i + 1}.png`, mimeType: 'image/png', buffer: PNG })));
      await page.waitForFunction((n) => document.querySelectorAll('#add-panel .a-photos img').length === n, photoCount);
      if (!(await page.inputValue('#add-panel input[name="bairro"]'))) await page.fill('#add-panel input[name="bairro"]', 'Centro');
      await page.fill('#add-panel input[name="street"]', street);
      await page.fill('#add-panel input[name="creci"]', '12345-J');
      await page.fill('#add-panel input[name="whatsapp"]', '(47) 90000-0000');
    }
    await page.selectOption('#add-panel select[name="type"]', 'house');
    await page.fill('#add-panel input[name="price"]', '987000');
    await page.fill('#add-panel input[name="areaM2"]', '180');
    await page.fill('#add-panel input[name="title"]', 'Casa de teste automatizado');
    await page.click('#add-panel label.chip:has-text("Churrasqueira")');
    await page.click('#add-panel [data-action="pick"]');
    await sleep(200);
    const pickingUi = await page.evaluate(() => document.querySelector('#add-panel').classList.contains('picking'));
    const pickedBuilding = await pickOnMap('building');
    const autoBairro = await page.inputValue('#add-panel input[name="bairro"]');
    // the house is on a real street next to its building, written as people do ("R. …"): the search box finds it later
    const houseStreet = pickedBuilding ? await streetNear(pickedBuilding) : null;
    const [houseType, ...houseRest] = (houseStreet?.name ?? 'Rua de Teste').split(' ');
    const houseTyped = `${ABBR[houseType] ?? houseType} ${houseRest.join(' ')}`;
    console.log(`  street of the house: "${houseTyped}" (${JSON.stringify(houseStreet)})`);
    // incomplete record: no CRECI is refused
    await fillRequired(4, houseTyped);
    await page.fill('#add-panel input[name="creci"]', '');
    await page.click('#add-panel button:has-text("Salvar anúncio")');
    await sleep(200);
    const refusal = await page.textContent('#add-panel .a-error');
    check('the form refuses an incomplete record (no CRECI)',
      /CRECI/.test(refusal) && !/foto/.test(refusal) && (await page.isVisible('#add-panel .add-form')), refusal);
    await page.setInputFiles('#add-panel input[name="photos"]', [{ name: 'foto5.png', mimeType: 'image/png', buffer: PNG }]);
    await page.waitForFunction(() => document.querySelectorAll('#add-panel .a-photos img').length === 5);
    await page.fill('#add-panel input[name="creci"]', '12345-J');
    await page.screenshot({ path: path.join(SHOTS, 'desktop-add-listing.png') });
    await page.click('#add-panel button:has-text("Salvar anúncio")');
    await sleep(700);
    await waitIdle(page);
    const added = await page.evaluate(() => ({
      title: document.querySelector('#drawer.open h2')?.textContent ?? null,
      badge: document.querySelector('#drawer .badge-user')?.textContent ?? null,
      panelHidden: document.querySelector('#add-panel').hidden,
      stored: JSON.parse(localStorage.getItem('mapa3d-america:user-listings:v1') ?? '[]').length,
      gallery: document.querySelector('#drawer .gal-pos')?.textContent ?? null,
      whatsapp: document.querySelector('#drawer .btn-whatsapp')?.getAttribute('href') ?? null,
      address: document.querySelector('#drawer .drawer-address')?.textContent ?? null,
    }));
    check('a new house is placed on a grey building, saved and opened',
      pickingUi && pickedBuilding && added.title === 'Casa de teste automatizado' && !!added.badge && added.panelHidden &&
        added.stored === 1 && (await rowCount()) === TOTAL + 1,
      JSON.stringify(added));
    check('the saved listing shows its photos, address (street only) and a WhatsApp contact',
      added.gallery === '1/5' && added.whatsapp?.startsWith('https://wa.me/5547900000000') && !!houseStreet &&
        (added.address ?? '').includes(`${houseTyped} · `) && !(added.address ?? '').includes(`${houseTyped}, `),
      `bairro from map: "${autoBairro}"; ${JSON.stringify({ ...added, whatsapp: added.whatsapp?.slice(0, 40) })}`);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-added-listing.png') });
    // owner lowers the price: the old one is struck through and the history records both
    await page.fill('#drawer .manage-form input[name="price"]', '950000');
    await page.click('#drawer .manage-form button[type="submit"]');
    await sleep(500);
    const managed = await page.evaluate(() => ({
      was: document.querySelector('#drawer .price-was s')?.textContent ?? null,
      cut: document.querySelector('#drawer .price-cut')?.textContent ?? null,
      history: document.querySelectorAll('#drawer .price-history li').length,
    }));
    check('lowering the price of an own listing shows the reduction and the price history',
      /987\.000/.test(managed.was ?? '') && managed.cut === '−4%' && managed.history === 2, JSON.stringify(managed));
    // full edit: the form opens filled in; change the title, drop a photo, pick another cover
    await page.click('#drawer [data-action="edit"]');
    await sleep(300);
    const editForm = await page.evaluate(() => ({
      heading: document.querySelector('#add-panel h2')?.textContent,
      title: document.querySelector('#add-panel input[name="title"]')?.value,
      price: document.querySelector('#add-panel input[name="price"]')?.value,
      place: document.querySelector('#add-panel .a-place-status')?.textContent ?? '',
      photos: document.querySelectorAll('#add-panel .a-photos img').length,
    }));
    await page.fill('#add-panel input[name="title"]', 'Casa de teste editada');
    await page.click('#add-panel [data-remove="0"]');
    await page.click('#add-panel input[name="cover"][value="2"]');
    await page.click('#add-panel button:has-text("Salvar alterações")');
    await sleep(700);
    await waitIdle(page);
    const edited = await page.evaluate(() => ({
      title: document.querySelector('#drawer.open h2')?.textContent ?? null,
      gallery: document.querySelector('#drawer .gal-pos')?.textContent ?? null,
      strip: document.querySelectorAll('#drawer .gal-strip button').length,
      was: document.querySelector('#drawer .price-was s')?.textContent ?? null,
      stored: JSON.parse(localStorage.getItem('mapa3d-america:user-listings:v1') ?? '[]').map((l) => [l.title, l.photos.length, !!l.photos[0].thumb]),
    }));
    check('"Editar anúncio" opens the form filled in and saves title, photos and cover (keeping the reduction)',
      editForm.heading === 'Editar anúncio' && editForm.title === 'Casa de teste automatizado' && editForm.price === '950000' &&
        editForm.place.startsWith('✓') && editForm.photos === 5 && edited.title === 'Casa de teste editada' && edited.gallery === '1/4' &&
        edited.strip === 4 && /987\.000/.test(edited.was ?? '') && JSON.stringify(edited.stored) === '[["Casa de teste editada",4,true]]' &&
        (await rowCount()) === TOTAL + 1,
      JSON.stringify({ editForm, edited }));
    await page.keyboard.press('Escape');
    await sleep(300);

    await closeUp();
    await waitIdle(page);
    await page.click('.add-toggle');
    await page.selectOption('#add-panel select[name="type"]', 'land');
    await page.fill('#add-panel input[name="price"]', '450000');
    await page.fill('#add-panel input[name="areaM2"]', '300');
    await page.click('#add-panel [data-action="pick"]');
    await sleep(200);
    const pickedLot = await pickOnMap('land');
    // the lot names the same street but shows the public only its neighbourhood: no street search may find it
    await fillRequired(5, houseStreet?.name ?? 'Rua de Teste');
    await page.selectOption('#add-panel select[name="addressDisplay"]', 'neighborhood');
    await page.click('#add-panel button:has-text("Salvar anúncio")');
    await sleep(700);
    await waitIdle(page);
    const lotAdded = await page.evaluate(() => document.querySelector('#drawer.open h2')?.textContent ?? null);
    check('a new lot is placed on free ground (no building, road, water or green) and saved',
      !!pickedLot && lotAdded === 'Terreno de 300 m²' && (await rowCount()) === TOTAL + 2, `${!!pickedLot} ${lotAdded}`);
    await page.keyboard.press('Escape');
    await sleep(300);

    // "Imóveis nesta rua": the street chosen in the box offers the listings that show it in their address
    const houseOpts = houseStreet ? await suggestions(page, fold(houseRest.join(' '))) : [];
    const houseOpt = houseOpts.find((o) => o.name === houseStreet.name && o.sub.startsWith(houseStreet.bairro ? `${houseStreet.bairro}, ${houseStreet.city}` : houseStreet.city));
    if (houseOpt) await page.click(`#${houseOpt.id}`);
    await sleep(300);
    await waitIdle(page);
    const streetCard = await streetState(page);
    // one row per (name, place): the card notes the name when ruas.json lists it in another place too
    const housePlaces = houseStreet ? new Set(streetRows(houseStreet.name).map((r) => r.place)) : new Set();
    check('a street chosen in the box counts the listings showing it ("R. …" counts; a lot showing only its neighbourhood does not)',
      !!houseOpt && streetCard.card === houseStreet.name && streetCard.button === 'Imóveis nesta rua (1)' && streetCard.lit === houseStreet.name &&
        streetCard.note === (housePlaces.size > 1 ? ELSEWHERE_NOTE : null),
      `${houseTyped} → ${JSON.stringify({ ...streetCard, places: [...housePlaces] })}`);
    await page.click('.street-card-search');
    await sleep(400);
    await waitIdle(page);
    const searchedStreet = await page.evaluate(() => ({
      header: document.querySelector('#results .results-title')?.textContent,
      rows: [...document.querySelectorAll('#results button[data-id]')].map((b) => b.querySelector('.r-title')?.textContent ?? b.textContent.trim().slice(0, 40)),
      search: location.search,
      chip: document.querySelector('.f-street-chip > span')?.textContent ?? null,
      card: !document.querySelector('.street-card').hidden,
      lit: window.__demo.highlightedStreet,
    }));
    check('"Imóveis nesta rua" searches them: one result, ?rua= in the address bar and a street chip in the box',
      searchedStreet.header === '1 imóvel encontrado' && searchedStreet.rows.length === 1 && searchedStreet.rows[0].includes('Casa de teste editada') &&
        new URLSearchParams(searchedStreet.search).get('rua') === houseStreet?.name && searchedStreet.chip === houseStreet?.name &&
        !searchedStreet.card && searchedStreet.lit === null,
      JSON.stringify(searchedStreet));
    await page.click('.f-street-chip button');
    await page.click('#filters button[type="submit"]');
    await sleep(400);
    await waitIdle(page);
    const unStreet = await page.evaluate(() => ({ header: document.querySelector('#results .results-title')?.textContent, search: location.search, chips: document.querySelectorAll('.f-street-chip').length }));
    check('removing the street chip and searching lists every listing again',
      unStreet.header === `${TOTAL + 2} imóveis à venda` && unStreet.search === '' && unStreet.chips === 0, JSON.stringify(unStreet));
    // a shared link with the street searches the same way, before the street list is even loaded
    await page.goto(`${URL_}?rua=${encodeURIComponent(houseStreet?.name ?? '')}`);
    await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
    await waitIdle(page);
    const streetLink = await page.evaluate(() => ({
      header: document.querySelector('#results .results-title')?.textContent,
      rows: [...document.querySelectorAll('#results button[data-id]')].map((b) => b.querySelector('.r-title')?.textContent ?? b.textContent.trim().slice(0, 40)),
      chip: document.querySelector('.f-street-chip > span')?.textContent ?? null,
    }));
    check('a link with ?rua= opens with that street search (the lot showing only its neighbourhood stays out)',
      streetLink.header === '1 imóvel encontrado' && streetLink.rows.length === 1 && streetLink.rows[0].includes('Casa de teste editada') &&
        streetLink.chip === houseStreet?.name,
      JSON.stringify(streetLink));

    // persisted across reloads (a fresh load without the street), then deleted from the drawer
    await page.goto(URL_);
    await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
    await waitIdle(page);
    const afterReload = await rowCount();
    page.once('dialog', (dlg) => dlg.accept());
    await page.click('#results button:has-text("Casa de teste editada")');
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

    // ------------------------------------------------ developments: 3D sales chart
    const towers = await page.evaluate(() =>
      new Set(window.__demo.map.queryRenderedFeatures({ layers: ['dev-towers'] }).map((f) => f.properties.devId)).size,
    );
    check('developments are drawn as violet towers with a label each',
      towers > 0 && (await page.locator('.dev-marker').count()) === DEVS.length, `${towers} towers on screen, ${DEVS.length} labels`);
    await page.click('#results button[data-dev="landhaus"]');
    await sleep(500);
    await waitIdle(page);
    await axe(page, 'espelho de vendas');
    const lh = devUnits('landhaus');
    const devOpen = await page.evaluate(() => ({
      title: document.querySelector('#dev-panel.open h2')?.textContent ?? null,
      units: document.querySelectorAll('#dev-panel button[data-unit]').length,
      blocks: window.__demo.map.queryRenderedFeatures({ layers: ['dev-blocks'] }).filter((f) => f.properties.kind === 'unit').length,
      search: location.search,
    }));
    check('opening a development splits the tower into units and lists every unit by floor',
      devOpen.title === 'Landhaus' && devOpen.units === lh.length && devOpen.blocks > 0 && devOpen.search === '?empreendimento=landhaus',
      JSON.stringify(devOpen));
    await page.screenshot({ path: path.join(SHOTS, 'desktop-development.png') });

    const pick = lh.find((u) => u.status === 'available' && Number(u.number) < 1500) ?? lh[0];
    await page.click(`#dev-panel button[data-unit="${pick.id}"]`);
    await sleep(500);
    await waitIdle(page);
    const unitState = await page.evaluate(() => ({
      card: document.querySelector('#dev-panel .dev-card h3')?.textContent ?? null,
      ghosts: window.__demo.map.queryRenderedFeatures({ layers: ['dev-blocks-ghost'] }).length,
      search: location.search,
      pageScroll: document.scrollingElement.scrollLeft + document.scrollingElement.scrollTop,
    }));
    check('choosing a unit shows its card, makes the floors above translucent and goes into the URL',
      unitState.card === `Apto ${pick.number}` && unitState.ghosts > 0 &&
        unitState.search === `?empreendimento=landhaus&unidade=${pick.number}` && unitState.pageScroll === 0,
      JSON.stringify(unitState));
    await page.screenshot({ path: path.join(SHOTS, 'desktop-development-unit.png') });

    await page.check('#dev-panel input[name="onlyAvailable"]');
    await sleep(300);
    const outCount = await page.locator('#dev-panel button[data-unit].is-out').count();
    check('"Só disponíveis" fades the other units in the grid',
      outCount === lh.filter((u) => u.status !== 'available').length, `${outCount} faded`);
    await page.uncheck('#dev-panel input[name="onlyAvailable"]');

    await page.click('#dev-panel [data-action="view"]');
    await sleep(500);
    await waitIdle(page);
    const view = await page.evaluate(() => ({ pitch: window.__demo.map.getPitch(), zoom: window.__demo.map.getZoom() }));
    await page.screenshot({ path: path.join(SHOTS, 'desktop-unit-window-view.png') });
    await page.keyboard.press('Escape');
    await sleep(500);
    await waitIdle(page);
    const afterView = await page.evaluate(() => ({ pitch: window.__demo.map.getPitch(), max: window.__demo.map.getMaxPitch() }));
    check('"Ver a vista da janela" puts the camera at the window and Esc brings it back',
      view.pitch >= 75 && afterView.pitch <= 75 && afterView.max === 75, `${JSON.stringify(view)} → ${JSON.stringify(afterView)}`);

    await page.click('#dev-panel .dev-back');
    await sleep(400);
    await waitIdle(page);
    const devClosed = await page.evaluate(() => ({
      open: document.querySelector('#dev-panel').classList.contains('open'),
      blocks: window.__demo.map.queryRenderedFeatures({ layers: ['dev-blocks'] }).length,
      search: location.search,
    }));
    check('"Voltar ao bairro" closes the development', !devClosed.open && devClosed.blocks === 0 && devClosed.search === '',
      JSON.stringify(devClosed));

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
    // static page of the open listing (scripts/prerender.mjs): linked from the panel, demo marked noindex
    const pageHref = await shared.page.getAttribute('#drawer .page-link a', 'href');
    const pageHtml = pageHref ? await (await fetch(pageHref)).text() : '';
    const sitemap = await (await fetch(`${URL_}sitemap.xml`)).text();
    check('listing panel links to the static listing page (title, structured data; demo is noindex and out of the sitemap)',
      /\/imovel\/terreno-plano-15x30-m-land-100\/$/.test(pageHref ?? '') && pageHtml.includes('<h1>Terreno plano 15×30 m</h1>') &&
        pageHtml.includes('"@type":"RealEstateListing"') && pageHtml.includes('content="noindex"') && !sitemap.includes('/imovel/'),
      pageHref ?? 'sem link');
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
    const amanTop = devUnits('aman').at(-3);
    const devLink = await openPage(browser, { width: 1440, height: 900 }, 'dev-link', `?empreendimento=aman&unidade=${amanTop.number}`);
    const devLinkState = await devLink.page.evaluate(() => ({
      title: document.querySelector('#dev-panel.open h2')?.textContent ?? null,
      card: document.querySelector('#dev-panel .dev-card h3')?.textContent ?? null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    check('shared link opens the development with the unit selected',
      devLinkState.title === 'Aman' && devLinkState.card === `Apto ${amanTop.number}` && devLinkState.overflow <= 0 && devLink.errors.length === 0,
      JSON.stringify(devLinkState) + devLink.errors.join(' | '));
    await devLink.ctx.close();

    // ------------------------------------------------ neighbourhood cut ("bairro" filter)
    const BAIRRO = 'Glória';
    const inBairro = DATA.filter((l) => l.address?.bairro === BAIRRO && (l.transaction ?? 'sale') !== 'rent');
    const cut = await openPage(browser, { width: 1440, height: 900 }, 'bairro', `?bairro=${encodeURIComponent('Gloria')}`);
    await cut.page.waitForFunction(() => window.__demo.clipped, null, { timeout: 20000 });
    await waitIdle(cut.page);
    const cutState = await cut.page.evaluate(() => {
      const m = window.__demo.map;
      return {
        header: document.querySelector('#results .results-title')?.textContent ?? '',
        chips: [...document.querySelectorAll('.f-bairro-chip')].map((c) => c.firstChild.textContent.trim()),
        search: location.search,
        filter: JSON.stringify(m.getFilter('context-buildings')),
        mask: m.querySourceFeatures('clip-mask').length,
        outline: m.getLayoutProperty('bairros-line', 'visibility'),
        devMarkers: [...document.querySelectorAll('.dev-marker:not(.is-hidden)')].length,
      };
    });
    check('bairro filter: link without accent finds the neighbourhood, lists only its listings and cuts the map (100 m around, rest masked)',
      cutState.header.startsWith(`${inBairro.length} `) && cutState.chips.join() === BAIRRO && cutState.search === `?bairro=${encodeURIComponent(BAIRRO)}` &&
        cutState.filter.includes('"distance"') && cutState.mask > 0 && cutState.outline === 'none' && cutState.devMarkers === 0,
      JSON.stringify({ ...cutState, filter: cutState.filter.slice(0, 60) }));
    await cut.page.screenshot({ path: path.join(SHOTS, 'desktop-bairro.png') });
    // with the neighbourhood search applied, the box suggests only the streets inside it: a word of a street of the
    // neighbourhood that streets elsewhere share
    const cutPlace = RUAS.places.findIndex(([b, c]) => b === BAIRRO && c === 'Joinville');
    const wordsOfStreet = (name) => fold(name).split(/[^a-z0-9]+/).slice(1).filter((w) => w.length >= 5);
    const elsewhere = (w) => RUAS.streets.filter((s) => s[1] !== cutPlace && wordsOfStreet(s[0]).some((x) => x.startsWith(w))).length;
    const cutWord = RUAS.streets.filter((s) => s[1] === cutPlace).flatMap((s) => wordsOfStreet(s[0])).sort((a, b) => elsewhere(b) - elsewhere(a))[0];
    const cutOpts = await suggestions(cut.page, cutWord);
    const cutStreets = cutOpts.filter((o) => o.sub.endsWith('ir para a rua'));
    check('bairro filter: the search box suggests only the streets of the chosen neighbourhood',
      cutStreets.length > 0 && cutStreets.every((o) => o.sub.startsWith(`${BAIRRO}, Joinville`) && o.group === 'Ruas nos bairros escolhidos') && elsewhere(cutWord) > 0,
      `"${cutWord}": ${cutStreets.map((o) => o.name).join(', ')} (${elsewhere(cutWord)} elsewhere left out)`);
    // the names are drawn above the mask, so the cut hides them by itself: none in the Centro, more than 1 km from the
    // cut (the whole screen is outside it), while the bairro keeps its names
    const AREAS = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', 'bairros-areas.geojson'), 'utf8')).features;
    const cutRings = AREAS.filter((f) => f.properties.name === BAIRRO).flatMap((f) =>
      f.properties.grown.type === 'Polygon' ? f.properties.grown.coordinates : f.properties.grown.coordinates.flat());
    const OUT = [-48.8457, -26.3035];
    const IN = streetRows(XV).find((r) => r.place === `${BAIRRO}, Joinville`)?.point;
    const cutNames = async (center) => {
      await cut.page.evaluate((c) => window.__demo.map.jumpTo({ center: c, zoom: 17, pitch: 55, bearing: 0 }), center);
      await waitIdle(cut.page);
      await sleep(600);
      return cut.page.evaluate(() => [...new Set(window.__demo.map.queryRenderedFeatures({ layers: ['road-names'] }).map((f) => f.properties.name))]);
    };
    const namesOut = await cutNames(OUT);
    const namesIn = IN ? await cutNames(IN) : [];
    const outDist = Math.round(metresToRings(OUT, cutRings));
    check('bairro filter: street names outside the cut are hidden (none in the Centro), the bairro keeps its own',
      cutRings.length > 0 && outDist > 1000 && namesOut.length === 0 && namesIn.length > 0,
      `${outDist} m from the cut: ${JSON.stringify(namesOut)}; inside: ${namesIn.length} names (${namesIn.slice(0, 3).join(', ')}…)`);
    await cut.page.keyboard.press('Escape');
    await cut.page.keyboard.press('Escape');
    await cut.page.click('.f-bairro-chip button');
    await cut.page.click('#filters button[type="submit"]');
    await cut.page.waitForFunction(() => !window.__demo.clipped, null, { timeout: 20000 });
    check('removing the neighbourhood shows the whole city again',
      (await cut.page.evaluate(() => JSON.stringify(window.__demo.map.getFilter('context-buildings')))).includes('distance') === false &&
        (await cut.page.textContent('#results .results-title')).startsWith(`${TOTAL} `));
    check('no console errors (bairro)', cut.errors.length === 0, cut.errors.join(' | '));
    await cut.ctx.close();

    // ------------------------------------------------ scenery up close: pavement, trees, lamps, night lights
    const sc = await openPage(browser, { width: 1440, height: 900 }, 'scenery');
    await sc.page.evaluate(() => window.__demo.map.jumpTo({ center: [-48.8457, -26.3035], zoom: 17.6, pitch: 60, bearing: -25 }));
    await waitIdle(sc.page);
    const scDay = await sc.page.evaluate(() => {
      const m = window.__demo.map;
      const n = (layers) => m.queryRenderedFeatures({ layers }).length;
      const surfaces = new Set(m.querySourceFeatures('osm', { sourceLayer: 'roads' }).map((f) => f.properties.s));
      return { trees: n(['trees']), lamps: n(['lamps']), roofs: n(['roofs']), paving: n(['roads-paving']), surfaces: [...surfaces].sort().join(','), glow: m.getPaintProperty('lamp-glow', 'circle-opacity') };
    });
    check('up close: low-poly roofs, trees, street lamps and roads by pavement (asphalt, paving stones…); no night lights by day',
      scDay.trees > 0 && scDay.lamps > 0 && scDay.roofs > 0 && scDay.surfaces.includes('a') && scDay.surfaces.includes('c') && scDay.glow === 0, JSON.stringify(scDay));
    await sc.page.screenshot({ path: path.join(SHOTS, 'desktop-scenery.png') });
    // building shadows on the ground: away from the sun (west in the morning, east in the afternoon), none at night
    const shadowsAt = async (label, east) => {
      await sc.page.click(`.time-of-day button:has-text("${label}")`);
      await sc.page.waitForFunction((e) => {
        const s = window.__demo.shadows();
        return e === 0 ? s.count === 0 : s.count > 0 && Math.sign(s.offset[0]) === e;
      }, east, { timeout: 15000 }).catch(() => {});
      await waitIdle(sc.page);
      return sc.page.evaluate(() => ({ ...window.__demo.shadows(), drawn: window.__demo.map.queryRenderedFeatures({ layers: ['building-shadows'] }).length }));
    };
    const shMorning = await shadowsAt('Manhã', -1);
    await sc.page.screenshot({ path: path.join(SHOTS, 'desktop-shadows-morning.png') });
    const shAfternoon = await shadowsAt('Tarde', 1);
    await sc.page.screenshot({ path: path.join(SHOTS, 'desktop-shadows-afternoon.png') });
    check('by day the buildings cast shadows on the ground: west in the morning, east in the afternoon',
      shMorning.count > 0 && shMorning.drawn > 0 && shMorning.offset[0] < 0 && shAfternoon.count > 0 && shAfternoon.drawn > 0 && shAfternoon.offset[0] > 0,
      JSON.stringify({ morning: shMorning, afternoon: shAfternoon }));
    // the most shadows are computed when they first appear (zoom 15: buildings within 1.5 km of the centre)
    await sc.page.evaluate(() => window.__demo.map.jumpTo({ zoom: 15.6 }));
    await waitIdle(sc.page);
    console.log('  shadows at zoom 15.6:', JSON.stringify(await sc.page.evaluate(() => window.__demo.shadows())));
    await sc.page.evaluate(() => window.__demo.map.jumpTo({ zoom: 17.6 }));
    await waitIdle(sc.page);
    await sc.page.click('.time-of-day button:has-text("Noite")');
    await waitIdle(sc.page);
    await sc.page.waitForFunction(() => window.__demo.shadows().count === 0, null, { timeout: 10000 }).catch(() => {});
    // switched to night already up close (tiles loaded by day): the lights must appear without moving the map
    const scNight = await sc.page.evaluate(() => {
      const m = window.__demo.map;
      const lights = m.queryRenderedFeatures({ layers: ['lamp-glow'] });
      return {
        lights: lights.length,
        // each lamp has its kind (warm or neutral white LED, sodium) and strength, fixed at build time
        typed: lights.every((f) => ['w', 'n', 's'].includes(f.properties.t ?? 'w') && f.properties.k > 0),
        opacity: m.getPaintProperty('lamp-glow', 'circle-opacity'),
        core: m.getPaintProperty('lamp-core', 'circle-opacity'),
        kinds: [...new Set(lights.map((f) => f.properties.t ?? 'w'))].sort().join(','),
        shadows: window.__demo.shadows().count,
      };
    });
    check('at night the street lamps light up the street (a pool and a bright spot, by kind of lamp), and there are no shadows',
      scNight.lights > 0 && scNight.typed && scNight.opacity > 0 && scNight.core > scNight.opacity && scNight.shadows === 0, JSON.stringify(scNight));
    await sc.page.screenshot({ path: path.join(SHOTS, 'desktop-scenery-night.png') });
    check('no console errors (scenery)', sc.errors.length === 0, sc.errors.join(' | '));
    await sc.ctx.close();

    // ------------------------------------------------ street names on the map, streets in the search box
    const st = await openPage(browser, { width: 1440, height: 900 }, 'ruas');
    const sp = st.page;
    await sp.evaluate(() => window.__demo.map.jumpTo({ center: [-48.8457, -26.3035], zoom: 17, pitch: 55, bearing: 0 }));
    await waitIdle(sp);
    const namesNow = () =>
      sp.evaluate(() => {
        const m = window.__demo.map;
        const fs = m.queryRenderedFeatures({ layers: ['road-names'] });
        return {
          drawn: fs.length,
          names: [...new Set(fs.map((f) => f.properties.name))],
          text: m.getPaintProperty('road-names', 'text-color'),
          halo: m.getPaintProperty('road-names', 'text-halo-color'),
        };
      });
    const namesDay = await namesNow();
    const fontUrl = await sp.evaluate(() => Object.values(window.__demo.map.getStyle()['font-faces'] ?? {})[0] ?? null);
    const fonts = st.requests.filter((u) => /\.woff2(\?|$)/.test(u));
    const ownOrigin = (u) => new URL(u).origin === new URL(URL_).origin;
    // drawn above the 3D city: after every extrusion layer (buildings, roofs, trees, developments…)
    const names3d = await sp.evaluate(() => {
      const layers = window.__demo.map.getStyle().layers;
      const at = layers.findIndex((l) => l.id === 'road-names');
      const extrusions = layers.map((l, i) => [l, i]).filter(([l]) => l.type === 'fill-extrusion');
      return { at, extrusions: extrusions.length, above: extrusions.every(([, i]) => i < at), clipMaskBelow: layers.findIndex((l) => l.id === 'clip-mask') < at };
    });
    check(`street names at the default 3D close-up (Centro, zoom 17, pitch 55): at least ${MIN_NAMES_3D} labels, drawn above every 3D layer`,
      namesDay.drawn >= MIN_NAMES_3D && names3d.extrusions > 0 && names3d.above && names3d.clipMaskBelow,
      `${namesDay.drawn} labels; ${JSON.stringify(names3d)}`);
    check('street names are drawn up close (Centro, zoom 17), with the site\'s own font file',
      namesDay.drawn > 0 && namesDay.names.every((n) => typeof n === 'string' && n.trim() === n && n.length > 2) &&
        typeof fontUrl === 'string' && ownOrigin(fontUrl) && fonts.includes(fontUrl) && fonts.every(ownOrigin),
      `${namesDay.drawn} labels, ${namesDay.names.length} names (${namesDay.names.slice(0, 4).join(', ')}…); fonts: ${fonts.map((u) => u.replace(URL_, '')).join(', ')}`);
    await sp.evaluate(() => window.__demo.map.jumpTo({ zoom: 15.5 }));
    await waitIdle(sp);
    const namesFar = await renderedCount(sp, 'road-names');
    check('street names: none from afar (zoom 15.5)', namesFar === 0, `${namesFar} labels`);
    await sp.evaluate(() => window.__demo.map.jumpTo({ zoom: 17 }));
    await sp.click('.time-of-day button:has-text("Noite")');
    await sleep(300);
    await waitIdle(sp);
    const namesNight = await namesNow();
    check('street names at night: light text on a dark halo',
      namesNight.drawn > 0 && namesNight.text !== namesDay.text && namesNight.halo !== namesDay.halo,
      `day ${namesDay.text}/${namesDay.halo} → night ${namesNight.text}/${namesNight.halo}, ${namesNight.drawn} labels`);
    await sp.click('.time-of-day button:has-text("Manhã")');
    await sp.click('.overview-btn');
    await sleep(300);
    await waitIdle(sp);

    // a neighbourhood: typing only suggests it, ↓ + Enter adds it as a pending chip, Backspace takes it back
    const bairroOpts = await suggestions(sp, 'Glo');
    const chipsWhileTyping = await sp.locator('.f-bairro-chip').count();
    const gloriaOpt = bairroOpts.find((o) => o.name === 'Glória' && o.group === 'Bairros');
    const toGloria = !!gloriaOpt && (await arrowTo(sp, gloriaOpt.id));
    await sp.keyboard.press('Enter');
    await sleep(200);
    const bairroChosen = await sp.evaluate(() => ({
      chips: [...document.querySelectorAll('.f-bairro-chip')].map((c) => c.firstChild.textContent.trim()),
      pendingHint: !document.querySelector('.f-pending').hidden,
      search: location.search,
      typed: document.querySelector('#f-bairro-input').value,
    }));
    await sp.keyboard.press('Backspace');
    await sleep(200);
    const bairroUndone = await sp.evaluate(() => document.querySelectorAll('.f-bairro-chip').length === 0 && document.querySelector('.f-pending').hidden);
    check('search box: a neighbourhood is suggested while typing, added as a pending chip with ↓ + Enter, removed with Backspace',
      toGloria && chipsWhileTyping === 0 && bairroChosen.chips.join() === 'Glória' && bairroChosen.pendingHint && bairroChosen.search === '' &&
        bairroChosen.typed === '' && bairroUndone,
      JSON.stringify({ options: bairroOpts.map((o) => `${o.group}: ${o.name}`).slice(0, 5), ...bairroChosen, bairroUndone }));

    // a street: ↓ + Enter takes the map there and lights it, with its card; the search stays as it was
    const zoomBefore = await sp.evaluate(() => window.__demo.map.getZoom());
    const xvOpts = await suggestions(sp, 'xv de nov');
    // one option per bairro the street crosses (ruas.json has one row per name and place); the Centro one is chosen
    const xvSubs = xvOpts.filter((o) => o.name === XV && o.group === 'Ruas').map((o) => o.sub.replace(/ · ir para a rua$/, '')).sort();
    const xvPlaces = streetRows(XV).map((r) => r.place).sort();
    check('search box: a street through several bairros is offered once per bairro (Rua XV de Novembro)',
      xvPlaces.length >= 4 && xvPlaces.includes('Centro, Joinville') && JSON.stringify(xvSubs) === JSON.stringify(xvPlaces),
      `${JSON.stringify(xvSubs)} vs ruas.json ${JSON.stringify(xvPlaces)}`);
    const xvOpt = xvOpts.find((o) => o.name === XV && o.group === 'Ruas' && o.sub.startsWith('Centro, Joinville'));
    const toXv = !!xvOpt && (await arrowTo(sp, xvOpt.id));
    await axe(sp, 'busca: lista de ruas');
    await sp.keyboard.press('Enter');
    await sleep(300);
    await waitIdle(sp);
    const xvState = await streetState(sp);
    const inBox = ([x, y], [w, s, e, n], pad = 1e-4) => w - pad <= x && x <= e + pad && s - pad <= y && y <= n + pad;
    check('search box: a street chosen with ↓ + Enter takes the map to it (zoom ≥ 16, names showing, inside its Centro stretch), lit, with its card; no search is made',
      toXv && zoomBefore < 16 && xvState.zoom >= 16 && xvState.names > 0 && xvState.search === '' && !xvState.pendingHint && !xvState.listOpen &&
        xvState.card === XV && xvState.place === 'Centro, Joinville' && xvState.lit === XV && !!XV_CENTRO && inBox(xvState.center, XV_CENTRO.bbox) &&
        xvState.note === null && xvState.litDrawn.length === 1 && xvState.litDrawn[0] === XV,
      JSON.stringify({ option: xvOpt, zoomBefore: Math.round(zoomBefore * 100) / 100, ...xvState }));
    await axe(sp, 'busca: rua escolhida');
    const litDay = await sp.evaluate(() => window.__demo.map.getPaintProperty('road-highlight', 'line-color'));
    await sp.click('.time-of-day button:has-text("Noite")');
    await sleep(300);
    await waitIdle(sp);
    const litNight = await sp.evaluate(() => ({
      color: window.__demo.map.getPaintProperty('road-highlight', 'line-color'),
      drawn: window.__demo.map.queryRenderedFeatures({ layers: ['road-highlight'] }).length,
    }));
    check('the lit street keeps showing at night, in the night colour', litNight.drawn > 0 && litNight.color !== litDay, `${litDay} → ${JSON.stringify(litNight)}`);
    await axe(sp, 'busca: rua escolhida (noite)');
    await suggestions(sp, 'xv de nov');
    await axe(sp, 'busca: lista de ruas (noite)');
    await sp.keyboard.press('Escape');
    await sp.keyboard.press('Escape');
    await sp.click('.time-of-day button:has-text("Manhã")');
    await sp.click('.street-card .street-card-close');
    await sleep(300);
    await waitIdle(sp);
    const xvClosed = await streetState(sp);
    check('closing the street card turns the light off and gives focus back to the box',
      xvClosed.card === null && xvClosed.lit === null && xvClosed.litDrawn.length === 0 && xvClosed.focus === 'f-bairro-input', JSON.stringify(xvClosed));
    check('no console errors (ruas)', st.errors.length === 0, st.errors.join(' | '));
    await st.ctx.close();

    // ------------------------------------------------ mobile
    const m = await openPage(browser, { width: 390, height: 844 }, 'mobile');
    const mp = m.page;
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('mobile: no horizontal overflow', overflow <= 0, `${overflow}px`);
    const mPitch = await mp.evaluate(() => window.__demo.map.getPitch());
    check('mobile: opens less tilted (more of the city on a tall screen)', Math.abs(mPitch - 45) < 1 && Math.abs(initialCam.pitch - 58) < 1, `${mPitch} / desktop ${initialCam.pitch}`);
    check('mobile: filters collapsed behind toggle', !(await mp.isVisible('#filters')) && (await mp.isVisible('.filters-toggle')));
    await axe(mp, 'celular');
    await mp.screenshot({ path: path.join(SHOTS, 'mobile-map.png') });
    await mp.click('.filters-toggle');
    await sleep(300);
    check('mobile: filters open on toggle', await mp.isVisible('#filters'));
    await mp.screenshot({ path: path.join(SHOTS, 'mobile-filters.png') });
    await mp.click('.filters-toggle');
    await sleep(300);
    await waitIdle(mp);
    const mClicked = await clickSomeListing(mp, ['listing-pins', 'listing-buildings']);
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
    await mp.goto(URL_ + '?empreendimento=cora');
    await mp.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
    await waitIdle(mp);
    const mDev = await mp.evaluate(() => {
      const r = document.querySelector('#dev-panel').getBoundingClientRect();
      return { open: document.querySelector('#dev-panel').classList.contains('open'), top: Math.round(r.top), overflow: document.documentElement.scrollWidth - window.innerWidth };
    });
    check('mobile: the development sheet is half open and leaves the tower visible above it',
      mDev.open && mDev.top > 300 && mDev.top < 600 && mDev.overflow <= 0, JSON.stringify(mDev));
    await axe(mp, 'celular: espelho de vendas');
    await mp.screenshot({ path: path.join(SHOTS, 'mobile-development.png') });
    // a street chosen on a small screen: the filters close, its card is a bar at the bottom, clear of the results pill
    await mp.goto(URL_);
    await mp.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
    await waitIdle(mp);
    await mp.click('.filters-toggle');
    await sleep(300);
    const mXvOpts = await suggestions(mp, 'xv de nov');
    const mListFits = await mp.evaluate(() => {
      const r = document.querySelector('#f-place-list').getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth && document.documentElement.scrollWidth - window.innerWidth <= 0;
    });
    await axe(mp, 'celular: lista de ruas');
    const mXv = mXvOpts.find((o) => o.name === XV && o.sub.startsWith('Centro, Joinville'));
    if (mXv) await mp.click(`#${mXv.id}`);
    await sleep(300);
    await waitIdle(mp);
    const mStreet = await mp.evaluate((point) => {
      const rect = (sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
      };
      const card = rect('.street-card');
      const pill = rect('#results');
      const zoomCtl = rect('.maplibregl-ctrl-bottom-right');
      return {
        filtersOpen: document.body.classList.contains('filters-open'),
        toggle: document.querySelector('.filters-toggle').getAttribute('aria-expanded'),
        card,
        pill,
        clearOfPill: card.top >= pill.bottom || card.bottom <= pill.top,
        inside: card.left >= 0 && card.right <= window.innerWidth && card.bottom <= window.innerHeight,
        controlsAbove: zoomCtl.bottom <= card.top,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        focus: document.activeElement?.className ?? null,
        lit: window.__demo.highlightedStreet,
        // where the stretch's point is on screen: the framing keeps it above the card, on the map
        litAt: (() => {
          const m = window.__demo.map;
          const p = m.project(point);
          const c = m.getCanvas().getBoundingClientRect();
          const el = document.elementFromPoint(p.x + c.left, p.y + c.top);
          return { x: Math.round(p.x + c.left), y: Math.round(p.y + c.top), onMap: el === m.getCanvas(), drawn: m.queryRenderedFeatures([[p.x - 30, p.y - 30], [p.x + 30, p.y + 30]], { layers: ['road-highlight'] }).length };
        })(),
      };
    }, XV_CENTRO?.point ?? [0, 0]);
    check('mobile: the lit street is framed above its card, not hidden by it (Centro stretch of XV de Novembro)',
      !!XV_CENTRO && mStreet.litAt.y > 0 && mStreet.litAt.y < mStreet.card.top && mStreet.litAt.x > 0 && mStreet.litAt.x < 390 &&
        mStreet.litAt.onMap && mStreet.litAt.drawn > 0,
      JSON.stringify({ litAt: mStreet.litAt, cardTop: mStreet.card.top }));
    check('mobile: choosing a street closes the filters; its card sits at the bottom, inside the screen and clear of the results pill',
      !!mXv && mListFits && !mStreet.filtersOpen && mStreet.toggle === 'false' && mStreet.clearOfPill && mStreet.inside && mStreet.controlsAbove &&
        mStreet.overflow <= 0 && mStreet.focus === 'street-card' && mStreet.lit === XV,
      JSON.stringify({ listFits: mListFits, ...mStreet }));
    await axe(mp, 'celular: rua escolhida');
    await mp.click('.street-card .street-card-close');
    await sleep(300);
    const mClosed = await mp.evaluate(() => ({ card: !document.querySelector('.street-card').hidden, focus: document.activeElement?.className ?? null }));
    check('mobile: closing the street card gives focus back to the filters button',
      !mClosed.card && mClosed.focus === 'filters-toggle', JSON.stringify(mClosed));
    check('no console errors (mobile)', m.errors.length === 0, m.errors.join(' | '));
    await m.ctx.close();
  } finally {
    await browser.close();
    server.kill();
  }

  check(`acessibilidade (axe, WCAG 2.2 A/AA): nenhuma violação (${axeStates.join(', ')})`, axeFindings.length === 0, axeFindings.join(' | '));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
