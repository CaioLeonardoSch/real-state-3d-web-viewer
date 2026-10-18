-- Moderação (prioridade 35): aprovação prévia dos anúncios de um cliente, ligada pelo suporte, e denúncias do público.
-- O anúncio em análise ou recusado não aparece no público (public_listings); o anunciante vê o motivo ao editar.

alter table public.organizations add column listing_review boolean not null default false;

-- Só o suporte liga ou desliga a aprovação prévia (o dono edita a própria linha de organizations).
create function public.organizations_listing_review_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.listing_review is distinct from old.listing_review and not public.is_staff()
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Só o suporte da plataforma muda a aprovação prévia dos anúncios.' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger organizations_listing_review_guard before update on public.organizations
for each row execute function public.organizations_listing_review_guard();

alter table public.listings
  add column moderation text not null default 'approved' check (moderation in ('pending', 'approved', 'rejected')),
  add column moderation_note text check (moderation_note is null or length(moderation_note) <= 500),
  add column moderated_at timestamptz,
  add column moderated_by uuid references auth.users (id) on delete set null;
create index listings_moderation_idx on public.listings (moderation) where moderation <> 'approved';

-- Depois das outras regras (ordem alfabética). Fora da moderação, ninguém muda o resultado: o anúncio novo de um
-- cliente com aprovação prévia entra em análise (também pela importação), e o recusado volta para a análise quando
-- o anunciante muda alguma coisa.
create function public.listings_zz_moderation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  volatile text[] := array['updated_at', 'moderation', 'moderation_note', 'moderated_at', 'moderated_by',
    'previous_price', 'price_reduced_at', 'approx_center', 'approx_radius_m',
    'exclusive_verified', 'exclusivity_reviewed_at', 'exclusivity_reviewed_by', 'exclusivity_note'];
begin
  if coalesce(current_setting('app.moderation_review', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.moderation := case when (select o.listing_review from public.organizations o where o.id = new.org_id)
      then 'pending' else 'approved' end;
    new.moderation_note := null;
    new.moderated_at := null;
    new.moderated_by := null;
    return new;
  end if;
  new.moderation := old.moderation;
  new.moderation_note := old.moderation_note;
  new.moderated_at := old.moderated_at;
  new.moderated_by := old.moderated_by;
  if old.moderation = 'rejected' and (to_jsonb(new) - volatile) is distinct from (to_jsonb(old) - volatile) then
    new.moderation := 'pending';
  end if;
  return new;
end
$$;
create trigger listings_zz_moderation before insert or update on public.listings
for each row execute function public.listings_zz_moderation();

-- ---------------------------------------------------------------- denúncias
create table public.listing_reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  reason text not null check (reason in ('sold', 'outdated', 'wrong_info', 'fraud', 'other')),
  details text check (details is null or length(details) <= 1000),
  origin_hash text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  resolution text check (resolution is null or length(resolution) <= 500)
);
create index listing_reports_open_idx on public.listing_reports (org_id, created_at) where resolved_at is null;
create index listing_reports_origin_idx on public.listing_reports (origin_hash, created_at);
alter table public.listing_reports enable row level security;
-- os administradores do cliente leem as denúncias dos anúncios dele (e a equipe, por is_org_admin)
create policy "denúncias: administradores leem" on public.listing_reports for select using (public.is_org_admin(org_id));
-- a origem (hash do IP) fica só para o limite de denúncias
revoke all on public.listing_reports from anon, authenticated;
grant select (id, listing_id, org_id, reason, details, created_at, resolved_at, resolved_by, resolution)
  on public.listing_reports to authenticated;

-- Denúncia de um anúncio publicado. Sem conta; no máximo 3 por origem por anúncio por dia e 20 por origem por dia.
create function public.report_listing(p_listing uuid, p_reason text, p_details text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_origin text := public.lead_origin(null);
begin
  if p_reason not in ('sold', 'outdated', 'wrong_info', 'fraud', 'other') then
    raise exception 'Escolha o motivo da denúncia.' using errcode = '22023';
  end if;
  if p_reason = 'other' and nullif(btrim(coalesce(p_details, '')), '') is null then
    raise exception 'Conte o que há de errado com o anúncio.' using errcode = '22023';
  end if;
  select l.org_id into v_org from public.public_listings l where l.id = p_listing;
  if not found then
    raise exception 'Anúncio não encontrado.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('report' || v_origin, 0));
  if (select count(*) from public.listing_reports r where r.origin_hash = v_origin and r.created_at > now() - interval '1 day') >= 20
     or (select count(*) from public.listing_reports r
         where r.origin_hash = v_origin and r.listing_id = p_listing and r.created_at > now() - interval '1 day') >= 3 then
    raise exception 'Recebemos várias denúncias suas hoje. Tente de novo amanhã.' using errcode = 'P0001';
  end if;
  insert into public.listing_reports (listing_id, org_id, reason, details, origin_hash)
  values (p_listing, v_org, p_reason, nullif(left(btrim(coalesce(p_details, '')), 1000), ''), v_origin);
end
$$;
revoke execute on function public.report_listing(uuid, text, text) from public;
grant execute on function public.report_listing(uuid, text, text) to anon, authenticated;

-- Encerrar uma denúncia: a equipe ou um administrador do cliente, com o que foi feito.
create function public.resolve_report(p_report uuid, p_resolution text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select r.org_id into v_org from public.listing_reports r where r.id = p_report and r.resolved_at is null;
  if not found or not public.is_org_admin(v_org) then
    raise exception 'Denúncia não encontrada ou já encerrada.' using errcode = 'P0002';
  end if;
  update public.listing_reports
    set resolved_at = now(), resolved_by = auth.uid(), resolution = nullif(left(btrim(coalesce(p_resolution, '')), 500), '')
    where id = p_report;
end
$$;
revoke execute on function public.resolve_report(uuid, text) from public, anon;
grant execute on function public.resolve_report(uuid, text) to authenticated;

-- ---------------------------------------------------------------- fila do suporte
-- Anúncios em análise e anúncios com denúncia aberta, os mais antigos primeiro.
create function public.moderation_queue()
returns table (id uuid, org_id uuid, org_name text, title text, reference_code text, moderation text,
  published boolean, open_reports bigint, reasons text[], since timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception 'Só o suporte da plataforma modera anúncios.' using errcode = '42501';
  end if;
  return query
    select l.id, l.org_id, o.name, l.title, l.reference_code, l.moderation, l.published,
      count(r.id), coalesce(array_agg(distinct r.reason) filter (where r.id is not null), '{}'),
      least(case when l.moderation = 'pending' then l.updated_at end, min(r.created_at))
    from public.listings l
    join public.organizations o on o.id = l.org_id
    left join public.listing_reports r on r.listing_id = l.id and r.resolved_at is null
    where l.deleted_at is null and (l.moderation = 'pending' or r.id is not null)
    group by l.id, o.name
    order by 10;
end
$$;
revoke execute on function public.moderation_queue() from public, anon;
grant execute on function public.moderation_queue() to authenticated;

-- Aprovar ou recusar (também tira do ar um anúncio já aprovado). Recusar exige o motivo, que o anunciante vê.
create function public.moderate_listing(p_listing uuid, p_ok boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  if not public.is_staff() then
    raise exception 'Só o suporte da plataforma modera anúncios.' using errcode = '42501';
  end if;
  if not p_ok and note is null then
    raise exception 'Informe o motivo da recusa.' using errcode = '22023';
  end if;
  perform set_config('app.moderation_review', 'on', true);
  update public.listings
    set moderation = case when p_ok then 'approved' else 'rejected' end,
      moderation_note = case when p_ok then null else note end, moderated_at = now(), moderated_by = auth.uid()
    where id = p_listing and deleted_at is null;
  if not found then
    raise exception 'Anúncio não encontrado.' using errcode = 'P0002';
  end if;
  perform set_config('app.moderation_review', 'off', true);
end
$$;
revoke execute on function public.moderate_listing(uuid, boolean, text) from public, anon;
grant execute on function public.moderate_listing(uuid, boolean, text) to authenticated;

-- Aprovação prévia de um cliente (só a equipe lê e muda).
create function public.listing_review_of(p_org uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception 'Só o suporte da plataforma vê a aprovação prévia.' using errcode = '42501';
  end if;
  return (select o.listing_review from public.organizations o where o.id = p_org);
end
$$;
revoke execute on function public.listing_review_of(uuid) from public, anon;
grant execute on function public.listing_review_of(uuid) to authenticated;

-- ---------------------------------------------------------------- views
-- O público só vê o que foi aprovado (a mesma definição de 20261024000002, com a moderação no filtro).
create or replace view public.public_listings with (security_barrier) as
select
  l.id, l.org_id, l.type, l.title, l.description, l.transaction, l.price, l.rent_price, l.previous_price,
  l.price_reduced_at, l.condo_fee, l.iptu_value, l.iptu_period, l.area_m2, l.total_area_m2, l.land_area_m2,
  l.bedrooms, l.suites, l.bathrooms, l.parking_spots, l.covered_parking,
  case when l.address_display = 'full' then l.unit_floor end as unit_floor,
  case when l.address_display = 'full' then l.floors end as floors,
  l.towers,
  l.year_built, l.usage, l.status, l.features,
  l.address_display,
  l.address_display <> 'full' as approximate_location,
  extensions.st_asgeojson(case when l.address_display = 'full' then l.location else l.approx_center end)::jsonb as location,
  case when l.address_display = 'full' then l.building_osm_id end as building_osm_id,
  case when l.address_display = 'full' then extensions.st_asgeojson(l.footprint)::jsonb end as footprint,
  case when l.address_display = 'full' then extensions.st_asgeojson(l.lot)::jsonb end as lot,
  (case when l.address_display = 'full' then l.building_height_m end)::numeric(6, 2) as building_height_m,
  l.approx_radius_m,
  -- o CEP nunca; número e complemento só no endereço completo; a rua no completo e em "só a rua"
  jsonb_strip_nulls(case l.address_display
    when 'full' then jsonb_build_object('street', l.address -> 'street', 'number', l.address -> 'number',
      'complement', l.address -> 'complement', 'bairro', l.address -> 'bairro', 'city', l.address -> 'city')
    when 'street' then jsonb_build_object('street', l.address -> 'street', 'bairro', l.address -> 'bairro',
      'city', l.address -> 'city')
    else jsonb_build_object('bairro', l.address -> 'bairro', 'city', l.address -> 'city')
  end) as address,
  l.video_url, l.tour_url, l.advertiser, l.reference_code,
  l.exclusive and l.exclusive_verified as exclusive,
  l.availability, l.highlight, l.published_at, l.updated_at,
  l.floors_built, l.construction_month, l.construction_source
from public.listings l
where l.published and l.deleted_at is null and l.moderation = 'approved';

drop view public.my_listings;
create view public.my_listings with (security_invoker) as
select
  l.*,
  extensions.st_asgeojson(l.location)::jsonb as location_geojson,
  extensions.st_asgeojson(l.footprint)::jsonb as footprint_geojson,
  extensions.st_asgeojson(l.lot)::jsonb as lot_geojson,
  extensions.st_asgeojson(l.approx_center)::jsonb as approx_center_geojson
from public.listings l
where public.is_member(l.org_id) and l.deleted_at is null;
grant select on public.my_listings to authenticated;
