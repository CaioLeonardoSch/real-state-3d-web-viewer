-- Contatos (leads): formulário do anúncio e cliques no WhatsApp, com aviso ao corretor.
-- Dados pessoais de visitantes: só a imobiliária dona vê; nada disso vai para o registro de auditoria.

create extension if not exists pgcrypto with schema extensions;

create type public.lead_status as enum ('new', 'contacted', 'visit', 'proposal', 'won', 'lost');
create type public.lead_source as enum ('form', 'whatsapp');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete set null,
  -- título do anúncio no momento do contato (o anúncio pode mudar ou ser apagado)
  listing_title text,
  -- corretor responsável: quem criou o anúncio; sem ele, os administradores
  assigned_to uuid references auth.users (id) on delete set null,
  source public.lead_source not null default 'form',
  name text check (length(name) <= 120),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (length(phone) <= 30),
  message text check (length(message) <= 2000),
  -- LGPD: o visitante concordou em compartilhar os dados com a imobiliária, com este texto
  consent_text text,
  consented_at timestamptz,
  status public.lead_status not null default 'new',
  notes text check (length(notes) <= 4000),
  -- origem resumida (hash do IP com sal), só para limitar envios em sequência
  origin_hash text,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_org_idx on public.leads (org_id, created_at desc);
create index leads_assigned_idx on public.leads (assigned_to, status);
create index leads_origin_idx on public.leads (origin_hash, created_at);

alter table public.leads enable row level security;
-- corretor vê os contatos dos anúncios dele; administradores e suporte veem todos do cliente
create policy "leads: responsável ou admin veem" on public.leads for select
  using (public.is_org_admin(org_id) or (public.is_member(org_id) and assigned_to = auth.uid()));
create policy "leads: responsável ou admin atualizam" on public.leads for update
  using (public.is_org_admin(org_id) or (public.is_member(org_id) and assigned_to = auth.uid()))
  with check (public.is_member(org_id));
-- exclusão (pedido do titular dos dados, LGPD): administradores
create policy "leads: admins excluem" on public.leads for delete using (public.is_org_admin(org_id));
grant select, update, delete on public.leads to authenticated;

-- O corretor só muda situação e anotações; a troca de responsável é dos administradores, e os dados do visitante
-- não são alterados.
create function public.leads_update_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- a chave de serviço (função de aviso, equipe técnica) grava o que precisar
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
  new.consent_text := old.consent_text;
  new.consented_at := old.consented_at;
  new.origin_hash := old.origin_hash;
  new.created_at := old.created_at;
  new.notified_at := old.notified_at;
  new.updated_at := now();
  return new;
end
$$;
create trigger leads_update_rules before update on public.leads
for each row execute function public.leads_update_rules();

-- Sal do hash de origem (gerado uma vez; nunca sai do banco).
create table public.private_settings (key text primary key, value text not null);
alter table public.private_settings enable row level security;
revoke all on public.private_settings from anon, authenticated;
insert into public.private_settings (key, value) values ('lead_salt', encode(extensions.gen_random_bytes(24), 'hex'));

-- Envio de um contato pelo site (visitante, sem login). Valida tudo no servidor e limita a frequência:
--   - o anúncio precisa estar publicado; formulário exige consentimento e e-mail ou telefone;
--   - campo-armadilha preenchido (robôs) é aceito em silêncio e descartado;
--   - no máximo 5 envios em 10 minutos por origem, e 3 por dia para a mesma pessoa no mesmo anúncio.
create function public.submit_lead(
  p_listing uuid,
  p_source public.lead_source default 'form',
  p_name text default null,
  p_email text default null,
  p_phone text default null,
  p_message text default null,
  p_consent boolean default false,
  p_consent_text text default null,
  p_trap text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  l public.listings;
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
  new_id uuid;
begin
  if coalesce(p_trap, '') <> '' then
    return gen_random_uuid(); -- robô: parece sucesso, nada é gravado
  end if;
  select * into l from public.listings where id = p_listing and published and deleted_at is null;
  if not found then
    raise exception 'anúncio não encontrado' using errcode = 'P0002';
  end if;
  origin := encode(extensions.digest(
    ip || (select value from public.private_settings where key = 'lead_salt'), 'sha256'), 'hex');
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
grant execute on function public.submit_lead(uuid, public.lead_source, text, text, text, text, boolean, text, text) to anon, authenticated;

-- Quantos contatos novos o usuário tem para atender (aviso no topo do site).
create function public.my_new_leads(p_org uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.leads l
  where l.org_id = p_org and l.status = 'new' and l.source = 'form'
    and (l.assigned_to = auth.uid() or (l.assigned_to is null and public.is_org_admin(p_org)))
$$;
grant execute on function public.my_new_leads(uuid) to authenticated;

-- E-mails dos donos e administradores de um cliente (só a função de aviso, com a chave de serviço).
create function public.org_admin_emails(p_org uuid) returns table (email text)
language sql stable security definer set search_path = '' as $$
  select p.email from public.memberships m join public.profiles p on p.user_id = m.user_id
  where m.org_id = p_org and m.role in ('owner', 'admin') and p.email is not null
$$;
revoke execute on function public.org_admin_emails(uuid) from public, anon, authenticated;
grant execute on function public.org_admin_emails(uuid) to service_role;
