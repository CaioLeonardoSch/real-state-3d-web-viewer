-- Endereço público por lista de campos permitidos: a view tirava do jsonb só os campos conhecidos (cep, rua, número,
-- complemento); qualquer outro campo gravado no endereço aparecia para todos. Agora ela monta o endereço só com os
-- campos que a escolha do anunciante permite (a mesma regra de publicAddress, em src/data/listingText.ts).
-- Mesmas colunas, na mesma ordem e com os mesmos tipos (exigência do "create or replace").
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
where l.published and l.deleted_at is null;
