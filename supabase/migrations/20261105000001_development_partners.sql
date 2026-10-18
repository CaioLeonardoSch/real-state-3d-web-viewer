-- Espelho com a identidade de cada incorporadora e disponibilidade ao vivo para corretores credenciados (item 46).
-- A incorporadora define a identidade do empreendimento (cores, logotipo, fonte, materiais do lançamento) e
-- credencia imobiliárias parceiras: a equipe da parceira vê o espelho como a equipe da incorporadora (preço mesmo
-- quando o público não vê, reservas ao vivo) e reserva dentro de uma cota; vender continua com a incorporadora.
-- Ver docs/espelho-de-vendas.md.

-- ---------------------------------------------------------------- identidade

-- Identidade do empreendimento. Cores em #rrggbb; logotipo: endereço de uma imagem (o enviado em Minha conta, no
-- bucket site-assets, ou da própria plataforma; o CSP do mapa só carrega imagens do Supabase e do site); fonte: um
-- dos estilos do sistema (sem fonte externa); materiais: até 8 links (book, tabela, vídeo).
create function public.valid_development_brand(b jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(b) = 'object'
    and (select coalesce(bool_and(k in ('color', 'accent', 'logo', 'font', 'materials')), true) from jsonb_object_keys(b) k)
    and (not b ? 'color' or (b ->> 'color') ~ '^#[0-9a-fA-F]{6}$')
    and (not b ? 'accent' or (b ->> 'accent') ~ '^#[0-9a-fA-F]{6}$')
    and (not b ? 'logo' or ((b ->> 'logo') ~ '^(https?://|/[^/\s])[^\s"''<>()\\]*$' and length(b ->> 'logo') <= 410))
    and (not b ? 'font' or (b ->> 'font') in ('moderna', 'classica', 'geometrica', 'elegante'))
    and (not b ? 'materials' or (
      jsonb_typeof(b -> 'materials') = 'array' and jsonb_array_length(b -> 'materials') <= 8
      -- (o regex do Postgres não repete mais de 255 vezes: o tamanho vai à parte; coalesce: campo ausente recusa)
      and (select coalesce(bool_and(coalesce(
        jsonb_typeof(m) = 'object' and length(trim(m ->> 'label')) between 1 and 60
        and (m ->> 'url') ~ '^https://[^\s"''<>\\]+$' and length(m ->> 'url') <= 408, false)), true)
        from jsonb_array_elements(b -> 'materials') m)))
$$;

alter table public.developments
  add column brand jsonb not null default '{}'::jsonb check (public.valid_development_brand(brand));
grant update (brand) on public.developments to authenticated;

-- a mesma view, com a identidade no fim
create or replace view public.public_developments with (security_barrier) as
select d.id, d.org_id, d.slug, d.name, d.developer, d.address, d.stage, d.delivery, d.show_prices, d.layout, d.info,
  d.progress, d.updated_at, d.brand
from public.developments d
where d.published;

-- ---------------------------------------------------------------- imobiliárias parceiras

create table public.development_partners (
  development_id uuid not null references public.developments (id) on delete cascade,
  -- a imobiliária credenciada
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- a incorporadora (copiada do empreendimento): as políticas leem direto
  owner_org uuid not null references public.organizations (id) on delete cascade,
  -- reservas ativas ao mesmo tempo (null: sem limite)
  max_reservations smallint check (max_reservations between 1 and 500),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  primary key (development_id, org_id),
  check (org_id <> owner_org)
);
create index development_partners_org_idx on public.development_partners (org_id);
alter table public.development_partners enable row level security;
-- a incorporadora vê as parceiras; a parceira vê os próprios credenciamentos; alterar só pelas funções
create policy "incorporadora e parceira leem" on public.development_partners for select
  using (public.is_member(owner_org) or public.is_member(org_id));
revoke all on public.development_partners from anon, authenticated;
grant select on public.development_partners to authenticated;

-- quem reservou por qual canal (a incorporadora ou uma parceira): cota e vendas por canal
alter table public.development_units add column reserved_org uuid references public.organizations (id) on delete set null;

-- Disponível ou vendida apaga também o canal da reserva (o resto da regra é a de 20261030000001).
create or replace function public.development_units_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.development_id is distinct from old.development_id then
    select d.org_id into new.org_id from public.developments d where d.id = new.development_id;
  end if;
  if new.status <> 'reserved' then
    new.reserved_until := null;
    new.reserved_by := null;
    new.reserved_note := null;
    new.reserved_org := null;
  elsif new.reserved_until is null then
    raise exception 'Para reservar, use "Reservar" no espelho (a reserva tem prazo)' using errcode = '23514';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end
$$;

-- O canal pelo qual o usuário vende o empreendimento: a incorporadora, se está na equipe dela; senão a parceira
-- credenciada de que faz parte; null quando não vende.
create function public.development_channel(p_development uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select d.org_id from public.developments d where d.id = p_development and public.is_member(d.org_id)),
    (select p.org_id from public.development_partners p
      join public.developments d on d.id = p.development_id and d.published
      where p.development_id = p_development and public.is_member(p.org_id)
      order by p.created_at limit 1))
$$;
revoke execute on function public.development_channel(uuid) from public, anon;
grant execute on function public.development_channel(uuid) to authenticated;

-- Reserva: a equipe da incorporadora (como antes) ou de uma parceira credenciada, dentro da cota dela.
create or replace function public.reserve_unit(p_unit uuid, p_hours integer default null, p_note text default null)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  u public.development_units;
  v_channel uuid;
  v_max integer;
  v_hours integer;
  v_until timestamptz;
begin
  select * into u from public.development_units where id = p_unit for update;
  v_channel := case when found then public.development_channel(u.development_id) end;
  if v_channel is null then
    raise exception 'Unidade não encontrada' using errcode = '42501';
  end if;
  if u.status = 'sold' then
    raise exception 'Esta unidade já foi vendida' using errcode = 'P0001';
  end if;
  if u.status = 'reserved' and u.reserved_until > now() then
    raise exception 'Esta unidade já está reservada até %', to_char(u.reserved_until at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
      using errcode = 'P0001';
  end if;
  if v_channel <> u.org_id then
    -- a cota conta as reservas ativas da parceira neste empreendimento (trava o credenciamento: duas ao mesmo tempo
    -- não passam do limite)
    select p.max_reservations into v_max from public.development_partners p
      where p.development_id = u.development_id and p.org_id = v_channel for update;
    if v_max is not null and (
      select count(*) from public.development_units x
      where x.development_id = u.development_id and x.reserved_org = v_channel and x.status = 'reserved' and x.reserved_until > now()
    ) >= v_max then
      raise exception 'Sua imobiliária já tem % reservas ativas neste empreendimento (o limite combinado com a incorporadora)', v_max
        using errcode = 'P0001';
    end if;
  end if;
  select d.reservation_hours into v_hours from public.developments d where d.id = u.development_id;
  if p_hours is not null and public.is_org_admin(u.org_id) then
    v_hours := least(greatest(p_hours, 1), 168);
  end if;
  v_until := now() + make_interval(hours => v_hours);
  update public.development_units
    set status = 'reserved', reserved_until = v_until, reserved_by = auth.uid(), reserved_org = v_channel,
      reserved_note = nullif(left(trim(p_note), 120), '')
    where id = p_unit;
  return v_until;
end
$$;

-- Desfaz a reserva: quem reservou, um administrador da incorporadora ou da imobiliária que reservou.
create or replace function public.release_unit(p_unit uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u public.development_units;
begin
  select * into u from public.development_units where id = p_unit for update;
  if not found or public.development_channel(u.development_id) is null then
    raise exception 'Unidade não encontrada' using errcode = '42501';
  end if;
  if u.status <> 'reserved' then
    return;
  end if;
  if u.reserved_by is distinct from auth.uid() and not public.is_org_admin(u.org_id)
     and not (u.reserved_org is not null and public.is_org_admin(u.reserved_org)) then
    raise exception 'Só quem reservou ou um administrador desfaz a reserva' using errcode = '42501';
  end if;
  update public.development_units set status = 'available' where id = p_unit;
end
$$;

-- O espelho visto por quem vende: a incorporadora vê tudo (quem reservou, por qual imobiliária); a parceira vê preço
-- e situação ao vivo, mas quem reservou e a observação só das reservas dela (as outras imobiliárias são
-- concorrentes). can_release: o botão "Desfazer reserva".
drop function public.team_development_units(uuid);
create function public.team_development_units(p_development uuid)
returns table (
  id uuid, tower text, floor integer, number text, plan text, area_m2 numeric, bedrooms smallint, suites smallint,
  parking_spots smallint, price numeric, status public.unit_status,
  reserved_until timestamptz, reserved_by uuid, reserved_by_name text, reserved_note text,
  reserved_org_name text, can_release boolean
)
language sql stable security definer set search_path = '' as $$
  with ch as (select public.development_channel(p_development) as org)
  select u.id, u.tower, u.floor, u.number, u.plan, u.area_m2, u.bedrooms, u.suites, u.parking_spots, u.price,
    case when u.status = 'reserved' and u.reserved_until <= now() then 'available'::public.unit_status else u.status end,
    case when u.reserved_until > now() then u.reserved_until end,
    case when u.reserved_until > now() and (ch.org = u.org_id or u.reserved_org = ch.org) then u.reserved_by end,
    case when u.reserved_until > now() and (ch.org = u.org_id or u.reserved_org = ch.org) then coalesce(nullif(p.full_name, ''), p.email) end,
    case when u.reserved_until > now() and (ch.org = u.org_id or u.reserved_org = ch.org) then u.reserved_note end,
    case when u.reserved_until > now() and (ch.org = u.org_id or u.reserved_org = ch.org) then o.name end,
    u.reserved_until > now() and (u.reserved_by = auth.uid() or public.is_org_admin(u.org_id)
      or (u.reserved_org = ch.org and public.is_org_admin(ch.org)))
  from public.development_units u
  cross join ch
  left join public.profiles p on p.user_id = u.reserved_by
  left join public.organizations o on o.id = u.reserved_org
  where u.development_id = p_development and ch.org is not null
  order by u.tower, u.floor, u.number
$$;
revoke execute on function public.team_development_units(uuid) from public, anon;
grant execute on function public.team_development_units(uuid) to authenticated;

-- ---------------------------------------------------------------- credenciar (administradores da incorporadora)

-- Credencia uma imobiliária pelo endereço dela (?imobiliaria=<slug>), ou muda a cota de uma já credenciada.
create function public.add_development_partner(p_development uuid, p_slug text, p_max integer default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  d public.developments;
  v_org uuid;
begin
  select * into d from public.developments where id = p_development;
  if not found or not public.is_org_admin(d.org_id) then
    raise exception 'Empreendimento não encontrado' using errcode = '42501';
  end if;
  select o.id into v_org from public.organizations o where o.slug = lower(trim(p_slug));
  if v_org is null then
    raise exception 'Não achamos uma imobiliária com o endereço "%"', left(trim(p_slug), 60) using errcode = 'P0001';
  end if;
  if v_org = d.org_id then
    raise exception 'A equipe da própria incorporadora já vende o empreendimento' using errcode = 'P0001';
  end if;
  if p_max is not null and (p_max < 1 or p_max > 500) then
    raise exception 'A cota vai de 1 a 500 reservas (ou em branco, sem limite)' using errcode = '22023';
  end if;
  insert into public.development_partners (development_id, org_id, owner_org, max_reservations, created_by)
  values (p_development, v_org, d.org_id, p_max, auth.uid())
  on conflict (development_id, org_id) do update set max_reservations = excluded.max_reservations;
  return v_org;
end
$$;

-- Descredencia: as reservas ativas dela no empreendimento voltam a ficar disponíveis.
create function public.remove_development_partner(p_development uuid, p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.developments;
begin
  select * into d from public.developments where id = p_development;
  if not found or not public.is_org_admin(d.org_id) then
    raise exception 'Empreendimento não encontrado' using errcode = '42501';
  end if;
  update public.development_units set status = 'available'
    where development_id = p_development and reserved_org = p_org and status = 'reserved';
  delete from public.development_partners where development_id = p_development and org_id = p_org;
end
$$;

-- As parceiras de um empreendimento, para a incorporadora: reservas ativas de cada uma (o painel por canal).
create function public.development_partner_list(p_development uuid)
returns table (org_id uuid, name text, slug text, max_reservations smallint, active_reservations integer, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.org_id, o.name, o.slug, p.max_reservations,
    (select count(*)::integer from public.development_units u
      where u.development_id = p.development_id and u.reserved_org = p.org_id and u.status = 'reserved' and u.reserved_until > now()),
    p.created_at
  from public.development_partners p
  join public.organizations o on o.id = p.org_id
  where p.development_id = p_development and public.is_member(p.owner_org)
  order by o.name
$$;

-- Os empreendimentos que a imobiliária vende como parceira (publicados), com a cota e as reservas dela.
create function public.partner_developments(p_org uuid)
returns table (id uuid, slug text, name text, developer text, owner_name text, max_reservations smallint, active_reservations integer)
language sql stable security definer set search_path = '' as $$
  select d.id, d.slug, d.name, d.developer, o.name, p.max_reservations,
    (select count(*)::integer from public.development_units u
      where u.development_id = d.id and u.reserved_org = p.org_id and u.status = 'reserved' and u.reserved_until > now())
  from public.development_partners p
  join public.developments d on d.id = p.development_id and d.published
  join public.organizations o on o.id = d.org_id
  where p.org_id = p_org and public.is_member(p_org)
  order by d.name
$$;

revoke execute on function public.add_development_partner(uuid, text, integer), public.remove_development_partner(uuid, uuid),
  public.development_partner_list(uuid), public.partner_developments(uuid) from public, anon;
grant execute on function public.add_development_partner(uuid, text, integer), public.remove_development_partner(uuid, uuid),
  public.development_partner_list(uuid), public.partner_developments(uuid) to authenticated;
