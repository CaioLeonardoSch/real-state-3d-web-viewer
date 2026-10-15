-- A client's site opens with one request instead of four (client by domain, client by address, listings, photos):
-- site_bootstrap returns the client found by its own domain (else by its address on the platform), its published
-- listings and their photos. It runs with the caller's rights, so it reads exactly what those separate queries read
-- (the public read of organizations and listing_photos, and public_listings with locations already blurred).
create function public.site_bootstrap(p_host text default null, p_slug text default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with org as (
    select o.id, o.name, o.slug, o.creci, o.custom_domain, o.branding
    from public.organizations o
    where o.custom_domain = lower(regexp_replace(p_host, '^www\.', ''))
       or o.slug = lower(p_slug)
    -- the domain wins over the address, as on the site
    order by o.custom_domain is not distinct from lower(regexp_replace(p_host, '^www\.', '')) desc
    limit 1
  ),
  listings as (
    select l.* from public.public_listings l where l.org_id = (select org.id from org)
  )
  select jsonb_build_object(
    'org', to_jsonb(org),
    'listings', coalesce((select jsonb_agg(to_jsonb(l)) from listings l), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'listing_id', p.listing_id, 'path', p.path, 'thumb_path', p.thumb_path, 'large_path', p.large_path,
        'caption', p.caption, 'position', p.position, 'is_floor_plan', p.is_floor_plan))
      from public.listing_photos p
      where p.listing_id in (select l.id from listings l)), '[]'::jsonb))
  from org;
$$;

revoke all on function public.site_bootstrap(text, text) from public;
grant execute on function public.site_bootstrap(text, text) to anon, authenticated;
