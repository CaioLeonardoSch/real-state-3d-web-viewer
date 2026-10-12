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

1. **Você vira suporte da plataforma** (uma vez): entre no site com **Entrar → Criar uma conta**, confirme o
   e-mail e, no painel do Supabase, **SQL Editor**, rode:
   ```sql
   insert into public.platform_staff (user_id)
   select id from auth.users where email = 'seu-email@exemplo.com';
   ```
   Ao entrar de novo, a sua conta mostra "suporte da plataforma".
2. **Cadastrar um cliente:** em **Minha conta → Suporte: nova imobiliária**, informe o nome, o endereço do site e o
   e-mail do dono. Aparece um **link de convite**: copie ou mande por WhatsApp. Só a equipe de suporte cadastra
   imobiliárias; uma conta comum não consegue.
3. **O dono entra pelo link**, cria a conta com o e-mail convidado (já vem preenchido) e clica em **Aceitar**.
4. **O dono convida os corretores** em **Minha conta → Equipe** (e-mail e papel: corretor ou administrador). Cada
   convite gera um link que vale 14 dias e só funciona para o e-mail convidado. Na mesma tela ele muda papéis,
   remove pessoas e cancela convites.
5. **+ Anunciar**: o anúncio é publicado ao salvar, com as fotos (e uma miniatura de cada) no storage.
6. **Editar:** no painel do anúncio, **Editar anúncio** abre o mesmo formulário preenchido: título, local ("Trocar
   local"), fotos (incluir, remover, legenda, capa), planta, preço e todos os outros campos. Fotos removidas saem do
   storage. Baixar o preço gera o preço riscado pelo histórico, como na atualização rápida.

7. **Excluir** manda o anúncio para a **lixeira**: ele sai do site na hora e pode ser restaurado em **Minha conta →
   Lixeira** por 30 dias (o corretor restaura os dele; administradores, todos). Depois disso uma tarefa diária do
   banco (`pg_cron`) apaga de vez; as fotos que sobram no storage são removidas pelo site na próxima vez que alguém
   da imobiliária entra. **Excluir de vez** na lixeira apaga na hora.
8. **Histórico de alterações** (administradores e suporte), em **Minha conta**: cada ação em frases, com quem fez,
   quando e o título que o anúncio tinha no momento ("Corretor X alterou "Casa com quintal": preço de R$ 900.000
   para R$ 850.000").

O suporte escolhe em **Atendendo** qual imobiliária está atendendo e pode corrigir anúncios e equipe de qualquer
uma. Tudo o que muda (anúncios, equipe, convites, fotos) fica no registro de auditoria (`audit_log`), com quem fez,
quando, o que mudou e se foi o suporte; os administradores de cada imobiliária leem o registro dela.

Os e-mails de convite ainda não são enviados pelo sistema: quem convida manda o link. O envio automático entra
junto com o e-mail próprio (SMTP) e uma função no servidor.

## O que o banco garante (testado)

- Só a equipe de suporte cadastra imobiliárias; ninguém se coloca na equipe pelo site.
- Corretores entram só por convite, e o convite só vale para o e-mail convidado, uma vez, por 14 dias. Corretor não
  convida; administrador não cria dono; a imobiliária nunca fica sem dono.
- Cada imobiliária vê e edita só os próprios anúncios; o corretor edita os dele, o dono/administrador edita todos.
- O suporte atende qualquer imobiliária, e cada ação dele fica marcada no registro de auditoria.
- O público lê por uma view que **esconde o endereço exato** quando o anunciante escolheu "só a rua" ou "só o
  bairro": sem ponto exato, sem prédio, sem número e sem CEP. O centro do círculo aproximado é sorteado no servidor.
- O preço riscado é calculado pelo banco a partir do histórico; o anunciante não consegue digitar um "preço
  anterior". O histórico de preço é visível só para a imobiliária dona.
- A marca "Exclusivo" só aparece depois que a equipe confere o documento (`exclusive_verified`, alterável só com a
  chave de serviço).
- Fotos: qualquer um vê as de anúncios publicados; só membros da imobiliária gravam na pasta dela.
- Rascunhos (`published = false`) não aparecem para o público.
- Editar um anúncio sem mudá-lo de lugar mantém o mesmo círculo aproximado (sortear um novo a cada edição permitiria
  estimar o endereço escondido comparando os círculos).

## Testes

```bash
npm run db:start        # Supabase local (Docker); a primeira vez baixa as imagens
npm run test:backend    # 20 testes: permissões, convites, auditoria, lixeira, privacidade, preço e storage
npm run verify:backend  # navegador: suporte cria a imobiliária → dono entra pelo link → convida o corretor →
                        # corretor anuncia com fotos → visitante → preço → edição completa → lixeira e
                        # restauração → excluir de vez → histórico (18 checagens)
npm run db:reset        # recria o banco local a partir das migrações
```

O workflow `.github/workflows/backend.yml` roda os testes do backend no GitHub a cada mudança no esquema.

## Mudanças no esquema

Nunca altere o banco de produção pelo painel. Crie uma migração nova (`npx supabase migration new <nome>`), teste
com `npm run db:reset && npm run test:backend` e aplique com `npx supabase db push`.
