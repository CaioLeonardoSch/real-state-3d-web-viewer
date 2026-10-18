-- Métricas por anúncio (prioridade 24): visualizações por dia, separadas entre o mapa e o site do cliente. Mensagens
-- e cliques no WhatsApp já estão em leads. A equipe lê pela função listing_stats: o corretor, os próprios anúncios;
-- os administradores, todos os do cliente.

create table public.listing_daily_views (
  listing_id uuid not null references public.listings (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  views_map integer not null default 0,
  views_site integer not null default 0,
  primary key (listing_id, day)
);
create index listing_daily_views_org_idx on public.listing_daily_views (org_id, day);
alter table public.listing_daily_views enable row level security;
-- sem políticas: só as funções abaixo leem e gravam

-- Quem já foi contado hoje: hash da origem (IP com sal) e do navegador. Guardado 2 dias, só para não contar a mesma
-- visita de novo.
create table public.listing_view_marks (
  listing_id uuid not null references public.listings (id) on delete cascade,
  day date not null,
  origin_hash text not null,
  visitor_hash text not null,
  primary key (listing_id, day, origin_hash, visitor_hash)
);
create index listing_view_marks_day_idx on public.listing_view_marks (day);
alter table public.listing_view_marks enable row level security;

-- Uma visualização do anúncio publicado: uma por navegador por dia; no máximo 20 por origem por dia em cada anúncio
-- (uma rede inteira atrás do mesmo IP ainda conta, e um robô não infla os números). Visitas da própria equipe não
-- contam. Nunca falha para o visitante: o que não conta é ignorado em silêncio.
create function public.track_listing_view(p_listing uuid, p_channel text default 'map', p_visitor text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
  v_origin text;
begin
  if p_channel not in ('map', 'site') then
    return;
  end if;
  select l.org_id into v_org from public.listings l where l.id = p_listing and l.published and l.deleted_at is null;
  if not found or public.is_member(v_org) then
    return;
  end if;
  v_origin := public.lead_origin(null);
  -- serializa a contagem por origem/anúncio/dia para o limite valer mesmo com chamadas simultâneas
  perform pg_advisory_xact_lock(hashtextextended(p_listing::text || v_day::text || v_origin, 0));
  if (select count(*) from public.listing_view_marks m
      where m.listing_id = p_listing and m.day = v_day and m.origin_hash = v_origin) >= 20 then
    return;
  end if;
  insert into public.listing_view_marks (listing_id, day, origin_hash, visitor_hash)
  values (p_listing, v_day, v_origin, encode(extensions.digest(coalesce(left(p_visitor, 64), ''), 'sha256'), 'hex'))
  on conflict do nothing;
  if not found then
    return;
  end if;
  insert into public.listing_daily_views as d (listing_id, org_id, day, views_map, views_site)
  values (p_listing, v_org, v_day, (p_channel = 'map')::int, (p_channel = 'site')::int)
  on conflict (listing_id, day) do update
    set views_map = d.views_map + excluded.views_map, views_site = d.views_site + excluded.views_site;
end
$$;
revoke execute on function public.track_listing_view(uuid, text, text) from public;
grant execute on function public.track_listing_view(uuid, text, text) to anon, authenticated;

-- Desempenho dos anúncios nos últimos p_days dias (1 a 365), incluindo os que estão sem visitas.
create function public.listing_stats(p_org uuid, p_days integer default 30)
returns table (
  listing_id uuid, title text, reference_code text, published boolean, created_by uuid,
  views_map bigint, views_site bigint, whatsapp bigint, messages bigint
)
language sql stable security definer set search_path = '' as $$
  with params as (
    select greatest(1, least(coalesce(p_days, 30), 365)) as days,
           (now() at time zone 'America/Sao_Paulo')::date as today
  )
  select l.id, l.title, l.reference_code, l.published, l.created_by,
    coalesce(v.map, 0), coalesce(v.site, 0), coalesce(c.wa, 0), coalesce(c.msg, 0)
  from public.listings l
  cross join params p
  left join lateral (
    select sum(d.views_map) as map, sum(d.views_site) as site from public.listing_daily_views d
    where d.listing_id = l.id and d.day > p.today - p.days
  ) v on true
  left join lateral (
    select count(*) filter (where x.source = 'whatsapp') as wa, count(*) filter (where x.source <> 'whatsapp') as msg
    from public.leads x where x.listing_id = l.id and x.created_at > now() - make_interval(days => p.days)
  ) c on true
  where l.org_id = p_org and l.deleted_at is null
    and (public.is_org_admin(p_org) or (public.is_member(p_org) and l.created_by = auth.uid()))
  order by coalesce(v.map, 0) + coalesce(v.site, 0) desc, l.updated_at desc
$$;
revoke execute on function public.listing_stats(uuid, integer) from public, anon;
grant execute on function public.listing_stats(uuid, integer) to authenticated;

-- as marcas de visita só servem no dia: a limpeza diária apaga as de antes de ontem
select cron.schedule('limpar-marcas-de-visita', '23 6 * * *',
  $$delete from public.listing_view_marks where day < (now() at time zone 'America/Sao_Paulo')::date - 1$$);
