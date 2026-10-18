-- Anunciar pela unidade (item 45): o anúncio de apartamento marca a unidade no prédio (o "final", contado ao longo
-- do lado maior, de 1 a units_per_floor), e o mapa destaca só a unidade. O layout do prédio (andares × unidades por
-- andar) fica guardado por prédio do OSM e é reaproveitado pelos próximos anúncios dele.
alter table public.listings
  add column unit_position smallint check (unit_position between 1 and 12),
  add column units_per_floor smallint check (units_per_floor between 1 and 12),
  add constraint listings_unit_fits check (unit_position is null or (units_per_floor is not null and unit_position <= units_per_floor));

-- Público para leitura. Só o gatilho abaixo escreve: um layout nasce de um anúncio publicado com endereço completo,
-- para que a tabela não revele o prédio de um anúncio com o endereço oculto (ou ainda em rascunho).
create table public.building_layouts (
  osm_id text primary key check (length(osm_id) <= 40),
  floors smallint not null check (floors between 1 and 40),
  units_per_floor smallint not null check (units_per_floor between 1 and 12),
  org_id uuid references public.organizations (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.building_layouts enable row level security;
create policy building_layouts_read on public.building_layouts for select to anon, authenticated using (true);
grant select (osm_id, floors, units_per_floor, updated_at) on public.building_layouts to anon, authenticated;

create function public.listings_record_layout() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.building_osm_id is not null and new.floors between 1 and 40 and new.units_per_floor is not null
     and new.address_display = 'full' and new.published and new.deleted_at is null then
    insert into public.building_layouts (osm_id, floors, units_per_floor, org_id)
    values (new.building_osm_id, new.floors, new.units_per_floor, new.org_id)
    on conflict (osm_id) do update
      set floors = excluded.floors, units_per_floor = excluded.units_per_floor, org_id = excluded.org_id, updated_at = now();
  end if;
  return null;
end
$$;
create trigger listings_record_layout after insert or update on public.listings
for each row execute function public.listings_record_layout();

-- As colunas novas no fim da view pública (a mesma definição de 20261102000001)
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
  l.floors_built, l.construction_month, l.construction_source,
  -- a unidade só aparece no endereço completo, como o andar
  case when l.address_display = 'full' then l.unit_position end as unit_position,
  case when l.address_display = 'full' then l.units_per_floor end as units_per_floor
from public.listings l
where l.published and l.deleted_at is null and l.moderation = 'approved';

-- my_listings lista l.*: refeita para levar as colunas novas
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
