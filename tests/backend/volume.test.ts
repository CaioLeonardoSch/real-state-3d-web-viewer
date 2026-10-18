// Many listings (audit A1): the server cuts ordinary queries at 1000 rows (max_rows), so the map reads summaries from
// map_listings / my_map_listings, one JSON per call, and the photos of one listing when it opens.
// Same setup as rls.test.ts: a running local Supabase, `npm run test:backend`.
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const URL_ = env.SUPABASE_URL;
const run = !!URL_;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = () => createClient(URL_!, env.SUPABASE_ANON_KEY!, opts);
const service = () => createClient(URL_!, env.SUPABASE_SERVICE_ROLE_KEY!, opts);
const tag = Date.now().toString(36);

const TOTAL = 5000;
const WITH_PHOTOS = 2000;
const PHOTOS = 10;

interface Summary {
  id: string;
  description?: string;
  advertiser?: unknown;
  cover?: string;
  cover_thumb?: string;
  org_name: string;
  location: { type: string } | null;
}

describe.skipIf(!run)('backend: muitos anúncios', () => {
  let org: string;
  let ids: string[] = [];
  let draft: string;

  beforeAll(async () => {
    const db = service();
    const o = await db.from('organizations').insert({ name: 'Imobiliária Grande', slug: `grande-${tag}` }).select('id').single();
    expect(o.error).toBeNull();
    org = o.data!.id;
    for (let start = 0; start < TOTAL; start += 500) {
      const rows = Array.from({ length: Math.min(500, TOTAL - start) }, (_, k) => {
        const i = start + k;
        const lon = -48.85 + (i % 100) * 0.0003;
        const lat = -26.3 + Math.floor(i / 100) * 0.0003;
        return {
          org_id: org,
          type: 'apartment',
          title: `Apartamento ${i}`,
          description: 'Descrição longa que só vem quando o anúncio abre. '.repeat(10),
          price: 300_000 + i,
          area_m2: 60,
          bedrooms: 2,
          bathrooms: 1,
          parking_spots: 1,
          location: `SRID=4326;POINT(${lon} ${lat})`,
          address: { street: 'Rua Grande', number: String(i), bairro: 'Centro', city: 'Joinville' },
          advertiser: { creci: '1-J', whatsapp: '47900000000' },
        };
      });
      const r = await db.from('listings').insert(rows).select('id');
      expect(r.error).toBeNull();
      ids.push(...r.data!.map((x) => x.id as string));
    }
    const photos = ids.slice(0, WITH_PHOTOS).flatMap((id) =>
      Array.from({ length: PHOTOS }, (_, p) => ({
        listing_id: id,
        org_id: org,
        path: `${org}/${id}/${p}.jpg`,
        thumb_path: `${org}/${id}/${p}-mini.jpg`,
        position: p,
        // the last one is the floor plan, never the cover
        is_floor_plan: p === PHOTOS - 1,
      })),
    );
    for (let start = 0; start < photos.length; start += 2000) {
      expect((await db.from('listing_photos').insert(photos.slice(start, start + 2000))).error).toBeNull();
    }
    const d = await db.from('listings').insert({ org_id: org, type: 'house', title: 'Rascunho', price: 1, area_m2: 50, bedrooms: 1, bathrooms: 1, parking_spots: 0, location: 'SRID=4326;POINT(-48.86 -26.31)', published: false }).select('id').single();
    expect(d.error).toBeNull();
    draft = d.data!.id;
  }, 120_000);

  it('uma consulta comum para em 1000 linhas; o resumo do mapa traz todos, com a capa e sem os campos longos', async () => {
    // the limit that hid listings and photos before
    expect((await anon().from('public_listings').select('id').eq('org_id', org)).data).toHaveLength(1000);
    const r = await anon().rpc('map_listings', { p_org: org });
    expect(r.error).toBeNull();
    const list = r.data as Summary[];
    expect(list).toHaveLength(TOTAL);
    expect(new Set(list.map((l) => l.id))).toEqual(new Set(ids));
    expect(list.some((l) => l.id === draft)).toBe(false);
    const byId = new Map(list.map((l) => [l.id, l]));
    for (const id of ids.slice(0, WITH_PHOTOS)) {
      expect(byId.get(id)!.cover).toBe(`${org}/${id}/0.jpg`);
      expect(byId.get(id)!.cover_thumb).toBe(`${org}/${id}/0-mini.jpg`);
    }
    expect(byId.get(ids[WITH_PHOTOS])!.cover).toBeUndefined();
    const one = list[0];
    expect(one.description).toBeUndefined();
    expect(one.advertiser).toBeUndefined();
    expect(one.org_name).toBe('Imobiliária Grande');
    expect(one.location?.type).toBe('Point');
    // a summary is small: the map of 5000 listings stays a light download
    const bytes = JSON.stringify(list).length;
    console.info(`map_listings: ${TOTAL} anúncios, ${(bytes / 1024 / 1024).toFixed(2)} MB (${Math.round(bytes / TOTAL)} bytes cada)`);
    expect(bytes / TOTAL).toBeLessThan(1500);
  });

  it('ao abrir um anúncio vêm todas as fotos e a descrição', async () => {
    const [row, photos] = await Promise.all([
      anon().from('public_listings').select('description, advertiser').eq('id', ids[WITH_PHOTOS - 1]).single(),
      anon().from('listing_photos').select('path, is_floor_plan').eq('listing_id', ids[WITH_PHOTOS - 1]),
    ]);
    expect(row.data!.description).toContain('Descrição longa');
    expect(photos.data).toHaveLength(PHOTOS);
    expect(photos.data!.filter((p) => p.is_floor_plan)).toHaveLength(1);
  });

  it('os anúncios do cliente de quem entrou vêm todos, com o rascunho; só para a equipe do cliente', { timeout: 20_000 }, async () => {
    const admin = service();
    const email = `grande-${tag}@teste.local`;
    const password = 'senha-de-teste-123';
    const u = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(u.error).toBeNull();
    const client = anon();
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    // not a member yet: nothing of this client
    const before = await client.rpc('my_map_listings');
    expect(before.error).toBeNull();
    expect((before.data as Summary[]).filter((l) => ids.includes(l.id))).toHaveLength(0);
    expect((await admin.from('memberships').insert({ org_id: org, user_id: u.data.user!.id, role: 'agent' })).error).toBeNull();
    const mine = await client.rpc('my_map_listings');
    expect(mine.error).toBeNull();
    const list = mine.data as (Summary & { published: boolean; created_by?: string; location_geojson: unknown })[];
    expect(list).toHaveLength(TOTAL + 1);
    expect(list.find((l) => l.id === draft)!.published).toBe(false);
    expect(list[0].description).toBeUndefined();
    expect(list[0].created_by).toBeUndefined();
    expect(list[0].location).toBeUndefined();
    expect(list[0].location_geojson).toBeTruthy();
    // visitors cannot call it
    expect((await anon().rpc('my_map_listings')).error).not.toBeNull();
  });
});
