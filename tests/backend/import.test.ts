// XML import (scripts/import-xml.mjs) against the local Supabase: first import, then a second one that changes a
// price, drops a photo and leaves a listing out (--sync). Photos come from a local image server, with GPS in EXIF.
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
    (await db().from('listings').select('*, listing_photos(path, thumb_path, caption, position, is_floor_plan, source_url)').eq('org_id', orgId).eq('reference_code', ref).single()).data!;

  beforeAll(async () => {
    // photos with a GPS position in their metadata, as a phone would save them
    const jpeg = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#7a9' } })
      .jpeg()
      .withExif({ IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '26/1 18/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '48/1 50/1 0/1' } })
      .toBuffer();
    server = http.createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(jpeg)).listen(0, '127.0.0.1');
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
    expect(photos.map((p) => [p.caption, p.is_floor_plan, !!p.thumb_path])).toEqual([['Fachada', false, true], ['Sala', false, true], ['Planta', true, false]]);
    const img = Buffer.from(await (await fetch(`${URL_}/storage/v1/object/public/listing-photos/${photos[0].path}`)).arrayBuffer());
    const m = await sharp(img).metadata();
    expect(m.width).toBe(1600);
    expect(m.exif).toBeUndefined(); // sem a localização GPS da foto original

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
});
