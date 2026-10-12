-- Equipe de suporte da plataforma, imobiliárias criadas só pela equipe, convites e registro de auditoria.
-- Ver docs/backend.md, seções 9 e 10.

-- ---------------------------------------------------------------- equipe da plataforma

-- Quem está aqui atende qualquer cliente (suporte). Incluído só pelo painel do Supabase / chave de serviço:
--   insert into public.platform_staff (user_id) select id from auth.users where email = 'voce@empresa.com';
create table public.platform_staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_staff enable row level security;
create policy "platform_staff: cada um vê se é" on public.platform_staff for select using (user_id = auth.uid());
grant select on public.platform_staff to authenticated;

create function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_staff s where s.user_id = auth.uid())
$$;
grant execute on function public.is_staff() to authenticated;

-- A equipe conta como membro e administrador de todos os clientes: todas as políticas existentes passam a valer
-- para ela sem duplicação. Cada ação dela fica no registro de auditoria.
create or replace function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff()
    or exists (select 1 from public.memberships m where m.org_id = org and m.user_id = auth.uid())
$$;

create or replace function public.is_org_admin(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff()
    or exists (
      select 1 from public.memberships m
      where m.org_id = org and m.user_id = auth.uid() and m.role in ('owner', 'admin')
    )
$$;

-- papel efetivo; a equipe age como dono
create or replace function public.member_role(org uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select case
    when public.is_staff() then 'owner'::public.member_role
    else (select m.role from public.memberships m where m.org_id = org and m.user_id = auth.uid())
  end
$$;

-- ---------------------------------------------------------------- perfis com e-mail

alter table public.profiles add column email text;

-- Perfil criado junto com a conta (nome vem do cadastro).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', lower(new.email))
  on conflict (user_id) do update set email = excluded.email;
  return new;
end
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- contas que já existiam
insert into public.profiles (user_id, full_name, email)
select u.id, u.raw_user_meta_data ->> 'full_name', lower(u.email) from auth.users u
on conflict (user_id) do update set email = excluded.email;

-- o e-mail do perfil acompanha o da conta; o usuário não o altera pelo perfil
create function public.profiles_keep_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.email := (select lower(u.email) from auth.users u where u.id = new.user_id);
  new.updated_at := now();
  return new;
end
$$;
create trigger profiles_keep_email before insert or update on public.profiles
for each row execute function public.profiles_keep_email();

-- ---------------------------------------------------------------- imobiliárias: só a equipe cria

drop function public.create_organization(text, text, public.org_kind);

-- Cria a imobiliária e, se informado, o convite do primeiro dono. Devolve a imobiliária e o código do convite.
create function public.create_organization(
  p_name text,
  p_slug text,
  p_kind public.org_kind default 'agency',
  p_owner_email text default null
)
returns table (id uuid, name text, slug text, invite_token uuid)
language plpgsql security definer set search_path = '' as $$
declare
  org public.organizations;
  token uuid;
begin
  if not public.is_staff() then
    raise exception 'só a equipe da plataforma cadastra imobiliárias' using errcode = '42501';
  end if;
  insert into public.organizations (name, slug, kind) values (p_name, p_slug, p_kind) returning * into org;
  if p_owner_email is not null and length(trim(p_owner_email)) > 0 then
    insert into public.invitations (org_id, email, role, invited_by)
    values (org.id, p_owner_email, 'owner', auth.uid())
    returning invitations.token into token;
  end if;
  return query select org.id, org.name, org.slug, token;
end
$$;

grant execute on function public.create_organization(text, text, public.org_kind, text) to authenticated;

-- a equipe também lista e exclui imobiliárias (a exclusão apaga anúncios e fotos em cascata)
create policy "organizations: equipe exclui" on public.organizations for delete using (public.is_staff());
grant delete on public.organizations to authenticated;

-- ---------------------------------------------------------------- convites

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.member_role not null default 'agent',
  -- vai no link de convite; quem tem o link e entra com o e-mail convidado vira membro
  token uuid not null unique default gen_random_uuid(),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null
);
create index invitations_org_idx on public.invitations (org_id);
create index invitations_email_idx on public.invitations (email) where accepted_at is null;

-- e-mail sempre em minúsculas; só um convite pendente por pessoa e imobiliária
create function public.invitations_normalise() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.email := lower(trim(new.email));
  if tg_op = 'INSERT' then
    new.invited_by := coalesce(auth.uid(), new.invited_by);
    delete from public.invitations i
    where i.org_id = new.org_id and i.email = new.email and i.accepted_at is null;
  end if;
  return new;
end
$$;
create trigger invitations_normalise before insert or update on public.invitations
for each row execute function public.invitations_normalise();

alter table public.invitations enable row level security;
-- administradores veem e criam convites do próprio cliente; só o dono (ou a equipe) convida outro dono
create policy "invitations: admins veem" on public.invitations for select using (public.is_org_admin(org_id));
create policy "invitations: admins convidam" on public.invitations for insert
  with check (public.is_org_admin(org_id) and (role <> 'owner' or public.member_role(org_id) = 'owner'));
create policy "invitations: admins cancelam" on public.invitations for delete
  using (public.is_org_admin(org_id) and accepted_at is null);
grant select, insert, delete on public.invitations to authenticated;

-- O que o link de convite mostra antes do login: para qual imobiliária e qual e-mail.
create function public.invitation_info(p_token uuid)
returns table (org_name text, email text, role public.member_role, expired boolean, accepted boolean)
language sql stable security definer set search_path = '' as $$
  select o.name, i.email, i.role, i.expires_at < now(), i.accepted_at is not null
  from public.invitations i join public.organizations o on o.id = i.org_id
  where i.token = p_token
$$;
grant execute on function public.invitation_info(uuid) to anon, authenticated;

-- Convites pendentes para o e-mail de quem está logado (aparecem na tela da conta).
create function public.my_invitations()
returns table (token uuid, org_id uuid, org_name text, role public.member_role, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.token, i.org_id, o.name, i.role, i.expires_at
  from public.invitations i join public.organizations o on o.id = i.org_id
  where i.accepted_at is null and i.expires_at > now()
    and i.email = lower((select u.email from auth.users u where u.id = auth.uid()))
$$;
grant execute on function public.my_invitations() to authenticated;

-- Aceita um convite. O e-mail da conta precisa ser o convidado: um link repassado a outra pessoa não funciona.
create function public.accept_invitation(p_token uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invitations;
  my_email text;
begin
  if auth.uid() is null then
    raise exception 'login necessário' using errcode = '42501';
  end if;
  select * into inv from public.invitations where token = p_token for update;
  if not found then
    raise exception 'convite não encontrado' using errcode = 'P0002';
  end if;
  if inv.accepted_at is not null then
    raise exception 'este convite já foi usado' using errcode = '22023';
  end if;
  if inv.expires_at < now() then
    raise exception 'este convite expirou; peça um novo' using errcode = '22023';
  end if;
  select lower(u.email) into my_email from auth.users u where u.id = auth.uid();
  if my_email is distinct from inv.email then
    raise exception 'este convite é para %; entre com esse e-mail', inv.email using errcode = '42501';
  end if;
  insert into public.memberships (org_id, user_id, role) values (inv.org_id, auth.uid(), inv.role)
  on conflict (org_id, user_id) do update set role = excluded.role;
  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.org_id;
end
$$;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- Membros de um cliente com nome e e-mail (para a tela de gerenciamento).
create function public.org_members(p_org uuid)
returns table (user_id uuid, full_name text, email text, role public.member_role, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.full_name, p.email, m.role, m.created_at
  from public.memberships m left join public.profiles p on p.user_id = m.user_id
  where m.org_id = p_org and public.is_member(p_org)
  order by m.role, p.full_name
$$;
grant execute on function public.org_members(uuid) to authenticated;

-- Lista de clientes para a equipe (e para cada pessoa, os seus), com o papel efetivo.
create function public.my_organizations()
returns table (id uuid, name text, slug text, role public.member_role)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.slug, public.member_role(o.id)
  from public.organizations o
  where public.is_staff() or exists (select 1 from public.memberships m where m.org_id = o.id and m.user_id = auth.uid())
  order by o.name
$$;
grant execute on function public.my_organizations() to authenticated;

-- O dono não pode ser removido nem rebaixado se for o único: a imobiliária ficaria sem dono.
create function public.memberships_keep_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') and not exists (
    select 1 from public.memberships m where m.org_id = old.org_id and m.role = 'owner' and m.user_id <> old.user_id
  ) and exists (select 1 from public.organizations o where o.id = old.org_id) then
    raise exception 'a imobiliária precisa de pelo menos um dono' using errcode = '23514';
  end if;
  return coalesce(new, old);
end
$$;
create trigger memberships_keep_owner before update or delete on public.memberships
for each row execute function public.memberships_keep_owner();

-- ---------------------------------------------------------------- registro de auditoria

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  -- a equipe da plataforma agindo num cliente fica marcada
  actor_is_staff boolean not null default false,
  org_id uuid,
  table_name text not null,
  row_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  -- só os campos que mudaram (geometrias omitidas)
  changes jsonb not null default '{}'::jsonb
);
create index audit_log_org_idx on public.audit_log (org_id, at desc);

alter table public.audit_log enable row level security;
create policy "audit_log: admins do cliente leem" on public.audit_log for select using (public.is_org_admin(org_id));
grant select on public.audit_log to authenticated;

create function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  before jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  after jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else '{}'::jsonb end;
  diff jsonb := '{}'::jsonb;
  k text;
  rec jsonb := coalesce(nullif(after, '{}'::jsonb), before);
begin
  for k in select jsonb_object_keys(before || after) loop
    continue when k in ('location', 'footprint', 'lot', 'approx_center', 'updated_at', 'token');
    if before -> k is distinct from after -> k then
      diff := diff || jsonb_build_object(k, jsonb_build_array(before -> k, after -> k));
    end if;
  end loop;
  if tg_op = 'UPDATE' and diff = '{}'::jsonb then
    return null;
  end if;
  insert into public.audit_log (actor, actor_is_staff, org_id, table_name, row_id, action, changes)
  values (
    auth.uid(),
    public.is_staff() and not exists (
      select 1 from public.memberships m where m.org_id = (rec ->> 'org_id')::uuid and m.user_id = auth.uid()
    ),
    coalesce((rec ->> 'org_id')::uuid, case when tg_table_name = 'organizations' then (rec ->> 'id')::uuid end),
    tg_table_name,
    coalesce(rec ->> 'id', rec ->> 'user_id'),
    tg_op,
    diff
  );
  return null;
end
$$;

create trigger audit after insert or update or delete on public.listings
for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.memberships
for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.organizations
for each row execute function public.audit_row();
create trigger audit after insert or delete on public.invitations
for each row execute function public.audit_row();
create trigger audit after insert or delete on public.listing_photos
for each row execute function public.audit_row();

-- a equipe vê os anúncios de todos os clientes como "seus" (modo suporte): my_listings usa is_member
