-- Verificação em duas etapas (TOTP do Supabase Auth: código de 6 dígitos de um aplicativo autenticador).
-- - A equipe da plataforma atende todos os clientes: os poderes de suporte só valem numa sessão confirmada com o
--   segundo fator (aal2). Sem ela, a conta da equipe é tratada como a de um usuário comum.
-- - Quem ativou o segundo fator (donos e administradores, em Minha conta) só age como membro da imobiliária numa
--   sessão confirmada: quem descobrir só a senha não lê nem altera nada da imobiliária.
-- Ver docs/backend.md, seção 10.

-- A sessão passou pelo segundo fator (claim "aal" do token de acesso, emitido pelo Supabase Auth).
create function public.session_aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- O segundo fator está em dia: a sessão passou por ele, ou a pessoa não ativou nenhum.
create function public.mfa_satisfied() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.session_aal2() or not exists (
    select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'
  )
$$;

-- Equipe da plataforma: só com o segundo fator confirmado nesta sessão.
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.session_aal2() and exists (select 1 from public.platform_staff s where s.user_id = auth.uid())
$$;

-- Membro, administrador e papel efetivo: a participação de quem ativou o segundo fator só conta numa sessão
-- confirmada. A equipe continua valendo como dona de todos os clientes (já com aal2, por is_staff).
create or replace function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff()
    or (exists (select 1 from public.memberships m where m.org_id = org and m.user_id = auth.uid()) and public.mfa_satisfied())
$$;

create or replace function public.is_org_admin(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff()
    or (exists (
      select 1 from public.memberships m
      where m.org_id = org and m.user_id = auth.uid() and m.role in ('owner', 'admin')
    ) and public.mfa_satisfied())
$$;

create or replace function public.member_role(org uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select case
    when public.is_staff() then 'owner'::public.member_role
    when public.mfa_satisfied() then (select m.role from public.memberships m where m.org_id = org and m.user_id = auth.uid())
  end
$$;

-- Os clientes de cada um passam pelas mesmas regras (antes liam memberships direto).
create or replace function public.my_organizations()
returns table (id uuid, name text, slug text, role public.member_role)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.slug, public.member_role(o.id)
  from public.organizations o
  where public.is_member(o.id)
  order by o.name
$$;

create or replace function public.my_new_leads(p_org uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.leads l
  where l.org_id = p_org and l.status = 'new' and l.source <> 'whatsapp' and public.is_member(p_org)
    and (l.assigned_to = auth.uid() or (l.assigned_to is null and public.is_org_admin(p_org)))
$$;

-- A equipe sem o segundo fator recebe a explicação, em vez de "só a equipe cadastra".
create or replace function public.create_organization(
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
    if exists (select 1 from public.platform_staff s where s.user_id = auth.uid()) then
      raise exception 'a equipe da plataforma precisa entrar com a verificação em duas etapas' using errcode = '42501';
    end if;
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

-- Perfis: o próprio e o dos colegas também só com o segundo fator em dia.
drop policy "profiles: o próprio" on public.profiles;
create policy "profiles: o próprio" on public.profiles for all
  using (user_id = auth.uid() and public.mfa_satisfied())
  with check (user_id = auth.uid() and public.mfa_satisfied());
drop policy "profiles: colegas leem" on public.profiles;
create policy "profiles: colegas leem" on public.profiles for select using (
  public.mfa_satisfied() and exists (
    select 1 from public.memberships a join public.memberships b on a.org_id = b.org_id
    where a.user_id = auth.uid() and b.user_id = profiles.user_id
  )
);
