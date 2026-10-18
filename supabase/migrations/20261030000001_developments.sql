-- Espelho de vendas no banco (prioridade 28): empreendimento, torre, andar e unidade, com situação, preço e reserva
-- com prazo. O desenho 3D da torre (contorno, andares, posição de cada unidade) é gerado por
-- scripts/generate-developments.mjs e enviado pelo suporte (scripts/upload-developments.mjs); a incorporadora cuida
-- do comercial: situação, preço, reservas e a planilha. Ver docs/espelho-de-vendas.md.

create type public.development_stage as enum ('launch', 'construction', 'ready');
create type public.unit_status as enum ('available', 'reserved', 'sold');

create table public.developments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- endereço do empreendimento no mapa (?empreendimento=<slug>)
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$'),
  name text not null check (length(name) between 2 and 120),
  developer text not null check (length(developer) between 1 and 120),
  address text not null default '' check (length(address) <= 200),
  stage public.development_stage not null default 'launch',
  delivery text not null default '' check (length(delivery) <= 40),
  published boolean not null default false,
  -- muitas incorporadoras não mostram preço ao público: a equipe continua vendo
  show_prices boolean not null default true,
  -- prazo padrão de uma reserva feita no espelho
  reservation_hours integer not null default 24 check (reservation_hours between 1 and 168),
  -- desenho 3D: location, center, footprint, grid, shapes, hiddenBuildingIds, floorHeightM, levels (sem unidades)
  layout jsonb not null check (coalesce(
    jsonb_typeof(layout -> 'levels') = 'array' and jsonb_typeof(layout -> 'shapes') = 'array'
    and jsonb_typeof(layout -> 'location') = 'array' and jsonb_typeof(layout -> 'center') = 'array'
    and jsonb_typeof(layout -> 'footprint') = 'object', false)),
  -- facts, estimates, sources, locationNote (o que aparece em "De onde vêm esses dados")
  info jsonb not null default '{}'::jsonb,
  progress jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index developments_org_idx on public.developments (org_id);

create table public.development_units (
  id uuid primary key default gen_random_uuid(),
  development_id uuid not null references public.developments (id) on delete cascade,
  -- copiado do empreendimento (gatilho): as políticas leem direto
  org_id uuid not null references public.organizations (id) on delete cascade,
  tower text not null default '' check (length(tower) <= 20),
  floor integer not null check (floor between -5 and 200),
  number text not null check (number ~ '^[0-9A-Za-z-]{1,12}$'),
  plan text not null default '' check (length(plan) <= 60),
  area_m2 numeric(8, 2) not null check (area_m2 > 0 and area_m2 < 100000),
  bedrooms smallint not null default 0 check (bedrooms between 0 and 20),
  suites smallint not null default 0 check (suites between 0 and 20),
  parking_spots smallint not null default 0 check (parking_spots between 0 and 20),
  -- posição no desenho: índice em layout.shapes e quantas células do andar ocupa
  shape integer not null default 0 check (shape >= 0),
  cells integer not null default 1 check (cells between 1 and 10),
  price numeric(14, 2) check (price is null or (price > 0 and price < 1e11)),
  status public.unit_status not null default 'available',
  reserved_until timestamptz,
  reserved_by uuid references auth.users (id) on delete set null,
  reserved_note text check (length(reserved_note) <= 120),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (development_id, tower, number),
  check ((status = 'reserved') = (reserved_until is not null))
);
create index development_units_org_idx on public.development_units (org_id);
create index development_units_reserved_idx on public.development_units (reserved_until) where status = 'reserved';

alter table public.developments enable row level security;
alter table public.development_units enable row level security;

-- a equipe da incorporadora vê tudo (também o que não está publicado); o público lê pelas views abaixo
create policy "membros leem os empreendimentos" on public.developments for select
  using (public.is_member(org_id));
create policy "administradores alteram o empreendimento" on public.developments for update
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy "administradores removem o empreendimento" on public.developments for delete
  using (public.is_org_admin(org_id));
create policy "membros leem as unidades" on public.development_units for select
  using (public.is_member(org_id));
create policy "administradores alteram as unidades" on public.development_units for update
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- o desenho e as unidades novas só o suporte grava (chave de serviço); reservar e importar, pelas funções abaixo
revoke all on public.developments, public.development_units from anon, authenticated;
grant select, delete on public.developments to authenticated;
grant update (name, developer, address, stage, delivery, published, show_prices, reservation_hours, info, progress)
  on public.developments to authenticated;
grant select on public.development_units to authenticated;
grant update (plan, area_m2, bedrooms, suites, parking_spots, price, status) on public.development_units to authenticated;

create function public.developments_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;
create trigger developments_rules before update on public.developments
for each row execute function public.developments_rules();

-- Unidade: org do empreendimento; disponível ou vendida apaga a reserva; "reservada" só pela reserva (com prazo)
create function public.development_units_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.development_id is distinct from old.development_id then
    select d.org_id into new.org_id from public.developments d where d.id = new.development_id;
  end if;
  if new.status <> 'reserved' then
    new.reserved_until := null;
    new.reserved_by := null;
    new.reserved_note := null;
  elsif new.reserved_until is null then
    raise exception 'Para reservar, use "Reservar" no espelho (a reserva tem prazo)' using errcode = '23514';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end
$$;
create trigger development_units_rules before insert or update on public.development_units
for each row execute function public.development_units_rules();

-- ---------------------------------------------------------------- público

create view public.public_developments with (security_barrier) as
select d.id, d.org_id, d.slug, d.name, d.developer, d.address, d.stage, d.delivery, d.show_prices, d.layout, d.info,
  d.progress, d.updated_at
from public.developments d
where d.published;

-- reserva vencida já aparece como disponível, sem esperar a limpeza; preço só quando a incorporadora mostra
create view public.public_development_units with (security_barrier) as
select u.id, u.development_id, u.tower, u.floor, u.number, u.plan, u.area_m2, u.bedrooms, u.suites, u.parking_spots,
  u.shape, u.cells,
  case when d.show_prices then u.price end as price,
  case when u.status = 'reserved' and u.reserved_until <= now() then 'available'::public.unit_status else u.status end as status
from public.development_units u
join public.developments d on d.id = u.development_id
where d.published;

grant select on public.public_developments, public.public_development_units to anon, authenticated;

-- ---------------------------------------------------------------- reservas

-- Reserva uma unidade disponível por um prazo (padrão do empreendimento; administradores escolhem até 7 dias).
-- Qualquer membro da incorporadora reserva; devolve o fim do prazo.
create function public.reserve_unit(p_unit uuid, p_hours integer default null, p_note text default null)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  u public.development_units;
  v_hours integer;
  v_until timestamptz;
begin
  select * into u from public.development_units where id = p_unit for update;
  if not found or not public.is_member(u.org_id) then
    raise exception 'Unidade não encontrada' using errcode = '42501';
  end if;
  if u.status = 'sold' then
    raise exception 'Esta unidade já foi vendida' using errcode = 'P0001';
  end if;
  if u.status = 'reserved' and u.reserved_until > now() then
    raise exception 'Esta unidade já está reservada até %', to_char(u.reserved_until at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
      using errcode = 'P0001';
  end if;
  select d.reservation_hours into v_hours from public.developments d where d.id = u.development_id;
  if p_hours is not null and public.is_org_admin(u.org_id) then
    v_hours := least(greatest(p_hours, 1), 168);
  end if;
  v_until := now() + make_interval(hours => v_hours);
  update public.development_units
    set status = 'reserved', reserved_until = v_until, reserved_by = auth.uid(), reserved_note = nullif(left(trim(p_note), 120), '')
    where id = p_unit;
  return v_until;
end
$$;

-- Desfaz a reserva: quem reservou ou um administrador.
create function public.release_unit(p_unit uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u public.development_units;
begin
  select * into u from public.development_units where id = p_unit for update;
  if not found or not public.is_member(u.org_id) then
    raise exception 'Unidade não encontrada' using errcode = '42501';
  end if;
  if u.status <> 'reserved' then
    return;
  end if;
  if u.reserved_by is distinct from auth.uid() and not public.is_org_admin(u.org_id) then
    raise exception 'Só quem reservou ou um administrador desfaz a reserva' using errcode = '42501';
  end if;
  update public.development_units set status = 'available' where id = p_unit;
end
$$;

revoke execute on function public.reserve_unit(uuid, integer, text), public.release_unit(uuid) from public, anon;
grant execute on function public.reserve_unit(uuid, integer, text), public.release_unit(uuid) to authenticated;

-- As reservas vencidas voltam a "disponível" (a view pública já mostra assim; aqui fica gravado).
create function public.release_expired_reservations() returns integer
language sql security definer set search_path = '' as $$
  with done as (
    update public.development_units set status = 'available'
    where status = 'reserved' and reserved_until <= now()
    returning 1
  )
  select count(*)::integer from done
$$;
revoke execute on function public.release_expired_reservations() from public, anon, authenticated;
select cron.schedule('liberar-reservas-vencidas', '*/10 * * * *', 'select public.release_expired_reservations()');

-- ---------------------------------------------------------------- planilha

-- Importa a planilha da incorporadora (já lida no navegador, src/backend/unitsCsv.ts): uma linha por unidade,
-- achada pela torre e pelo número. Atualiza situação, preço e o que vier preenchido; unidade que não existe no
-- desenho volta na lista "unknown" e não muda nada. Uma linha inválida desfaz a importação inteira.
create function public.import_development_units(p_development uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.developments;
  r jsonb;
  u public.development_units;
  v_status public.unit_status;
  v_until timestamptz;
  v_updated integer := 0;
  v_unknown jsonb := '[]'::jsonb;
begin
  select * into d from public.developments where id = p_development;
  if not found or not public.is_org_admin(d.org_id) then
    raise exception 'Empreendimento não encontrado' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Planilha inválida (até 5.000 linhas)' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into u from public.development_units
      where development_id = p_development and tower = coalesce(r ->> 'tower', '') and number = r ->> 'number'
      for update;
    if not found then
      v_unknown := v_unknown || jsonb_build_array(trim(concat_ws(' ', nullif(r ->> 'tower', ''), r ->> 'number')));
      continue;
    end if;
    v_status := coalesce((r ->> 'status')::public.unit_status, u.status);
    v_until := case
      when v_status <> 'reserved' then null
      when r ? 'reservedUntil' and r ->> 'reservedUntil' is not null then (r ->> 'reservedUntil')::timestamptz
      when u.status = 'reserved' then u.reserved_until
      else now() + make_interval(hours => d.reservation_hours)
    end;
    update public.development_units set
      plan = coalesce(r ->> 'plan', plan),
      area_m2 = coalesce((r ->> 'areaM2')::numeric, area_m2),
      bedrooms = coalesce((r ->> 'bedrooms')::smallint, bedrooms),
      suites = coalesce((r ->> 'suites')::smallint, suites),
      parking_spots = coalesce((r ->> 'parkingSpots')::smallint, parking_spots),
      price = case when r ? 'price' then (r ->> 'price')::numeric else price end,
      status = v_status,
      reserved_until = v_until,
      reserved_by = case when v_status = 'reserved' and u.status <> 'reserved' then auth.uid() else reserved_by end
    where id = u.id;
    v_updated := v_updated + 1;
  end loop;
  return jsonb_build_object('updated', v_updated, 'unknown', v_unknown);
end
$$;
revoke execute on function public.import_development_units(uuid, jsonb) from public, anon;
grant execute on function public.import_development_units(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- equipe

-- O espelho visto pela equipe da incorporadora: preço mesmo quando o público não vê, e quem reservou até quando.
create function public.team_development_units(p_development uuid)
returns table (
  id uuid, tower text, floor integer, number text, plan text, area_m2 numeric, bedrooms smallint, suites smallint,
  parking_spots smallint, price numeric, status public.unit_status,
  reserved_until timestamptz, reserved_by uuid, reserved_by_name text, reserved_note text
)
language sql stable security definer set search_path = '' as $$
  select u.id, u.tower, u.floor, u.number, u.plan, u.area_m2, u.bedrooms, u.suites, u.parking_spots, u.price,
    case when u.status = 'reserved' and u.reserved_until <= now() then 'available'::public.unit_status else u.status end,
    case when u.reserved_until > now() then u.reserved_until end,
    case when u.reserved_until > now() then u.reserved_by end,
    case when u.reserved_until > now() then coalesce(nullif(p.full_name, ''), p.email) end,
    case when u.reserved_until > now() then u.reserved_note end
  from public.development_units u
  left join public.profiles p on p.user_id = u.reserved_by
  where u.development_id = p_development and public.is_member(u.org_id)
  order by u.tower, u.floor, u.number
$$;
revoke execute on function public.team_development_units(uuid) from public, anon;
grant execute on function public.team_development_units(uuid) to authenticated;
