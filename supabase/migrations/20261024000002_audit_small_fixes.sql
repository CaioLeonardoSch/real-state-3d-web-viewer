-- Correções pequenas da auditoria de 17/10 (prioridades 14 a 17).

-- ---------------------------------------------------------------- A10 (15): administradores e donos
-- O administrador alterava qualquer linha de membros: rebaixava um dono (quando havia mais de um) e podia trocar o
-- user_id de uma linha, incluindo alguém sem convite. Incluir direto também era permitido. Agora:
-- - só um dono (ou a equipe) altera a linha de outro dono;
-- - pelo site só se muda o papel (a coluna role); incluir pessoas é só pelo convite (accept_invitation) ou pela
--   equipe da plataforma.
drop policy "memberships: admins alteram" on public.memberships;
create policy "memberships: admins alteram" on public.memberships for update
  using (public.is_org_admin(org_id) and (role <> 'owner' or public.member_role(org_id) = 'owner'))
  with check (public.is_org_admin(org_id) and (role <> 'owner' or public.member_role(org_id) = 'owner'));
drop policy "memberships: admins incluem" on public.memberships;
create policy "memberships: equipe inclui" on public.memberships for insert with check (public.is_staff());
revoke update on public.memberships from authenticated;
grant update (role) on public.memberships to authenticated;

-- ---------------------------------------------------------------- A11 (16): endereço oculto
-- Com o endereço oculto, a altura do prédio, o total de andares e o andar da unidade apontavam o prédio dentro do
-- círculo de 150 m. Só o endereço completo mostra esses campos. Os andares já construídos de uma obra continuam
-- públicos (também estão em construction_history): sem o total, dizem pouco sobre qual é o prédio.
create or replace view public.public_listings with (security_barrier) as
select
  l.id, l.org_id, l.type, l.title, l.description, l.transaction, l.price, l.rent_price, l.previous_price,
  l.price_reduced_at, l.condo_fee, l.iptu_value, l.iptu_period, l.area_m2, l.total_area_m2, l.land_area_m2,
  l.bedrooms, l.suites, l.bathrooms, l.parking_spots, l.covered_parking,
  case when l.address_display = 'full' then l.unit_floor end as unit_floor,
  case when l.address_display = 'full' then l.floors end as floors,
  l.towers,
  l.year_built, l.usage, l.status, l.features,
  l.address_display,
  l.address_display <> 'full' as approximate_location,
  extensions.st_asgeojson(case when l.address_display = 'full' then l.location else l.approx_center end)::jsonb as location,
  case when l.address_display = 'full' then l.building_osm_id end as building_osm_id,
  case when l.address_display = 'full' then extensions.st_asgeojson(l.footprint)::jsonb end as footprint,
  case when l.address_display = 'full' then extensions.st_asgeojson(l.lot)::jsonb end as lot,
  (case when l.address_display = 'full' then l.building_height_m end)::numeric(6, 2) as building_height_m,
  l.approx_radius_m,
  -- o CEP nunca; número e complemento só no endereço completo; a rua no completo e em "só a rua"
  jsonb_strip_nulls(case l.address_display
    when 'full' then jsonb_build_object('street', l.address -> 'street', 'number', l.address -> 'number',
      'complement', l.address -> 'complement', 'bairro', l.address -> 'bairro', 'city', l.address -> 'city')
    when 'street' then jsonb_build_object('street', l.address -> 'street', 'bairro', l.address -> 'bairro',
      'city', l.address -> 'city')
    else jsonb_build_object('bairro', l.address -> 'bairro', 'city', l.address -> 'city')
  end) as address,
  l.video_url, l.tour_url, l.advertiser, l.reference_code,
  l.exclusive and l.exclusive_verified as exclusive,
  l.availability, l.highlight, l.published_at, l.updated_at,
  l.floors_built, l.construction_month, l.construction_source
from public.listings l
where l.published and l.deleted_at is null;

-- ---------------------------------------------------------------- A12 (17): leitura pública das imobiliárias
-- O público lia todas as colunas da tabela, inclusive as que entrarem no futuro (plano, cobrança). Agora só as do
-- site; uma coluna nova fica fechada até ser liberada aqui de propósito.
revoke select on public.organizations from anon, authenticated;
grant select (id, name, kind, slug, creci, branding, custom_domain, created_at) on public.organizations to authenticated;
grant select (id, name, slug, creci, branding, custom_domain) on public.organizations to anon;

-- ---------------------------------------------------------------- A9 (14): limite de envios
-- Os cliques no WhatsApp contavam no limite de 5 mensagens em 10 minutos por origem. Agora têm um limite próprio
-- (20 em 10 minutos; acima dele o clique só não é registrado) e não tiram a vez das mensagens. O resto das duas
-- funções é o de 20261020000002_lead_captcha.sql.
create or replace function public.submit_lead(
  p_listing uuid,
  p_source public.lead_source default 'form',
  p_name text default null,
  p_email text default null,
  p_phone text default null,
  p_message text default null,
  p_consent boolean default false,
  p_consent_text text default null,
  p_trap text default null,
  p_client_ip text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  l public.listings;
  origin text;
  v_email text := nullif(lower(trim(p_email)), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  new_id uuid;
begin
  perform public.lead_captcha_check(p_source::text);
  -- contatos de site e de captação têm a função própria (submit_site_lead)
  if p_source not in ('form', 'whatsapp') then
    raise exception 'tipo de contato inválido' using errcode = '22023';
  end if;
  if coalesce(p_trap, '') <> '' then
    return gen_random_uuid(); -- robô: parece sucesso, nada é gravado
  end if;
  select * into l from public.listings where id = p_listing and published and deleted_at is null;
  if not found then
    raise exception 'anúncio não encontrado' using errcode = 'P0002';
  end if;
  origin := public.lead_origin(p_client_ip);
  -- mensagens e cliques no WhatsApp têm limites separados: abrir o WhatsApp não tira a vez de mandar a mensagem
  if p_source = 'whatsapp' then
    if (select count(*) from public.leads where origin_hash = origin and source = 'whatsapp'
        and created_at > now() - interval '10 minutes') >= 20 then
      return gen_random_uuid(); -- o clique não é registrado; o WhatsApp abre do mesmo jeito
    end if;
  elsif (select count(*) from public.leads where origin_hash = origin and source <> 'whatsapp'
      and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'muitos envios em pouco tempo; tente de novo em alguns minutos' using errcode = '54000';
  end if;
  if p_source = 'form' then
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
        where listing_id = p_listing and created_at > now() - interval '1 day'
          and ((v_email is not null and email = v_email) or (v_phone is not null and phone = v_phone))) >= 3 then
      raise exception 'você já enviou mensagens sobre este imóvel hoje; o corretor vai responder' using errcode = '54000';
    end if;
  end if;
  insert into public.leads (org_id, listing_id, listing_title, assigned_to, source, name, email, phone, message,
    consent_text, consented_at, origin_hash)
  values (
    l.org_id, l.id, l.title,
    case when exists (select 1 from public.memberships m where m.org_id = l.org_id and m.user_id = l.created_by)
      then l.created_by end,
    p_source,
    case when p_source = 'form' then left(trim(p_name), 120) end,
    case when p_source = 'form' then v_email end,
    case when p_source = 'form' then left(v_phone, 30) end,
    case when p_source = 'form' then left(trim(p_message), 2000) end,
    case when p_source = 'form' then left(p_consent_text, 1000) end,
    case when p_source = 'form' then now() end,
    origin
  )
  returning id into new_id;
  return new_id;
end
$$;

create or replace function public.submit_site_lead(
  p_org uuid,
  p_source text,
  p_name text default null,
  p_email text default null,
  p_phone text default null,
  p_message text default null,
  p_details jsonb default null,
  p_consent boolean default false,
  p_consent_text text default null,
  p_trap text default null,
  p_client_ip text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  origin text;
  v_email text := nullif(lower(trim(p_email)), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_details jsonb;
  new_id uuid;
begin
  perform public.lead_captcha_check(coalesce(p_source, ''));
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
  origin := public.lead_origin(p_client_ip);
  if (select count(*) from public.leads where origin_hash = origin and source <> 'whatsapp'
      and created_at > now() - interval '10 minutes') >= 5 then
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
