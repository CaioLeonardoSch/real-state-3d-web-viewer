-- Miniatura de cada foto (~320 px), usada na lista e na faixa da galeria. Mesmo caminho do arquivo, no mesmo bucket.
alter table public.listing_photos add column thumb_path text;
alter table public.listing_photos add constraint listing_photos_thumb_path_check
  check (thumb_path is null or thumb_path like org_id::text || '/' || listing_id::text || '/%');

-- Edição: o centro aproximado só é sorteado de novo quando o imóvel muda de lugar (mais de 5 m). Sortear a cada
-- edição permitiria estimar o endereço escondido comparando vários círculos.
create or replace function public.listings_price_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.previous_price := null;
    new.price_reduced_at := null;
  elsif new.price is distinct from old.price then
    if new.price < old.price then
      new.previous_price := greatest(coalesce(old.previous_price, 0), old.price);
      new.price_reduced_at := current_date;
    else
      new.previous_price := null;
      new.price_reduced_at := null;
    end if;
  else
    new.previous_price := old.previous_price;
    new.price_reduced_at := old.price_reduced_at;
  end if;
  if tg_op = 'UPDATE' then
    -- quem criou, o cliente e a data de publicação não mudam
    new.org_id := old.org_id;
    new.created_by := old.created_by;
    new.published_at := old.published_at;
    new.updated_at := now();
  else
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  -- endereço não público: o mapa mostra um círculo de 150 m em volta de um centro deslocado de 50 a 149 m,
  -- sorteado no servidor (o local real fica sempre dentro do círculo)
  if new.address_display = 'full' then
    new.approx_center := null;
    new.approx_radius_m := null;
  elsif tg_op = 'INSERT' or new.approx_center is null or not extensions.st_dwithin(new.location, old.location, 5) then
    new.approx_center := extensions.st_project(new.location, 50 + floor(random() * 100), radians(random() * 360));
    new.approx_radius_m := 150;
  else
    new.approx_center := old.approx_center;
    new.approx_radius_m := old.approx_radius_m;
  end if;
  -- verificação da exclusividade é feita pela equipe (service_role), não pelo anunciante
  if coalesce(auth.role(), '') <> 'service_role' then
    new.exclusive_verified := case when tg_op = 'UPDATE' and new.exclusive then old.exclusive_verified else false end;
  end if;
  return new;
end
$$;


-- Apagar e listar arquivos pela API do storage exige poder lê-los (o bucket público só cobre o link público).
-- Sem isto, fotos removidas e as de anúncios excluídos ficavam no storage.
create policy "fotos: membros leem a pasta do cliente" on storage.objects for select to authenticated
  using (bucket_id = 'listing-photos' and public.is_member(((storage.foldername(name))[1])::uuid));
