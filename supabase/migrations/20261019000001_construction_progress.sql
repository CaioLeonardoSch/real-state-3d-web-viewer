-- Obras em andamento: andares já construídos, atualizados todo mês. O mapa mostra os andares prontos sólidos e o
-- restante do prédio translúcido, com uma grua; o anúncio mostra "12 de 20 andares", o mês e a origem da informação.

alter table public.listings
  add column floors_built smallint check (floors_built between 0 and 200),
  -- primeiro dia do mês a que a informação se refere
  add column construction_month date check (construction_month = date_trunc('month', construction_month)::date),
  -- quem informou: o anunciante, uma vistoria da nossa equipe ou a estimativa por imagem aérea (serviço mensal)
  add column construction_source text check (construction_source in ('anunciante', 'vistoria', 'imagem', 'ilustrativo')),
  add constraint floors_built_le_floors check (floors_built is null or floors is null or floors_built <= floors);

-- Regras: andamento só com a obra em andamento; o mês é obrigatório junto; quem anuncia só informa como
-- "anunciante" (vistoria e imagem vêm da equipe da plataforma ou do serviço mensal, com a chave de serviço).
create function public.listings_construction_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'under_construction' then
    new.floors_built := null;
    new.construction_month := null;
    new.construction_source := null;
    return new;
  end if;
  if new.floors_built is null then
    new.construction_month := null;
    new.construction_source := null;
    return new;
  end if;
  new.construction_month := coalesce(new.construction_month, date_trunc('month', now())::date);
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_staff()
     and (tg_op = 'INSERT' or new.floors_built is distinct from old.floors_built
          or new.construction_month is distinct from old.construction_month
          or new.construction_source is distinct from old.construction_source) then
    new.construction_source := 'anunciante';
  end if;
  new.construction_source := coalesce(new.construction_source, 'anunciante');
  return new;
end
$$;
create trigger listings_construction_rules before insert or update on public.listings
for each row execute function public.listings_construction_rules();

-- Histórico mensal do andamento (para a linha do tempo da obra e o relatório do serviço mensal).
create table public.construction_history (
  listing_id uuid not null references public.listings (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  month date not null,
  floors_built smallint not null,
  source text not null,
  recorded_at timestamptz not null default now(),
  primary key (listing_id, month)
);
alter table public.construction_history enable row level security;
-- o público vê a evolução das obras publicadas; o cliente vê as dele
create policy "obra: público vê as publicadas" on public.construction_history for select
  using (public.listing_is_published(listing_id));
create policy "obra: membros veem" on public.construction_history for select using (public.is_member(org_id));
grant select on public.construction_history to anon, authenticated;

create function public.listings_record_construction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.floors_built is not null and (tg_op = 'INSERT' or new.floors_built is distinct from old.floors_built
       or new.construction_month is distinct from old.construction_month) then
    insert into public.construction_history (listing_id, org_id, month, floors_built, source)
    values (new.id, new.org_id, new.construction_month, new.floors_built, new.construction_source)
    on conflict (listing_id, month) do update set floors_built = excluded.floors_built, source = excluded.source, recorded_at = now();
  end if;
  return null;
end
$$;
create trigger listings_record_construction after insert or update on public.listings
for each row execute function public.listings_record_construction();

-- O público vê o andamento (colunas novas no fim da view, como pede o "create or replace").
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
  l.availability, l.highlight, l.published_at, l.updated_at,
  l.floors_built, l.construction_month, l.construction_source
from public.listings l
where l.published and l.deleted_at is null;

-- my_listings usa l.*: recriada para incluir as colunas novas
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
