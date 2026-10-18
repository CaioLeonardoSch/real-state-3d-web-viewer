// XML import (scripts/import-xml.mjs) against the local Supabase: first import, then a second one that changes a
// price, drops a photo and leaves a listing out (--sync). Photos come from a local image server, with GPS in EXIF.
// Then the scheduled import (scripts/import-feeds.mjs), reading the feed from the same server.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL_ = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const run = promisify(execFile);
const tag = Date.now().toString(36);

describe.skipIf(!URL_)('importação do XML (VRSync)', () => {
  const db = () => createClient(URL_!, SERVICE, { auth: { persistSession: false } });
  let server: http.Server;
  let base: string;
  let orgId: string;
  let slug: string;
  let brokerId: string;
  const brokerEmail = `corretor-xml-${tag}@teste.local`;
  /** What the server answers at /feed.xml (null: 404). */
  let served: string | null = null;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xml-'));
  const sample = readFileSync('tests/fixtures/vrsync-exemplo.xml', 'utf8');
  const feedFile = (xml: string) => {
    const f = path.join(dir, `feed-${Math.random().toString(36).slice(2)}.xml`);
    writeFileSync(f, xml.replace(/__FOTOS__/g, base).replace(/__CORRETOR__/g, brokerEmail));
    return f;
  };
  const importFeed = async (file: string, ...extra: string[]) => {
    const { stdout } = await run('node', ['scripts/import-xml.mjs', '--local', '--org', slug, '--file', file, '--json', ...extra], { timeout: 120_000 });
    return JSON.parse(stdout.trim().split('\n').at(-1)!);
  };
  const byRef = async (ref: string) =>
    (await db().from('listings').select('*, listing_photos(path, thumb_path, large_path, caption, position, is_floor_plan, source_url)').eq('org_id', orgId).eq('reference_code', ref).single()).data!;

  beforeAll(async () => {
    // photos with a GPS position in their metadata, as a phone would save them
    const jpeg = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#7a9' } })
      .jpeg()
      .withExif({ IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '26/1 18/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '48/1 50/1 0/1' } })
      .toBuffer();
    server = http
      .createServer((req, res) => {
        if (req.url !== '/feed.xml') return res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(jpeg);
        if (served === null) return res.writeHead(404).end('não encontrado');
        res.writeHead(200, { 'Content-Type': 'application/xml' }).end(served.replace(/__FOTOS__/g, base).replace(/__CORRETOR__/g, brokerEmail));
      })
      .listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    slug = `imob-xml-${tag}`;
    const org = await db().from('organizations').insert({ name: 'Imobiliária XML', slug, creci: '7777-J' }).select('id').single();
    orgId = org.data!.id;
    const u = await db().auth.admin.createUser({ email: brokerEmail, password: 'senha-de-teste-123', email_confirm: true });
    brokerId = u.data.user!.id;
    await db().from('memberships').insert({ org_id: orgId, user_id: brokerId, role: 'agent' });
  });
  afterAll(() => server?.close());

  it('primeira importação: cria, encaixa no prédio, baixa as fotos sem GPS e explica o que ficou de fora', async () => {
    const r = await importFeed(feedFile(sample));
    expect(r.created.map((c: { referenceCode: string }) => c.referenceCode)).toEqual(['AP-1001', 'CA-2002', 'TE-3003']);
    expect(r.skipped.map((s: { referenceCode: string }) => s.referenceCode)).toEqual(['SL-4004', 'AP-5005']);
    expect(r.errors).toEqual([]);

    const ap = await byRef('AP-1001');
    expect(ap).toMatchObject({ building_osm_id: 'way/515701197', address_display: 'full', created_by: brokerId, import_source: 'xml', price: 780000, highlight: 'featured' });
    expect(ap.advertiser).toMatchObject({ creci: '7777-J', email: brokerEmail });
    const photos = [...ap.listing_photos].sort((a, b) => a.position - b.position);
    // three sizes of each photo (the original is 2400 px wide); the floor plan, one file
    expect(photos.map((p) => [p.caption, p.is_floor_plan, !!p.thumb_path, !!p.large_path])).toEqual([
      ['Fachada', false, true, true],
      ['Sala', false, true, true],
      ['Planta', true, false, false],
    ]);
    const meta = async (path: string) => sharp(Buffer.from(await (await fetch(`${URL_}/storage/v1/object/public/listing-photos/${path}`)).arrayBuffer())).metadata();
    const m = await meta(photos[0].path);
    expect(m.width).toBe(1024);
    expect(m.exif).toBeUndefined(); // sem a localização GPS da foto original
    expect((await meta(photos[0].large_path)).width).toBe(1920);
    expect((await meta(photos[0].thumb_path)).width).toBe(480);
    expect((await meta(photos[2].path)).width).toBe(1600);

    const casa = await byRef('CA-2002');
    expect(casa).toMatchObject({ building_osm_id: null, address_display: 'neighborhood', transaction: 'both', rent_price: 3200, created_by: null });
    const terreno = await byRef('TE-3003');
    expect(terreno.lot).not.toBeNull();
    expect(terreno.address_display).toBe('street');

    // the public sees them like any listing
    const anon = createClient(URL_!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const pub = await anon.from('public_listings').select('id, reference_code').eq('org_id', orgId);
    expect(pub.data).toHaveLength(3);
  }, 120_000);

  it('importar de novo atualiza sem duplicar; --sync manda o que saiu do XML para a lixeira e não toca nos cadastrados pela tela', async () => {
    const manual = await db().from('listings').insert({
      org_id: orgId, type: 'house', title: 'Cadastrado pela tela', price: 500000, area_m2: 100, location: 'SRID=4326;POINT(-48.85 -26.3)',
      address_display: 'neighborhood', reference_code: 'MANUAL-1',
    }).select('id').single();
    expect(manual.error).toBeNull();
    const changed = sample
      .replace('<ListPrice currency="BRL">780000</ListPrice>', '<ListPrice currency="BRL">740000</ListPrice>')
      .replace(/<Item medium="image" caption="Sala">[^<]*<\/Item>/, '')
      .replace(/<Listing>\s*<ListingID>TE-3003<\/ListingID>[\s\S]*?<\/Listing>/, '');
    const r = await importFeed(feedFile(changed), '--sync');
    expect(r.created).toEqual([]);
    expect(r.updated.map((u: { referenceCode: string }) => u.referenceCode)).toEqual(['AP-1001', 'CA-2002']);
    expect(r.trashed.map((t: { referenceCode: string }) => t.referenceCode)).toEqual(['TE-3003']);

    const ap = await byRef('AP-1001');
    expect(ap).toMatchObject({ price: 740000, previous_price: 780000 }); // a redução aparece pelo histórico
    expect(ap.listing_photos.filter((p: { is_floor_plan: boolean }) => !p.is_floor_plan).map((p: { caption: string }) => p.caption)).toEqual(['Fachada']);
    expect((await byRef('TE-3003')).deleted_at).not.toBeNull();
    expect((await db().from('listings').select('deleted_at').eq('id', manual.data!.id).single()).data!.deleted_at).toBeNull();
    const count = await db().from('listings').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('reference_code', 'AP-1001');
    expect(count.count).toBe(1);
  }, 120_000);

  it('--dry-run só mostra o que mudaria', async () => {
    const before = (await byRef('AP-1001')).updated_at;
    const r = await importFeed(feedFile(sample), '--dry-run');
    expect(r.updated.map((u: { referenceCode: string }) => u.referenceCode)).toContain('AP-1001');
    expect((await byRef('AP-1001')).updated_at).toBe(before);
  }, 120_000);

  it('respeita a tela: despublicado continua, local ajustado fica, lixeira da equipe não volta; a do importador volta', async () => {
    const ap = await byRef('AP-1001');
    const casa = await byRef('CA-2002');
    const moved = await db()
      .from('listings')
      .update({ published: false, placement_locked: true, location: 'SRID=4326;POINT(-48.846 -26.304)', building_osm_id: null, footprint: null, building_height_m: null, address_display: 'street' })
      .eq('id', ap.id);
    expect(moved.error).toBeNull();
    await db().from('listings').update({ deleted_at: new Date().toISOString(), deleted_by: brokerId }).eq('id', casa.id);
    const before = (await byRef('AP-1001')).location;
    const r = await importFeed(feedFile(sample), '--sync');
    expect(r.updated.map((u: { referenceCode: string }) => u.referenceCode)).toEqual(['AP-1001', 'TE-3003']);
    expect(r.skipped.find((s: { referenceCode: string }) => s.referenceCode === 'CA-2002')?.reason).toMatch(/lixeira/);
    expect(await byRef('AP-1001')).toMatchObject({ published: false, location: before, building_osm_id: null, price: 780000 });
    expect((await byRef('TE-3003')).deleted_at).toBeNull();
    expect((await byRef('CA-2002')).deleted_at).not.toBeNull();
    await db().from('listings').update({ deleted_at: null, published: true }).in('id', [ap.id, casa.id]);
  }, 120_000);

  it('feed que some pela metade não esvazia o site sem --force', async () => {
    const extra = await db()
      .from('listings')
      .insert(['X-1', 'X-2', 'X-3', 'X-4'].map((ref) => ({
        org_id: orgId, import_source: 'xml', type: 'house', title: `Importado ${ref}`, price: 400000, area_m2: 90,
        location: 'SRID=4326;POINT(-48.85 -26.3)', address_display: 'neighborhood', reference_code: ref,
      })))
      .select('id');
    expect(extra.error).toBeNull();
    const r = await importFeed(feedFile(sample), '--sync');
    expect(r.suspect).toBe(true);
    expect(r.trashed).toEqual([]);
    expect((await byRef('X-1')).deleted_at).toBeNull();
    await db().from('listings').delete().in('id', extra.data!.map((x) => x.id));
  }, 120_000);

  it('importação agendada: lê o endereço cadastrado, grava o resultado; feed fora do ar ou vazio não mexe em nada', async () => {
    const schedule = () => run('node', ['scripts/import-feeds.mjs', '--local', '--org', orgId], { timeout: 180_000 });
    const feedRow = async () => (await db().from('listing_feeds').select('*').eq('org_id', orgId).single()).data!;
    expect((await db().from('listing_feeds').insert({ org_id: orgId, url: `${base}/feed.xml`, requested_at: new Date().toISOString() })).error).toBeNull();

    served = sample.replace('<ListPrice currency="BRL">780000</ListPrice>', '<ListPrice currency="BRL">760000</ListPrice>');
    await schedule();
    let f = await feedRow();
    expect(f).toMatchObject({ last_status: 'ok', last_error: null });
    expect(f.last_summary).toMatchObject({ created: 0, updated: 3, trashed: 0, skipped: 2, errorCount: 0 });
    expect(Date.parse(f.last_run_at)).toBeGreaterThan(Date.parse(f.requested_at));
    expect((await byRef('AP-1001')).price).toBe(760000);

    served = null;
    await schedule();
    f = await feedRow();
    expect(f).toMatchObject({ last_status: 'erro', last_error: expect.stringMatching(/HTTP 404/) });

    served = '<?xml version="1.0"?><ListingDataFeed><Listings></Listings></ListingDataFeed>';
    await schedule();
    f = await feedRow();
    expect(f).toMatchObject({ last_status: 'erro', last_error: expect.stringMatching(/nenhum anúncio/) });
    const alive = await db().from('listings').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null);
    expect(alive.count).toBe(4); // os 3 do XML e o cadastrado pela tela
  }, 240_000);
});
