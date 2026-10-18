#!/usr/bin/env node
// Imports a client's listings from a VRSync XML feed (the file their CRM already sends to ZAP/VivaReal/OLX).
// Run by the platform's support team during a client's migration, and again to keep in sync:
//
//   npm run import:xml -- --org <slug-ou-id> --file feed.xml        (or --url https://crm.../feed.xml)
//   options: --sync      trash listings imported before that are no longer in the feed
//            --dry-run   only report what would change
//            --force     with --sync, trash even when the feed drops more than 30% of the imported listings
//            --local     use the local Supabase (npm run db:start) instead of SUPABASE_URL
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service key: support only, never in the site).
// For each listing: matched by its ListingID (reference code), so importing again updates instead of duplicating;
// placed on its building of the map by the feed's coordinates (or shown approximate in its neighbourhood);
// photos downloaded, shrunk (1600 px + 320 px thumbnail) and stripped of metadata such as GPS position.
// What the team did on screen stays: a listing hidden (draft) stays hidden, one a person sent to the trash is not
// brought back, and one whose place was adjusted keeps it. scripts/import-feeds.mjs runs this on a schedule.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { parseVrsync } from '../src/import/vrsync.ts';
import { PHOTO_SIZES } from '../src/utils/images.ts';
import { toEwkt } from '../src/backend/mapping.ts';
import { openBuildings } from './lib/building-at.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);
const DRY = flag('dry-run');
const PHOTOS = 'listing-photos';

function fail(msg) {
  console.error(`Erro: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------- connection
let url = process.env.SUPABASE_URL;
let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (flag('local')) {
  const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  [url, key] = [status.API_URL, status.SERVICE_ROLE_KEY];
}
if (!url || !key) fail('defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou use --local)');
const db = createClient(url, key, { auth: { persistSession: false } });

// ---------------------------------------------------------------- feed
const orgArg = opt('org');
if (!orgArg) fail('informe --org <slug ou id da imobiliária>');
async function download(feedUrl) {
  let r;
  try {
    r = await fetch(feedUrl, { signal: AbortSignal.timeout(60000) });
  } catch (err) {
    fail(`não foi possível baixar o XML (${err.cause?.message ?? err.message})`);
  }
  if (!r.ok) fail(`o endereço do XML respondeu HTTP ${r.status}`);
  const text = await r.text();
  if (text.length > 50 * 1024 * 1024) fail('o XML tem mais de 50 MB');
  return text;
}
const xml = opt('file') ? await readFile(opt('file'), 'utf8') : opt('url') ? await download(opt('url')) : fail('informe --file ou --url');
let feed;
try {
  feed = parseVrsync(xml);
} catch (err) {
  fail(`o arquivo não é um XML VRSync (${err.message})`);
}
// an empty answer (CRM down, wrong address) must not look like "every listing left the feed"
if (!feed.listings.length && !feed.skipped.length) fail('o XML não tem nenhum anúncio; confira o endereço do feed');

const isUuid = /^[0-9a-f-]{36}$/.test(orgArg);
const { data: org } = await db.from('organizations').select('id, name, creci').eq(isUuid ? 'id' : 'slug', orgArg).maybeSingle();
if (!org) fail(`imobiliária "${orgArg}" não encontrada`);

// brokers of the client by e-mail: an imported listing belongs to the broker in its contact, when they are on the team
const { data: team } = await db.from('memberships').select('user_id').eq('org_id', org.id);
const { data: profiles } = team?.length ? await db.from('profiles').select('user_id, email').in('user_id', team.map((m) => m.user_id)) : { data: [] };
const memberByEmail = new Map((profiles ?? []).flatMap((p) => (p.email ? [[p.email.toLowerCase(), p.user_id]] : [])));

const { data: existingRows, error: exErr } = await db
  .from('listings')
  .select('id, reference_code, import_source, deleted_at, deleted_by, published, placement_locked, price, title')
  .eq('org_id', org.id)
  .not('reference_code', 'is', null);
if (exErr) fail(exErr.message);
const existing = new Map(existingRows.map((r) => [r.reference_code, r]));

// ---------------------------------------------------------------- placement on the map
const meta = JSON.parse(await readFile(path.join(ROOT, 'public', 'data', 'meta.json'), 'utf8'));
const buildings = await openBuildings(path.join(ROOT, 'public', 'data', meta.tiles));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const bairros = new Map(
  JSON.parse(await readFile(path.join(ROOT, 'public', 'data', 'bairros.geojson'), 'utf8')).features.map((f) => [norm(f.properties.name), f.geometry.coordinates]),
);

/** Rectangle of `areaM2` (front : depth = 1 : 2.5) centred on the point, aligned north (like the site's form). */
function lotAround([lon, lat], areaM2) {
  const front = Math.sqrt(areaM2 / 2.5);
  const depth = front * 2.5;
  const dLon = front / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  const dLat = depth / 2 / 110540;
  const r = (v) => Number(v.toFixed(7));
  return {
    type: 'Polygon',
    coordinates: [[[r(lon - dLon), r(lat - dLat)], [r(lon + dLon), r(lat - dLat)], [r(lon + dLon), r(lat + dLat)], [r(lon - dLon), r(lat + dLat)], [r(lon - dLon), r(lat - dLat)]]],
  };
}

/** Where the listing goes and what the public may see; `note` explains a downgrade to "approximate". */
async function place(l) {
  let display = l.addressDisplay;
  let note = null;
  const point = l.point ?? bairros.get(norm(l.address.bairro ?? '')) ?? null;
  if (!point) return { error: 'sem coordenadas e bairro não encontrado no mapa' };
  if (!l.point) {
    if (display !== 'neighborhood') note = 'sem coordenadas no XML: aparece como aproximado no bairro; ajuste o local em "Editar anúncio"';
    display = display === 'full' ? 'street' : display;
  }
  if (l.type === 'land') {
    const b = l.point ? await buildings.at(point, 0) : null;
    if (b?.inside) note = 'a coordenada do terreno cai sobre um prédio do mapa; confira o local';
    return { point, display, note, lot: lotAround(point, l.areaM2) };
  }
  const b = l.point ? await buildings.at(point) : null;
  if (!b) {
    if (l.point && display === 'full') note = 'nenhum prédio do mapa na coordenada: aparece como aproximado; ajuste em "Editar anúncio"';
    return { point, display: display === 'full' ? 'street' : display, note };
  }
  if (!b.residential) note = 'o prédio do mapa nessa coordenada não está marcado como residencial; confira o local';
  return { point, display, note, building: b };
}

// ---------------------------------------------------------------- photos
/**
 * Photos in the three sizes the form makes (src/utils/images.ts, PHOTO_SIZES); `large` only when the original is
 * bigger. Floor plans: one file, large enough to read the rooms.
 */
async function photoFiles(sourceUrl, plan) {
  const r = await fetch(sourceUrl, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (!/^image\//.test(r.headers.get('content-type') ?? 'image/')) throw new Error('não é imagem');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) throw new Error('maior que 15 MB');
  // rotate(): applies the camera orientation; output has no metadata (EXIF/GPS) since withMetadata() is not used
  const size = ([max, quality]) =>
    sharp(buf).rotate().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: Math.round(quality * 100) }).toBuffer();
  if (plan) return { main: await size([1600, 0.8]), thumb: null, large: null };
  const { width = 0, height = 0 } = await sharp(buf).metadata();
  return {
    main: await size(PHOTO_SIZES.src),
    thumb: await size(PHOTO_SIZES.thumb),
    large: Math.max(width, height) > PHOTO_SIZES.src[0] ? await size(PHOTO_SIZES.large) : null,
  };
}

/** Brings the listing's photos in line with the feed (by original URL): new ones uploaded, missing ones removed. */
async function syncPhotos(listingId, l, report) {
  const { data: rows } = await db.from('listing_photos').select('id, path, thumb_path, large_path, source_url').eq('listing_id', listingId);
  const bySource = new Map((rows ?? []).filter((r) => r.source_url).map((r) => [r.source_url, r]));
  const wanted = [...l.photos.map((p, i) => ({ ...p, position: i, plan: false })), ...l.floorPlans.map((u) => ({ url: u, caption: 'Planta', position: 999, plan: true }))];
  const kept = new Set();
  let added = 0;
  for (const p of wanted) {
    const row = bySource.get(p.url);
    if (row) {
      kept.add(row.id);
      await db.from('listing_photos').update({ position: p.position, caption: p.caption }).eq('id', row.id);
      continue;
    }
    try {
      const { main, thumb, large } = await photoFiles(p.url, p.plan);
      const base = `${org.id}/${listingId}/${crypto.randomUUID().slice(0, 8)}`;
      const files = [[`${base}.jpg`, main], [`${base}-mini.jpg`, thumb], [`${base}-grande.jpg`, large]].filter(([, buf]) => buf);
      for (const [file, buf] of files) {
        const up = await db.storage.from(PHOTOS).upload(file, buf, { contentType: 'image/jpeg' });
        if (up.error) throw new Error(up.error.message);
      }
      const ins = await db.from('listing_photos').insert({
        listing_id: listingId,
        org_id: org.id,
        path: `${base}.jpg`,
        thumb_path: thumb ? `${base}-mini.jpg` : null,
        large_path: large ? `${base}-grande.jpg` : null,
        caption: p.caption,
        position: p.position,
        is_floor_plan: p.plan,
        source_url: p.url,
      });
      if (ins.error) throw new Error(ins.error.message);
      added++;
    } catch (err) {
      report.warnings.push({ referenceCode: l.referenceCode, message: `foto não importada (${p.url}): ${err.message}` });
    }
  }
  const gone = (rows ?? []).filter((r) => r.source_url && !kept.has(r.id));
  if (gone.length) {
    await db.from('listing_photos').delete().in('id', gone.map((r) => r.id));
    await db.storage.from(PHOTOS).remove(gone.flatMap((r) => [r.path, r.thumb_path, r.large_path].filter(Boolean)));
  }
  return { added, removed: gone.length };
}

// ---------------------------------------------------------------- import
const report = { org: org.name, created: [], updated: [], trashed: [], skipped: feed.skipped, warnings: [...feed.warnings], errors: [] };
const PLACEMENT = ['address_display', 'location', 'building_osm_id', 'footprint', 'building_height_m', 'lot'];
for (const l of feed.listings) {
  const old = existing.get(l.referenceCode);
  if (old?.deleted_at && old.deleted_by) {
    report.skipped.push({ referenceCode: l.referenceCode, title: l.title, reason: 'alguém da equipe mandou para a lixeira: não foi restaurado (restaure pela Lixeira para voltar a importar)' });
    continue;
  }
  const where = await place(l);
  if (where.error) {
    report.errors.push({ referenceCode: l.referenceCode, message: where.error });
    continue;
  }
  if (where.note) report.warnings.push({ referenceCode: l.referenceCode, message: where.note });
  const contactEmail = l.contact.email ?? feed.provider.email;
  const row = {
    org_id: org.id,
    import_source: 'xml',
    published: true,
    type: l.type,
    usage: l.usage,
    title: l.title.slice(0, 120),
    description: l.description.slice(0, 5000),
    transaction: l.transaction,
    price: l.price,
    rent_price: l.rentPrice,
    condo_fee: l.condoFee,
    iptu_value: l.iptu?.value ?? null,
    iptu_period: l.iptu?.period ?? null,
    area_m2: l.areaM2,
    total_area_m2: l.totalAreaM2,
    land_area_m2: l.landAreaM2,
    bedrooms: l.bedrooms,
    suites: l.suites,
    bathrooms: l.bathrooms,
    parking_spots: l.parkingSpots,
    unit_floor: l.unitFloor,
    floors: l.floors,
    year_built: l.yearBuilt,
    features: l.features,
    highlight: l.highlight,
    address: l.address,
    address_display: where.display,
    location: toEwkt({ type: 'Point', coordinates: where.point }),
    building_osm_id: where.building?.osmId ?? null,
    footprint: where.building ? toEwkt(where.building.geometry) : null,
    building_height_m: where.building?.height ?? null,
    lot: where.lot ? `SRID=4326;POLYGON((${where.lot.coordinates[0].map((p) => p.join(' ')).join(',')}))` : null,
    video_url: l.videoUrl,
    advertiser: Object.fromEntries(
      Object.entries({
        creci: org.creci ?? undefined,
        contactName: l.contact.name ?? feed.provider.name,
        email: contactEmail,
        whatsapp: l.contact.phone ?? feed.provider.phone,
      }).filter(([, v]) => v),
    ),
    reference_code: l.referenceCode,
    deleted_at: null,
  };
  if (old) {
    delete row.published; // hidden on screen (draft) stays hidden
    if (old.placement_locked) for (const k of PLACEMENT) delete row[k]; // place adjusted on screen stays
  }
  if (DRY) {
    (old ? report.updated : report.created).push({ referenceCode: l.referenceCode, title: l.title });
    continue;
  }
  let id;
  if (old) {
    const { error } = await db.from('listings').update(row).eq('id', old.id);
    if (error) {
      report.errors.push({ referenceCode: l.referenceCode, message: error.message });
      continue;
    }
    id = old.id;
  } else {
    const { data, error } = await db.from('listings').insert({ ...row, created_by: memberByEmail.get(contactEmail ?? '') ?? null }).select('id').single();
    if (error) {
      report.errors.push({ referenceCode: l.referenceCode, message: error.message });
      continue;
    }
    id = data.id;
  }
  const photos = await syncPhotos(id, l, report);
  (old ? report.updated : report.created).push({ referenceCode: l.referenceCode, title: l.title, id, photos });
}

// listings imported before and gone from the feed: to the trash (restorable for 30 days)
if (flag('sync')) {
  const inFeed = new Set(feed.listings.map((l) => l.referenceCode));
  const imported = existingRows.filter((r) => r.import_source === 'xml' && !r.deleted_at);
  const gone = imported.filter((r) => !inFeed.has(r.reference_code));
  // a feed cut in half by the CRM would empty the site: above 30% (and more than 3), nothing goes without --force
  const suspect = gone.length > 3 && gone.length > imported.length * 0.3 && !flag('force');
  if (suspect) {
    report.warnings.push({
      referenceCode: '—',
      message: `${gone.length} de ${imported.length} anúncios importados saíram do XML de uma vez: nada foi para a lixeira. Se for isso mesmo, rode com --force (ou apague pela tela)`,
    });
    report.suspect = true;
  }
  for (const r of suspect ? [] : gone) {
    if (!DRY) await db.from('listings').update({ deleted_at: new Date().toISOString() }).eq('id', r.id);
    report.trashed.push({ referenceCode: r.reference_code, title: r.title });
  }
}
await buildings.close();

// ---------------------------------------------------------------- report
const line = (r) => `  ${r.referenceCode}  ${r.title ?? ''}${r.message ? ` — ${r.message}` : ''}${r.reason ? ` — ${r.reason}` : ''}`;
console.log(`${DRY ? '[simulação] ' : ''}Importação para ${org.name}: ${feed.listings.length + feed.skipped.length} anúncios no XML`);
for (const [label, list] of [
  ['Criados', report.created],
  ['Atualizados', report.updated],
  ['Para a lixeira (fora do XML)', report.trashed],
  ['Ignorados', report.skipped],
  ['Avisos', report.warnings],
  ['Erros', report.errors],
])
  if (list.length) console.log(`${label} (${list.length}):\n${list.map(line).join('\n')}`);
if (flag('json')) console.log(JSON.stringify(report));
process.exit(report.errors.length ? 2 : 0);
