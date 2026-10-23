-- Contas criadas por quem administra, com senha provisória (pedido de 22/10):
-- - o suporte da plataforma cria a imobiliária e o administrador dela (um por imobiliária);
-- - o administrador (ou o suporte) cria os corretores;
-- - a senha provisória aparece uma vez para quem criou, e a pessoa troca no primeiro acesso.
-- A conta é criada pela função create-user (com a chave de serviço, que cria usuários no Auth); quem pode criar o
-- quê é decidido aqui, com o token de quem pediu.

-- Quem ainda está com a senha provisória. temp_hash é o hash da senha provisória: a marca só sai quando a senha
-- da conta deixa de ser essa (ver password_changed), e não por um simples pedido.
create table public.password_change_required (
  user_id uuid primary key references auth.users (id) on delete cascade,
  temp_hash text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.password_change_required enable row level security;
create policy "senha provisória: a própria" on public.password_change_required for select using (user_id = auth.uid());
revoke all on public.password_change_required from anon, authenticated;
grant select on public.password_change_required to authenticated;

-- null quando quem chama pode criar uma conta com esse papel na imobiliária; senão, o motivo.
create function public.can_create_member(p_org uuid, p_role public.member_role) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organizations o where o.id = p_org) then
    return 'imobiliária não encontrada';
  end if;
  if p_role = 'agent' then
    if public.is_org_admin(p_org) then return null; end if;
    return 'só o administrador da imobiliária (ou o suporte) cria corretores';
  elsif p_role = 'owner' then
    if not public.is_staff() then return 'só o suporte da plataforma cria o administrador da imobiliária'; end if;
    if exists (select 1 from public.memberships m where m.org_id = p_org and m.role = 'owner') then
      return 'esta imobiliária já tem administrador';
    end if;
    return null;
  end if;
  return 'papel não permitido: crie um corretor ou o administrador';
end
$$;
revoke execute on function public.can_create_member(uuid, public.member_role) from public, anon;
grant execute on function public.can_create_member(uuid, public.member_role) to authenticated;

-- Liga a conta recém-criada à imobiliária e marca a senha como provisória. Só a função create-user (service_role).
create function public.attach_created_member(p_org uuid, p_user uuid, p_role public.member_role, p_name text, p_by uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- no histórico, quem criou o acesso aparece como autor (e não "Sistema", que é o que a chave de serviço seria)
  if p_by is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_by, 'role', 'service_role')::text, true);
  end if;
  insert into public.memberships (org_id, user_id, role) values (p_org, p_user, p_role);
  update public.profiles set full_name = coalesce(nullif(trim(p_name), ''), full_name) where user_id = p_user;
  insert into public.password_change_required (user_id, temp_hash, created_by)
  select u.id, u.encrypted_password, p_by from auth.users u where u.id = p_user
  on conflict (user_id) do update set temp_hash = excluded.temp_hash, created_by = excluded.created_by, created_at = now();
end
$$;
revoke execute on function public.attach_created_member(uuid, uuid, public.member_role, text, uuid) from public, anon, authenticated;
grant execute on function public.attach_created_member(uuid, uuid, public.member_role, text, uuid) to service_role;

-- Depois de trocar a senha: tira a marca se a senha já não é a provisória. true = liberado.
create function public.password_changed() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.password_change_required r
  using auth.users u
  where r.user_id = auth.uid() and u.id = r.user_id and u.encrypted_password is distinct from r.temp_hash;
  return not exists (select 1 from public.password_change_required r where r.user_id = auth.uid());
end
$$;
revoke execute on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated;

-- Um administrador por imobiliária: só o suporte põe um segundo (por exemplo, para passar a administração adiante).
create function public.memberships_one_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'owner' and (tg_op = 'INSERT' or old.role <> 'owner') and not public.is_staff() and exists (
    select 1 from public.memberships m where m.org_id = new.org_id and m.role = 'owner' and m.user_id <> new.user_id
  ) then
    raise exception 'esta imobiliária já tem administrador' using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger memberships_one_owner before insert or update on public.memberships
for each row execute function public.memberships_one_owner();
