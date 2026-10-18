-- Um banco só para todos os clientes (SaaS), cada um isolado pelo org_id e pelas regras de acesso (RLS). Nada de um
-- cliente chega a outro: o mapa da plataforma não lista os anúncios dos clientes para o público (cada um aparece só no
-- site da sua imobiliária) e o layout dos prédios passa a ser de cada cliente.

-- map_listings só responde por um cliente: sem p_org, nada (antes, os publicados de todos de uma vez)
create or replace function public.map_listings(p_org uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
    public.listing_summary(to_jsonb(p), o.name, c.path, c.thumb_path)
    order by p.published_at desc, p.id), '[]'::jsonb)
  from public.public_listings p
  left join public.organizations o on o.id = p.org_id
  left join lateral (
    select ph.path, ph.thumb_path from public.listing_photos ph
    where ph.listing_id = p.id and not ph.is_floor_plan
    order by ph.position limit 1
  ) c on true
  where p_org is not null and p.org_id = p_org
$$;

-- Layout do prédio (andares × unidades por andar): era um por prédio, público, e o que uma imobiliária informava era
-- oferecido às outras. Agora é um por cliente e prédio, e só os membros do cliente o leem.
delete from public.building_layouts where org_id is null;
alter table public.building_layouts drop constraint building_layouts_pkey;
alter table public.building_layouts drop constraint building_layouts_org_id_fkey;
alter table public.building_layouts
  alter column org_id set not null,
  add constraint building_layouts_org_id_fkey foreign key (org_id) references public.organizations (id) on delete cascade,
  add primary key (org_id, osm_id);
drop policy building_layouts_read on public.building_layouts;
revoke select on public.building_layouts from anon, authenticated;
create policy building_layouts_read on public.building_layouts for select to authenticated using (public.is_member(org_id));
grant select (osm_id, floors, units_per_floor, updated_at) on public.building_layouts to authenticated;

create or replace function public.listings_record_layout() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.building_osm_id is not null and new.floors between 1 and 40 and new.units_per_floor is not null
     and new.address_display = 'full' and new.published and new.deleted_at is null then
    insert into public.building_layouts (osm_id, floors, units_per_floor, org_id)
    values (new.building_osm_id, new.floors, new.units_per_floor, new.org_id)
    on conflict (org_id, osm_id) do update
      set floors = excluded.floors, units_per_floor = excluded.units_per_floor, updated_at = now();
  end if;
  return null;
end
$$;
