# Backend no Supabase: como colocar no ar

O backend é um projeto [Supabase](https://supabase.com): Postgres com PostGIS, login, armazenamento de arquivos e
regras de acesso no próprio banco (Row Level Security). O esquema está em `supabase/migrations/`; o site lê e
grava direto no Supabase com a biblioteca oficial, sem servidor próprio.

Sem configurar nada, o site continua como antes (demonstração, "Anunciar" salvando no navegador).

## 1. Criar o projeto (uma vez, ~10 minutos)

1. Crie uma conta em <https://supabase.com> e um projeto novo:
   - **Region:** South America (São Paulo), pela LGPD e pela latência;
   - **Database password:** gere uma forte e guarde num gerenciador de senhas.
   O plano gratuito serve para começar. O Pro (US$ 25/mês) inclui backups diários e não pausa o projeto por
   inatividade; vale contratar antes de ter clientes.
2. Aplique o esquema, a partir desta pasta:
   ```bash
   npx supabase login                      # abre o navegador para autorizar
   npx supabase link --project-ref <ref>   # o <ref> está na URL do projeto: supabase.com/dashboard/project/<ref>
   npx supabase db push                    # cria tabelas, regras de acesso e buckets de fotos
   ```
3. Em **Authentication → URL Configuration**:
   - **Site URL:** `https://caioleonardosch.github.io/real-state-3d-web-viewer/`;
   - **Redirect URLs:** a mesma, e `http://localhost:5173/` para desenvolvimento.
4. Em **Authentication → Sign In / Providers → Email**, deixe "Confirm email" ligado: a pessoa recebe um link para
   confirmar o e-mail antes de entrar. O envio de e-mails do plano gratuito é limitado (poucos por hora). Para
   produção, configure um SMTP próprio (Resend, Postmark, Amazon SES) em **Authentication → Emails → SMTP**.
5. Em **Project Settings → API Keys**, copie a **URL** do projeto e a chave **publishable** (ou "anon"). Ela é
   pública por natureza: vai no site, e quem protege os dados são as regras do banco. **Nunca** use a chave
   `service_role`/`secret` no site.

## 2. Ligar o site ao backend

No GitHub: **Settings → Secrets and variables → Actions → Variables → New repository variable**:

| Nome | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | a chave publishable/anon |
| `VITE_DEMO_LISTINGS` | `false` para esconder os 100 imóveis fictícios (opcional; padrão: mostrar) |

Depois rode de novo **Actions → Publicar no GitHub Pages → Run workflow** (ou faça um push). O botão **Entrar**
aparece no topo.

Para desenvolver no computador, crie `.env.local` (não versionado) com as duas primeiras variáveis.

## 3. Primeiro uso

1. **Entrar → Criar uma conta**, confirme o e-mail e entre.
2. Cadastre a imobiliária (nome e endereço do site). Quem cadastra vira **dono**.
3. **+ Anunciar**: o anúncio é publicado para todos ao salvar, com as fotos no storage.
4. Para incluir corretores na imobiliária, por enquanto: a pessoa cria a conta, e você inclui pelo painel do
   Supabase (**Table Editor → memberships**: `org_id` da imobiliária, `user_id` da pessoa, `role` = `agent`). A tela
   de convite é o próximo passo.

## O que o banco garante (testado)

- Cada imobiliária vê e edita só os próprios anúncios; o corretor edita os dele, o dono/administrador edita todos.
- O público lê por uma view que **esconde o endereço exato** quando o anunciante escolheu "só a rua" ou "só o
  bairro": sem ponto exato, sem prédio, sem número e sem CEP. O centro do círculo aproximado é sorteado no servidor.
- O preço riscado é calculado pelo banco a partir do histórico; o anunciante não consegue digitar um "preço
  anterior". O histórico de preço é visível só para a imobiliária dona.
- A marca "Exclusivo" só aparece depois que a equipe confere o documento (`exclusive_verified`, alterável só com a
  chave de serviço).
- Fotos: qualquer um vê as de anúncios publicados; só membros da imobiliária gravam na pasta dela.
- Rascunhos (`published = false`) não aparecem para o público.

## Testes

```bash
npm run db:start        # Supabase local (Docker); a primeira vez baixa as imagens
npm run test:backend    # 10 testes de permissão, privacidade, preço e storage contra o banco local
npm run verify:backend  # navegador: criar conta → imobiliária → anunciar com fotos → visitante → preço → excluir
npm run db:reset        # recria o banco local a partir das migrações
```

O workflow `.github/workflows/backend.yml` roda os testes do backend no GitHub a cada mudança no esquema.

## Mudanças no esquema

Nunca altere o banco de produção pelo painel. Crie uma migração nova (`npx supabase migration new <nome>`), teste
com `npm run db:reset && npm run test:backend` e aplique com `npx supabase db push`.
