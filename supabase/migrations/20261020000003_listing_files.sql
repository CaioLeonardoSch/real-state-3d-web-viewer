-- Fotos e plantas no storage: só quem edita o anúncio (o autor ou os administradores) envia, troca e apaga os
-- arquivos dele. Antes, qualquer membro da imobiliária apagava ou sobrescrevia as fotos dos anúncios dos colegas
-- (as linhas de listing_photos já eram protegidas; os arquivos, não). Caminho: <org_id>/<listing_id>/<arquivo>.

create function public.can_edit_listing_files(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  -- administradores: tudo na pasta do cliente, inclusive arquivos de anúncios já apagados (limpeza da lixeira)
  select public.is_org_admin(((storage.foldername(object_name))[1])::uuid)
    or exists (
      select 1 from public.listings l
      where l.org_id::text = (storage.foldername(object_name))[1]
        and l.id::text = (storage.foldername(object_name))[2]
        and l.created_by = auth.uid() and public.is_member(l.org_id)
    )
$$;

drop policy "fotos: membros enviam na pasta do cliente" on storage.objects;
drop policy "fotos: membros alteram na pasta do cliente" on storage.objects;
drop policy "fotos: membros apagam na pasta do cliente" on storage.objects;
create policy "fotos: quem edita o anúncio envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-photos' and public.can_edit_listing_files(name));
create policy "fotos: quem edita o anúncio altera" on storage.objects for update to authenticated
  using (bucket_id = 'listing-photos' and public.can_edit_listing_files(name));
create policy "fotos: quem edita o anúncio apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and public.can_edit_listing_files(name));

-- Arquivos que a limpeza da lixeira deixou: só os administradores os veem e removem (um corretor não conseguiria
-- apagar os arquivos, e a anotação sumiria com eles ainda no storage).
drop policy "storage_orphans: membros veem" on public.storage_orphans;
drop policy "storage_orphans: membros removem" on public.storage_orphans;
create policy "storage_orphans: admins veem" on public.storage_orphans for select using (public.is_org_admin(org_id));
create policy "storage_orphans: admins removem" on public.storage_orphans for delete using (public.is_org_admin(org_id));
