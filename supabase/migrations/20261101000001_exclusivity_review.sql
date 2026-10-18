-- Documento de exclusividade: o anunciante envia o arquivo para o bucket privado e o suporte confere na tela.
-- O selo "Exclusivo" só aparece no público depois da conferência (exclusive_verified).
alter table public.listings
  add column exclusivity_reviewed_at timestamptz,
  add column exclusivity_reviewed_by uuid references auth.users (id) on delete set null,
  -- motivo da recusa, mostrado ao anunciante
  add column exclusivity_note text check (exclusivity_note is null or length(exclusivity_note) <= 500);
alter table public.listings add constraint listings_exclusivity_doc_check
  check (exclusivity_doc is null or exclusivity_doc like org_id::text || '/' || id::text || '/%');

-- Roda depois de listings_price_rules (ordem alfabética). Fora da conferência, o anunciante não muda o resultado;
-- trocar o documento ou tirar a exclusividade volta o anúncio para "a conferir".
create or replace function public.listings_review_exclusivity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.exclusivity_review', true), '') = 'on' then
    new.exclusive_verified := coalesce(current_setting('app.exclusivity_verified', true), '') = 'true';
    return new;
  end if;
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' or not new.exclusive or new.exclusivity_doc is distinct from old.exclusivity_doc then
    new.exclusive_verified := false;
    new.exclusivity_reviewed_at := null;
    new.exclusivity_reviewed_by := null;
    new.exclusivity_note := null;
  else
    new.exclusive_verified := old.exclusive_verified;
    new.exclusivity_reviewed_at := old.exclusivity_reviewed_at;
    new.exclusivity_reviewed_by := old.exclusivity_reviewed_by;
    new.exclusivity_note := old.exclusivity_note;
  end if;
  return new;
end
$$;
create trigger listings_review_exclusivity before insert or update on public.listings
for each row execute function public.listings_review_exclusivity();

-- Fila do suporte: anúncios exclusivos com documento enviado e ainda sem conferência.
create or replace function public.exclusivity_queue()
returns table (id uuid, org_id uuid, org_name text, title text, reference_code text, doc text, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception 'Só o suporte da plataforma confere exclusividades.' using errcode = '42501';
  end if;
  return query
    select l.id, l.org_id, o.name, l.title, l.reference_code, l.exclusivity_doc, l.updated_at
    from public.listings l join public.organizations o on o.id = l.org_id
    where l.exclusive and l.exclusivity_doc is not null and l.exclusivity_reviewed_at is null and l.deleted_at is null
    order by l.updated_at;
end
$$;
revoke execute on function public.exclusivity_queue() from public, anon;
grant execute on function public.exclusivity_queue() to authenticated;

-- Resultado da conferência. Recusar exige o motivo, que o anunciante vê ao editar o anúncio.
create or replace function public.review_exclusivity(p_listing uuid, p_ok boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_staff() then
    raise exception 'Só o suporte da plataforma confere exclusividades.' using errcode = '42501';
  end if;
  if not p_ok and note is null then
    raise exception 'Informe o motivo da recusa.' using errcode = '22023';
  end if;
  perform set_config('app.exclusivity_review', 'on', true);
  perform set_config('app.exclusivity_verified', case when p_ok then 'true' else 'false' end, true);
  update public.listings
    set exclusivity_reviewed_at = now(), exclusivity_reviewed_by = auth.uid(), exclusivity_note = case when p_ok then null else note end
    where id = p_listing and exclusive and exclusivity_doc is not null and deleted_at is null;
  if not found then
    raise exception 'Anúncio sem documento de exclusividade para conferir.' using errcode = 'P0002';
  end if;
  perform set_config('app.exclusivity_review', 'off', true);
end
$$;
revoke execute on function public.review_exclusivity(uuid, boolean, text) from public, anon;
grant execute on function public.review_exclusivity(uuid, boolean, text) to authenticated;

-- A view expande l.* na criação: recriada para a equipe ver o resultado da conferência ao editar.
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
