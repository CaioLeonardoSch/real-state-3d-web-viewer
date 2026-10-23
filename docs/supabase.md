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
| `VITE_DEMO_LISTINGS` | `false` no produto: build sem a demonstração (sem os imóveis fictícios, sem o espelho de vendas de exemplo, sem o título e a faixa "demonstração"; os arquivos de exemplo nem são publicados). Padrão: demonstração |
| `VITE_TURNSTILE_SITE_KEY` | Site Key do CAPTCHA (opcional; ver a seção 9) |

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
   Ao entrar de novo, a conta pede a **verificação em duas etapas**, obrigatória para o suporte: em **Minha conta →
   Verificação em duas etapas → Ativar**, leia o QR code com um aplicativo autenticador (Google Authenticator,
   Microsoft Authenticator, 1Password…) e digite o código de 6 dígitos. Só então a conta mostra "suporte da
   plataforma"; dali em diante, cada entrada pede a senha e o código do aplicativo (ver a seção 9).
2. **Cadastrar um cliente:** em **Minha conta → Suporte: nova imobiliária**, informe o nome, o endereço do site, o
   nome e o e-mail do administrador da imobiliária. Aparece a **senha provisória** dele, uma vez só: passe para a
   pessoa por um canal seguro, com o endereço de entrada (`painel.html`). Só a equipe de suporte cadastra
   imobiliárias e o administrador delas (um por imobiliária); ninguém cria conta sozinho pelo site.
3. **O administrador entra** com o e-mail e a senha provisória e, antes de qualquer outra coisa, escolhe a senha
   dele. Esqueceu? **Esqueci minha senha** manda um link por e-mail para escolher outra.
4. **O administrador cria os acessos dos corretores** em **Minha conta → Equipe → Criar acesso** (nome e e-mail).
   Cada corretor recebe uma senha provisória, também mostrada uma vez, e troca no primeiro acesso. Na mesma tela o
   administrador muda papéis e remove pessoas. Precisa da função `create-user` publicada:
   `npx supabase functions deploy create-user`.
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
visitante) e o link do anúncio. Cada contato gera um aviso só, mesmo com duas chamadas ao mesmo tempo: a função
reserva o contato numa atualização só (`notified_at` preenchido onde ainda está vazio) antes de enviar, e devolve a
reserva se o envio falhar.

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

Ver [`importacao-xml.md`](importacao-xml.md). Para a importação automática (o administrador informa o endereço do
feed em Minha conta), crie no GitHub o segredo **`SUPABASE_SERVICE_ROLE_KEY`** (Settings → Secrets and variables →
Actions → Secrets) com a chave `service_role` do projeto. O workflow "Importar XML" roda de hora em hora quando a
variável `VITE_SUPABASE_URL` está definida; sem o segredo, ele falha e nenhum feed é lido.

**Feito em 17/10:** alertas de imóveis novos (item 40). O workflow "Alertas de imóveis" (`.github/workflows/alertas.yml`)
roda todo dia às 8h07 quando as variáveis `VITE_SUPABASE_URL` e `SITE_URL` (o endereço da plataforma, onde fica o site
na raiz) estão definidas. Precisa dos segredos `SUPABASE_SERVICE_ROLE_KEY` e `RESEND_API_KEY`; a variável
`ALERT_EMAIL_FROM` é o remetente (um domínio verificado no Resend). Para rodar à mão: `npm run alerts:send`
(`--dry-run` só mostra o que mandaria). Pedidos sem confirmação somem depois de 30 dias.

### Espelho de vendas das incorporadoras

O suporte envia o desenho das torres com `npm run developments:upload` (chave de serviço); a incorporadora cuida de
situação, preços, reservas e planilha em Minha conta. Passo a passo em [`espelho-de-vendas.md`](espelho-de-vendas.md).
As reservas vencidas são liberadas pelo `pg_cron` a cada 10 minutos (o mesmo agendador da limpeza da lixeira).

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

Cada imobiliária tem um site com a marca dela em `/?imobiliaria=<slug>` (raiz da plataforma) (o slug é o do cadastro). Para
personalizar: entre como dono ou administrador e use **Minha conta → Personalizar o site** (ou abra o site com
`&editar=1`). As alterações aparecem na hora para quem editar e, depois de **Publicar alterações**, para todos.
Cada publicação entra no **Histórico de publicações**, no fim do editor (as 30 últimas, com data e quem publicou):
**Abrir esta versão** coloca uma versão anterior no editor, para conferir e publicar de novo.
Logo e fotos vão para o bucket `site-assets`.

**Domínio próprio:** o suporte grava o domínio em `organizations.custom_domain` (sem `www.`, por exemplo
`suaimobiliaria.com.br`) e o cliente aponta o DNS para a hospedagem. O site reconhece o cliente pelo domínio.
No domínio do cliente, o site tem endereços limpos (`/imovel/<título>-<código>`) e cada página chega pronta para o
Google e para a prévia do WhatsApp, com o `sitemap.xml` e o `robots.txt` do cliente. Isso pede a hospedagem com a
função `functions/[[path]].ts` (Cloudflare Pages), porque o GitHub Pages atende um domínio só. Detalhes no item 12
de [`backend.md`](backend.md).

O site abre com uma consulta só: `site_bootstrap` devolve o cliente (pelo domínio, senão pelo slug), os anúncios
publicados e as fotos. A consulta roda com os direitos de quem chama.

Os formulários "Contato" e "Anunciar imóvel" do site chegam em Minha conta → Contatos (para os administradores) e
por e-mail, como os contatos dos anúncios.

## 9. Segurança: verificação em duas etapas, CAPTCHA e cabeçalhos

**Verificação em duas etapas (TOTP).** Vem ligada no Supabase (confira em **Authentication → Multi-Factor**: "TOTP
(App Authenticator)"; não tem custo). A equipe de suporte só tem os poderes de suporte numa sessão confirmada com o
código; donos e administradores ativam se quiserem, em **Minha conta**, e a partir daí a senha sozinha não dá acesso
aos dados da imobiliária. Quem perder o celular pede ao suporte, que remove o fator no **SQL Editor**:
```sql
delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'pessoa@exemplo.com');
```
A conta volta a entrar só com a senha (no caso da equipe de suporte, sem os poderes de suporte) até a pessoa ativar
a verificação de novo, com o celular novo.

**CAPTCHA (Cloudflare Turnstile).** Pronto para ligar, desligado por padrão. Ligado, protege o login, o cadastro e
os formulários de contato (anúncio, "Contato" e "Anunciar imóvel"). O campo-armadilha e os limites por origem
continuam valendo. Para ligar, nesta ordem:
1. No painel da Cloudflare, **Turnstile → Add widget**: nome, modo **Managed** e os domínios do site (o do GitHub
   Pages e os dos clientes). Guarde a **Site Key** (pública) e a **Secret Key**.
2. Publique a função dos contatos e grave a chave secreta:
   ```bash
   npx supabase functions deploy submit-lead
   npx supabase secrets set TURNSTILE_SECRET_KEY=0x...
   ```
3. No GitHub, crie a variável `VITE_TURNSTILE_SITE_KEY` com a Site Key e publique o site de novo. Os formulários
   passam a mostrar o widget (só aparece quando a Cloudflare pede um clique) e os contatos vão pela função
   `submit-lead`, que confere o token antes de gravar.
4. Com o site novo no ar, ligue as duas checagens do servidor:
   - **login e cadastro:** no Supabase, **Authentication → Attack Protection → Enable Captcha protection**,
     provedor Turnstile, com a Secret Key;
   - **contatos:** no **SQL Editor**, `update public.private_settings set value = 'on' where key = 'lead_captcha';`.
     A partir daí o banco recusa contatos que não passem pela função (o clique no WhatsApp, sem dados pessoais,
     continua direto). Essa configuração não é lida nem alterada pelo site.

Ligar o passo 4 antes do 3 bloqueia o login e os contatos de quem ainda está com o site antigo. Para desligar, faça o
caminho inverso (`value = 'off'`). Num projeto de homologação dá para usar as chaves de teste da Cloudflare, que
sempre aprovam: Site Key `1x00000000000000000000AA` e Secret Key `1x0000000000000000000000000000000AA`.

**Cabeçalhos de segurança.** O build gera a política de conteúdo (CSP) a partir das variáveis do próprio build:
endereço do Supabase, Turnstile e endereço dos blocos do mapa (`scripts/lib/csp.mjs`). No GitHub Pages vale só a
cópia em `<meta>` de cada página, que não cobre `frame-ancestors` (proteção contra o site ser aberto dentro de outro)
nem HSTS. Em Cloudflare Pages ou Netlify, o arquivo `dist/_headers`, gerado no build a partir de `public/_headers`,
traz os cabeçalhos completos. Para conferir no ar: ferramentas do desenvolvedor do navegador (aba Rede, cabeçalhos da
página) ou <https://securityheaders.com>. Um domínio novo de onde o site precise carregar algo (por exemplo, fotos
em outro storage) tem de entrar em `scripts/lib/csp.mjs`; o teste `tests/csp.test.ts` e o console do navegador
("Refused to load…") mostram o que ficou de fora.

**Senhas.** O site exige 8 caracteres; no Supabase, ajuste o mínimo para 8 nas configurações de senha do Auth (o
`supabase/config.toml` local já usa 8). A recusa de senhas vazadas é um recurso do plano Pro.

## O que o banco garante (testado)

Os itens de 14/10/2026 (verificação em duas etapas, CAPTCHA dos contatos e arquivos no storage) e o histórico do site
passaram nos testes de backend e no fluxo pelo navegador, no Supabase local, em 15/10/2026.

- A equipe da plataforma só tem os poderes de suporte numa sessão confirmada com a verificação em duas etapas
  (`aal2` no token); sem ela, a conta da equipe é tratada como a de um usuário comum. Quem ativou a verificação só
  age como membro da imobiliária numa sessão confirmada: a senha sozinha não lê nem altera nada da imobiliária
  (migração `20261020000001_mfa.sql`).
- Com o CAPTCHA dos contatos ligado (`private_settings.lead_captcha = 'on'`), visitantes e usuários logados não
  gravam contatos direto: só a função `submit-lead`, depois de conferir o token. O IP informado pela função conta
  para os limites só quando ela chama com a chave de serviço; ninguém escolhe o próprio IP pelo site
  (`20261020000002_lead_captcha.sql`).
- Só a equipe de suporte cadastra imobiliárias; ninguém se coloca na equipe pelo site.
- Só dono e administradores mudam o site da imobiliária (configuração de até 64 KB); endereço e domínio, só o
  suporte. Imagens do site só na pasta do próprio cliente, sem SVG.
- Cada publicação do site entra no histórico (as 30 últimas, com data e autor), que só dono e administradores leem;
  ninguém grava nele direto (`20261021000002_site_history.sql`).
- Ninguém cria conta pelo site (`enable_signup = false`): o suporte cria o administrador da imobiliária (um só;
  `can_create_member` e o gatilho `memberships_one_owner`), e o administrador cria os corretores, pela função
  `create-user`. A senha provisória fica marcada (`password_change_required`) até a pessoa escolher a dela; a marca
  só sai quando a senha da conta realmente muda (`20261108000001_created_accounts.sql`). Corretor não cria acessos;
  a imobiliária nunca fica sem dono.
- Cada imobiliária vê e edita só os próprios anúncios; o corretor edita os dele, o dono/administrador edita todos.
- O suporte atende qualquer imobiliária, e cada ação dele fica marcada no registro de auditoria.
- O público lê por uma view que **esconde o endereço exato** quando o anunciante escolheu "só a rua" ou "só o
  bairro": sem ponto exato, sem prédio, sem número e sem CEP. O centro do círculo aproximado é sorteado no servidor.
- O preço riscado é calculado pelo banco a partir do histórico; o anunciante não consegue digitar um "preço
  anterior". O histórico de preço é visível só para a imobiliária dona.
- A marca "Exclusivo" só aparece depois que a equipe confere o documento (`exclusive_verified`, alterável só com a
  chave de serviço).
- Fotos: qualquer um vê as de anúncios publicados; só quem edita o anúncio (o autor ou os administradores) envia,
  troca ou apaga os arquivos dele (`20261020000003_listing_files.sql`). Os arquivos que sobram da limpeza da lixeira
  são removidos por administradores.
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
npm run test:backend    # 45 testes: permissões, convites (e o e-mail), auditoria, lixeira, contatos (com o aviso
                        # por e-mail num provedor falso, inclusive chamadas simultâneas), CAPTCHA dos contatos
                        # (verificador falso), verificação em duas etapas (suporte e dona), privacidade, preço,
                        # obra em andamento, site da imobiliária, storage e importação do XML
npm run verify:backend  # navegador: suporte ativa a verificação em duas etapas e cria a imobiliária e o
                        # administrador → ele entra com a senha provisória e escolhe a dele → cria o acesso do
                        # corretor → corretor troca a senha e anuncia com fotos → visitante → preço →
                        # edição completa → lixeira e restauração → excluir de vez → suporte entra de novo com o
                        # código → histórico, contato do visitante, site da imobiliária
                        # personalizado pelo dono, e o dono ativa a verificação e entra no editor com o código
                        # (41 checagens)
npm run db:reset        # recria o banco local a partir das migrações
```

Os testes geram os códigos do aplicativo autenticador com `scripts/lib/totp.mjs` (RFC 6238, sem dependências) e
usam um verificador falso do Turnstile (só o token `token-valido` passa). Depois de mudar `supabase/config.toml` (por
exemplo, ao ligar o TOTP), o Supabase local precisa ser reiniciado para ler a configuração nova.

O workflow `.github/workflows/ci.yml` roda os testes do backend (`test:backend` e `verify:backend`) no GitHub a cada
push e pull request, junto com os do site; a publicação só sai com ele verde.

## Mudanças no esquema

Nunca altere o banco de produção pelo painel. Crie uma migração nova (`npx supabase migration new <nome>`), teste
com `npm run db:reset && npm run test:backend` e aplique com `npx supabase db push`.
