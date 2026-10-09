-- Arquivos: fotos e plantas (públicas) e documentos de exclusividade (privados).
-- Caminho: <org_id>/<listing_id>/<arquivo>. Só membros do cliente gravam na pasta dele.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('listing-photos', 'listing-photos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('exclusivity-docs', 'exclusivity-docs', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "fotos: membros enviam na pasta do cliente" on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-photos' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "fotos: membros alteram na pasta do cliente" on storage.objects for update to authenticated
  using (bucket_id = 'listing-photos' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "fotos: membros apagam na pasta do cliente" on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and public.is_member(((storage.foldername(name))[1])::uuid));

create policy "documentos: membros enviam" on storage.objects for insert to authenticated
  with check (bucket_id = 'exclusivity-docs' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "documentos: admins do cliente leem" on storage.objects for select to authenticated
  using (bucket_id = 'exclusivity-docs' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
