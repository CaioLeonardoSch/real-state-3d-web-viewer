-- Convite só se aceita com o link (auditoria de 17/10, A3).
-- my_invitations devolvia o código do convite a qualquer conta com o e-mail convidado. Exigir e-mail confirmado não
-- basta: com "Confirm email" desligado, o próprio Supabase marca o e-mail como confirmado no cadastro (conferido no
-- ambiente local). Então qualquer pessoa podia criar a conta com o e-mail convidado, ver o código e entrar na
-- imobiliária, inclusive como dona. Agora a lista mostra só para qual imobiliária e com qual papel; aceitar exige o
-- código, que só vem no link enviado por quem convidou. accept_invitation também recusa e-mail não confirmado
-- (contas criadas pelo suporte sem confirmação, ou login por provedor que não confirma o e-mail).

drop function public.my_invitations();
create function public.my_invitations()
returns table (org_id uuid, org_name text, role public.member_role, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.org_id, o.name, i.role, i.expires_at
  from public.invitations i join public.organizations o on o.id = i.org_id
  where i.accepted_at is null and i.expires_at > now()
    and i.email = lower((select u.email from auth.users u where u.id = auth.uid()))
$$;
revoke execute on function public.my_invitations() from public, anon;
grant execute on function public.my_invitations() to authenticated;

create or replace function public.accept_invitation(p_token uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invitations;
  my_email text;
  confirmed boolean;
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
  select lower(u.email), u.email_confirmed_at is not null into my_email, confirmed from auth.users u where u.id = auth.uid();
  if my_email is distinct from inv.email then
    raise exception 'este convite é para %; entre com esse e-mail', inv.email using errcode = '42501';
  end if;
  if not confirmed then
    raise exception 'confirme seu e-mail antes de aceitar o convite' using errcode = '42501';
  end if;
  insert into public.memberships (org_id, user_id, role) values (inv.org_id, auth.uid(), inv.role)
  on conflict (org_id, user_id) do update set role = excluded.role;
  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.org_id;
end
$$;
