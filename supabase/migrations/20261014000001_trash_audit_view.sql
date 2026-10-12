-- Lixeira de anúncios (30 dias para restaurar) e leitura do registro de auditoria pela tela.

-- ---------------------------------------------------------------- lixeira

alter table public.listings
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users (id) on delete set null;
create index listings_trash_idx on public.listings (org_id, deleted_at) where deleted_at is not null;

-- Quem e quando vêm do servidor; restaurar limpa os dois.
create function public.listings_trash_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- a chave de serviço (equipe técnica) corrige datas à vontade
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_at := now();
    new.deleted_by := auth.uid();
  elsif new.deleted_at is null then
    new.deleted_by := null;
  else
    new.deleted_at := old.deleted_at;
    new.deleted_by := old.deleted_by;
  end if;
  return new;
end
$$;
create trigger listings_trash_rules before update of deleted_at on public.listings
for each row execute function public.listings_trash_rules();

-- anúncio na lixeira some do público (e as fotos dele também)
create or replace function public.listing_is_published(listing uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.listings l where l.id = listing and l.published and l.deleted_at is null)
$$;

create or replace view public.public_listings with (security_barrier) as
select
  l.id, l.org_id, l.type, l.title, l.description, l.transaction, l.price, l.rent_price, l.previous_price,
  l.price_reduced_at, l.condo_fee, l.iptu_value, l.iptu_period, l.area_m2, l.total_area_m2, l.land_area_m2,
  l.bedrooms, l.suites, l.bathrooms, l.parking_spots, l.covered_parking, l.unit_floor, l.floors, l.towers,
  l.year_built, l.usage, l.status, l.features,
  l.address_display,
  l.address_display <> 'full' as approximate_location,
  extensions.st_asgeojson(case when l.address_display = 'full' then l.location else l.approx_center end)::jsonb as location,
  case when l.address_display = 'full' then l.building_osm_id end as building_osm_id,
  case when l.address_display = 'full' then extensions.st_asgeojson(l.footprint)::jsonb end as footprint,
  case when l.address_display = 'full' then extensions.st_asgeojson(l.lot)::jsonb end as lot,
  l.building_height_m,
  l.approx_radius_m,
  case l.address_display
    when 'full' then l.address - 'cep'
    when 'street' then l.address - 'cep' - 'number' - 'complement'
    else l.address - 'cep' - 'street' - 'number' - 'complement'
  end as address,
  l.video_url, l.tour_url, l.advertiser, l.reference_code,
  l.exclusive and l.exclusive_verified as exclusive,
  l.availability, l.highlight, l.published_at, l.updated_at
from public.listings l
where l.published and l.deleted_at is null;

-- my_listings: só os que não estão na lixeira (as colunas novas mudam l.*, então a view é recriada)
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

-- Lixeira do cliente: o que foi excluído, por quem e até quando pode ser restaurado.
create view public.listing_trash with (security_invoker) as
select
  l.id, l.org_id, l.title, l.type, l.price, l.created_by, l.deleted_at, l.deleted_by,
  p.full_name as deleted_by_name,
  l.deleted_at + interval '30 days' as purge_at
from public.listings l
left join public.profiles p on p.user_id = l.deleted_by
where l.deleted_at is not null and public.is_member(l.org_id);
grant select on public.listing_trash to authenticated;

-- Arquivos de anúncios apagados pela limpeza automática. O banco não apaga arquivos do storage; o site remove
-- estes pela API quando alguém da imobiliária entra.
create table public.storage_orphans (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  path text not null,
  created_at timestamptz not null default now()
);
alter table public.storage_orphans enable row level security;
create policy "storage_orphans: membros veem" on public.storage_orphans for select using (public.is_member(org_id));
create policy "storage_orphans: membros removem" on public.storage_orphans for delete using (public.is_member(org_id));
grant select, delete on public.storage_orphans to authenticated;

-- Apaga de vez o que está há mais de 30 dias na lixeira (roda todo dia). Devolve quantos anúncios apagou.
create function public.purge_trash() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  insert into public.storage_orphans (org_id, path)
  select p.org_id, f.path
  from public.listing_photos p
  join public.listings l on l.id = p.listing_id
  cross join lateral (values (p.path), (p.thumb_path)) as f (path)
  where l.deleted_at < now() - interval '30 days' and f.path is not null;
  delete from public.listings where deleted_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end
$$;
revoke execute on function public.purge_trash() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('limpar-lixeira', '17 6 * * *', 'select public.purge_trash()');

-- ---------------------------------------------------------------- registro de auditoria pela tela

-- Nome do que foi afetado, guardado na hora (título do anúncio, pessoa, e-mail do convite): o histórico continua
-- legível depois que o anúncio é apagado ou a pessoa sai.
alter table public.audit_log add column label text;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  before jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  after jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else '{}'::jsonb end;
  diff jsonb := '{}'::jsonb;
  k text;
  rec jsonb := coalesce(nullif(after, '{}'::jsonb), before);
  lbl text;
begin
  for k in select jsonb_object_keys(before || after) loop
    continue when k in ('location', 'footprint', 'lot', 'approx_center', 'updated_at', 'token');
    if before -> k is distinct from after -> k then
      diff := diff || jsonb_build_object(k, jsonb_build_array(before -> k, after -> k));
    end if;
  end loop;
  if tg_op = 'UPDATE' and diff = '{}'::jsonb then
    return null;
  end if;
  lbl := case tg_table_name
    when 'listings' then rec ->> 'title'
    when 'listing_photos' then (select l.title from public.listings l where l.id = (rec ->> 'listing_id')::uuid)
    when 'memberships' then (select coalesce(p.full_name, p.email) from public.profiles p where p.user_id = (rec ->> 'user_id')::uuid)
    when 'invitations' then rec ->> 'email'
    when 'organizations' then rec ->> 'name'
  end;
  -- fotos apagadas junto com o anúncio: a exclusão do anúncio já está registrada
  if tg_table_name = 'listing_photos' and tg_op = 'DELETE' and lbl is null then
    return null;
  end if;
  insert into public.audit_log (actor, actor_is_staff, org_id, table_name, row_id, action, changes, label)
  values (
    auth.uid(),
    public.is_staff() and not exists (
      select 1 from public.memberships m where m.org_id = (rec ->> 'org_id')::uuid and m.user_id = auth.uid()
    ),
    coalesce((rec ->> 'org_id')::uuid, case when tg_table_name = 'organizations' then (rec ->> 'id')::uuid end),
    tg_table_name,
    coalesce(rec ->> 'id', rec ->> 'user_id'),
    tg_op,
    diff,
    lbl
  );
  return null;
end
$$;

-- Página do registro de um cliente (mais recentes primeiro), com o nome de quem fez e o título do anúncio.
-- Só administradores do cliente e o suporte.
create function public.org_audit(p_org uuid, p_before bigint default null, p_limit integer default 30)
returns table (
  id bigint, at timestamptz, actor_name text, actor_email text, actor_is_staff boolean,
  table_name text, row_id text, action text, changes jsonb, listing_title text, subject text
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.at, p.full_name, p.email, a.actor_is_staff, a.table_name, a.row_id, a.action, a.changes,
    case when a.table_name in ('listings', 'listing_photos') and a.label is not null then a.label
    when a.table_name = 'listings' then coalesce(
      (select l.title from public.listings l where l.id::text = a.row_id),
      a.changes -> 'title' ->> 1, a.changes -> 'title' ->> 0
    ) when a.table_name = 'listing_photos' then (
      select l.title from public.listings l where l.id::text = (a.changes -> 'listing_id' ->> 1)
        or l.id::text = (a.changes -> 'listing_id' ->> 0) limit 1
    ) end,
    -- a pessoa afetada: membro incluído/alterado/removido, e-mail do convite
    case when a.table_name in ('memberships', 'invitations') and a.label is not null then a.label
    else case a.table_name
      when 'memberships' then (select coalesce(s.full_name, s.email) from public.profiles s where s.user_id::text = a.row_id)
      when 'invitations' then coalesce(a.changes -> 'email' ->> 1, a.changes -> 'email' ->> 0)
    end end
  from public.audit_log a
  left join public.profiles p on p.user_id = a.actor
  where a.org_id = p_org and public.is_org_admin(p_org) and (p_before is null or a.id < p_before)
  order by a.id desc
  limit least(greatest(p_limit, 1), 100)
$$;
grant execute on function public.org_audit(uuid, bigint, integer) to authenticated;
