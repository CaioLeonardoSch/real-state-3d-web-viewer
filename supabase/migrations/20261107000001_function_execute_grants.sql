-- Quem pode chamar cada função pela API (/rest/v1/rpc), a partir do Security Advisor do Supabase (lints 0028 e 0029).
-- O Postgres dá EXECUTE a PUBLIC em toda função nova, e o Supabase repete para anon e authenticated: sem o revoke,
-- qualquer visitante chama qualquer função security definer do schema public.

-- Funções de gatilho (trigger e event_trigger, como a rls_auto_enable que o painel cria): o gatilho dispara sem
-- EXECUTE de quem grava, então ninguém precisa chamá-las pela API.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- Só para quem entrou: o site só as chama com sessão (src/backend/remote.ts), e por dentro elas já não devolviam
-- nada ao visitante.
revoke execute on function public.accept_invitation(uuid) from public, anon;
revoke execute on function public.create_organization(text, text, public.org_kind, text) from public, anon;
revoke execute on function public.my_organizations() from public, anon;
revoke execute on function public.my_new_leads(uuid) from public, anon;
revoke execute on function public.org_audit(uuid, bigint, integer) from public, anon;
revoke execute on function public.org_members(uuid) from public, anon;

-- Continuam no Security Advisor, de propósito (docs/backend.md §10):
-- - as vistas public_listings, public_developments e public_development_units (security definer: mostram ao público
--   só as colunas permitidas, sem endereço oculto);
-- - as funções que o visitante usa (contato, denúncia, alerta de busca, convite, mapa, visualização) e as do dia a
--   dia de quem entrou: são security definer para gravar e ler com as regras que elas mesmas conferem;
-- - is_member, is_staff, mfa_satisfied e as outras usadas dentro das regras de acesso (RLS), que precisam de EXECUTE
--   para quem consulta e só dizem algo sobre a própria pessoa.
