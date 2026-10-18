-- Item 26: pedido de visita na ficha do imóvel. O visitante escolhe o dia (de amanhã até 30 dias) e, se quiser, o
-- período; o servidor confere e grava em `details` ({"visita": "sábado, 25/10/2026", "horario": "Tarde"}), que a lista
-- de contatos, a planilha e o e-mail ao corretor já mostram, e que a equipe não altera (trigger de leads). O resto da
-- função é o de 20261024000002_audit_small_fixes.sql.
drop function public.submit_lead(uuid, public.lead_source, text, text, text, text, boolean, text, text, text);
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
  p_client_ip text default null,
  p_visit_on date default null,
  p_visit_period text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  l public.listings;
  origin text;
  v_email text := nullif(lower(trim(p_email)), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_details jsonb;
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
  if p_visit_on is not null then
    if p_source <> 'form' or p_visit_on <= v_today or p_visit_on > v_today + 30 then
      raise exception 'escolha um dia para a visita entre amanhã e os próximos 30 dias' using errcode = '22023';
    end if;
    if p_visit_period is not null and p_visit_period not in ('manha', 'tarde', 'noite') then
      raise exception 'período da visita inválido' using errcode = '22023';
    end if;
    v_details := jsonb_build_object(
      'visita', (array['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'])
        [extract(dow from p_visit_on)::int + 1] || ', ' || to_char(p_visit_on, 'DD/MM/YYYY'),
      'horario', case p_visit_period when 'manha' then 'Manhã' when 'tarde' then 'Tarde' when 'noite' then 'Noite'
        else 'Qualquer horário' end);
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
    details, consent_text, consented_at, origin_hash)
  values (
    l.org_id, l.id, l.title,
    case when exists (select 1 from public.memberships m where m.org_id = l.org_id and m.user_id = l.created_by)
      then l.created_by end,
    p_source,
    case when p_source = 'form' then left(trim(p_name), 120) end,
    case when p_source = 'form' then v_email end,
    case when p_source = 'form' then left(v_phone, 30) end,
    case when p_source = 'form' then left(trim(p_message), 2000) end,
    v_details,
    case when p_source = 'form' then left(p_consent_text, 1000) end,
    case when p_source = 'form' then now() end,
    origin
  )
  returning id into new_id;
  return new_id;
end
$$;
grant execute on function public.submit_lead(uuid, public.lead_source, text, text, text, text, boolean, text, text, text, date, text)
  to anon, authenticated, service_role;
