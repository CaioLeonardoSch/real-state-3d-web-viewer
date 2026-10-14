-- Fotos em três tamanhos: além da miniatura (thumb_path, agora com ~480 px) e da versão do caminho principal
-- (~1024 px), uma grande (~1920 px) para a galeria em telas grandes ou de alta densidade. O site escolhe pelo
-- tamanho da tela (srcset). Fotos de antes ficam como estão, sem a versão grande. Mesmo caminho, no mesmo bucket.
alter table public.listing_photos add column large_path text;
alter table public.listing_photos add constraint listing_photos_large_path_check
  check (large_path is null or large_path like org_id::text || '/' || listing_id::text || '/%');

-- A limpeza da lixeira também anota os arquivos grandes para apagar do storage.
create or replace function public.purge_trash() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  insert into public.storage_orphans (org_id, path)
  select p.org_id, f.path
  from public.listing_photos p
  join public.listings l on l.id = p.listing_id
  cross join lateral (values (p.path), (p.thumb_path), (p.large_path)) as f (path)
  where l.deleted_at < now() - interval '30 days' and f.path is not null;
  delete from public.listings where deleted_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end
$$;
revoke execute on function public.purge_trash() from public, anon, authenticated;
