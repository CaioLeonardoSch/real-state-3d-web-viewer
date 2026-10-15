-- Histórico das publicações do site de cada cliente. Cada mudança em organizations.branding guarda a versão que
-- entrou no ar, com a data e quem publicou (as 30 últimas por cliente). A primeira publicação guarda também a
-- configuração de antes, para poder voltar a ela. O editor abre uma versão antiga como rascunho e a publica de novo,
-- então voltar atrás também entra no histórico e pode ser desfeito.

create table public.site_versions (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  branding jsonb not null,
  published_by uuid references auth.users (id) on delete set null,
  -- vazio na configuração de antes do histórico (data desconhecida)
  published_at timestamptz default now()
);
create index site_versions_org on public.site_versions (org_id, id desc);

-- Sem políticas: ninguém lê nem grava direto. Só o gatilho grava; a leitura é pela função site_history.
alter table public.site_versions enable row level security;

create function public.record_site_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.branding is not distinct from old.branding then
    return null;
  end if;
  if not exists (select 1 from public.site_versions where org_id = new.id) then
    insert into public.site_versions (org_id, branding, published_by, published_at) values (new.id, old.branding, null, null);
  end if;
  insert into public.site_versions (org_id, branding, published_by) values (new.id, new.branding, auth.uid());
  delete from public.site_versions
  where org_id = new.id
    and id < (select v.id from public.site_versions v where v.org_id = new.id order by v.id desc offset 29 limit 1);
  return null;
end
$$;
revoke all on function public.record_site_version() from public, anon, authenticated;
create trigger site_versions after update of branding on public.organizations
for each row execute function public.record_site_version();

-- Versões do site, da mais nova para a mais antiga, para quem edita o site (donos e administradores).
create function public.site_history(p_org uuid)
returns table (id bigint, published_at timestamptz, author text, branding jsonb)
language sql stable security definer set search_path = '' as $$
  select v.id, v.published_at, coalesce(nullif(p.full_name, ''), p.email), v.branding
  from public.site_versions v
  left join public.profiles p on p.user_id = v.published_by
  where v.org_id = p_org and public.is_org_admin(p_org)
  order by v.id desc
$$;
revoke all on function public.site_history(uuid) from public, anon;
grant execute on function public.site_history(uuid) to authenticated;
