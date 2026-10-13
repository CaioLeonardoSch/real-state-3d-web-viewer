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

interface User {
  client: SupabaseClient;
  id: string;
  email: string;
}
const service = () => createClient(URL_!, SERVICE, opts);

async function userClient(name: string): Promise<User> {
  const admin = createClient(URL_!, SERVICE, opts);
  const email = `${name}-${tag}@teste.local`;
  const password = 'senha-de-teste-123';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = anon();
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { client, id: data.user.id, email };
}

/** Accepts an invitation as `u`; fails the test on error. */
async function accept(u: User, token: string) {
  const r = await u.client.rpc('accept_invitation', { p_token: token });
  expect(r.error).toBeNull();
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
  let staff: User; // suporte da plataforma
  let ana: User; // dona da imobiliária A
  let bruno: User; // corretor da A
  let carla: User; // dona da imobiliária B
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    [staff, ana, bruno, carla] = await Promise.all(['suporte', 'ana', 'bruno', 'carla'].map(userClient));
    // a equipe só entra pelo painel (chave de serviço)
    expect((await service().from('platform_staff').insert({ user_id: staff.id })).error).toBeNull();
    const a = await staff.client.rpc('create_organization', { p_name: 'Imobiliária A', p_slug: `imob-a-${tag}`, p_owner_email: ana.email });
    const b = await staff.client.rpc('create_organization', { p_name: 'Imobiliária B', p_slug: `imob-b-${tag}`, p_owner_email: carla.email.toUpperCase() });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    orgA = a.data[0].id;
    orgB = b.data[0].id;
    await accept(ana, a.data[0].invite_token);
    await accept(carla, b.data[0].invite_token); // e-mail do convite em maiúsculas: comparado sem diferença
    const inv = await ana.client.from('invitations').insert({ org_id: orgA, email: bruno.email, role: 'agent' }).select('token').single();
    expect(inv.error).toBeNull();
    await accept(bruno, inv.data!.token);
  });

  it('só a equipe da plataforma cadastra imobiliárias', async () => {
    const r = await ana.client.rpc('create_organization', { p_name: 'Minha', p_slug: `minha-${tag}` });
    expect(r.error?.message).toMatch(/equipe da plataforma/);
    const direct = await ana.client.from('organizations').insert({ name: 'Direta', slug: `direta-${tag}` });
    expect(direct.error).not.toBeNull();
  });

  it('convites: só o e-mail convidado aceita, uma vez, dentro do prazo', async () => {
    const inv = await ana.client.from('invitations').insert({ org_id: orgA, email: `novo-${tag}@teste.local`, role: 'agent' }).select('token').single();
    const token = inv.data!.token;
    const info = await anon().rpc('invitation_info', { p_token: token });
    expect(info.data[0]).toMatchObject({ org_name: 'Imobiliária A', expired: false, accepted: false });
    const wrong = await carla.client.rpc('accept_invitation', { p_token: token });
    expect(wrong.error?.message).toMatch(/este convite é para novo-/);
    const reused = await bruno.client.rpc('accept_invitation', { p_token: (await ana.client.from('invitations').select('token').eq('email', bruno.email).single()).data!.token });
    expect(reused.error?.message).toMatch(/já foi usado/);
    const late = await ana.client.from('invitations').insert({ org_id: orgA, email: carla.email, role: 'agent' }).select('id, token').single();
    await service().from('invitations').update({ expires_at: '2020-01-01' }).eq('id', late.data!.id);
    expect((await carla.client.rpc('accept_invitation', { p_token: late.data!.token })).error?.message).toMatch(/expirou/);
  });

  it('convites: corretor não convida; administrador não convida dono; convite pendente aparece para a pessoa', async () => {
    const byAgent = await bruno.client.from('invitations').insert({ org_id: orgA, email: `x-${tag}@teste.local`, role: 'agent' });
    expect(byAgent.error).not.toBeNull();
    await ana.client.from('memberships').update({ role: 'admin' }).eq('org_id', orgA).eq('user_id', bruno.id);
    const ownerByAdmin = await bruno.client.from('invitations').insert({ org_id: orgA, email: `y-${tag}@teste.local`, role: 'owner' });
    expect(ownerByAdmin.error).not.toBeNull();
    const ok = await bruno.client.from('invitations').insert({ org_id: orgA, email: carla.email, role: 'agent' });
    expect(ok.error).toBeNull();
    const pending = await carla.client.rpc('my_invitations');
    expect(pending.data.map((p: { org_name: string }) => p.org_name)).toContain('Imobiliária A');
    await ana.client.from('memberships').update({ role: 'agent' }).eq('org_id', orgA).eq('user_id', bruno.id);
    await ana.client.from('invitations').delete().eq('org_id', orgA).eq('email', carla.email);
    expect((await carla.client.rpc('my_invitations')).data).toHaveLength(0);
  });

  it('membros: a dona vê nome e e-mail da equipe dela; outra imobiliária não vê; o único dono não sai', async () => {
    const m = await ana.client.rpc('org_members', { p_org: orgA });
    expect(m.data.map((x: { email: string }) => x.email).sort()).toEqual([ana.email, bruno.email].sort());
    expect((await carla.client.rpc('org_members', { p_org: orgA })).data).toHaveLength(0);
    const leave = await ana.client.from('memberships').delete().eq('org_id', orgA).eq('user_id', ana.id);
    expect(leave.error?.message).toMatch(/pelo menos um dono/);
  });

  it('suporte: edita anúncio de qualquer cliente, e fica registrado como suporte; o registro é só do cliente', async () => {
    const l = await bruno.client.from('listings').insert(listingRow(orgA)).select('id').single();
    const upd = await staff.client.from('listings').update({ title: 'Corrigido pelo suporte' }).eq('id', l.data!.id).select('id');
    expect(upd.data).toHaveLength(1);
    const orgs = await staff.client.rpc('my_organizations');
    expect(orgs.data.map((o: { id: string }) => o.id)).toEqual(expect.arrayContaining([orgA, orgB]));
    const log = await ana.client.from('audit_log').select('actor, actor_is_staff, action, changes').eq('row_id', l.data!.id).order('id');
    expect(log.data!.map((e) => e.action)).toEqual(['INSERT', 'UPDATE']);
    expect(log.data![1]).toMatchObject({ actor: staff.id, actor_is_staff: true, changes: { title: ['Apartamento de teste', 'Corrigido pelo suporte'] } });
    expect(log.data![0]).toMatchObject({ actor: bruno.id, actor_is_staff: false });
    expect((await carla.client.from('audit_log').select('id').eq('row_id', l.data!.id)).data).toHaveLength(0);
    expect((await bruno.client.from('audit_log').select('id').eq('org_id', orgA)).data).toHaveLength(0); // corretor não lê
    expect((await anon().from('audit_log').select('id')).data ?? []).toHaveLength(0);
  });

  it('lixeira: some do público, aparece na lixeira com quem excluiu, e pode ser restaurado', async () => {
    const l = await bruno.client.from('listings').insert(listingRow(orgA)).select('id').single();
    const id = l.data!.id;
    // a data vem do servidor: tentar antedatar não adianta
    await bruno.client.from('listings').update({ deleted_at: '2020-01-01T00:00:00Z' }).eq('id', id);
    expect((await anon().from('public_listings').select('id').eq('id', id)).data).toHaveLength(0);
    expect((await bruno.client.from('my_listings').select('id').eq('id', id)).data).toHaveLength(0);
    const trash = (await ana.client.from('listing_trash').select('*').eq('id', id).single()).data!;
    expect(trash.deleted_by).toBe(bruno.id);
    expect(new Date(trash.deleted_at).getFullYear()).toBeGreaterThan(2025);
    expect((await carla.client.from('listing_trash').select('id').eq('id', id)).data).toHaveLength(0);
    await bruno.client.from('listings').update({ deleted_at: null }).eq('id', id);
    expect((await anon().from('public_listings').select('id').eq('id', id)).data).toHaveLength(1);
  });

  it('limpeza automática: apaga o que passou de 30 dias e anota os arquivos para o site remover', async () => {
    const l = await bruno.client.from('listings').insert(listingRow(orgA)).select('id').single();
    const id = l.data!.id;
    const path = `${orgA}/${id}/velha.jpg`;
    await bruno.client.from('listing_photos').insert({ listing_id: id, org_id: orgA, path, thumb_path: `${orgA}/${id}/velha-mini.jpg` });
    await bruno.client.from('listings').update({ deleted_at: 'now()' }).eq('id', id);
    expect((await anon().rpc('purge_trash')).error).not.toBeNull();
    expect((await bruno.client.rpc('purge_trash')).error).not.toBeNull();
    await service().from('listings').update({ deleted_at: new Date(Date.now() - 31 * 86400000).toISOString() }).eq('id', id);
    const purged = await service().rpc('purge_trash');
    expect(purged.data).toBeGreaterThanOrEqual(1);
    expect((await service().from('listings').select('id').eq('id', id)).data).toHaveLength(0);
    const orphans = await bruno.client.from('storage_orphans').select('path').like('path', `%/${id}/%`);
    expect(orphans.data!.map((o) => o.path).sort()).toEqual([path, `${orgA}/${id}/velha-mini.jpg`].sort());
    expect((await carla.client.from('storage_orphans').select('id').like('path', `%/${id}/%`)).data).toHaveLength(0);
  });

  it('registro pela tela: administradores leem com nomes e títulos; corretor e outra imobiliária não', async () => {
    const page = await ana.client.rpc('org_audit', { p_org: orgA, p_limit: 100 });
    expect(page.error).toBeNull();
    const rows = page.data as { table_name: string; action: string; subject: string | null; listing_title: string | null; actor_email: string | null }[];
    expect(rows.some((r) => r.table_name === 'memberships' && r.action === 'INSERT' && r.subject === bruno.email)).toBe(true);
    expect(rows.some((r) => r.table_name === 'listings' && r.listing_title)).toBe(true);
    expect(rows.some((r) => r.actor_email === bruno.email)).toBe(true);
    const older = await ana.client.rpc('org_audit', { p_org: orgA, p_before: (page.data as { id: number }[])[0].id, p_limit: 1 });
    expect(older.data).toHaveLength(1);
    expect((await bruno.client.rpc('org_audit', { p_org: orgA })).data).toHaveLength(0);
    expect((await carla.client.rpc('org_audit', { p_org: orgA })).data).toHaveLength(0);
  });

  describe('contatos (leads)', () => {
    const consent = 'Concordo em compartilhar meus dados com a Imobiliária A.';
    const lead = (listing: string, extra: Record<string, unknown> = {}) => ({
      p_listing: listing, p_source: 'form', p_name: 'Visitante', p_email: `visitante-${Math.random().toString(36).slice(2)}@x.com`,
      p_phone: `(47) 9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, p_message: 'Tenho interesse', p_consent: true, p_consent_text: consent, ...extra,
    });
    let listingId: string;
    beforeAll(async () => {
      listingId = (await bruno.client.from('listings').insert(listingRow(orgA)).select('id').single()).data!.id;
    });

    it('visitante envia; o contato vai para o corretor do anúncio, com o consentimento registrado', async () => {
      const r = await anon().rpc('submit_lead', lead(listingId, { p_phone: '(47) 98888-7777' }));
      expect(r.error).toBeNull();
      const mine = await bruno.client.from('leads').select('*').eq('id', r.data).single();
      expect(mine.data).toMatchObject({ assigned_to: bruno.id, status: 'new', listing_title: 'Apartamento de teste', consent_text: consent, phone: '47988887777' });
      expect(mine.data!.consented_at).not.toBeNull();
      expect((await ana.client.from('leads').select('id').eq('id', r.data)).data).toHaveLength(1); // admin vê
      expect((await carla.client.from('leads').select('id').eq('id', r.data)).data).toHaveLength(0);
      expect((await anon().from('leads').select('id').eq('id', r.data)).data ?? []).toHaveLength(0);
      expect((await bruno.client.rpc('my_new_leads', { p_org: orgA })).data).toBeGreaterThanOrEqual(1);
    });

    it('sem consentimento, sem nome ou sem contato é recusado; robô é descartado em silêncio', async () => {
      expect((await anon().rpc('submit_lead', lead(listingId, { p_consent: false }))).error?.message).toMatch(/concordar/);
      expect((await anon().rpc('submit_lead', lead(listingId, { p_name: ' ' }))).error?.message).toMatch(/nome/);
      expect((await anon().rpc('submit_lead', lead(listingId, { p_email: null, p_phone: '123' }))).error?.message).toMatch(/e-mail ou um telefone/);
      const bot = await anon().rpc('submit_lead', lead(listingId, { p_trap: 'http://spam', p_name: 'Robô' }));
      expect(bot.error).toBeNull();
      expect((await ana.client.from('leads').select('id').eq('name', 'Robô')).data).toHaveLength(0);
      const draft = (await ana.client.from('listings').insert(listingRow(orgA, { published: false })).select('id').single()).data!.id;
      expect((await anon().rpc('submit_lead', lead(draft))).error?.message).toMatch(/não encontrado/);
    });

    it('o corretor muda situação e anotações, mas não os dados do visitante nem o responsável', async () => {
      const id = (await anon().rpc('submit_lead', lead(listingId))).data;
      const upd = await bruno.client.from('leads').update({ status: 'contacted', notes: 'Ligar sexta', name: 'Outro', assigned_to: ana.id }).eq('id', id).select('*').single();
      expect(upd.data).toMatchObject({ status: 'contacted', notes: 'Ligar sexta', name: 'Visitante', assigned_to: bruno.id });
      const reassign = await ana.client.from('leads').update({ assigned_to: ana.id }).eq('id', id).select('assigned_to').single();
      expect(reassign.data!.assigned_to).toBe(ana.id);
      expect((await bruno.client.from('leads').select('id').eq('id', id)).data).toHaveLength(0); // não é mais dele
      expect((await ana.client.from('leads').update({ assigned_to: carla.id }).eq('id', id)).error?.message).toMatch(/equipe/);
      expect((await bruno.client.from('leads').delete().eq('id', id).select('id')).data ?? []).toHaveLength(0);
      expect((await ana.client.from('leads').delete().eq('id', id).select('id')).data).toHaveLength(1); // pedido LGPD
    });

    it('clique no WhatsApp vira contato sem dados pessoais; contatos não vão para o registro de auditoria', async () => {
      const id = (await anon().rpc('submit_lead', { p_listing: listingId, p_source: 'whatsapp', p_name: 'Ignorado', p_email: 'x@y.com' })).data;
      const w = (await bruno.client.from('leads').select('source, name, email, phone').eq('id', id).single()).data!;
      expect(w).toEqual({ source: 'whatsapp', name: null, email: null, phone: null });
      expect((await ana.client.from('audit_log').select('id').eq('table_name', 'leads')).data).toHaveLength(0);
    });

    it('limite: a mesma pessoa no mesmo anúncio, 3 por dia', async () => {
      const same = lead(listingId, { p_email: `repetido-${tag}@x.com`, p_phone: null });
      // origem compartilhada pelos testes: limpa os recentes para não bater no limite de 5 em 10 minutos
      await service().from('leads').update({ created_at: '2020-01-01' }).neq('id', '00000000-0000-0000-0000-000000000000');
      for (let i = 0; i < 3; i++) expect((await anon().rpc('submit_lead', same)).error).toBeNull();
      expect((await anon().rpc('submit_lead', same)).error?.message).toMatch(/já enviou/);
    });

    it('limite: 5 envios em 10 minutos pela mesma origem', async () => {
      await service().from('leads').update({ created_at: '2020-01-01' }).neq('id', '00000000-0000-0000-0000-000000000000');
      for (let i = 0; i < 5; i++) expect((await anon().rpc('submit_lead', lead(listingId))).error).toBeNull();
      expect((await anon().rpc('submit_lead', lead(listingId))).error?.message).toMatch(/muitos envios/);
      await service().from('leads').update({ created_at: '2020-01-01' }).neq('id', '00000000-0000-0000-0000-000000000000');
    });

    it.skipIf(!env.MAIL_LOG)('aviso por e-mail ao corretor, uma vez só, com resposta direta ao visitante', async () => {
      const { readFileSync } = await import(/* @vite-ignore */ 'node:fs' as string);
      const id = (await anon().rpc('submit_lead', lead(listingId, { p_name: 'Maria Compradora', p_message: 'Posso visitar sábado?', p_phone: '(47) 98888-7777' }))).data;
      const call = () => fetch(`${URL_}/functions/v1/notify-lead`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: id }) }).then((r) => r.json());
      expect(await call()).toEqual({ sent: true, to: 1 });
      expect(await call()).toMatchObject({ sent: false }); // não repete
      const sent = readFileSync(env.MAIL_LOG, 'utf8').trim().split('\n').map((l: string) => JSON.parse(l)).find((m: { text: string }) => m.text.includes('Maria Compradora'));
      expect(sent.to).toEqual([bruno.email]);
      expect(sent.subject).toBe('Novo contato: Apartamento de teste');
      expect(sent.reply_to).toMatch(/^visitante-/);
      expect(sent.text).toMatch(/Posso visitar sábado\?/);
      expect(sent.text).toMatch(/wa\.me\/5547988887777/);
      expect((await bruno.client.from('leads').select('notified_at').eq('id', id).single()).data!.notified_at).not.toBeNull();
    }, 30_000); // the first call boots the function
  });

  it.skipIf(!env.MAIL_LOG)('convite por e-mail: só quem administra o cliente pede; vai uma vez, com o link', async () => {
    const { readFileSync } = await import(/* @vite-ignore */ 'node:fs' as string);
    const email = `convidado-email-${tag}@teste.local`;
    const inv = await ana.client.from('invitations').insert({ org_id: orgA, email, role: 'agent' }).select('token').single();
    const token = inv.data!.token;
    const send = async (u: User | null) =>
      fetch(`${URL_}/functions/v1/send-invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON,
          ...(u ? { Authorization: `Bearer ${(await u.client.auth.getSession()).data.session!.access_token}` } : {}),
        },
        body: JSON.stringify({ token }),
      });
    expect((await send(null)).status).toBe(401);
    expect((await send(carla)).status).toBe(404); // outra imobiliária não enxerga o convite
    expect((await send(bruno)).status).toBe(404); // corretor também não
    expect(await (await send(ana)).json()).toEqual({ sent: true });
    expect(await (await send(ana)).json()).toMatchObject({ sent: false, reason: 'já enviado' });
    const mail = readFileSync(env.MAIL_LOG, 'utf8').trim().split('\n').map((l: string) => JSON.parse(l)).find((m: { to: string[] }) => m.to[0] === email);
    expect(mail.subject).toBe('Convite: equipe da Imobiliária A');
    expect(mail.text).toContain(`?convite=${token}`);
    expect(mail.text).toMatch(/como corretor\(a\)/);
  }, 30_000);

  it('ninguém se coloca na equipe da plataforma', async () => {
    const r = await ana.client.from('platform_staff').insert({ user_id: ana.id });
    expect(r.error).not.toBeNull();
    expect((await ana.client.rpc('is_staff')).data).toBe(false);
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

  it('editar sem mudar de lugar mantém o círculo aproximado; mudar de lugar sorteia de novo', async () => {
    const l = await ana.client.from('listings').insert(listingRow(orgA, { address_display: 'street' })).select('id').single();
    const center = async () => (await anon().from('public_listings').select('location').eq('id', l.data!.id).single()).data!.location.coordinates;
    const c0 = await center();
    // mesmo ponto com diferença de arredondamento (como o centro recalculado no formulário)
    await ana.client.from('listings').update({ title: 'Editado', location: point(-48.8500001, -26.3000001) }).eq('id', l.data!.id);
    expect(await center()).toEqual(c0);
    await ana.client.from('listings').update({ location: point(-48.86, -26.31) }).eq('id', l.data!.id);
    expect(await center()).not.toEqual(c0);
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
    expect((await carla.client.storage.from('listing-photos').list(`${orgA}/${l.data!.id}`)).data ?? []).toHaveLength(0);
    expect((await bruno.client.storage.from('listing-photos').list(`${orgA}/${l.data!.id}`)).data).toHaveLength(1);
    const rm = await carla.client.storage.from('listing-photos').remove([path]);
    expect(rm.data ?? []).toHaveLength(0);
    expect((await bruno.client.storage.from('listing-photos').list(`${orgA}/${l.data!.id}`)).data).toHaveLength(1);
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
    // a dona inclui pelo convite; incluir direto pelo id também é recusado para quem não é administrador
    expect((await carla.client.rpc('org_members', { p_org: orgA })).data).toHaveLength(0);
  });

  it('busca por área do mapa devolve só publicados dentro do retângulo', async () => {
    const inside = await ana.client.from('listings').insert(listingRow(orgA, { location: point(-48.7001, -26.2001), address_display: 'full' })).select('id').single();
    const r = await anon().rpc('listings_in_bbox', { w: -48.701, s: -26.201, e: -48.699, n: -26.199 });
    expect(r.error).toBeNull();
    expect(r.data.map((x: { id: string }) => x.id)).toContain(inside.data!.id);
    expect(r.data.every((x: { location: { coordinates: number[] } }) => x.location.coordinates[0] > -48.71)).toBe(true);
  });
});
