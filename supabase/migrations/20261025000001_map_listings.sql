-- A1 (prioridade 5): o mapa lia public_listings e as fotos com consultas comuns, que o servidor corta em 1000 linhas
-- (max_rows) sem avisar: acima disso faltavam anúncios e fotos. Agora o mapa recebe um resumo de cada anúncio numa
-- resposta só (um JSON, que não é cortado), com a foto de capa e sem os campos longos; a descrição, as fotos, o vídeo
-- e o anunciante vêm quando o anúncio é aberto, de um anúncio por vez.

-- O resumo: sem os campos que ficam para quando o anúncio é aberto, com o nome do cliente e a capa, e sem os vazios
-- (null), que só ocupariam espaço.
create function public.listing_summary(row_json jsonb, org_name text, cover text, cover_thumb text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(
    (row_json - 'description' - 'video_url' - 'tour_url' - 'advertiser')
      || jsonb_build_object('org_name', org_name, 'cover', cover, 'cover_thumb', cover_thumb))
$$;

-- Anúncios publicados (de um cliente só, no mapa dentro do site dele). Lê pela view pública, que já esconde o que não
-- é público; as fotos de anúncio publicado são públicas. Roda como dona das tabelas para não conferir as regras de
-- acesso foto por foto (com 5000 anúncios, segundos de diferença).
create function public.map_listings(p_org uuid default null) returns jsonb
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
  where p_org is null or p.org_id = p_org
$$;
revoke execute on function public.map_listings(uuid) from public;
grant execute on function public.map_listings(uuid) to anon, authenticated;

-- Os anúncios dos clientes de quem entrou (rascunhos e local exato), no mesmo formato de my_listings, sem as colunas
-- internas. Lê a tabela e confere cada cliente uma vez (is_member, a mesma regra de my_listings), não anúncio por
-- anúncio.
create function public.my_map_listings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
    public.listing_summary(
      (to_jsonb(l) - 'location' - 'footprint' - 'lot' - 'approx_center' - 'created_by' - 'deleted_at' - 'deleted_by'
        - 'exclusive_verified')
        || jsonb_build_object(
          'location_geojson', extensions.st_asgeojson(l.location)::jsonb,
          'footprint_geojson', extensions.st_asgeojson(l.footprint)::jsonb,
          'lot_geojson', extensions.st_asgeojson(l.lot)::jsonb,
          'approx_center_geojson', extensions.st_asgeojson(l.approx_center)::jsonb),
      o.name, c.path, c.thumb_path)
    order by l.updated_at desc, l.id), '[]'::jsonb)
  from public.organizations o
  join public.listings l on l.org_id = o.id and l.deleted_at is null
  left join lateral (
    select ph.path, ph.thumb_path from public.listing_photos ph
    where ph.listing_id = l.id and not ph.is_floor_plan
    order by ph.position limit 1
  ) c on true
  where public.is_member(o.id)
$$;
revoke execute on function public.my_map_listings() from public, anon;
grant execute on function public.my_map_listings() to authenticated;
