-- CAPTCHA (Cloudflare Turnstile) nos contatos dos visitantes, pronto para ligar. Desligado (o padrão), nada muda.
-- Ligado (private_settings.lead_captcha = 'on', ver docs/supabase.md), o site manda as mensagens pela função
-- submit-lead, que confere o token no servidor e grava com a chave de serviço, e o banco recusa as chamadas diretas
-- de visitantes. A configuração fica em private_settings, que os papéis do site (anon, authenticated) não leem nem
-- alteram. O campo-armadilha e os limites por origem continuam valendo nos dois caminhos.

insert into public.private_settings (key, value) values ('lead_captcha', 'off') on conflict (key) do nothing;

create function public.lead_captcha_required() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.value = 'on' from public.private_settings s where s.key = 'lead_captcha'), false)
$$;

-- Origem resumida de um contato (hash do IP com sal), para os limites de envio. Pela função submit-lead (chave de
-- serviço), vale o IP do visitante que ela informa; nos outros casos, o do próprio pedido.
create function public.lead_origin(p_client_ip text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  headers json := nullif(current_setting('request.headers', true), '')::json;
  ip text := coalesce(
    headers ->> 'cf-connecting-ip',
    split_part(headers ->> 'x-forwarded-for', ',', 1),
    headers ->> 'x-real-ip',
    'desconhecido'
  );
begin
  if coalesce(auth.role(), '') = 'service_role' and nullif(trim(p_client_ip), '') is not null then
    ip := left(trim(p_client_ip), 64);
  end if;
  return encode(extensions.digest(ip || (select value from public.private_settings where key = 'lead_salt'), 'sha256'), 'hex');
end
$$;
revoke execute on function public.lead_captcha_required() from public, anon, authenticated;
revoke execute on function public.lead_origin(text) from public, anon, authenticated;

-- Com o CAPTCHA ligado, só a função submit-lead grava mensagens (o clique no WhatsApp, sem dados pessoais, continua
-- direto).
create function public.lead_captcha_check(p_source text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_source <> 'whatsapp' and coalesce(auth.role(), '') <> 'service_role' and public.lead_captcha_required() then
    raise exception 'este site exige a verificação anti-robô; recarregue a página e envie de novo' using errcode = '42501';
  end if;
end
$$;
revoke execute on function public.lead_captcha_check(text) from public, anon, authenticated;

-- As duas funções de contato ganham p_client_ip (só vale para a chave de serviço) e a checagem acima. O resto é o
-- que já existia (20261015000001_leads.sql e 20261018000001_client_sites.sql).
drop function public.submit_lead(uuid, public.lead_source, text, text, text, text, boolean, text, text);
create function public.submit_lead(
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
  if (select count(*) from public.leads where origin_hash = origin and created_at > now() - interval '10 minutes') >= 5 then
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
grant execute on function public.submit_lead(uuid, public.lead_source, text, text, text, text, boolean, text, text, text) to anon, authenticated, service_role;

drop function public.submit_site_lead(uuid, text, text, text, text, text, jsonb, boolean, text, text);
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
grant execute on function public.submit_site_lead(uuid, text, text, text, text, text, jsonb, boolean, text, text, text) to anon, authenticated, service_role;
