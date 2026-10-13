-- Site de cada cliente (white label): configuração em organizations.branding, domínio próprio, imagens do site e
-- contatos que chegam pelo site sem ser de um anúncio (página de contato e "Anunciar imóvel").

-- ---------------------------------------------------------------- domínio e configuração

alter table public.organizations
  add column custom_domain text unique
    check (custom_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$' and custom_domain not like 'www.%');

-- A configuração é dado (cores, textos, links), lida e corrigida pelo site antes de usar; aqui só limites gerais:
-- precisa ser um objeto e caber em 64 KB (as imagens vão para o storage, não para dentro dela).
alter table public.organizations
  add constraint branding_is_object check (jsonb_typeof(branding) = 'object'),
  add constraint branding_size check (pg_column_size(branding) <= 65536);

-- Admins editam nome, CRECI e site; endereço (slug), domínio e tipo dependem de configuração nossa (DNS,
-- certificado), então só a equipe da plataforma muda.
create function public.organizations_update_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'service_role' or public.is_staff() then
    return new;
  end if;
  if new.slug is distinct from old.slug or new.custom_domain is distinct from old.custom_domain or new.kind is distinct from old.kind then
    raise exception 'endereço e domínio do site são alterados pelo suporte' using errcode = '42501';
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end
$$;
create trigger organizations_update_rules before update on public.organizations
for each row execute function public.organizations_update_rules();

-- ---------------------------------------------------------------- imagens do site (logo, capa, foto da equipe)
-- Caminho: <org_id>/<arquivo>. Públicas; só donos e administradores do cliente enviam e apagam. Sem SVG (pode
-- conter scripts): o editor converte logos SVG em PNG antes de enviar.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-assets', 'site-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "site: admins enviam" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-assets' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
create policy "site: admins leem" on storage.objects for select to authenticated
  using (bucket_id = 'site-assets' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
create policy "site: admins apagam" on storage.objects for delete to authenticated
  using (bucket_id = 'site-assets' and public.is_org_admin(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------- contatos pelo site

alter type public.lead_source add value if not exists 'contact';
alter type public.lead_source add value if not exists 'owner';

-- Respostas extras dos formulários do site (tipo, bairro e valor do imóvel oferecido, por exemplo).
alter table public.leads add column details jsonb
  check (details is null or (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 4096));

-- O corretor não altera as respostas do visitante (mesma regra dos outros campos).
create or replace function public.leads_update_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if not public.is_org_admin(old.org_id) then
    new.assigned_to := old.assigned_to;
  elsif new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null and not exists (
    select 1 from public.memberships m where m.org_id = old.org_id and m.user_id = new.assigned_to
  ) then
    raise exception 'o responsável precisa ser da equipe' using errcode = '23514';
  end if;
  new.id := old.id;
  new.org_id := old.org_id;
  new.listing_id := old.listing_id;
  new.listing_title := old.listing_title;
  new.source := old.source;
  new.name := old.name;
  new.email := old.email;
  new.phone := old.phone;
  new.message := old.message;
  new.details := old.details;
  new.consent_text := old.consent_text;
  new.consented_at := old.consented_at;
  new.origin_hash := old.origin_hash;
  new.created_at := old.created_at;
  new.notified_at := old.notified_at;
  new.updated_at := now();
  return new;
end
$$;

-- Contato pela página "Contato" ou oferta de imóvel em "Anunciar imóvel". Mesmas proteções do contato pelo anúncio:
-- consentimento, campo-armadilha, 5 envios em 10 minutos por origem e 3 por dia para a mesma pessoa no mesmo
-- cliente. Sem anúncio, o contato vai para os administradores (sem responsável).
create function public.submit_site_lead(
  p_org uuid,
  p_source text,
  p_name text default null,
  p_email text default null,
  p_phone text default null,
  p_message text default null,
  p_details jsonb default null,
  p_consent boolean default false,
  p_consent_text text default null,
  p_trap text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  headers json := nullif(current_setting('request.headers', true), '')::json;
  ip text := coalesce(
    headers ->> 'cf-connecting-ip',
    split_part(headers ->> 'x-forwarded-for', ',', 1),
    headers ->> 'x-real-ip',
    'desconhecido'
  );
  origin text;
  v_email text := nullif(lower(trim(p_email)), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_details jsonb;
  new_id uuid;
begin
  if coalesce(p_trap, '') <> '' then
    return gen_random_uuid();
  end if;
  if p_source not in ('contact', 'owner') then
    raise exception 'tipo de contato inválido' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'imobiliária não encontrada' using errcode = 'P0002';
  end if;
  -- só textos curtos, no máximo 12 respostas
  select jsonb_object_agg(left(key, 40), left(value, 200)) into v_details
  from (
    select key, value from jsonb_each_text(case when jsonb_typeof(p_details) = 'object' then p_details else '{}'::jsonb end)
    where value <> '' limit 12
  ) d;
  origin := encode(extensions.digest(
    ip || (select value from public.private_settings where key = 'lead_salt'), 'sha256'), 'hex');
  if (select count(*) from public.leads where origin_hash = origin and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'muitos envios em pouco tempo; tente de novo em alguns minutos' using errcode = '54000';
  end if;
  if not coalesce(p_consent, false) or coalesce(trim(p_consent_text), '') = '' then
    raise exception 'é preciso concordar em compartilhar os dados com a imobiliária' using errcode = '22023';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'informe seu nome' using errcode = '22023';
  end if;
  if v_email is null and (v_phone is null or length(v_phone) < 10) then
    raise exception 'informe um e-mail ou um telefone com DDD' using errcode = '22023';
  end if;
  if (select count(*) from public.leads
      where org_id = p_org and listing_id is null and created_at > now() - interval '1 day'
        and ((v_email is not null and email = v_email) or (v_phone is not null and phone = v_phone))) >= 3 then
    raise exception 'você já enviou mensagens hoje; a imobiliária vai responder' using errcode = '54000';
  end if;
  insert into public.leads (org_id, source, name, email, phone, message, details, consent_text, consented_at, origin_hash)
  values (
    p_org, p_source::public.lead_source, left(trim(p_name), 120), v_email, left(v_phone, 30),
    left(trim(p_message), 2000), v_details, left(p_consent_text, 1000), now(), origin
  )
  returning id into new_id;
  return new_id;
end
$$;
grant execute on function public.submit_site_lead(uuid, text, text, text, text, text, jsonb, boolean, text, text) to anon, authenticated;

-- O aviso de novos contatos conta também os que chegam pelo site.
create or replace function public.my_new_leads(p_org uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.leads l
  where l.org_id = p_org and l.status = 'new' and l.source <> 'whatsapp'
    and (l.assigned_to = auth.uid() or (l.assigned_to is null and public.is_org_admin(p_org)))
$$;
