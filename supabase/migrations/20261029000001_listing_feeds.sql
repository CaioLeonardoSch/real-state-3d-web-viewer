-- Importação agendada do XML (prioridade 25): o administrador informa em "Minha conta" o endereço do XML que o CRM
-- já gera para os portais, e o agendador (scripts/import-feeds.mjs, workflow "Importar XML", de hora em hora) lê
-- o feed a cada 6 horas, ou na próxima hora quando alguém pede "Importar agora". O resultado da última leitura
-- fica aqui para a tela mostrar.

create table public.listing_feeds (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  url text not null check (url ~ '^https?://[^\s]+$' and length(url) <= 500),
  enabled boolean not null default true,
  -- tira para a lixeira o que foi importado e saiu do XML
  sync boolean not null default true,
  requested_at timestamptz,
  last_run_at timestamptz,
  last_status text check (last_status in ('ok', 'avisos', 'erro')),
  last_summary jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.listing_feeds enable row level security;

create policy "administradores leem o feed" on public.listing_feeds for select
  using (public.is_org_admin(org_id));
create policy "administradores cadastram o feed" on public.listing_feeds for insert
  with check (public.is_org_admin(org_id));
create policy "administradores alteram o feed" on public.listing_feeds for update
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy "administradores removem o feed" on public.listing_feeds for delete
  using (public.is_org_admin(org_id));

-- o resultado da leitura só o agendador (chave de serviço) grava
revoke all on public.listing_feeds from anon, authenticated;
grant select, delete on public.listing_feeds to authenticated;
grant insert (org_id, url, enabled, sync, requested_at) on public.listing_feeds to authenticated;
grant update (url, enabled, sync, requested_at) on public.listing_feeds to authenticated;

-- "Importar agora" vale pela hora do servidor, não pelo relógio de quem clicou
create function public.listing_feeds_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if coalesce(auth.role(), '') <> 'service_role' and new.requested_at is not null
     and (tg_op = 'INSERT' or new.requested_at is distinct from old.requested_at) then
    new.requested_at := now();
  end if;
  return new;
end
$$;
create trigger listing_feeds_rules before insert or update on public.listing_feeds
for each row execute function public.listing_feeds_rules();

-- Local ajustado pela tela: quando alguém da equipe muda o lugar de um anúncio importado (ponto, prédio, lote ou o
-- que o público vê do endereço), as importações seguintes deixam o lugar como está e só atualizam o resto.
alter table public.listings add column placement_locked boolean not null default false;

create function public.listings_placement_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  -- o formulário recalcula o ponto ao salvar: menos de 5 m é o mesmo lugar (como o círculo aproximado)
  new.placement_locked := old.placement_locked or coalesce(old.import_source = 'xml' and (
      not extensions.st_dwithin(new.location, old.location, 5) or new.building_osm_id is distinct from old.building_osm_id
      or new.lot::text is distinct from old.lot::text or new.address_display is distinct from old.address_display), false);
  return new;
end
$$;
create trigger listings_placement_lock before update on public.listings
for each row execute function public.listings_placement_lock();
