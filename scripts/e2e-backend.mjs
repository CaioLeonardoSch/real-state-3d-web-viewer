#!/usr/bin/env node
// Browser check of the site connected to the LOCAL Supabase (`npm run db:start` first):
// builds dist-backend/ with the local URL and key, then: sign-up → client → announce with photos → the public
// sees it (without the private fields) → lower the price → delete. Never point this at a production project.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'dist-backend';
const PORT = 4179;
const URL_ = `http://127.0.0.1:${PORT}/`;
const EXEC = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(status.API_URL)) throw new Error(`${status.API_URL} não é o Supabase local`);
execFileSync('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir'], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, VITE_SUPABASE_URL: status.API_URL, VITE_SUPABASE_ANON_KEY: status.ANON_KEY },
});

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function waitIdle(page) {
  await page.waitForFunction(() => {
    const m = window.__demo?.map;
    return m && m.loaded() && !m.isMoving() && m.areTilesLoaded();
  }, null, { timeout: 30000 });
  await sleep(400);
}

async function open(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL_);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
  await waitIdle(page);
  return { ctx, page, errors };
}

const server = spawn('npx', ['vite', 'preview', '--outDir', OUT, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const browser = await chromium.launch({ executablePath: EXEC, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL_)).ok) break;
    } catch {}
    await sleep(500);
  }
  const { page, errors } = await open(browser);
  const rows = () => page.evaluate(() => document.querySelectorAll('#results button[data-id]').length);
  const before = await rows();

  // ---- account
  check('"Entrar" aparece quando há backend', await page.isVisible('.account-toggle'));
  await page.click('.add-toggle');
  await sleep(300);
  const note = await page.textContent('#account-panel .account-note');
  check('"Anunciar" sem login abre a conta e explica', /Entre na sua conta/.test(note ?? ''), note);
  await page.click('#account-panel [data-action="switch"]');
  const email = `corretor-${Date.now().toString(36)}@teste.local`;
  await page.fill('#account-panel input[name="name"]', 'Corretor Teste');
  await page.fill('#account-panel input[name="email"]', email);
  await page.fill('#account-panel input[name="password"]', 'senha-segura-123');
  await page.click('#account-panel button[type="submit"]');
  await page.waitForSelector('#account-panel input[name="orgName"]', { timeout: 15000 });
  await page.fill('#account-panel input[name="orgName"]', 'Imobiliária Teste Ação');
  const slug = await page.inputValue('#account-panel input[name="orgSlug"]');
  await page.fill('#account-panel input[name="orgSlug"]', `${slug}-${Date.now().toString(36)}`);
  await page.click('#account-panel button[type="submit"]');
  await page.waitForFunction(() => /cadastrada/.test(document.querySelector('#account-panel .account-note')?.textContent ?? ''), null, { timeout: 15000 });
  const toggle = await page.textContent('.account-toggle');
  check('criar conta e cadastrar a imobiliária', slug === 'imobiliaria-teste-acao' && toggle === 'Imobiliária Teste Ação', `${slug} / ${toggle}`);
  await page.keyboard.press('Escape');

  // ---- announce on a grey building, close up
  const META = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', 'meta.json'), 'utf8'));
  await page.evaluate((c) => window.__demo.map.jumpTo({ center: c, zoom: 16.3, pitch: 50, bearing: 0 }), META.center);
  await waitIdle(page);
  await page.click('.add-toggle');
  await sleep(300);
  const orgShown = await page.textContent('#add-panel .a-section:has(legend:text("Anunciante")) strong');
  await page.selectOption('#add-panel select[name="type"]', 'house');
  await page.fill('#add-panel input[name="price"]', '880000');
  await page.fill('#add-panel input[name="areaM2"]', '160');
  await page.fill('#add-panel input[name="title"]', 'Casa publicada no backend');
  await page.click('#add-panel [data-action="pick"]');
  await sleep(200);
  const candidates = await page.evaluate(() => {
    const map = window.__demo.map;
    const r = map.getCanvas().getBoundingClientRect();
    const out = [];
    for (let y = r.height * 0.25; y < r.height * 0.85; y += 24)
      for (let x = r.width * 0.3; x < r.width * 0.7; x += 24) {
        if (document.elementFromPoint(x + r.left, y + r.top) !== map.getCanvas()) continue;
        const h = map.queryRenderedFeatures([x, y])[0];
        if (h?.layer.id === 'context-buildings' && h.properties.residential === true)
          out.push({ x: x + r.left, y: y + r.top, d: Math.hypot(x - r.width / 2, y - r.height / 2) });
      }
    return out.sort((a, b) => a.d - b.d);
  });
  let picked = false;
  for (const c of candidates.slice(0, 40)) {
    await page.mouse.click(c.x, c.y);
    await sleep(250);
    if ((await page.textContent('#add-panel .a-place-status'))?.startsWith('✓')) {
      picked = true;
      break;
    }
  }
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#add-panel input[name="photos"]', [1, 2].map((i) => ({ name: `f${i}.png`, mimeType: 'image/png', buffer: PNG })));
  await page.waitForFunction(() => document.querySelectorAll('#add-panel .a-photos img').length === 2);
  if (!(await page.inputValue('#add-panel input[name="bairro"]'))) await page.fill('#add-panel input[name="bairro"]', 'Centro');
  await page.fill('#add-panel input[name="street"]', 'Rua do Teste');
  await page.fill('#add-panel input[name="number"]', '123');
  await page.selectOption('#add-panel select[name="addressDisplay"]', 'full');
  await page.fill('#add-panel input[name="creci"]', '99999-J');
  await page.fill('#add-panel input[name="whatsapp"]', '(47) 90000-1111');
  await page.click('#add-panel button:has-text("Salvar anúncio")');
  await page.waitForFunction(() => document.querySelector('#drawer.open h2')?.textContent === 'Casa publicada no backend', null, { timeout: 20000 });
  await waitIdle(page);
  const saved = await page.evaluate(() => ({
    badge: document.querySelector('#drawer .badge-user')?.textContent,
    photo: document.querySelector('#drawer .gallery img')?.getAttribute('src') ?? '',
    pos: document.querySelector('#drawer .gal-pos')?.textContent,
    url: location.search,
  }));
  check('anúncio salvo no servidor, com as fotos no storage', picked && orgShown === 'Imobiliária Teste Ação' && saved.badge === 'Seu anúncio' &&
    saved.photo.startsWith('http://127.0.0.1:54321/storage/v1/object/public/listing-photos/') && saved.pos === '1/2', JSON.stringify(saved));
  const id = new URLSearchParams(saved.url).get('imovel');

  // ---- the public (another browser, not logged in)
  const visitor = await open(browser);
  const pub = await visitor.page.evaluate((id) => ({
    rows: document.querySelectorAll('#results button[data-id]').length,
    has: !!document.querySelector(`#results button[data-id="${id}"]`),
  }), id);
  await visitor.page.click(`#results button[data-id="${id}"]`);
  await sleep(600);
  const pubDrawer = await visitor.page.evaluate(() => ({
    address: document.querySelector('#drawer .drawer-address')?.textContent,
    mine: !!document.querySelector('#drawer .badge-user'),
    manage: !!document.querySelector('#drawer .manage'),
    whatsapp: !!document.querySelector('#drawer .btn-whatsapp'),
  }));
  check('o visitante vê o anúncio publicado, sem ferramentas de gestão', pub.has && pub.rows === before + 1 && /Rua do Teste, 123/.test(pubDrawer.address ?? '') &&
    !pubDrawer.mine && !pubDrawer.manage && pubDrawer.whatsapp, JSON.stringify({ ...pub, ...pubDrawer }));

  // ---- lower the price (server records the history and the reduction)
  await page.fill('#drawer .manage-form input[name="price"]', '800000');
  await page.click('#drawer .manage-form button[type="submit"]');
  await page.waitForFunction(() => !!document.querySelector('#drawer .price-was s'), null, { timeout: 15000 });
  const managed = await page.evaluate(() => ({
    was: document.querySelector('#drawer .price-was s')?.textContent,
    cut: document.querySelector('#drawer .price-cut')?.textContent,
    history: document.querySelectorAll('#drawer .price-history li').length,
  }));
  check('baixar o preço gera o preço riscado e o histórico (pelo servidor)', /880\.000/.test(managed.was ?? '') && managed.cut === '−9%' && managed.history === 2, JSON.stringify(managed));
  await visitor.page.reload();
  await visitor.page.waitForSelector('body[data-ready="true"]');
  await visitor.page.click(`#results button[data-id="${id}"]`);
  await sleep(600);
  const pubCut = await visitor.page.evaluate(() => ({
    was: document.querySelector('#drawer .price-was s')?.textContent,
    history: document.querySelectorAll('#drawer .price-history li').length,
  }));
  check('o visitante vê a redução, mas não o histórico', /880\.000/.test(pubCut.was ?? '') && pubCut.history === 0, JSON.stringify(pubCut));

  // ---- session survives a reload; delete
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  await waitIdle(page);
  const stillIn = await page.textContent('.account-toggle');
  page.once('dialog', (d) => d.accept());
  await page.click(`#results button[data-id="${id}"]`);
  await sleep(600);
  await page.click('#drawer [data-action="delete"]');
  await page.waitForFunction((id) => !document.querySelector(`#results button[data-id="${id}"]`), id, { timeout: 15000 });
  check('a sessão continua após recarregar, e o anúncio pode ser excluído', stillIn === 'Imobiliária Teste Ação' && (await rows()) === before, stillIn);
  check('sem erros no console', errors.length === 0 && visitor.errors.length === 0, [...errors, ...visitor.errors].join(' | '));
  await visitor.ctx.close();
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
