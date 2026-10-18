-- Alertas de imóveis novos (item 40): o visitante do site de uma imobiliária deixa o e-mail numa busca e recebe os
-- imóveis novos que se encaixam nela. Confirmação por e-mail antes do primeiro aviso (opt-in duplo) e link de saída
-- em todo e-mail. Quem envia é scripts/send-alerts.mjs (chave de serviço), uma vez por dia; a tabela não tem
-- nenhuma política: o navegador só usa as três funções abaixo.
create table public.search_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 120),
  -- a busca no formato do endereço do site (negocio=alugar&bairro=Glória…), sem página nem vista
  query text not null check (length(query) <= 1000),
  label text not null check (length(label) <= 160),
  token uuid not null unique default gen_random_uuid(),
  consent_text text not null,
  created_at timestamptz not null default now(),
  origin_hash text,
  confirm_sent_at timestamptz,
  confirmed_at timestamptz,
  -- os imóveis publicados até aqui já foram vistos (o primeiro aviso só traz os que entrarem depois da confirmação)
  last_sent_at timestamptz,
  unique (org_id, email, query)
);
alter table public.search_alerts enable row level security;
create index search_alerts_pending on public.search_alerts (org_id) where confirmed_at is not null;

-- Pedido do site. Repetir a mesma busca com o mesmo e-mail não duplica (e reenvia a confirmação se ainda não
-- confirmou, no máximo uma vez por dia). Limites: 5 pedidos a cada 10 minutos por origem e 10 alertas por e-mail em cada imobiliária.
create function public.subscribe_search_alert(
  p_org uuid,
  p_email text,
  p_query text,
  p_label text,
  p_consent_text text default null,
  p_trap text default null,
  p_client_ip text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  origin text;
  v_email text := nullif(lower(trim(p_email)), '');
begin
  perform public.lead_captcha_check('alert');
  if coalesce(p_trap, '') <> '' then
    return;
  end if;
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'imobiliária não encontrada' using errcode = 'P0002';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 120 then
    raise exception 'informe um e-mail válido' using errcode = '22023';
  end if;
  if coalesce(trim(p_consent_text), '') = '' then
    raise exception 'é preciso concordar em receber os avisos' using errcode = '22023';
  end if;
  origin := public.lead_origin(p_client_ip);
  if (select count(*) from public.search_alerts where origin_hash = origin and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'muitos pedidos em pouco tempo; tente de novo em alguns minutos' using errcode = '54000';
  end if;
  if (select count(*) from public.search_alerts where org_id = p_org and email = v_email) >= 10 then
    raise exception 'este e-mail já tem 10 alertas neste site; cancele algum pelo link dos e-mails' using errcode = '54000';
  end if;
  insert into public.search_alerts (org_id, email, query, label, consent_text, origin_hash)
  values (p_org, v_email, left(coalesce(p_query, ''), 1000), left(coalesce(nullif(trim(p_label), ''), 'Imóveis'), 160),
    left(p_consent_text, 1000), origin)
  on conflict (org_id, email, query) do update
    set confirm_sent_at = case when public.search_alerts.confirmed_at is null and public.search_alerts.confirm_sent_at < now() - interval '1 day'
      then null else public.search_alerts.confirm_sent_at end;
end
$$;
revoke execute on function public.subscribe_search_alert(uuid, text, text, text, text, text, text) from public;
grant execute on function public.subscribe_search_alert(uuid, text, text, text, text, text, text) to anon, authenticated, service_role;

-- Links dos e-mails: confirmar e sair. Respondem o que a página mostra (sem revelar o e-mail).
create function public.confirm_search_alert(p_token uuid) returns jsonb
language sql security definer set search_path = '' as $$
  update public.search_alerts set confirmed_at = coalesce(confirmed_at, now()), last_sent_at = coalesce(last_sent_at, now())
  where token = p_token
  returning jsonb_build_object('label', label, 'query', query);
$$;
revoke execute on function public.confirm_search_alert(uuid) from public;
grant execute on function public.confirm_search_alert(uuid) to anon, authenticated;

create function public.cancel_search_alert(p_token uuid) returns boolean
language sql security definer set search_path = '' as $$
  with gone as (delete from public.search_alerts where token = p_token returning 1)
  select exists (select 1 from gone);
$$;
revoke execute on function public.cancel_search_alert(uuid) from public;
grant execute on function public.cancel_search_alert(uuid) to anon, authenticated;
