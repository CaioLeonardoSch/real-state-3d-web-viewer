// Backend tests against a running Supabase (local: `npx supabase start`, then `npm run test:backend`).
// Skipped by plain `npm test` when SUPABASE_URL is not set.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

// tests run in Node; the project's tsconfig has only browser types
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const URL_ = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY!;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY!;
const run = !!URL_;

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = () => createClient(URL_!, ANON, opts);
const tag = Date.now().toString(36);

async function userClient(name: string): Promise<{ client: SupabaseClient; id: string }> {
  const admin = createClient(URL_!, SERVICE, opts);
  const email = `${name}-${tag}@teste.local`;
  const password = 'senha-de-teste-123';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = anon();
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { client, id: data.user.id };
}

const point = (lon: number, lat: number) => `SRID=4326;POINT(${lon} ${lat})`;
const square = (lon: number, lat: number, d = 0.0001) =>
  `SRID=4326;MULTIPOLYGON(((${lon} ${lat},${lon + d} ${lat},${lon + d} ${lat + d},${lon} ${lat + d},${lon} ${lat})))`;
const listingRow = (org: string, extra: Record<string, unknown> = {}) => ({
  org_id: org,
  type: 'apartment',
  title: 'Apartamento de teste',
  price: 500_000,
  area_m2: 70,
  bedrooms: 2,
  bathrooms: 1,
  parking_spots: 1,
  location: point(-48.85, -26.3),
  building_osm_id: 'way/1',
  footprint: square(-48.85, -26.3),
  address: { cep: '89201-000', street: 'Rua das Flores', number: '100', complement: 'apto 3', bairro: 'Centro', city: 'Joinville' },
  advertiser: { creci: '12345-J', whatsapp: '47900000000' },
  ...extra,
});

describe.skipIf(!run)('backend: clientes, anúncios e permissões', () => {
  let ana: { client: SupabaseClient; id: string }; // dona da imobiliária A
  let bruno: { client: SupabaseClient; id: string }; // corretor da A
  let carla: { client: SupabaseClient; id: string }; // dona da imobiliária B
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    [ana, bruno, carla] = await Promise.all([userClient('ana'), userClient('bruno'), userClient('carla')]);
    const a = await ana.client.rpc('create_organization', { p_name: 'Imobiliária A', p_slug: `imob-a-${tag}` });
    const b = await carla.client.rpc('create_organization', { p_name: 'Imobiliária B', p_slug: `imob-b-${tag}` });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    orgA = a.data.id;
    orgB = b.data.id;
    const m = await ana.client.from('memberships').insert({ org_id: orgA, user_id: bruno.id, role: 'agent' });
    expect(m.error).toBeNull();
  });

  it('visitante não cria cliente nem anúncio', async () => {
    const r = await anon().rpc('create_organization', { p_name: 'X', p_slug: `x-${tag}` });
    expect(r.error).not.toBeNull();
    const l = await anon().from('listings').insert(listingRow(orgA));
    expect(l.error).not.toBeNull();
  });

  it('membro cria anúncio no próprio cliente, não no de outro', async () => {
    const ok = await bruno.client.from('listings').insert(listingRow(orgA)).select('id, created_by').single();
    expect(ok.error).toBeNull();
    expect(ok.data!.created_by).toBe(bruno.id);
    const other = await bruno.client.from('listings').insert(listingRow(orgB));
    expect(other.error).not.toBeNull();
  });

  it('corretor só edita os próprios anúncios; o admin edita todos; outro cliente não edita nada', async () => {
    const mine = await bruno.client.from('listings').insert(listingRow(orgA)).select('id').single();
    const anas = await ana.client.from('listings').insert(listingRow(orgA)).select('id').single();
    const upd = (c: SupabaseClient, id: string) => c.from('listings').update({ title: 'Título alterado' }).eq('id', id).select('id');
    expect((await upd(bruno.client, mine.data!.id)).data).toHaveLength(1);
    expect((await upd(bruno.client, anas.data!.id)).data).toHaveLength(0);
    expect((await upd(ana.client, mine.data!.id)).data).toHaveLength(1);
    expect((await upd(carla.client, mine.data!.id)).data).toHaveLength(0);
    const del = await carla.client.from('listings').delete().eq('id', mine.data!.id).select('id');
    expect(del.data).toHaveLength(0);
  });

  it('o público lê pela view, sem o endereço exato quando o anunciante escolheu esconder', async () => {
    const full = await ana.client.from('listings').insert(listingRow(orgA, { address_display: 'full' })).select('id').single();
    const street = await ana.client.from('listings').insert(listingRow(orgA, { address_display: 'street' })).select('id').single();
    const hood = await ana.client.from('listings').insert(listingRow(orgA, { address_display: 'neighborhood' })).select('id').single();
    const direct = await anon().from('listings').select('id').eq('id', full.data!.id);
    expect(direct.data ?? []).toHaveLength(0); // a tabela não é pública

    const get = async (id: string) => (await anon().from('public_listings').select('*').eq('id', id).single()).data!;
    const f = await get(full.data!.id);
    expect(f.building_osm_id).toBe('way/1');
    expect(f.address).toMatchObject({ street: 'Rua das Flores', number: '100' });
    expect(f.address.cep).toBeUndefined();
    expect(f.location).toEqual({ type: 'Point', coordinates: [-48.85, -26.3] });

    const s = await get(street.data!.id);
    expect(s.address).toEqual({ street: 'Rua das Flores', bairro: 'Centro', city: 'Joinville' });
    expect(s.building_osm_id).toBeNull();
    expect(s.footprint).toBeNull();
    expect(s.approximate_location).toBe(true);
    expect(s.approx_radius_m).toBe(150);
    // centro deslocado de 50 a 149 m: nunca o ponto real, sempre dentro do círculo
    const [lon, lat] = s.location.coordinates;
    const dist = Math.hypot((lon + 48.85) * 111320 * Math.cos((26.3 * Math.PI) / 180), (lat + 26.3) * 110540);
    expect(dist).toBeGreaterThan(45);
    expect(dist).toBeLessThan(150);

    const h = await get(hood.data!.id);
    expect(h.address).toEqual({ bairro: 'Centro', city: 'Joinville' });
  });

  it('rascunho não aparece para o público', async () => {
    const d = await ana.client.from('listings').insert(listingRow(orgA, { published: false })).select('id').single();
    const pub = await anon().from('public_listings').select('id').eq('id', d.data!.id);
    expect(pub.data).toHaveLength(0);
    const mine = await ana.client.from('my_listings').select('id').eq('id', d.data!.id);
    expect(mine.data).toHaveLength(1);
  });

  it('baixar o preço gera o preço riscado; o histórico é só do cliente; o anunciante não forja o preço anterior', async () => {
    const l = await ana.client
      .from('listings')
      .insert(listingRow(orgA, { price: 600_000, previous_price: 900_000 }))
      .select('id, previous_price')
      .single();
    expect(l.data!.previous_price).toBeNull(); // ignorado na criação
    const id = l.data!.id;
    await ana.client.from('listings').update({ price: 550_000 }).eq('id', id);
    await ana.client.from('listings').update({ price: 520_000 }).eq('id', id);
    const pub = (await anon().from('public_listings').select('price, previous_price, price_reduced_at').eq('id', id).single()).data!;
    expect(pub).toMatchObject({ price: 520_000, previous_price: 600_000 });
    expect(pub.price_reduced_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const forged = await ana.client.from('listings').update({ previous_price: 2_000_000 }).eq('id', id).select('previous_price').single();
    expect(forged.data!.previous_price).toBe(600_000);

    const hist = await ana.client.from('price_history').select('price').eq('listing_id', id).order('changed_at');
    expect(hist.data!.map((h) => h.price)).toEqual([600_000, 550_000, 520_000]);
    expect((await anon().from('price_history').select('id').eq('listing_id', id)).data ?? []).toHaveLength(0);
    expect((await carla.client.from('price_history').select('id').eq('listing_id', id)).data).toHaveLength(0);

    await ana.client.from('listings').update({ price: 700_000 }).eq('id', id);
    const up = (await anon().from('public_listings').select('previous_price').eq('id', id).single()).data!;
    expect(up.previous_price).toBeNull(); // subir o preço apaga a redução
  });

  it('exclusividade só vale depois de conferida pela equipe', async () => {
    const l = await ana.client
      .from('listings')
      .insert(listingRow(orgA, { exclusive: true, exclusive_verified: true }))
      .select('id, exclusive_verified')
      .single();
    expect(l.data!.exclusive_verified).toBe(false);
    expect((await anon().from('public_listings').select('exclusive').eq('id', l.data!.id).single()).data!.exclusive).toBe(false);
    const admin = createClient(URL_!, SERVICE, opts);
    await admin.from('listings').update({ exclusive_verified: true }).eq('id', l.data!.id);
    expect((await anon().from('public_listings').select('exclusive').eq('id', l.data!.id).single()).data!.exclusive).toBe(true);
  });

  it('fotos: membros enviam na pasta do cliente; o público vê; outro cliente não grava lá', async () => {
    const l = await bruno.client.from('listings').insert(listingRow(orgA)).select('id').single();
    const path = `${orgA}/${l.data!.id}/capa.jpg`;
    const jpg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
    const up = await bruno.client.storage.from('listing-photos').upload(path, jpg);
    expect(up.error).toBeNull();
    const row = await bruno.client.from('listing_photos').insert({ listing_id: l.data!.id, org_id: orgA, path, caption: 'Sala' });
    expect(row.error).toBeNull();
    const pub = await anon().from('listing_photos').select('path, caption').eq('listing_id', l.data!.id);
    expect(pub.data).toEqual([{ path, caption: 'Sala' }]);
    const bad = await carla.client.storage.from('listing-photos').upload(`${orgA}/${l.data!.id}/invasao.jpg`, jpg);
    expect(bad.error).not.toBeNull();
    const badRow = await carla.client
      .from('listing_photos')
      .insert({ listing_id: l.data!.id, org_id: orgA, path: `${orgA}/${l.data!.id}/x.jpg` });
    expect(badRow.error).not.toBeNull();
  });

  it('corretor não se promove nem inclui pessoas', async () => {
    const promote = await bruno.client.from('memberships').update({ role: 'admin' }).eq('org_id', orgA).eq('user_id', bruno.id).select();
    expect(promote.data ?? []).toHaveLength(0);
    const add = await bruno.client.from('memberships').insert({ org_id: orgA, user_id: carla.id, role: 'agent' });
    expect(add.error).not.toBeNull();
  });

  it('busca por área do mapa devolve só publicados dentro do retângulo', async () => {
    const inside = await ana.client.from('listings').insert(listingRow(orgA, { location: point(-48.7001, -26.2001), address_display: 'full' })).select('id').single();
    const r = await anon().rpc('listings_in_bbox', { w: -48.701, s: -26.201, e: -48.699, n: -26.199 });
    expect(r.error).toBeNull();
    expect(r.data.map((x: { id: string }) => x.id)).toContain(inside.data!.id);
    expect(r.data.every((x: { location: { coordinates: number[] } }) => x.location.coordinates[0] > -48.71)).toBe(true);
  });
});
