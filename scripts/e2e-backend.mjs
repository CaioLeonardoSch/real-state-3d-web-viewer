#!/usr/bin/env node
// Browser check of the site connected to the LOCAL Supabase (`npm run db:start` first):
// builds dist-backend/ with the local URL and key, then: support creates the client and its administrator → the
// administrator creates a broker (temporary passwords, changed on the first login) → announce with photos → the public
// sees it (without the private fields) → lower the price → delete. Never point this at a production project.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { cli, supabaseStatus } from './lib/cli.mjs';
import { promisify } from 'node:util';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { startLocalFunctions } from './lib/local-functions.mjs';
import { freshTotp } from './lib/totp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'dist-backend';
const PORT = 4179;
const URL_ = `http://127.0.0.1:${PORT}/`;
// the 3D map, where the account panel opens; the root is the client's site
const MAP_ = `${URL_}mapa.html`;
const EXEC = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The open listing's details (description, photos, history) arrived from the server. */
const detailReady = (p) => p.waitForFunction(() => !!document.querySelector('#drawer.open') && !document.querySelector('#drawer .detail-loading'), null, { timeout: 15000 });
/** Authenticator-app codes already typed: the next one waits for a new code (Supabase may refuse a repeat). */
const usedCodes = new Set();

const status = supabaseStatus();
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(status.API_URL)) throw new Error(`${status.API_URL} não é o Supabase local`);
execFileSync(...cli('vite', ['build', '--outDir', OUT, '--emptyOutDir']), {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, VITE_SUPABASE_URL: status.API_URL, VITE_SUPABASE_ANON_KEY: status.ANON_KEY },
});

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Screenshot for docs/screenshots, once the 3D map of the page (or of an embedded frame) has stopped: with the relief
 * each frame is slow in software WebGL (CI) while the map still draws, and a shot then waits for a frame for a long
 * time. A map that does not settle in time is shot as it is.
 */
async function shot(page, name) {
  for (const frame of page.frames()) {
    await frame
      .waitForFunction(() => {
        const m = window.__demo?.map;
        return !m || (m.loaded() && !m.isMoving() && m.areTilesLoaded());
      }, null, { timeout: 30000 })
      .catch(() => {});
  }
  return page.screenshot({ path: path.join(SHOTS, name), timeout: 90000 });
}

async function waitIdle(page) {
  await page.waitForFunction(() => {
    const m = window.__demo?.map;
    return m && m.loaded() && !m.isMoving() && m.areTilesLoaded();
  }, null, { timeout: 30000 });
  await sleep(400);
}

async function open(browser, url = MAP_) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
  await waitIdle(page);
  return { ctx, page, errors };
}

// edge functions with a fake e-mail provider (lead notifications)
const fns = await startLocalFunctions(status.API_URL, URL_);
// with the back end in its environment, the preview also answers clients' own domains (vite.config.ts, clientDomains)
// a server left on the port (e.g. the demo build, or one from an interrupted run) would answer in place of ours
if (await fetch(URL_).then(() => true, () => false)) throw new Error(`a porta ${PORT} está ocupada por outro servidor`);
// vite itself rather than through npx, so that kill() stops the server and does not leave it holding the port
const server = spawn(...cli('vite', ['preview', '--outDir', OUT, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1']), {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, VITE_SUPABASE_URL: status.API_URL, VITE_SUPABASE_ANON_KEY: status.ANON_KEY },
});
const browser = await chromium.launch({ executablePath: EXEC, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL_)).ok) break;
    } catch {}
    await sleep(500);
  }
  const tag = Date.now().toString(36);
  const PASSWORD = 'senha-segura-123';

  // ---- nobody creates an account alone: only "Entrar", and "Esqueci minha senha"
  const stranger = await open(browser);
  check('"Entrar" aparece quando há backend', await stranger.page.isVisible('.account-toggle'));
  await stranger.page.click('.add-toggle');
  await sleep(300);
  const note = await stranger.page.textContent('#account-panel .account-note');
  check('"Anunciar" sem login abre a conta e explica', /Entre na sua conta/.test(note ?? ''), note);
  const loginUi = await stranger.page.evaluate(() => ({
    name: !!document.querySelector('#account-panel input[name="name"]'),
    link: document.querySelector('#account-panel [data-action="switch"]')?.textContent ?? '',
  }));
  await stranger.page.click('#account-panel [data-action="switch"]');
  await stranger.page.fill('#account-panel input[name="email"]', `sem-conta-${tag}@teste.local`);
  await stranger.page.click('#account-panel button[type="submit"]');
  await stranger.page.waitForFunction(() => /link para escolher a senha nova/.test(document.querySelector('#account-panel .account-note')?.textContent ?? ''), null, { timeout: 15000 });
  check('sem "criar conta": só entrar; "Esqueci minha senha" manda o link (sem dizer se o e-mail tem conta)', !loginUi.name && /Esqueci/.test(loginUi.link), JSON.stringify(loginUi));
  await stranger.ctx.close();

  // ---- the platform's support staff creates the client and its administrator
  const staffEmail = `suporte-${tag}@teste.local`;
  const svc = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const created = await svc.auth.admin.createUser({ email: staffEmail, password: PASSWORD, email_confirm: true });
  await svc.from('platform_staff').insert({ user_id: created.data.user.id });
  const staff = await open(browser);
  await staff.page.click('.account-toggle');
  await staff.page.fill('#account-panel input[name="email"]', staffEmail);
  await staff.page.fill('#account-panel input[name="password"]', PASSWORD);
  await staff.page.click('#account-panel button[type="submit"]');
  // support powers need two-step verification: the staff member turns it on with an authenticator app first
  await staff.page.waitForSelector('#account-panel [data-action="mfa-on"]', { timeout: 15000 });
  const staffNote = await staff.page.textContent('#account-panel .account-note');
  const orgFormBefore = await staff.page.isVisible('#account-panel form[data-form="org"]');
  await staff.page.click('#account-panel [data-action="mfa-on"]');
  await staff.page.waitForSelector('#account-panel input[name="totp-secret"]', { timeout: 15000 });
  const staffSecret = await staff.page.inputValue('#account-panel input[name="totp-secret"]');
  const qr = (await staff.page.getAttribute('#account-panel .mfa-setup img', 'src')) ?? '';
  await staff.page.fill('#account-panel form[data-form="mfa-confirm"] input[name="code"]', await freshTotp(staffSecret, usedCodes));
  await staff.page.click('#account-panel form[data-form="mfa-confirm"] button[type="submit"]');
  await staff.page.waitForSelector('#account-panel form[data-form="org"]', { timeout: 15000 });
  check('suporte: sem a verificação em duas etapas não atende; ativa pelo QR code (ou pela chave) e passa a atender',
    /obrigatória/.test(staffNote ?? '') && !orgFormBefore && qr.startsWith('data:image/svg+xml') && /^[A-Z2-7]{16,}$/.test(staffSecret),
    JSON.stringify({ staffNote, orgFormBefore, qr: qr.slice(0, 30) }));
  const ownerEmail = `dona-${tag}@teste.local`;
  await staff.page.fill('#account-panel input[name="orgName"]', 'Imobiliária Teste Ação');
  const slug = await staff.page.inputValue('#account-panel input[name="orgSlug"]');
  await staff.page.fill('#account-panel input[name="orgSlug"]', `${slug}-${tag}`);
  await staff.page.fill('#account-panel input[name="ownerName"]', 'Dona Teste');
  await staff.page.fill('#account-panel input[name="ownerEmail"]', ownerEmail);
  await staff.page.click('#account-panel form[data-form="org"] button[type="submit"]');
  await staff.page.waitForSelector('#account-panel .org-result input', { timeout: 30000 }).catch(async (e) => {
    throw new Error(`${e.message}\npainel: ${(await staff.page.textContent('#account-panel'))?.replace(/\s+/g, ' ').slice(0, 800)}`);
  });
  const ownerTemp = await staff.page.inputValue('#account-panel .org-result input');
  await shot(staff.page, 'backend-suporte.png');
  check('o suporte cadastra a imobiliária e o administrador dela, e vê a senha provisória (uma vez)',
    slug === 'imobiliaria-teste-acao' && /^[A-Za-z2-9]{12}$/.test(ownerTemp), ownerTemp.replace(/./g, '•'));
  await staff.ctx.close();
  const clientId = (await svc.from('organizations').select('id').eq('slug', `${slug}-${tag}`).single()).data.id;

  /** Logs in with the temporary password: nothing but "choose your password" until it is changed. */
  const firstLogin = async (p, email, temp, shotName) => {
    await p.click('.account-toggle');
    await p.fill('#account-panel input[name="email"]', email);
    await p.fill('#account-panel input[name="password"]', temp);
    await p.click('#account-panel button[type="submit"]');
    await p.waitForSelector('#account-panel form[data-form="new-password"]', { timeout: 15000 });
    if (shotName) await shot(p, shotName);
    const locked = await p.evaluate(() => document.querySelectorAll('#account-panel form').length === 1);
    await p.fill('#account-panel form[data-form="new-password"] input[name="password"]', PASSWORD);
    await p.fill('#account-panel form[data-form="new-password"] input[name="again"]', 'outra-senha-123');
    await p.click('#account-panel form[data-form="new-password"] button[type="submit"]');
    await p.waitForSelector('#account-panel form[data-form="new-password"] .a-error:not([hidden])');
    const mismatch = await p.textContent('#account-panel form[data-form="new-password"] .a-error');
    await p.fill('#account-panel form[data-form="new-password"] input[name="again"]', PASSWORD);
    await p.click('#account-panel form[data-form="new-password"] button[type="submit"]');
    await p.waitForSelector('#account-panel form[data-form="new-password"]', { state: 'detached', timeout: 15000 });
    const marked = (await svc.from('password_change_required').select('user_id')).data ?? [];
    return { locked, mismatch, cleared: !(await svc.auth.admin.listUsers({ perPage: 1000 })).data.users.some((u) => u.email === email && marked.some((m) => m.user_id === u.id)) };
  };

  // ---- the administrator enters with the temporary password and must choose their own first
  const owner = await open(browser);
  const ownerFirst = await firstLogin(owner.page, ownerEmail, ownerTemp, 'backend-senha-nova.png');
  check('o administrador entra com a senha provisória e só segue depois de escolher a dele',
    ownerFirst.locked && /não são iguais/.test(ownerFirst.mismatch ?? '') && ownerFirst.cleared, JSON.stringify(ownerFirst));

  // ---- the administrator creates a broker's access from the team screen
  const brokerEmail = `corretor-${tag}@teste.local`;
  await owner.page.waitForSelector('#account-panel form[data-form="member"]', { timeout: 15000 });
  const roleField = await owner.page.evaluate(() => document.querySelector('#account-panel form[data-form="member"] [name="role"]')?.getAttribute('type'));
  await owner.page.fill('#account-panel form[data-form="member"] input[name="name"]', 'Corretor Teste');
  await owner.page.fill('#account-panel form[data-form="member"] input[name="email"]', brokerEmail);
  await owner.page.click('#account-panel form[data-form="member"] button[type="submit"]');
  await owner.page.waitForSelector('#account-panel .member-result input', { timeout: 30000 });
  const brokerTemp = await owner.page.inputValue('#account-panel .member-result input');
  await shot(owner.page, 'backend-equipe.png');
  const team0 = await owner.page.evaluate(() => [...document.querySelectorAll('#account-panel li[data-user]')].map((li) => li.textContent.replace(/\s+/g, ' ')));
  check('o administrador cria o acesso de um corretor (só corretor) e vê a senha provisória',
    roleField === 'hidden' && /^[A-Za-z2-9]{12}$/.test(brokerTemp) && brokerTemp !== ownerTemp && team0.some((t) => t.includes('Corretor Teste')), JSON.stringify(team0));
  // one administrator per agency: even through the function, the administrator cannot create another
  const asOwner = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  await asOwner.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD });
  const second = await asOwner.functions.invoke('create-user', { body: { org_id: clientId, email: `outro-${tag}@teste.local`, name: 'Outro', role: 'owner' } });
  const stray = (await svc.auth.admin.listUsers({ perPage: 1000 })).data.users.some((u) => u.email === `outro-${tag}@teste.local`);
  check('um administrador por imobiliária: o administrador não cria outro (nem pela função)', !!second.error && !stray, String(second.error?.context?.status ?? second.error));

  // ---- "Importação automática (XML)": the owner sets the CRM's feed and asks for a reading now
  await owner.page.click('#account-panel details[data-section="feed"] summary');
  await owner.page.fill('#account-panel form[data-form="feed"] input[name="url"]', 'crm.exemplo/feed.xml');
  await owner.page.click('#account-panel form[data-form="feed"] [data-action="import-now"]');
  const feedErr = await owner.page.textContent('#account-panel form[data-form="feed"] .a-error');
  await owner.page.fill('#account-panel form[data-form="feed"] input[name="url"]', 'https://crm.exemplo/feed.xml');
  await owner.page.click('#account-panel form[data-form="feed"] [data-action="import-now"]');
  await owner.page.waitForSelector('#account-panel details[data-section="feed"] .account-note', { timeout: 15000 });
  const feedUi = await owner.page.evaluate(() => ({
    note: document.querySelector('#account-panel details[data-section="feed"] .account-note')?.textContent ?? '',
    url: document.querySelector('#account-panel form[data-form="feed"] input[name="url"]')?.value,
    remove: !!document.querySelector('#account-panel [data-action="remove-feed"]'),
  }));
  check('importação automática: o dono informa o endereço do XML e pede "Importar agora" (endereço sem https recusado)',
    /https:\/\//.test(feedErr ?? '') && /até 1 hora/.test(feedUi.note) && feedUi.url === 'https://crm.exemplo/feed.xml' && feedUi.remove,
    JSON.stringify({ feedErr, ...feedUi }));

  // ---- the broker enters with the temporary password, chooses their own, and announces
  const { page, errors } = await open(browser);
  const rows = () => page.evaluate(() => document.querySelectorAll('#results button[data-id]').length);
  const before = await rows();
  const brokerFirst = await firstLogin(page, brokerEmail, brokerTemp);
  const brokerUi = await page.evaluate(() => ({ team: !!document.querySelector('#account-panel form[data-form="member"]') }));
  check('o corretor entra com a senha provisória e escolhe a dele; corretor não vê a gestão da equipe',
    brokerFirst.locked && brokerFirst.cleared && !brokerUi.team, JSON.stringify({ ...brokerFirst, ...brokerUi }));
  await owner.page.reload();
  await owner.page.waitForSelector('body[data-ready="true"]');
  await owner.page.click('.account-toggle');
  await owner.page.waitForSelector('#account-panel li[data-user]');
  const team = await owner.page.evaluate(() => [...document.querySelectorAll('#account-panel li[data-user]')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
  check('o dono vê o corretor na equipe', team.some((t) => t.includes('Corretor Teste')), JSON.stringify(team));
  await owner.ctx.close();
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
  await detailReady(page);
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

  // ---- the public (another browser, not logged in). One database for every client, each one isolated: the platform's
  // map lists no client's listings (another client would see them); the visitor finds it on the client's own site.
  const orgId = (await svc.from('listings').select('org_id').eq('id', id).single()).data.org_id;
  const platform = await open(browser);
  const onPlatform = await platform.page.evaluate((id) => !!document.querySelector(`#results button[data-id="${id}"]`), id);
  const viaRpc = (await createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } }).rpc('map_listings')).data;
  await platform.ctx.close();
  check('o mapa da plataforma não mostra os anúncios dos clientes ao público (nem map_listings sem o cliente)',
    !onPlatform && Array.isArray(viaRpc) && viaRpc.length === 0, JSON.stringify({ onPlatform, viaRpc: viaRpc?.length }));
  const visitor = await open(browser, `${MAP_}?embed=1&site=${orgId}&imovel=${id}`);
  await detailReady(visitor.page);
  const pub = await visitor.page.evaluate((id) => ({
    rows: document.querySelectorAll('#results button[data-id]').length,
    has: !!document.querySelector(`#results button[data-id="${id}"]`),
  }), id);
  const pubDrawer = await visitor.page.evaluate(() => ({
    address: document.querySelector('#drawer .drawer-address')?.textContent,
    mine: !!document.querySelector('#drawer .badge-user'),
    manage: !!document.querySelector('#drawer .manage'),
    whatsapp: !!document.querySelector('#drawer .btn-whatsapp'),
  }));
  check('no mapa do site da imobiliária, o visitante vê o anúncio publicado, sem ferramentas de gestão', pub.has && pub.rows === 1 && /Rua do Teste, 123/.test(pubDrawer.address ?? '') &&
    !pubDrawer.mine && !pubDrawer.manage && pubDrawer.whatsapp, JSON.stringify({ ...pub, ...pubDrawer }));

  // ---- the visitor sends a message and clicks WhatsApp; the broker gets it
  // every local run comes from the same origin: age earlier test leads so the 5-per-10-minutes limit does not apply
  await svc.from('leads').update({ created_at: '2020-01-01T00:00:00Z' }).gt('created_at', '2020-01-02');
  // embedded in the site the drawer is slim (the message form is on the site's listing page): the drawer's own form,
  // used on the map page, is exercised here by leaving the slim mode
  const slim = await visitor.page.isHidden('#drawer .lead-box');
  await visitor.page.evaluate(() => document.body.classList.remove('embed'));
  await visitor.page.click('#drawer .lead-box summary');
  await visitor.page.fill('#drawer .lead-form input[name="name"]', 'Maria Compradora');
  await visitor.page.fill('#drawer .lead-form input[name="phone"]', '(47) 98888-7777');
  await visitor.page.click('#drawer .lead-form button[type="submit"]');
  const refused = await visitor.page.textContent('#drawer .lead-form .a-error');
  await visitor.page.check('#drawer .lead-form input[name="consent"]');
  await visitor.page.check('#drawer .lead-form input[name="visit"]');
  await visitor.page.selectOption('#drawer .lead-form select[name="visit_period"]', 'tarde');
  await visitor.page.click('#drawer .lead-form button[type="submit"]');
  await visitor.page.waitForSelector('#drawer .lead-done:not([hidden])', { timeout: 15000 });
  const done = await visitor.page.textContent('#drawer .lead-done');
  await shot(visitor.page, 'backend-contato-enviado.png');
  const [popup] = await Promise.all([visitor.ctx.waitForEvent('page'), visitor.page.click('#drawer .btn-whatsapp')]);
  await popup.close();
  check('o visitante pede uma visita (só com a autorização da LGPD) e clica no WhatsApp',
    slim && /autorização/.test(refused ?? '') && /Pedido de visita enviado, Maria!/.test(done ?? ''), `${slim} / ${refused} / ${done}`);
  let mail;
  for (let i = 0; i < 30 && !mail; i++) {
    mail = fns?.mails().find((m) => m.text?.includes('Maria Compradora'));
    if (!mail) await sleep(500);
  }
  check('o corretor recebe o aviso por e-mail (provedor falso), com WhatsApp do visitante, link do anúncio e a visita pedida',
    !!fns && mail?.to?.[0] === brokerEmail && /wa\.me\/5547988887777/.test(mail?.text ?? '') && mail?.text?.includes(`?imovel=${id}`) &&
      /^Pedido de visita:/.test(mail?.subject ?? '') && /Visita pedida: .+\nHorário: Tarde/.test(mail?.text ?? ''),
    JSON.stringify(mail ? { to: mail.to, subject: mail.subject } : { fns: !!fns }));
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForSelector('.account-toggle .lead-badge', { timeout: 15000 });
  const badge = await page.textContent('.account-toggle .lead-badge');
  await page.click('.account-toggle');
  await page.click('#account-panel details[data-section="leads"] summary');
  await page.waitForSelector('#account-panel .lead-item', { timeout: 15000 });
  const leadUi = await page.evaluate(() => ({
    items: document.querySelectorAll('#account-panel .lead-item').length,
    name: document.querySelector('#account-panel .lead-item strong')?.textContent,
    wa: document.querySelector('#account-panel .lead-contact a')?.getAttribute('href') ?? '',
    clicks: document.querySelector('#account-panel details[data-section="leads"] .a-hint')?.textContent ?? '',
  }));
  await shot(page, 'backend-contatos.png');
  await page.selectOption('#account-panel .lead-item select[name="status"]', 'contacted');
  await page.waitForFunction(() => !document.querySelector('.account-toggle .lead-badge'), null, { timeout: 15000 });
  check('o corretor vê o contato na conta (contador no topo), responde pelo WhatsApp e muda a situação',
    badge === '1' && leadUi.items === 1 && leadUi.name === 'Maria Compradora' && leadUi.wa.startsWith('https://wa.me/5547988887777') &&
      /1 clique no WhatsApp/.test(leadUi.clicks),
    JSON.stringify({ badge, ...leadUi }));

  check('o corretor não vê a importação automática (só administradores)', !(await page.$('#account-panel details[data-section="feed"]')));

  // ---- "Desempenho dos anúncios": the visitor's view, WhatsApp click and message on the broker's listing
  await page.click('#account-panel details[data-section="stats"] summary');
  await page.waitForSelector('#account-panel .stats-table tbody tr', { timeout: 15000 });
  const statsUi = await page.evaluate((lid) => {
    const tr = document.querySelector(`#account-panel .stats-table [data-open="${lid}"]`)?.closest('tr');
    return { cells: [...(tr?.querySelectorAll('td') ?? [])].map((td) => td.textContent), total: document.querySelector('#account-panel .stats-total')?.textContent ?? '' };
  }, id);
  check('desempenho: o corretor vê a visualização, o clique no WhatsApp e a mensagem do visitante no anúncio',
    JSON.stringify(statsUi.cells) === '["1","1","1"]' && /no mapa/.test(statsUi.total), JSON.stringify(statsUi));

  // ---- painel.html: the same management on a page of its own, without the map (same session)
  const panel = await page.context().newPage();
  const panelErrs = [];
  panel.on('pageerror', (e) => panelErrs.push(String(e)));
  await panel.goto(`${URL_}painel.html`);
  await panel.waitForSelector(`#account-panel .listing-row[data-listing="${id}"]`, { timeout: 20000 });
  // the count comes with the list (the panel may draw itself again when the session is read)
  await panel.waitForFunction(() => /contato/.test(document.querySelector('#account-panel details[data-section="leads"] .list-count')?.textContent ?? ''), null, { timeout: 20000 });
  const pUi = await panel.evaluate(() => ({
    title: document.querySelector('#account-title')?.textContent,
    map: !!document.querySelector('#map'),
    count: document.querySelector('#account-panel details[data-section="leads"] .list-count')?.textContent ?? '',
  }));
  await panel.fill('#account-panel form[data-filter="leads"] input[name="q"]', 'ninguém com esse nome');
  await panel.waitForFunction(() => !document.querySelector('#account-panel .lead-item'), null, { timeout: 15000 });
  await panel.fill('#account-panel form[data-filter="leads"] input[name="q"]', 'Maria');
  await panel.waitForSelector('#account-panel .lead-item', { timeout: 15000 });
  const [csvFile] = await Promise.all([panel.waitForEvent('download'), panel.click('#account-panel [data-action="export"]')]);
  const csv = readFileSync(await csvFile.path(), 'utf8');
  await Promise.all([panel.waitForURL(/mapa\.html\?imovel=/), panel.click(`#account-panel .listing-row[data-listing="${id}"] [data-action="open"]`)]);
  check('painel.html: gestão sem o mapa — anúncios e contatos, busca, planilha (CSV) e "Ver no mapa"',
    pUi.title === 'Gestão' && !pUi.map && /1 contato/.test(pUi.count) && csv.startsWith('\uFEFFData;Nome') && csv.includes('Maria Compradora') &&
      panel.url().includes(`imovel=${id}`) && panelErrs.length === 0,
    JSON.stringify({ ...pUi, maria: csv.includes('Maria Compradora'), url: panel.url(), errs: panelErrs }));
  await panel.close();
  await page.keyboard.press('Escape');
  await page.click(`#results button[data-id="${id}"]`);
  await sleep(600);
  await detailReady(page);

  // ---- lower the price (server records the history and the reduction)
  await page.fill('#drawer .manage-form input[name="price"]', '800000');
  await page.click('#drawer .manage-form button[type="submit"]');
  await page.waitForFunction(() => !!document.querySelector('#drawer .price-was s'), null, { timeout: 15000 });
  await detailReady(page);
  const managed = await page.evaluate(() => ({
    was: document.querySelector('#drawer .price-was s')?.textContent,
    cut: document.querySelector('#drawer .price-cut')?.textContent,
    history: document.querySelectorAll('#drawer .price-history li').length,
  }));
  check('baixar o preço gera o preço riscado e o histórico (pelo servidor)', /880\.000/.test(managed.was ?? '') && managed.cut === '−9%' && managed.history === 2, JSON.stringify(managed));
  await visitor.page.reload();
  await visitor.page.waitForSelector('body[data-ready="true"]');
  await detailReady(visitor.page);
  const pubCut = await visitor.page.evaluate(() => ({
    was: document.querySelector('#drawer .price-was s')?.textContent,
    history: document.querySelectorAll('#drawer .price-history li').length,
  }));
  check('o visitante vê a redução, mas não o histórico', /880\.000/.test(pubCut.was ?? '') && pubCut.history === 0, JSON.stringify(pubCut));

  // ---- full edit: title, one photo out and one in, address down to the street
  await page.click('#drawer [data-action="edit"]');
  await page.waitForSelector('#add-panel:not([hidden]) input[name="title"]');
  const editPhotos = await page.evaluate(() => document.querySelectorAll('#add-panel .a-photos img').length);
  await page.fill('#add-panel input[name="title"]', 'Casa editada no backend');
  await page.click('#add-panel [data-remove="0"]');
  await page.setInputFiles('#add-panel input[name="photos"]', [{ name: 'nova.png', mimeType: 'image/png', buffer: PNG }]);
  await page.waitForFunction(() => document.querySelectorAll('#add-panel .a-photos img').length === 2);
  await page.click('#add-panel input[name="cover"][value="1"]');
  await page.selectOption('#add-panel select[name="addressDisplay"]', 'street');
  await page.click('#add-panel button:has-text("Salvar alterações")');
  await page.waitForFunction(() => document.querySelector('#drawer.open h2')?.textContent === 'Casa editada no backend', null, { timeout: 20000 });
  await detailReady(page);
  const editedMine = await page.evaluate(() => ({
    pos: document.querySelector('#drawer .gal-pos')?.textContent,
    strip: [...document.querySelectorAll('#drawer .gal-strip img')].map((i) => i.getAttribute('src')),
    was: document.querySelector('#drawer .price-was s')?.textContent,
  }));
  const files = await svc.storage.from('listing-photos').list(editedMine.strip[0]?.split('/listing-photos/')[1]?.split('/').slice(0, 2).join('/'));
  check('edição completa: título, fotos (com miniaturas) e capa salvos no servidor; a foto removida sai do storage',
    editPhotos === 2 && editedMine.pos === '1/2' && editedMine.strip.length === 2 && editedMine.strip.every((u) => /-mini\.jpg$/.test(u ?? '')) &&
      /880\.000/.test(editedMine.was ?? '') && files.data?.length === 4,
    JSON.stringify({ editPhotos, ...editedMine, files: files.data?.map((f) => f.name) }));
  await visitor.page.reload();
  await visitor.page.waitForSelector('body[data-ready="true"]');
  await detailReady(visitor.page);
  const pubEdited = await visitor.page.evaluate(() => ({
    title: document.querySelector('#drawer h2')?.textContent,
    address: document.querySelector('#drawer .drawer-address')?.textContent,
    approx: !!document.querySelector('#drawer .notice-approx'),
  }));
  check('o visitante vê a edição, e sem o número quando o endereço passa a "só a rua"',
    pubEdited.title === 'Casa editada no backend' && /Rua do Teste/.test(pubEdited.address ?? '') && !/123/.test(pubEdited.address ?? '') && pubEdited.approx,
    JSON.stringify(pubEdited));

  // ---- building layout (item 45): only a published listing with the full address records it, kept per client and read
  // only by its members (another client, and the public, never see it)
  {
    const anon = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
    const osm = `way/9${Date.now() % 1e9}`;
    const before = (await svc.from('listings').select('address_display, building_osm_id, floors').eq('id', id).single()).data;
    const unit = { building_osm_id: osm, floors: 8, units_per_floor: 4, unit_floor: 3, unit_position: 2 };
    await svc.from('listings').update({ ...unit, address_display: 'street' }).eq('id', id);
    const hidden = (await svc.from('building_layouts').select('osm_id').eq('osm_id', osm)).data;
    const upd = await svc.from('listings').update({ address_display: 'full' }).eq('id', id);
    const shown = (await svc.from('building_layouts').select('org_id, floors, units_per_floor').eq('osm_id', osm)).data;
    const toPublic = await anon.from('building_layouts').select('floors').eq('osm_id', osm);
    const pub = (await anon.from('public_listings').select('unit_position, units_per_floor').eq('id', id)).data;
    const bad = await svc.from('listings').update({ unit_position: 5 }).eq('id', id);
    await svc.from('listings').update({ ...before, units_per_floor: null, unit_floor: null, unit_position: null }).eq('id', id);
    check('o layout do prédio (andares × unidades) nasce só com o endereço completo, fica com a imobiliária e não é público; a unidade cabe no andar',
      hidden?.length === 0 && !upd.error && shown?.length === 1 && shown[0].org_id === orgId && shown[0].floors === 8 &&
        shown[0].units_per_floor === 4 && !!toPublic.error && pub?.[0]?.unit_position === 2 && !!bad.error,
      JSON.stringify({ hidden, shown, toPublic: toPublic.error?.code ?? toPublic.data, pub, bad: bad.error?.code, upd: upd.error?.message }));
  }

  // ---- the client's own domain, while the listing is published: pages ready for search engines and link previews
  // (src/seo/siteServer.ts)
  const domain = `imob-${tag}.localhost`; // under .localhost the browser reaches this machine, with no DNS
  const origin = `http://${domain}:${PORT}`;
  const org = (await svc.from('organizations').update({ custom_domain: domain }).eq('slug', `${slug}-${tag}`).select('id').single()).data;
  const published = (await svc.from('public_listings').select('id').eq('org_id', org.id)).data;
  const raw = (p) =>
    new Promise((resolve, reject) =>
      http
        .get({ host: '127.0.0.1', port: PORT, path: p, headers: { host: `${domain}:${PORT}` } }, (res) => {
          let body = '';
          res.on('data', (d) => (body += d)).on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body }));
        })
        .on('error', reject),
    );
  const [home, sitemap, robots, old] = await Promise.all(['/', '/sitemap.xml', '/robots.txt', `/site.html?imobiliaria=${slug}-${tag}&p=sobre`].map(raw));
  const listed = sitemap.body.match(/<loc>[^<]*\/imovel\/[^<]+<\/loc>/g) ?? [];
  check(
    'domínio do cliente: o HTML já traz título, canônico e Open Graph; sitemap com os anúncios, robots.txt e 301 dos endereços antigos',
    home.status === 200 && /<title>[^<]+ · Imóveis em Joinville<\/title>/.test(home.body) && home.body.includes(`<link rel="canonical" href="${origin}/">`) &&
      home.body.includes('property="og:title"') && published.length > 0 && listed.length === published.length &&
      robots.body.includes(`Sitemap: ${origin}/sitemap.xml`) && old.status === 301 && old.location === '/sobre',
    JSON.stringify({ home: home.status, title: /<title>[^<]*/.exec(home.body)?.[0], listed: listed.length, published: published.length, robots: robots.status, old: [old.status, old.location] }),
  );
  const dom = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const dp = await dom.newPage();
  const domErrors = [];
  dp.on('pageerror', (e) => domErrors.push(String(e)));
  dp.on('console', (m) => m.type() === 'error' && domErrors.push(m.text()));
  await dp.goto(`${origin}/imoveis`);
  await dp.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
  const card = dp.locator('main .card-title a[href^="/imovel/"]').first();
  const href = await card.getAttribute('href');
  await card.click();
  await dp.waitForFunction((h) => location.pathname === h, href);
  const meta = () => dp.evaluate(() => ({ canonical: document.querySelector('link[rel=canonical]')?.href, h1: document.querySelector('main h1')?.textContent }));
  const opened = await meta();
  await dp.reload();
  await dp.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
  const reloaded = await meta();
  check(
    'domínio do cliente: links com endereços limpos; a ficha aberta pelo link e recarregada mostra o imóvel, com o canônico no domínio',
    !!href && opened.canonical === origin + href && reloaded.canonical === origin + href && !!reloaded.h1 && reloaded.h1 === opened.h1 && domErrors.length === 0,
    JSON.stringify({ href, opened, reloaded, domErrors }),
  );

  // ---- new-listing alert (item 40): asked on the search page, confirmed by the e-mail link, then the new listings
  if (fns) {
    const alertEmail = `alerta-${tag}@teste.local`;
    // async: the fake e-mail provider answers from this process
    const sendAlerts = () =>
      promisify(execFile)(process.execPath, ['scripts/send-alerts.mjs', '--local'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, RESEND_API_KEY: 'teste', RESEND_API_URL: fns.mailUrl, SITE_URL: URL_ },
      });
    await dp.goto(`${origin}/imoveis`);
    await dp.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
    await dp.click('.alert-box summary');
    await dp.fill('.alert-box [name=email]', alertEmail);
    await dp.check('.alert-box [name=consent]');
    await dp.click('.alert-box button[type=submit]');
    await dp.waitForSelector('.alert-box .form-msg.ok, .alert-box .form-msg.err', { timeout: 15000 });
    const asked = await dp.textContent('.alert-box .form-msg');
    await sendAlerts();
    const confirm = fns.mails().find((m) => m.to?.[0] === alertEmail && /Confirme/.test(m.subject));
    const token = /token=([0-9a-f-]{36})/.exec(confirm?.text ?? '')?.[1];
    await dp.goto(`${origin}/favoritos?alerta=confirmar&token=${token}`);
    await dp.waitForFunction(() => /confirmado/.test(document.querySelector('.alert-note')?.textContent ?? ''), null, { timeout: 15000 });
    // as if the listing came in after the confirmation
    await svc.from('search_alerts').update({ last_sent_at: '2000-01-01T00:00:00Z' }).eq('token', token);
    await sendAlerts();
    const news = fns.mails().find((m) => m.to?.[0] === alertEmail && /novo/.test(m.subject));
    await sendAlerts();
    const again = fns.mails().filter((m) => m.to?.[0] === alertEmail).length;
    await dp.goto(`${origin}/favoritos?alerta=cancelar&token=${token}`);
    await dp.waitForFunction(() => /não vai mais receber/.test(document.querySelector('.alert-note')?.textContent ?? ''), null, { timeout: 15000 });
    const left = (await svc.from('search_alerts').select('id').eq('token', token)).data?.length;
    check(
      'alerta de imóvel novo: pedido na busca, confirmação pelo link do e-mail, e-mail com o imóvel e o link de saída, sem repetir; cancelado pelo link',
      /confirmação/.test(asked ?? '') && !!token && !!news && news.text.includes(`https://${domain}/imovel?id=`) && news.text.includes('alerta=cancelar') && again === 2 && left === 0,
      JSON.stringify({ asked, token: !!token, news: news?.subject, again, left }),
    );
  }
  await dom.close();

  // ---- session survives a reload; trash → restore → trash → delete for good
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  await waitIdle(page);
  const stillIn = await page.textContent('.account-toggle');
  page.on('dialog', (d) => d.accept());
  await page.click(`#results button[data-id="${id}"]`);
  await sleep(600);
  await detailReady(page);
  const trashLabel = await page.textContent('#drawer [data-action="delete"]');
  await page.click('#drawer [data-action="delete"]');
  await page.waitForFunction((id) => !document.querySelector(`#results button[data-id="${id}"]`), id, { timeout: 15000 });
  await visitor.page.reload();
  await visitor.page.waitForSelector('body[data-ready="true"]');
  const visitorAfterTrash = await visitor.page.evaluate((id) => !!document.querySelector(`#results button[data-id="${id}"]`), id);
  await page.click('.account-toggle');
  await page.click('#account-panel details[data-section="trash"] summary');
  await page.waitForSelector('#account-panel [data-restore]', { timeout: 15000 });
  const trashItem = await page.textContent('#account-panel details[data-section="trash"] li');
  await shot(page, 'backend-lixeira.png');
  await page.click('#account-panel [data-restore]');
  await page.waitForFunction((id) => !!document.querySelector(`#results button[data-id="${id}"]`), id, { timeout: 15000 });
  check('excluir move para a lixeira (some do site, inclusive para o visitante) e dá para restaurar',
    trashLabel === 'Mover para a lixeira' && !visitorAfterTrash && /Casa editada no backend/.test(trashItem ?? '') && /Corretor Teste/.test(trashItem ?? ''),
    JSON.stringify({ trashLabel, visitorAfterTrash, trashItem: trashItem?.replace(/\s+/g, ' ') }));
  await page.keyboard.press('Escape');
  await page.click(`#results button[data-id="${id}"]`);
  await sleep(600);
  await detailReady(page);
  await page.click('#drawer [data-action="delete"]');
  await page.waitForFunction((id) => !document.querySelector(`#results button[data-id="${id}"]`), id, { timeout: 15000 });
  await page.click('.account-toggle');
  await page.waitForSelector('#account-panel [data-purge]', { timeout: 15000 });
  await page.click('#account-panel [data-purge]');
  await page.waitForFunction(() => /vazia/.test(document.querySelector('#account-panel details[data-section="trash"]')?.textContent ?? ''), null, { timeout: 15000 });
  const folder = editedMine.strip[0].split('/listing-photos/')[1].split('/').slice(0, 2).join('/');
  const left = await svc.storage.from('listing-photos').list(folder);
  check('a sessão continua após recarregar, e "Excluir de vez" apaga o anúncio e as fotos do storage',
    stillIn === 'Imobiliária Teste Ação' && (await rows()) === before && left.data?.length === 0, `${stillIn}; ${left.data?.length} arquivos`);

  // ---- the support staff logs in again: after the password, the code of the authenticator app
  const staff2 = await open(browser);
  await staff2.page.click('.account-toggle');
  await staff2.page.fill('#account-panel input[name="email"]', staffEmail);
  await staff2.page.fill('#account-panel input[name="password"]', PASSWORD);
  await staff2.page.click('#account-panel button[type="submit"]');
  await staff2.page.waitForSelector('#account-panel form[data-form="mfa"]', { timeout: 15000 });
  await staff2.page.fill('#account-panel form[data-form="mfa"] input[name="code"]', '000000');
  await staff2.page.click('#account-panel form[data-form="mfa"] button[type="submit"]');
  await staff2.page.waitForSelector('#account-panel form[data-form="mfa"] .a-error:not([hidden])', { timeout: 15000 });
  const wrongCode = await staff2.page.textContent('#account-panel form[data-form="mfa"] .a-error');
  await staff2.page.fill('#account-panel form[data-form="mfa"] input[name="code"]', await freshTotp(staffSecret, usedCodes));
  await staff2.page.click('#account-panel form[data-form="mfa"] button[type="submit"]');
  await staff2.page.waitForSelector('#account-panel form[data-form="org"]', { timeout: 15000 });
  check('suporte: ao entrar de novo, o código errado é recusado e o certo libera o atendimento', /Código incorreto/.test(wrongCode ?? ''), wrongCode);
  await staff2.ctx.close();

  // ---- the owner reads the history
  const owner2 = await open(browser);
  await owner2.page.click('.account-toggle');
  await owner2.page.fill('#account-panel input[name="email"]', ownerEmail);
  await owner2.page.fill('#account-panel input[name="password"]', PASSWORD);
  await owner2.page.click('#account-panel button[type="submit"]');
  await owner2.page.click('#account-panel details[data-section="audit"] summary', { timeout: 15000 });
  await owner2.page.waitForSelector('#account-panel .audit-list li', { timeout: 15000 });
  const history = await owner2.page.evaluate(() => [...document.querySelectorAll('#account-panel .audit-list li span')].map((li) => li.textContent.trim()));
  await shot(owner2.page, 'backend-historico.png');
  const has = (re) => history.some((h) => re.test(h));
  check('o dono vê o histórico em frases: quem criou, alterou, mandou para a lixeira, restaurou e excluiu',
    has(/^Corretor Teste criou o anúncio "Casa publicada no backend"/) && has(/alterou "Casa publicada no backend": preço de R\$ 880\.000 para R\$ 800\.000/) &&
      has(/moveu "Casa editada no backend" para a lixeira/) && has(/restaurou "Casa editada no backend"/) && has(/excluiu definitivamente "Casa editada no backend"/) &&
      has(/alterou "Casa editada no backend": título, exibição do endereço/) && !history.some((h) => /um anúncio/.test(h)) &&
      has(/Corretor Teste entrou na equipe como corretor/),
    JSON.stringify(history.slice(0, 12)));
  await owner2.ctx.close();

  // ---- the client's site (index.html): the owner customizes it, a visitor offers a property
  const siteUrl = `${URL_}?imobiliaria=${slug}-${tag}`;
  const siteOpen = async (url) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await p.goto(url);
    await p.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
    return { ctx, p, errs };
  };
  const ed = await siteOpen(`${siteUrl}&editar=1`);
  check('site: visitante sem login não vê "Personalizar"; o editor pede o login de dono', await ed.p.isVisible('.editor .ed-login'));
  await ed.p.fill('.editor [name=email]', ownerEmail);
  await ed.p.fill('.editor [name=password]', PASSWORD);
  await ed.p.click('.editor .ed-login button');
  await ed.p.waitForSelector('.editor .ed-body', { timeout: 15000 });
  await ed.p.click('.editor [data-template=escuro]');
  await ed.p.click('.editor summary:has-text("Contatos e redes")');
  await ed.p.fill('.editor [data-k="contacts.whatsapp"]', '(47) 98888-1234');
  await ed.p.fill('.editor [data-k="name"]', 'Ação Imóveis');
  await sleep(400);
  await ed.p.click('.editor [data-save]');
  await ed.p.waitForSelector('.toast:not([hidden])');
  const savedBranding = (await svc.from('organizations').select('branding').eq('slug', `${slug}-${tag}`).single()).data.branding;
  check('site: o dono personaliza e publica; fica salvo no banco já validado',
    savedBranding.template === 'escuro' && savedBranding.name === 'Ação Imóveis' && savedBranding.contacts.whatsapp === '47988881234', JSON.stringify({ t: savedBranding.template, n: savedBranding.name }));
  await ed.p.click('.editor summary:has-text("Histórico de publicações")');
  await ed.p.waitForSelector('.editor .ed-history li:nth-child(2)', { timeout: 10000 });
  const hist = await ed.p.$$eval('.editor .ed-history li', (li) => li.map((x) => x.textContent));
  check('site: o histórico mostra a publicação no ar, com quem publicou, e a versão de antes',
    hist.length === 2 && /·.*no ar/.test(hist[0]) && /Antes do histórico/.test(hist[1]), JSON.stringify(hist));
  await ed.p.click('.editor [data-version]');
  await ed.p.click('.editor [data-save]');
  await ed.p.waitForFunction(() => document.querySelectorAll('.editor .ed-history li').length === 3, null, { timeout: 10000 });
  const back = (await svc.from('organizations').select('branding').eq('slug', `${slug}-${tag}`).single()).data.branding;
  check('site: abrir a versão de antes e publicar volta o site, e a volta também fica no histórico', back.template !== 'escuro' && back.name !== 'Ação Imóveis', JSON.stringify({ t: back.template, n: back.name }));
  await svc.from('organizations').update({ branding: savedBranding }).eq('slug', `${slug}-${tag}`);
  await ed.ctx.close();
  const vis = await siteOpen(`${siteUrl}&p=anunciar`);
  const look = await vis.p.evaluate(() => ({ theme: document.documentElement.dataset.theme, brand: document.querySelector('.brand-name')?.textContent, edit: !!document.querySelector('.edit-fab'), demo: !!document.querySelector('.demo-note') }));
  check('site: o visitante vê a personalização, sem o botão de editar e sem aviso de demonstração', look.theme === 'dark' && look.brand === 'Ação Imóveis' && !look.edit && !look.demo, JSON.stringify(look));
  await vis.p.selectOption('[name=x-finalidade]', 'Vender');
  await vis.p.selectOption('[name=x-tipo]', 'Casa');
  await vis.p.fill('[name=x-bairro]', 'Glória');
  await vis.p.fill('main [name=name]', 'Proprietária Site');
  await vis.p.fill('main [name=phone]', '(47) 97777-1111');
  await vis.p.check('main [name=consent]');
  await vis.p.click('main form.lead button[type=submit]');
  await vis.p.waitForSelector('main .form-msg.ok', { timeout: 15000 });
  await shot(vis.p, 'backend-site.png');
  check('sem erros no console (site)', vis.errs.length === 0, vis.errs.join(' | '));
  await vis.ctx.close();
  const owner3 = await open(browser);
  await owner3.page.click('.account-toggle');
  await owner3.page.fill('#account-panel input[name="email"]', ownerEmail);
  await owner3.page.fill('#account-panel input[name="password"]', PASSWORD);
  await owner3.page.click('#account-panel button[type="submit"]');
  await owner3.page.click('#account-panel details[data-section="leads"] summary', { timeout: 15000 });
  await owner3.page.waitForSelector('#account-panel .lead-origin', { timeout: 15000 });
  const offer = await owner3.page.evaluate(() => {
    const li = [...document.querySelectorAll('#account-panel .lead-item')].find((x) => x.textContent.includes('Proprietária Site'));
    return { origin: li?.querySelector('.lead-origin')?.textContent, details: li?.querySelector('.lead-details')?.textContent };
  });
  const siteLink = await owner3.page.getAttribute('#account-panel [data-action=customize]', 'href');
  check('a oferta de imóvel chega em Minha conta → Contatos, com as respostas; o dono tem o link "Personalizar o site"',
    /anunciar/.test(offer.origin ?? '') && /Casa/.test(offer.details ?? '') && /Glória/.test(offer.details ?? '') && siteLink.includes('editar=1'), JSON.stringify(offer));
  // ---- the owner turns two-step verification on; the site editor then asks for the code after the password
  await owner3.page.click('#account-panel [data-action="mfa-on"]');
  await owner3.page.waitForSelector('#account-panel input[name="totp-secret"]', { timeout: 15000 });
  const ownerSecret = await owner3.page.inputValue('#account-panel input[name="totp-secret"]');
  await owner3.page.fill('#account-panel form[data-form="mfa-confirm"] input[name="code"]', await freshTotp(ownerSecret, usedCodes));
  await owner3.page.click('#account-panel form[data-form="mfa-confirm"] button[type="submit"]');
  await owner3.page.waitForSelector('#account-panel [data-action="mfa-off"]', { timeout: 15000 });
  await owner3.ctx.close();
  const ed2 = await siteOpen(`${siteUrl}&editar=1`);
  await ed2.p.fill('.editor [name=email]', ownerEmail);
  await ed2.p.fill('.editor [name=password]', PASSWORD);
  await ed2.p.click('.editor .ed-login button');
  await ed2.p.waitForSelector('.editor .ed-login [name=code]', { timeout: 15000 });
  const editorBeforeCode = await ed2.p.isVisible('.editor .ed-body');
  await ed2.p.fill('.editor .ed-login [name=code]', await freshTotp(ownerSecret, usedCodes));
  await ed2.p.click('.editor .ed-login button');
  await ed2.p.waitForSelector('.editor .ed-body', { timeout: 15000 });
  check('dono: ativa a verificação em duas etapas em Minha conta; o editor do site pede o código depois da senha', !editorBeforeCode, String(editorBeforeCode));
  await ed2.ctx.close();

  check('sem erros no console', errors.length === 0 && visitor.errors.length === 0, [...errors, ...visitor.errors].join(' | '));
  await visitor.ctx.close();
} finally {
  await browser.close();
  server.kill();
  fns?.stop();
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
