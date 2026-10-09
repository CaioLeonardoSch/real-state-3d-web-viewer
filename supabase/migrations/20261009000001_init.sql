-- Esquema inicial: clientes (imobiliárias, construtoras), membros, anúncios, fotos e histórico de preço.
-- Multi-inquilino: toda linha de dado tem org_id, e o isolamento é feito pelo próprio banco (Row Level Security).
-- Ver docs/backend.md.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------- clientes e membros

create type public.org_kind as enum ('agency', 'developer', 'broker');
create type public.member_role as enum ('owner', 'admin', 'agent');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  kind public.org_kind not null default 'agency',
  -- endereço do site do cliente: <slug>.dominio ou domínio próprio
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'),
  creci text,
  -- marca: cores, logo, fontes (configuração, não código)
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'agent',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  whatsapp text,
  creci text,
  updated_at timestamptz not null default now()
);

-- Papel do usuário logado num cliente (null = não é membro). security definer: lê memberships sem passar pelo RLS
-- dela, o que evita recursão nas políticas.
create function public.member_role(org uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m where m.org_id = org and m.user_id = auth.uid()
$$;

create function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.org_id = org and m.user_id = auth.uid())
$$;

create function public.is_org_admin(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = org and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  )
$$;

-- Cria um cliente e torna quem criou o dono dele (numa transação só).
create function public.create_organization(p_name text, p_slug text, p_kind public.org_kind default 'agency')
returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare
  org public.organizations;
begin
  if auth.uid() is null then
    raise exception 'login necessário' using errcode = '42501';
  end if;
  insert into public.organizations (name, slug, kind) values (p_name, p_slug, p_kind) returning * into org;
  insert into public.memberships (org_id, user_id, role) values (org.id, auth.uid(), 'owner');
  return org;
end
$$;

-- ---------------------------------------------------------------- anúncios

create type public.listing_type as enum ('apartment', 'house', 'semi_detached', 'land');
create type public.transaction_kind as enum ('sale', 'rent', 'both');
create type public.construction_status as enum ('ready', 'under_construction');
create type public.availability as enum ('active', 'reserved', 'sold');
create type public.highlight as enum ('standard', 'featured', 'super');
create type public.address_display as enum ('full', 'street', 'neighborhood');

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  -- false = rascunho, visível só para o cliente
  published boolean not null default true,

  type public.listing_type not null,
  title text not null check (length(title) between 3 and 120),
  description text not null default '' check (length(description) <= 5000),
  transaction public.transaction_kind not null default 'sale',
  -- preço de venda; num anúncio só de locação é o aluguel mensal (igual a rent_price)
  price integer not null check (price > 0),
  rent_price integer check (rent_price > 0),
  -- preço riscado: mantido pelo gatilho de histórico, nunca digitado
  previous_price integer,
  price_reduced_at date,
  condo_fee integer check (condo_fee >= 0),
  iptu_value integer check (iptu_value >= 0),
  iptu_period text check (iptu_period in ('month', 'year')),

  area_m2 numeric(10, 2) not null check (area_m2 > 0),
  total_area_m2 numeric(10, 2) check (total_area_m2 >= area_m2),
  land_area_m2 numeric(10, 2) check (land_area_m2 > 0),
  bedrooms smallint not null default 0 check (bedrooms between 0 and 20),
  suites smallint check (suites >= 0 and suites <= bedrooms),
  bathrooms smallint not null default 0 check (bathrooms between 0 and 20),
  parking_spots smallint not null default 0 check (parking_spots between 0 and 50),
  covered_parking smallint check (covered_parking >= 0 and covered_parking <= parking_spots),
  unit_floor smallint,
  floors smallint check (floors between 1 and 80),
  towers smallint check (towers between 1 and 30),
  year_built smallint check (year_built between 1800 and 2100),
  usage text not null default 'residential' check (usage in ('residential', 'commercial')),
  status public.construction_status not null default 'ready',
  features text[] not null default '{}',

  -- localização: ponto do imóvel, prédio do OSM ou lote desenhado; o público vê só o que address_display permite
  location extensions.geography (point, 4326) not null,
  building_osm_id text,
  footprint extensions.geometry (multipolygon, 4326),
  lot extensions.geometry (polygon, 4326),
  building_height_m numeric(6, 2),
  address jsonb not null default '{}'::jsonb,
  address_display public.address_display not null default 'street',
  -- centro deslocado e raio mostrados quando o endereço exato não é público
  approx_center extensions.geography (point, 4326),
  approx_radius_m smallint,

  -- mídia (fotos ficam em listing_photos)
  video_url text check (video_url ~ '^https://'),
  tour_url text check (tour_url ~ '^https://'),

  -- anunciante
  advertiser jsonb not null default '{}'::jsonb,
  reference_code text,
  exclusive boolean not null default false,
  -- caminho do documento de exclusividade no storage privado; conferido antes de exclusive_verified
  exclusivity_doc text,
  exclusive_verified boolean not null default false,

  availability public.availability not null default 'active',
  highlight public.highlight not null default 'standard',
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint rent_needs_rent_price check (transaction = 'sale' or rent_price is not null),
  constraint land_has_lot check (type <> 'land' or lot is not null),
  constraint building_has_osm check (type = 'land' or building_osm_id is not null)
);

create index listings_org_idx on public.listings (org_id);
create index listings_location_idx on public.listings using gist (location);
create index listings_search_idx on public.listings (type, transaction, price) where published;
create unique index listings_reference_idx on public.listings (org_id, reference_code) where reference_code is not null;

create table public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  -- repetido de listings para as políticas não precisarem de junção
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- caminho no bucket listing-photos: <org_id>/<listing_id>/<arquivo>
  path text not null check (path like org_id::text || '/' || listing_id::text || '/%'),
  caption text check (length(caption) <= 120),
  -- 0 = capa; a planta entra com is_floor_plan
  position smallint not null default 0,
  is_floor_plan boolean not null default false,
  created_at timestamptz not null default now()
);
create index listing_photos_listing_idx on public.listing_photos (listing_id, position);

-- Histórico de preço: gravado pelo gatilho; visível só para o cliente dono do anúncio.
create table public.price_history (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  price integer not null,
  rent_price integer,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users (id) on delete set null
);
create index price_history_listing_idx on public.price_history (listing_id, changed_at);

-- ---------------------------------------------------------------- gatilhos

-- Preço riscado e histórico. O "de" é sempre um preço que esteve publicado: baixar o preço guarda o maior preço desde
-- o último aumento; subir apaga a redução. O cliente não consegue escrever previous_price diretamente.
create function public.listings_price_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.previous_price := null;
    new.price_reduced_at := null;
  elsif new.price is distinct from old.price then
    if new.price < old.price then
      new.previous_price := greatest(coalesce(old.previous_price, 0), old.price);
      new.price_reduced_at := current_date;
    else
      new.previous_price := null;
      new.price_reduced_at := null;
    end if;
  else
    new.previous_price := old.previous_price;
    new.price_reduced_at := old.price_reduced_at;
  end if;
  if tg_op = 'UPDATE' then
    -- quem criou, o cliente e a data de publicação não mudam
    new.org_id := old.org_id;
    new.created_by := old.created_by;
    new.published_at := old.published_at;
    new.updated_at := now();
  else
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  -- endereço não público: o mapa mostra um círculo de 150 m em volta de um centro deslocado de 50 a 149 m,
  -- sorteado no servidor (o local real fica sempre dentro do círculo)
  if new.address_display = 'full' then
    new.approx_center := null;
    new.approx_radius_m := null;
  elsif tg_op = 'INSERT' or new.approx_center is null or not extensions.st_equals(new.location::extensions.geometry, old.location::extensions.geometry) then
    new.approx_center := extensions.st_project(new.location, 50 + floor(random() * 100), radians(random() * 360));
    new.approx_radius_m := 150;
  else
    new.approx_center := old.approx_center;
    new.approx_radius_m := old.approx_radius_m;
  end if;
  -- verificação da exclusividade é feita pela equipe (service_role), não pelo anunciante
  if coalesce(auth.role(), '') <> 'service_role' then
    new.exclusive_verified := case when tg_op = 'UPDATE' and new.exclusive then old.exclusive_verified else false end;
  end if;
  return new;
end
$$;

create trigger listings_price_rules before insert or update on public.listings
for each row execute function public.listings_price_rules();

create function public.listings_record_price() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.price is distinct from old.price or new.rent_price is distinct from old.rent_price then
    insert into public.price_history (listing_id, org_id, price, rent_price, changed_by)
    values (new.id, new.org_id, new.price, new.rent_price, auth.uid());
  end if;
  return null;
end
$$;

create trigger listings_record_price after insert or update on public.listings
for each row execute function public.listings_record_price();

-- ---------------------------------------------------------------- Row Level Security

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.listing_photos enable row level security;
alter table public.price_history enable row level security;

-- clientes: nome, marca e slug são públicos (o site do cliente precisa deles)
create policy "organizations: leitura pública" on public.organizations for select using (true);
create policy "organizations: admins editam" on public.organizations for update
  using (public.is_org_admin(id)) with check (public.is_org_admin(id));
-- criação só pela função create_organization; exclusão só pela equipe

-- membros: cada um vê os colegas do próprio cliente; admins gerenciam
create policy "memberships: colegas veem" on public.memberships for select using (public.is_member(org_id));
create policy "memberships: admins incluem" on public.memberships for insert
  with check (public.is_org_admin(org_id) and (role <> 'owner' or public.member_role(org_id) = 'owner'));
create policy "memberships: admins alteram" on public.memberships for update
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id) and (role <> 'owner' or public.member_role(org_id) = 'owner'));
create policy "memberships: admins removem" on public.memberships for delete
  using (public.is_org_admin(org_id) and (role <> 'owner' or public.member_role(org_id) = 'owner'));

-- perfil: o próprio usuário; colegas de cliente leem
create policy "profiles: o próprio" on public.profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "profiles: colegas leem" on public.profiles for select using (
  exists (
    select 1 from public.memberships a join public.memberships b on a.org_id = b.org_id
    where a.user_id = auth.uid() and b.user_id = profiles.user_id
  )
);

-- anúncios: só membros leem a tabela (o público usa a view public_listings, que esconde o endereço exato);
-- corretor edita os seus, admin edita todos
create policy "listings: membros veem os do cliente" on public.listings for select using (public.is_member(org_id));
create policy "listings: membros criam no próprio cliente" on public.listings for insert
  with check (public.is_member(org_id));
create policy "listings: autor ou admin edita" on public.listings for update
  using (public.is_org_admin(org_id) or (public.is_member(org_id) and created_by = auth.uid()))
  with check (public.is_member(org_id));
create policy "listings: autor ou admin exclui" on public.listings for delete
  using (public.is_org_admin(org_id) or (public.is_member(org_id) and created_by = auth.uid()));

-- fotos: seguem o anúncio
create function public.listing_is_published(listing uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.listings l where l.id = listing and l.published)
$$;
create policy "photos: público vê as de anúncios publicados" on public.listing_photos for select
  using (public.listing_is_published(listing_id));
create policy "photos: membros veem" on public.listing_photos for select using (public.is_member(org_id));
create policy "photos: quem edita o anúncio gerencia" on public.listing_photos for all
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.org_id = listing_photos.org_id
        and (public.is_org_admin(l.org_id) or (public.is_member(l.org_id) and l.created_by = auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.org_id = listing_photos.org_id
        and (public.is_org_admin(l.org_id) or (public.is_member(l.org_id) and l.created_by = auth.uid()))
    )
  );

-- histórico: só o cliente dono lê; ninguém escreve diretamente (só o gatilho)
create policy "price_history: só o cliente" on public.price_history for select using (public.is_member(org_id));

-- ---------------------------------------------------------------- consultas públicas

-- O que o público vê de um anúncio publicado. Sem o endereço completo: sem o ponto exato, sem o prédio, sem o número.
-- Roda com os direitos do dono da view (filtra published por conta própria) e nunca expõe o documento de exclusividade.
create view public.public_listings with (security_barrier) as
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
where l.published;

-- Anúncios publicados dentro de um retângulo (oeste, sul, leste, norte), para a busca por área do mapa.
create function public.listings_in_bbox(w double precision, s double precision, e double precision, n double precision)
returns setof public.public_listings
language sql stable security definer set search_path = '' as $$
  select v.* from public.public_listings v
  join public.listings l on l.id = v.id
  where extensions.st_intersects(
    case when l.address_display = 'full' then l.location else l.approx_center end,
    extensions.st_makeenvelope(w, s, e, n, 4326)::extensions.geography
  )
$$;

-- Anúncios do próprio cliente, completos (RLS da tabela vale: security_invoker), com geometrias em GeoJSON.
create view public.my_listings with (security_invoker) as
select
  l.*,
  extensions.st_asgeojson(l.location)::jsonb as location_geojson,
  extensions.st_asgeojson(l.footprint)::jsonb as footprint_geojson,
  extensions.st_asgeojson(l.lot)::jsonb as lot_geojson,
  extensions.st_asgeojson(l.approx_center)::jsonb as approx_center_geojson
from public.listings l
where public.is_member(l.org_id);

-- permissões de tabela (o RLS decide as linhas)
grant usage on schema public to anon, authenticated;
grant select on public.organizations, public.listing_photos, public.public_listings to anon;
grant select on public.public_listings, public.my_listings to authenticated;
grant select, update on public.organizations to authenticated;
grant select, insert, update, delete on public.memberships, public.profiles, public.listings, public.listing_photos to authenticated;
grant select on public.price_history to authenticated;
grant execute on function public.create_organization(text, text, public.org_kind) to authenticated;
grant execute on function public.listings_in_bbox(double precision, double precision, double precision, double precision) to anon, authenticated;
