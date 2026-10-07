#!/usr/bin/env node
// Browser verification with Playwright: builds nothing, serves dist/ with `vite preview`,
// runs the checks listed in the README and saves screenshots to docs/screenshots/.
// Usage: npm run build && npm run verify:e2e
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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

async function openPage(browser, viewport, label) {
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
  await page.goto(URL_);
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
      for (let x = r.width * 0.15; x < r.width * 0.6; x += 29) {
        if (map.queryRenderedFeatures([x, y], { layers }).length === 0) return { x: x + r.left, y: y + r.top };
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
    const ctxCount = await renderedCount(page, 'context-buildings');
    const listingCount = await renderedCount(page, 'listing-buildings');
    check('desktop: context building layer rendered', ctxCount > 0, `${ctxCount} features`);
    check('desktop: listing layer rendered', listingCount > 0, `${listingCount} features`);
    const attrib = await page.textContent('.maplibregl-ctrl-attrib');
    check('attribution shows OSM and MapLibre', /OpenStreetMap contributors/.test(attrib) && /MapLibre/.test(attrib), attrib?.trim());
    check('demo banner visible', await page.isVisible('text=Demonstração. Imóveis e valores fictícios.'));
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
    const resultsHidden = await page.evaluate(() => document.querySelector('#results').hidden);
    check('editing filters does NOT change the map', dimBefore === dimAfterEdit && stateBefore === stateAfterEdit && resultsHidden,
      `dimmed ${dimBefore}→${dimAfterEdit}, camera unchanged=${stateBefore === stateAfterEdit}, results hidden=${resultsHidden}`);
    check('"Alterações não aplicadas" hint shown', await page.isVisible('text=Alterações não aplicadas'));
    await page.screenshot({ path: path.join(SHOTS, 'desktop-filters-pending.png') });

    await page.click('button:has-text("Buscar")');
    await sleep(300);
    await waitIdle(page);
    const header = await page.textContent('#results .results-head strong');
    const landCount = await page.evaluate(() => window.__demo.listingIds.filter((id) => id.startsWith('land')).length);
    const dimAfterApply = await page.evaluate(() =>
      window.__demo.map.querySourceFeatures('listings').filter((f) => f.properties.matched === false).length,
    );
    check('"Buscar" applies filters (results list + dimmed listings)',
      header?.startsWith(`${landCount} `) && dimAfterApply > 0, `${header}; ${dimAfterApply} dimmed source features`);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-search-results.png') });

    // result list click flies + opens drawer
    await page.click('#results li button >> nth=0');
    await sleep(300);
    await waitIdle(page);
    check('clicking a result opens the drawer', await page.evaluate(() => document.querySelector('#drawer').classList.contains('open')));
    await page.screenshot({ path: path.join(SHOTS, 'desktop-result-land-closeup.png') });
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
    const sheet = await mp.evaluate(() => {
      const r = document.querySelector('#drawer').getBoundingClientRect();
      return { open: document.querySelector('#drawer').classList.contains('open'), top: r.top, bottom: r.bottom, width: r.width };
    });
    check('mobile: drawer opens as bottom sheet', !!mClicked && sheet.open && sheet.width === 390 && Math.abs(sheet.bottom - 844) < 2 && sheet.top > 100,
      JSON.stringify(sheet));
    await sleep(400);
    await mp.screenshot({ path: path.join(SHOTS, 'mobile-drawer.png') });
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
