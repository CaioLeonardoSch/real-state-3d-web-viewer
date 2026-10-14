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

9. **Contatos (leads):** no anúncio, o visitante usa **Enviar mensagem** (nome, e-mail ou telefone, mensagem e a
   autorização da LGPD) ou o botão do WhatsApp. O contato vai para o corretor que criou o anúncio (sem ele, para os
   administradores), aparece em **Minha conta → Contatos** com um contador no topo, e o corretor registra a
   situação (novo, em atendimento, visita, proposta, fechado, perdido) e anotações. Cliques no WhatsApp são contados,
   sem dados pessoais. Administradores trocam o responsável e excluem contatos a pedido do cliente (LGPD).

O suporte escolhe em **Atendendo** qual imobiliária está atendendo e pode corrigir anúncios e equipe de qualquer
uma. Tudo o que muda (anúncios, equipe, convites, fotos) fica no registro de auditoria (`audit_log`), com quem fez,
quando, o que mudou e se foi o suporte; os administradores de cada imobiliária leem o registro dela.

Os e-mails de convite ainda não são enviados pelo sistema: quem convida manda o link. O envio automático entra
junto com o e-mail próprio (SMTP) e uma função no servidor.

## 4. Aviso de contato por e-mail (opcional)

Sem configuração, os contatos já aparecem em **Minha conta → Contatos**. Para o corretor receber cada um por e-mail:

1. Crie uma conta no [Resend](https://resend.com) (o plano gratuito envia algumas milhares de mensagens por mês),
   verifique o domínio de envio (por exemplo `seudominio.com.br`) e gere uma chave de API.
2. Publique a função e configure as chaves (uma vez):
   ```bash
   npx supabase functions deploy notify-lead
   npx supabase secrets set RESEND_API_KEY=re_... LEAD_EMAIL_FROM="Contatos <contatos@seudominio.com.br>" \
     SITE_URL=https://caioleonardosch.github.io/real-state-3d-web-viewer/
   ```
O e-mail traz o nome, o telefone (com link para responder no WhatsApp), o e-mail (responder ao e-mail responde ao
visitante) e o link do anúncio. Cada contato gera um aviso só.

## 5. E-mails de convite e de confirmação de conta

Com o Resend configurado (seção 4), publique também a função dos convites:
```bash
npx supabase functions deploy send-invite
```
Cada convite criado em **Minha conta** (pelo suporte ou pelo dono) passa a ser enviado por e-mail, com o link; o
link continua aparecendo na tela para mandar também pelo WhatsApp.

Os e-mails de **confirmação de conta** e de troca de senha são do próprio Supabase. Para saírem pelo mesmo domínio
(e sem o limite baixo do plano gratuito), em **Authentication → Emails → SMTP Settings** use o SMTP do Resend:
servidor `smtp.resend.com`, porta 465, usuário `resend`, senha = a chave do Resend.

## 6. Importação dos anúncios por XML

Ver [`importacao-xml.md`](importacao-xml.md).

## 7. Páginas para o Google

A cada publicação, o site gera uma página para cada anúncio real (`/imovel/<titulo>-<codigo>/`), com título, preço,
fotos, descrição, endereço só até onde o anunciante permitiu e os dados estruturados que o Google lê
(`RealEstateListing`), além do `sitemap.xml`. Com o backend configurado, o GitHub Pages republica **de hora em
hora**, então anúncios novos ganham página em até uma hora. Os imóveis fictícios da demonstração têm página, mas
marcada para não ser indexada, e ficam fora do sitemap.

Para o Google conhecer o site: no [Google Search Console](https://search.google.com/search-console), adicione a
propriedade do site e envie o `sitemap.xml`. Com domínio próprio (por exemplo `imoveis.suaimobiliaria.com.br`),
defina a variável `SITE_URL` no GitHub com esse endereço, para as páginas apontarem para ele.

Observações: o GitHub desliga as execuções agendadas de repositórios sem atividade por 60 dias (um push reativa).
No endereço do GitHub Pages de projeto, o `robots.txt` não fica na raiz do domínio, então o Google não o lê; com
domínio próprio passa a valer.

## 8. Site da imobiliária

Cada imobiliária tem um site com a marca dela em `site.html?imobiliaria=<slug>` (o slug é o do cadastro). Para
personalizar: entre como dono ou administrador e use **Minha conta → Personalizar o site** (ou abra o site com
`&editar=1`). As alterações aparecem na hora para quem editar e, depois de **Publicar alterações**, para todos.
Logo e fotos vão para o bucket `site-assets`.

**Domínio próprio:** o suporte grava o domínio em `organizations.custom_domain` (sem `www.`, por exemplo
`suaimobiliaria.com.br`) e o cliente aponta o DNS para a hospedagem. O site reconhece o cliente pelo domínio.
O GitHub Pages atende um domínio só; para vários clientes, ver o item 12 de [`backend.md`](backend.md).

Os formulários "Contato" e "Anunciar imóvel" do site chegam em Minha conta → Contatos (para os administradores) e
por e-mail, como os contatos dos anúncios.

## O que o banco garante (testado)

- Só a equipe de suporte cadastra imobiliárias; ninguém se coloca na equipe pelo site.
- Só dono e administradores mudam o site da imobiliária (configuração de até 64 KB); endereço e domínio, só o
  suporte. Imagens do site só na pasta do próprio cliente, sem SVG.
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
- Contatos: o visitante só envia para anúncio publicado, com autorização (o texto aceito fica guardado) e com
  e-mail ou telefone; robôs que preenchem o campo-armadilha são descartados; no máximo 5 envios em 10 minutos por
  origem (guardada só como hash) e 3 por dia da mesma pessoa no mesmo anúncio. O corretor vê só os contatos dos
  anúncios dele e não altera os dados do visitante; contatos não entram no registro de auditoria (dados pessoais).
- Editar um anúncio sem mudá-lo de lugar mantém o mesmo círculo aproximado (sortear um novo a cada edição permitiria
  estimar o endereço escondido comparando os círculos).
- Obra em andamento (`floors_built`, `construction_month`, `construction_source`; migração
  `20261019000001_construction_progress.sql`):
  - só vale para anúncio "em construção" e nunca passa do número de andares;
  - quem anuncia só registra como "anunciante" ("vistoria" e "imagem" ficam para a equipe e para o serviço mensal,
    com a chave de serviço);
  - cada mês fica em `construction_history`, visível ao público para anúncios publicados e à imobiliária para os
    dela.

## Testes

```bash
npm run db:start        # Supabase local (Docker); a primeira vez baixa as imagens
npm run test:backend    # 39 testes: permissões, convites (e o e-mail), auditoria, lixeira, contatos (com o aviso
                        # por e-mail num provedor falso), privacidade, preço, obra em andamento, site da
                        # imobiliária, storage e importação do XML
npm run verify:backend  # navegador: suporte cria a imobiliária → dono entra pelo link → convida o corretor →
                        # corretor anuncia com fotos → visitante → preço → edição completa → lixeira e
                        # restauração → excluir de vez → histórico, contato do visitante, convites por e-mail e
                        # site da imobiliária personalizado pelo dono (27 checagens)
npm run db:reset        # recria o banco local a partir das migrações
```

O workflow `.github/workflows/backend.yml` roda os testes do backend no GitHub a cada mudança no esquema.

## Mudanças no esquema

Nunca altere o banco de produção pelo painel. Crie uma migração nova (`npx supabase migration new <nome>`), teste
com `npm run db:reset && npm run test:backend` e aplique com `npx supabase db push`.
