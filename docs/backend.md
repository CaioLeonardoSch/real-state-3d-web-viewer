# Backend e hospedagem: o que precisa existir para virar produto

Anotações de 09/10/2026. O protótipo começou 100% estático (arquivos em `public/data/` e anúncios no `localStorage`).
Este documento lista o que precisa ir para um backend e como manter tudo rodando para vários clientes.

**Situação (13/10/2026):** iniciado no Supabase, ver [`supabase.md`](supabase.md). Prontos: itens 1 (contas,
imobiliárias e papéis dono/administrador/corretor, com isolamento por RLS; imobiliárias cadastradas só pelo
suporte; corretores por convite; registro de auditoria), 2 (criar, alterar situação e preço, excluir; busca por área
com PostGIS; edição completa em 12/10/2026) e 3 (fotos com miniatura e planta no storage). Faltam: envio
dos itens 5 em diante: o 6 (páginas para o Google), o 8 (importação do XML) e o envio dos convites por e-mail
ficaram prontos em 13/10/2026. Lixeira e histórico de alterações pela tela: 12/10/2026. Site configurável de cada
imobiliária (white label, item 12): 13/10/2026.

## 1. O que precisa estar no backend

### Essencial (MVP)

1. **Contas e acesso.** Login de imobiliárias, corretores, incorporadoras e administradores, cada um vendo e editando
   só os próprios dados (multi-inquilino com isolamento por cliente). É a parte onde aparecem as falhas de segurança;
   exige testes específicos.
2. **CRUD de anúncios.** Criar, editar, despublicar e excluir, com as validações que hoje rodam no navegador: prédio
   residencial, terreno sem encostar em prédios, ruas e verde, círculo de localização aproximada. A busca por área do
   mapa usa PostGIS.
3. **Fotos e vídeos.** Upload, redimensionamento (miniaturas e WebP), armazenamento em object storage com CDN.
4. **Contatos (leads).** Formulário e botão de WhatsApp com mensagem pronta, gravados e avisados ao corretor (e-mail
   e/ou WhatsApp). Exige consentimento conforme a LGPD. **Feito em 13/10/2026** (aviso por e-mail via Resend; aviso
   por WhatsApp fica para depois, exige a API paga do WhatsApp Business).
5. **Espelho de vendas.** Unidades por empreendimento com situação (disponível, reservado, vendido) e preço, editados
   pela incorporadora. O ideal é integrar com o sistema de vendas dela.
6. **Página própria de cada imóvel,** que o Google consiga indexar. **Feito em 13/10/2026**: páginas estáticas geradas
   a cada publicação (de hora em hora com o backend), com dados estruturados e sitemap.
7. **Termos de uso, política de privacidade e CRECI** nos anúncios de corretores e imobiliárias.

### Logo depois

8. **Importação dos anúncios** do sistema que a imobiliária já usa (**feito em 13/10/2026**, formato VRSync, ver
   [`importacao-xml.md`](importacao-xml.md)). Elas mandam o mesmo cadastro para ZAP e VivaReal
   em XML; ler esse arquivo evita cadastro duplicado e é o que faz uma imobiliária adotar o produto.
9. **Favoritos, buscas salvas e alertas** de novos imóveis (e-mail ou push).
10. **Moderação:** fila de aprovação, denúncias, histórico de alterações.
11. **Métricas por cliente:** visualizações, cliques e contatos por anúncio (o relatório que justifica a assinatura).
12. **Cobrança** da assinatura (Asaas, Iugu, Stripe…).

### Dados do mapa (rotina, não servidor)

13. **Atualização periódica** do OSM, do cadastro da Prefeitura, das alturas e do `.pmtiles`: feita pelo workflow
    mensal, que abre um pull request com o relatório de mudanças (item 13 abaixo). O mapa base não precisa de
    servidor: é um arquivo estático lido por intervalos.

### Esforço estimado

O CRUD de anúncios com login, sobre uma base pronta (Postgres + PostGIS + autenticação), leva cerca de **1 a 2
semanas**. Um MVP com os itens 1 a 7 fica em torno de **6 a 10 semanas** para uma pessoa. É uma estimativa grosseira
e depende do que entra na primeira versão.

## 2. Vários clientes: um sistema só, não vários sites

Manter um site separado por cliente (uma cópia do código e um servidor para cada) multiplica o trabalho: cada
correção precisa ser aplicada N vezes e cada servidor precisa ser monitorado. O modelo recomendado é **multi-inquilino**:

- **um código, um deploy, um banco**; cada tabela tem `cliente_id`, e o isolamento é garantido no banco (Row Level
  Security do Postgres), não só no código;
- **cada cliente acessa pelo próprio endereço**, seja um subdomínio (`imobiliariax.seuproduto.com.br`) ou o domínio
  dele (`mapa.imobiliariax.com.br`, com certificado automático);
- **a "cara" do cliente é configuração**, não código: logo, cores, textos, região inicial do mapa, quais anúncios
  aparecem;
- para o site da própria imobiliária: um **componente embutível** (`<iframe>` ou um script) que mostra o mapa dentro
  do site que ela já tem.

Uma correção ou melhoria chega a todos os clientes de uma vez, e acrescentar um cliente é cadastrar uma linha, não
subir um servidor.

## 3. Onde hospedar

### Recomendado para começar: serviços gerenciados

| Parte | Serviço (exemplos) | Por quê |
|---|---|---|
| Site (o front atual) | Cloudflare Pages, Vercel ou Netlify | Deploy a cada push no GitHub, CDN, HTTPS e domínios de clientes automáticos |
| Banco + login + arquivos | Supabase (Postgres com PostGIS, autenticação, storage, Row Level Security) | Resolve contas, isolamento por cliente e busca geográfica sem administrar servidor; tem região em São Paulo, bom para LGPD e latência |
| Mapa base (`.pmtiles`) e fotos | Cloudflare R2 ou o storage do Supabase | R2 não cobra pelo tráfego de saída, que é o custo que cresce num mapa |
| Tarefas agendadas (dados do mapa, alertas) | GitHub Actions, Supabase cron ou Cloudflare Workers | Sem máquina ligada o tempo todo |
| E-mail transacional | Resend, Postmark ou Amazon SES | |

Custo inicial: algumas dezenas de dólares por mês, que crescem com o uso. Os planos pagos desses serviços já incluem
backups, atualizações de segurança e monitoramento básico, que é a maior parte da "manutenção" de infraestrutura.

### AWS

Faz sentido mais adiante, com volume alto, exigência contratual de um cliente grande ou alguém dedicado a
infraestrutura. Equivalentes: S3 + CloudFront (site, mapa e fotos), RDS Postgres com PostGIS ou Aurora (banco),
Cognito (login), Lambda ou ECS (API), SES (e-mail). É mais flexível, mas tem mais peças para configurar, proteger e
pagar, e o custo de tráfego de saída pesa num produto de mapas.

### Para não ficar preso

Postgres é padrão. Usando PostGIS e o banco do Supabase como Postgres comum (sem depender de recursos exclusivos
na regra de negócio), a migração para RDS ou outro provedor é um dump e restore. O front e o `.pmtiles` são arquivos
estáticos e rodam em qualquer CDN.

## 4. Manutenção contínua

- **Ambientes:** produção e homologação (staging), com deploy automático a partir de branches do GitHub.
- **Testes:** os que já existem (`npm test`, `npm run verify:e2e`) rodando no CI a cada mudança, mais testes de
  permissão entre clientes.
- **Monitoramento:** erros do front e do backend (Sentry ou similar) e disponibilidade (UptimeRobot, Better Stack).
- **Backups:** automáticos diários do banco com retenção, e um teste de restauração periódico.
- **Atualizações:** dependências (Dependabot) e versões do MapLibre e do pmtiles.
- **Dados do mapa:** o job mensal do item 13, com alerta se a validação (`npm run validate:data`) falhar.
- **LGPD:** registro de consentimentos, exportação e exclusão de dados de um contato a pedido.

## 5. Vários anunciantes para o mesmo imóvel

No Brasil é comum o mesmo apartamento ser anunciado por várias imobiliárias e corretores, muitas vezes com preços e
fotos diferentes. Num mapa 3D isso é pior do que numa lista: viram vários pinos empilhados no mesmo prédio.

**Separar o imóvel do anúncio:**

- **Imóvel** é a coisa física: o prédio (id do OSM) + a unidade (andar e final), ou o lote do cadastro da Prefeitura
  (inscrição imobiliária) para casas e terrenos. A matrícula, quando informada, é a chave mais forte.
- **Anúncio** é a oferta de um anunciante sobre um imóvel: preço, fotos, texto, contato, tipo de autorização.
- Um imóvel tem N anúncios. O mapa mostra **um pino por imóvel**, nunca um por anúncio.

**Detectar duplicados:**

- **Certeza:** mesma matrícula ou mesma inscrição imobiliária, ou mesmo prédio e mesma unidade.
- **Provável:** mesmo prédio e unidade não informada, com área, quartos e vagas iguais (dentro de uma tolerância) e
  preço próximo. Fica marcado "possivelmente o mesmo imóvel" e o anunciante confirma ou separa ao cadastrar.
- Na importação dos XMLs das imobiliárias a mesma regra roda automaticamente.

**Como mostrar ao visitante:**

- Uma ficha do imóvel com "**anunciado por 3 imobiliárias**" e, para cada uma, preço, data e botão de contato. A
  diferença de preço aparece; é transparência a favor de quem compra.
- O contato vai para o anunciante que a pessoa escolheu. Nunca para todos.
- A ordem entre anunciantes segue regras claras: exclusividade, anúncio mais completo (fotos, planta), mais recente.
  Plano pago pode dar destaque, desde que isso esteja informado.

**Exclusividade:**

- Quem tem **autorização de venda com exclusividade** envia o documento, que é conferido. Com isso o anúncio dele
  passa a ser o único exibido para aquele imóvel, e os outros ficam ocultos e avisados.
- A exclusividade tem validade. Quando vence, os outros anúncios voltam a aparecer.
- Também dá para registrar **parceria** entre imobiliárias (venda compartilhada, comum no mercado): o anúncio mostra
  as duas e o lead chega às duas.

**Regras de convivência:** denúncia de anúncio desatualizado ou já vendido, expiração automática sem atualização (por
exemplo, 60 dias) e histórico de preço por imóvel. O histórico vira, com o tempo, um dado valioso.

## 6. Construtoras e incorporadoras

São poucas, mas cada uma vale muito: um lançamento tem dezenas a centenas de unidades, um orçamento de marketing
próprio e um período de vendas de anos. O espelho de vendas 3D é feito para elas. O papel delas no sistema é
diferente do das imobiliárias:

- **A construtora é dona dos dados do empreendimento:** torres, plantas, unidades, tabela de preços e situação de
  cada unidade. Ela atualiza; ninguém mais altera.
- **Imobiliárias e corretores credenciados vendem** a partir desses dados. Não recadastram o empreendimento: veem o
  espelho ao vivo, sempre com a disponibilidade correta, e o contato que aparece para o cliente é o deles.
- **Experiência do corretor exclusivo ou credenciado:**
  - link personalizado para enviar ao cliente, com as unidades que o corretor separou, a marca dele e o contato dele;
  - modo apresentação no estande ou no tablet (tela cheia, vista da janela, sol por fachada);
  - **reserva temporária** de uma unidade (por exemplo, 24 h) direto no espelho, que aparece como "reservada" para
    todos os outros canais e expira sozinha;
  - histórico do que o cliente viu (unidades abertas, tempo), com consentimento, para o corretor saber o que oferecer;
  - simulação de pagamento com a tabela real da construtora (entrada, reforços, parcelas, correção pelo INCC).
- **Para a própria construtora:** painel de vendas por canal (qual imobiliária vendeu o quê), mapa de calor das
  unidades mais vistas e menos vistas, e o mesmo espelho embutido no site do lançamento.
- **Permissões:** construtora (edita tudo do empreendimento), imobiliária parceira (vê tudo, reserva, vende),
  corretor (vê e reserva dentro da cota da imobiliária), público (vê só o que a construtora liberar; muitas preferem
  não mostrar preço ou disponibilidade abertamente).

## 7. Cadastro do anúncio no backend

O formulário do protótipo já tem o cadastro completo (negócio, imóvel, endereço, mídia, anunciante, publicação; ver o
README). O que muda com backend:

- **Fotos e planta** vão para o storage (R2/Supabase) com miniaturas; no protótipo ficam reduzidas no `localStorage`.
- **Vídeo** continua sendo um link do YouTube/Vimeo exibido embutido (padrão dos portais); não hospedamos vídeo.
- **Documento de exclusividade** é enviado e conferido por uma pessoa antes de o anúncio ganhar a marca "Exclusivo".
- **Histórico de preço** é gravado pelo sistema a cada mudança e fica visível só para o anunciante. O preço riscado
  ("de R$ X por R$ Y") só aparece a partir de um preço que esteve de fato publicado na plataforma: o anunciante não
  digita o "preço anterior". O valor do desconto em si é decidido entre vendedor e corretor; a plataforma só garante
  que o "de" é real.
- **Datas** de publicação e atualização vêm do servidor; anúncios sem atualização por um prazo (ex.: 60 dias) pedem
  confirmação ao anunciante.

## 8. Diferenciais planejados (conversa de 09/10/2026)

1. **Anunciar pela unidade no 3D.** Para apartamento: buscar o prédio ou o condomínio pelo nome ou endereço (cadastro
   de condomínios), abrir o prédio dividido em andares e unidades e clicar na unidade a anunciar. Depende de saber o
   número de andares, unidades por andar e a posição de cada uma: o cadastro da Prefeitura dá a área construída, mas
   não a distribuição. Para prédios novos vem da construtora; para antigos, do próprio anunciante (um editor simples
   de "andares × unidades por andar × posição do final") e vai sendo reaproveitado pelos próximos anúncios do prédio.
2. **Espelho de vendas com a identidade de cada construtora e empreendimento** (cores, logotipo, fontes, materiais do
   lançamento), além da disponibilidade ao vivo para corretores credenciados.
3. **Camadas da Prefeitura como opções ligáveis**: mancha de inundação, zoneamento e lote real, desligadas por padrão
   para não poluir o mapa.
4. **Anúncios repetidos** só importam num modo portal (vários anunciantes). No produto vendido por imobiliária, cada
   site mostra só os anúncios dela; a deduplicação da seção 5 fica para um eventual portal agregador.
5. **Marca da imobiliária**: tema dinâmico por cliente (cores, logo, fontes, textos) aplicado ao mapa e ao site
   embutido, como configuração (seção 2).

## 9. Como o produto chega ao site do cliente (conversa de 12/10/2026)

**Como o mercado faz hoje.** A maioria dos sites de imobiliária no Brasil não é feita sob medida: vem de uma
plataforma que vende CRM + site prontos (Kenlo, Jetimob, Tecimob, Univen, Vista e outras). Por isso os sites se
parecem: mesma busca com filtros na lateral, mesma ficha do imóvel, só mudam logo e cores. A imobiliária aponta o
domínio dela para a plataforma, e os anúncios saem do CRM, que também envia o XML para os portais (ZAP, VivaReal,
Chaves na Mão).

**Duas formas de entrarmos:**

1. **Site completo (o principal).** Nós hospedamos o site inteiro com a marca do cliente: página inicial, busca com
   filtros, mapa 3D, ficha do imóvel, contato. O cliente aponta o domínio para nós (um registro DNS, tipo CNAME, que
   ele ou o técnico dele altera no Registro.br ou onde o domínio estiver), e o certificado HTTPS é emitido
   automaticamente. É o modelo das plataformas acima, e o que justifica a assinatura com manutenção.
2. **Busca embutida (a porta de entrada).** Para quem não quer trocar de site agora: um trecho de código (`<script>`
   ou `<iframe>`) colocado numa página do site atual, por exemplo `imobiliariax.com.br/mapa`, mostra o nosso mapa e
   a busca com os anúncios dele. Menos atrito para fechar o primeiro contrato; depois migra para o site completo.

Nos dois casos os anúncios entram pela **importação do XML** do sistema atual do cliente, que é o mesmo arquivo que
ele já manda para os portais. Assim ele não recadastra nada e pode continuar usando o CRM que tem.

**Migração de um cliente novo (roteiro):**

1. Cadastrar a imobiliária, o administrador dela e os corretores (convite por e-mail).
2. Importar os anúncios pelo XML, com as fotos baixadas para o nosso storage, e conferir com o cliente.
3. Configurar a marca (logo, cores, textos, contatos) e revisar o site num endereço provisório
   (`imobiliariax.nossoproduto.com.br`).
4. Virar o domínio (CNAME). Antes disso, mapear os endereços antigos dos imóveis para os novos com redirecionamento
   301, senão o cliente perde a posição que já tem no Google.
5. Acompanhar a primeira semana: contatos chegando, anúncios atualizados, Google indexando.

**Papéis:** suporte da plataforma (nossa equipe: vê e corrige qualquer cliente, com registro de tudo o que faz),
dono e administradores da imobiliária (gerenciam corretores e todos os anúncios dela), corretores (os próprios
anúncios).

## 10. Segurança

**O Supabase é seguro para isso?** Sim, como plataforma: Postgres gerenciado, certificação SOC 2 Type 2,
criptografia em trânsito e em repouso, proteção contra DDoS na frente da API, backups. É usado em produção por
muitas empresas. Mas a segurança dos **nossos dados** depende das regras que nós escrevemos, e é aí que mora o risco.

**"Qualquer um, até com uma IA, pode atacar o site?"** Pode tentar, e é por isso que as regras ficam no banco, não
no site. A chave que vai no site é pública por natureza; com ela, sem login, só se lê o que é público (anúncios
publicados, sem endereço oculto). Escrever exige login, e o banco confere em cada operação se a pessoa é da
imobiliária dona do dado. Os testes automáticos (`npm run test:backend`) tentam exatamente esses ataques: visitante
criando anúncio, corretor de uma imobiliária editando a outra, corretor se promovendo a administrador, forjando o
preço anterior, gravando fotos na pasta de outro cliente. Todos são recusados.

**O que ainda falta fechar antes do primeiro cliente:**

1. ~~**Cadastro aberto de imobiliárias.**~~ Feito em 12/10/2026: só o suporte cadastra imobiliárias, e corretores
   entram por convite (válido só para o e-mail convidado, uma vez, por 14 dias).
2. ~~**Papel de suporte da plataforma** com registro de auditoria.~~ Feito em 12/10/2026 (`platform_staff`,
   `audit_log`).
3. ~~**Lixeira em vez de exclusão definitiva**~~ feita em 12/10/2026 (30 dias para restaurar). Falta ativar os
   backups com restauração a um ponto no tempo (plano Pro).
4. **Contas:** ~~verificação em duas etapas~~ e ~~CAPTCHA no login e no cadastro~~ feitos em 14/10/2026 (ver abaixo).
   Falta a recusa de senhas vazadas (recurso do plano Pro) e decidir se a verificação em duas etapas passa a ser
   obrigatória também para donos e administradores.
5. **Limites contra abuso** no formulário de contato: ~~limite de envios por origem e campo-armadilha~~ feitos em
   13/10/2026; ~~CAPTCHA (Turnstile)~~ pronto para ligar desde 14/10/2026.
6. **Fotos sem localização:** fotos de celular carregam as coordenadas GPS de onde foram tiradas, o que revelaria o
   endereço de quem escolheu escondê-lo. O site já remove esses dados ao redimensionar a foto; a importação por XML
   precisa fazer o mesmo no servidor.
7. **LGPD:** termos de uso, política de privacidade, contrato de tratamento de dados com cada imobiliária (ela é a
   controladora dos dados dos clientes dela; nós somos operadores) e exclusão de dados a pedido.
8. **Antes de lançar:** revisão de segurança por alguém de fora (teste de invasão), o "Security Advisor" do painel do
   Supabase sem alertas e monitoramento de erros (Sentry).
9. **Hospedagem com cabeçalhos:** a política de conteúdo (CSP) já sai em cada página, mas no GitHub Pages só como
   `<meta>`, sem `frame-ancestors` nem HSTS. Os cabeçalhos completos dependem da hospedagem com vários domínios
   (Cloudflare Pages ou Netlify; avaliação de outubro, B3), que lê o `_headers` gerado no build.

**O que entrou em 14/10/2026** (pedido: subir a nota de segurança de 6 para pelo menos 8):

- **Política de conteúdo (CSP) e cabeçalhos.** O build gera a política a partir das próprias variáveis (Supabase,
  Turnstile, blocos do mapa) em `scripts/lib/csp.mjs`: tag `<meta>` no mapa e no site e `dist/_headers` com HSTS,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` e `frame-ancestors` (o mapa só pode ser
  embutido pelo próprio site; as páginas dos anúncios, por ninguém). Scripts só do próprio domínio: um código
  injetado (`onerror`, `javascript:`, `<script>`) não roda, mesmo que um dia algum texto escape sem querer. Os
  estilos embutidos continuam permitidos, porque os modelos de HTML usam atributos `style`. Conferido no Chromium:
  nenhuma violação no mapa, no site (com o mapa embutido e o editor) e numa página de anúncio. O HSTS fica sem
  `includeSubDomains` de propósito: o mesmo site atende os domínios dos clientes, e um subdomínio antigo deles sem
  HTTPS deixaria de abrir.
- **Verificação em duas etapas (TOTP).** Obrigatória para a equipe de suporte, que atende todos os clientes: no
  banco, os poderes de suporte só valem numa sessão confirmada com o código (`aal2`); sem ela, a conta é a de um
  usuário comum. Donos e administradores ativam em Minha conta (QR code ou chave), e a partir daí a senha sozinha
  não dá acesso aos dados da imobiliária. O login do mapa e o do editor do site pedem o código.
- **CAPTCHA (Turnstile), pronto para ligar.** Desligado, nada muda. Ligado, o login e o cadastro mandam o token ao
  Supabase Auth, e os contatos passam pela função `submit-lead`, que confere o token no servidor; o banco recusa os
  contatos que não vêm por ela (configuração que o site não lê nem altera). O passo a passo está em
  [`supabase.md`](supabase.md), seção 9.
- **Aviso de contato sem duplicar.** `notify-lead` reserva o contato numa atualização só antes de mandar o e-mail.
- **Revisão do código** (injeção de HTML, CSS e URL; regras de acesso; storage; redirecionamentos; mensagens entre
  o site e o mapa; segredos no repositório e no histórico; `npm audit`). Correções:
  - um corretor apagava ou sobrescrevia no storage as fotos dos anúncios dos colegas (as linhas de
    `listing_photos` eram protegidas; os arquivos, não): agora só quem edita o anúncio mexe nos arquivos dele;
  - a limpeza dos arquivos órfãos da lixeira ficou só com administradores;
  - os rótulos dos empreendimentos no mapa são montados com `textContent` (o texto nunca vira HTML);
  - `.env` no `.gitignore`;
  - senha mínima de 8 caracteres também no Supabase local.
  Sem achados em: textos dos clientes (sempre escapados; a configuração do site é validada campo a campo), links
  (`javascript:` recusado, vídeo só do YouTube/Vimeo, redes só no domínio da rede), o parâmetro `pagina` do mapa
  (só endereços do mesmo site), as mensagens entre o site e o mapa (origem e remetente conferidos nos dois sentidos),
  segredos (nenhum no repositório nem no histórico) e dependências (`npm audit`: 0 vulnerabilidades).

**Deixado de lado, de propósito:**

- **Sessão no `localStorage`.** Cookies `HttpOnly` exigiriam um servidor nosso entre o site e o Supabase;
  `sessionStorage` não protege contra um script injetado e quebraria o "Personalizar o site" em outra aba. A defesa
  é não deixar código injetado rodar (CSP), o token de acesso de 1 hora e a verificação em duas etapas.
- **Proteção contra o site dentro de outro (clickjacking) no GitHub Pages:** só por cabeçalho, que o GitHub Pages não
  manda. Os navegadores atuais isolam o armazenamento de um site aberto dentro de outro, então a sessão de quem está
  logado não aparece ali; a proteção completa vem com a hospedagem nova.
- **Administrador incluir uma conta existente direto na equipe** (sem convite): a tela usa só convites, mas o banco
  aceita a inclusão direta por administradores. Dá acesso à pessoa incluída, não a quem inclui.
- **Limite de envios por origem:** usa o IP que a Cloudflare do Supabase informa (`cf-connecting-ip`). Fora dela, o
  primeiro endereço do `X-Forwarded-For` pode ser forjado; com o CAPTCHA ligado, cada contato exige um token novo.
- **Ações do GitHub fixadas por versão (`@v4`), não pelo hash do commit:** risco baixo; fixar por hash dá mais
  trabalho de manutenção.

**Como ligar as chaves:** verificação em duas etapas, CAPTCHA (Cloudflare, Supabase, função `submit-lead` e variável
`VITE_TURNSTILE_SITE_KEY` no GitHub) e cabeçalhos estão em [`supabase.md`](supabase.md), seção 9.

*Anotado por Claude (assistente de IA), 14/10/2026, para consulta na manutenção.*

## 11. Cobrança e contrato (proposta de 12/10/2026)

**Quem paga:** a imobiliária (o cliente), não o corretor. O corretor é usuário da conta da imobiliária. Corretor
autônomo entra como uma "imobiliária" de uma pessoa só, num plano menor.

**Como cobrar:**
- **Implantação** (valor único): migração dos anúncios pelo XML, configuração da marca, virada do domínio,
  treinamento. Cobre o trabalho inicial e filtra quem não está comprometido.
- **Mensalidade** por plano, com faixas por **número de anúncios ativos** e de **usuários** (é o que muda o custo
  para nós: fotos, armazenamento, suporte). Exemplo de estrutura, com valores a validar em conversas com
  imobiliárias:
  | Plano | Para quem | Limites |
  |---|---|---|
  | Corretor | autônomo | 1 usuário, até 30 anúncios |
  | Imobiliária | pequena e média | até 10 usuários, até 300 anúncios |
  | Construtora / Rede | espelho de vendas, várias lojas | sob consulta |
- **Plano anual** com desconto (por exemplo, 2 meses grátis), que reduz cancelamento e melhora o caixa.
- **Período de teste** de 14 a 30 dias com os anúncios do cliente já importados: é o argumento de venda.

**Meio de pagamento:** um gateway brasileiro com assinatura recorrente, boleto, Pix e cartão, avisos de cobrança
automáticos e emissão de nota fiscal de serviço, como **Asaas** (o mais usado por SaaS pequeno no Brasil) ou Iugu.
Stripe é ótimo para cartão, mas boleto/Pix e nota fiscal brasileira dão mais trabalho. Imobiliária costuma pagar por
boleto ou Pix, então isso pesa.

**Contrato:** termo de adesão aceito no cadastro (termos de uso + contrato de tratamento de dados da LGPD) e, para
quem tem implantação, contrato assinado eletronicamente (Clicksign, ZapSign ou D4Sign).

**Como o sistema valida o acesso:**
1. Tabela `subscriptions` por imobiliária: plano, limites (anúncios, usuários), situação (`trialing`, `active`,
   `past_due`, `suspended`, `canceled`) e data de vencimento.
2. O gateway avisa cada pagamento ou atraso por **webhook** a uma função no servidor (Supabase Edge Function), que
   atualiza a situação. A chave do gateway fica só no servidor.
3. As regras ficam no banco, como as de permissão: com a assinatura em dia, tudo funciona; acima do limite, novos
   anúncios ou convites são recusados com a mensagem do plano.
4. **Inadimplência em etapas**, para não derrubar o site do cliente por um boleto atrasado: aviso no painel →
   após ~10 dias, edição bloqueada (o site continua no ar) → após ~30 dias, site suspenso. Pagou, volta na hora.
5. **Cancelamento:** o cliente exporta os anúncios (XML/planilha) e os dados são apagados após um prazo combinado
   (por exemplo, 90 dias), como manda a LGPD.
6. O suporte vê a situação de todos os clientes e pode dar carência manualmente, com registro na auditoria.

## 12. Site de cada imobiliária (conversa de 13/10/2026)

**O que vimos no mercado de Joinville** (pelos prints enviados): GW Imóveis e Nozz usam o mesmo fornecedor
(cabeçalho escuro com menu, busca com "Filtrar", "12 imóveis de 212", ordenação, grade/lista, cards com código,
comparar, favorito e carrossel). A wPrime usa outro (filtros na lateral, mapa ou grade, preço sobre a foto). A The
Office usa outro (tema escuro, muitos filtros no topo, chips removíveis). A 636 se destaca pela leveza: cabeçalho
branco, busca rápida sobre a capa com o número de resultados no botão "Buscar", abas Todos / Prontos /
Lançamentos, botão **"Apenas com desconto"** e filtros que não cansam (abrem só em "Filtros"). Os fornecedores
desse mercado incluem Tecimob, apresenta.me, labbo e outros. Não fizemos uma análise detalhada dos produtos deles:
a comparação abaixo vem dos prints e do que é comum nesses sites.

**O que foi feito.** Um único código de site (`site.html`, `src/site/`) que monta o site de qualquer imobiliária
a partir de uma **configuração** (dados, não código), guardada em `organizations.branding`:

- **Marca:** nome, CRECI, logo (com altura), três cores (principal, destaque, cabeçalho), fundo claro ou escuro,
  fontes (do sistema ou Google Fonts, de uma lista fechada) e cantos.
- **Modelos prontos:** *Leve* (inspirado na 636), *Clássico* (GW/Nozz), *Filtros na lateral* (wPrime), *Escuro*
  (The Office) e *Moderno*. Trocar o modelo muda cores, fontes e o jeito da busca, sem perder textos e contatos.
- **Contatos e redes:** WhatsApp (botão flutuante e no topo), telefone, e-mail, endereço, horário, Instagram,
  Facebook, YouTube, LinkedIn, TikTok.
- **Menu** (itens e ordem): Comprar, Alugar, Lançamentos, Baixaram o preço, Mapa 3D, Sobre nós, Anunciar imóvel,
  Contato, Favoritos.
- **Página inicial:** título e subtítulo da capa, foto de capa, busca rápida no estilo da 636 e seções escolhidas e
  ordenadas pelo cliente (destaques, baixaram o preço, chamada para o mapa 3D, lançamentos, bairros com mais
  imóveis, recentes, sobre, "anuncie seu imóvel").
- **Busca:** filtros na lateral ou no topo; aplicam na hora, sem botão "Aplicar"; chips removíveis; bairros como
  chips no campo; quartos, suítes, banheiros e vagas em botões 1 2 3 4+; ordenação; grade, lista ou **mapa 3D**;
  paginação; sugestão de qual filtro tirar quando não há resultado; a URL guarda a busca (link compartilhável).
- **Cards:** carrossel de fotos, código, favorito, comparar, selos (destaque, lançamento, financiamento, permuta,
  reservado), preço abaixo ou sobre a foto e **redução com o preço anterior riscado**.
- **Página do imóvel:** galeria com miniaturas, ficha completa, vídeo, planta, tour 360, o **prédio em destaque no
  mapa 3D**, WhatsApp com o código e o link do imóvel na mensagem, formulário de contato (LGPD), imóveis parecidos,
  dados para o Google (JSON-LD) e endereço canônico apontando para a página estática do anúncio.
- **Favoritos e comparação** (até 4 lado a lado, com a maior área e o menor valor do m² destacados), sem login.
- **Sobre, Contato e Anunciar imóvel:** os formulários viram contatos em Minha conta → Contatos, com as respostas
  (tipo, bairro, valor pretendido) e aviso por e-mail aos administradores. "Anunciar imóvel" é a **captação de
  proprietários**, que o mercado costuma tratar como formulário solto.
- **Editor "Personalizar site"** (dono e administradores; `?editar=1` ou link em Minha conta): pré-visualização
  ao vivo, aviso de contraste das cores (WCAG) e correção automática da cor dos textos, envio de logo e fotos,
  "Desfazer", "Publicar alterações" e o histórico de publicações (as 30 últimas, com data e autor), de onde uma
  versão anterior volta ao editor para ser conferida e publicada de novo.

**Onde ficamos à frente** (a confirmar com clientes):
1. **Mapa 3D da cidade** dentro do site do cliente, filtrando junto com a busca, e o prédio do imóvel na ficha.
2. **Desconto confiável:** "Apenas com desconto" e o preço riscado vêm do histórico registrado pela plataforma,
   não de um "de/por" digitado.
3. **Velocidade:** o código do site tem 27 KB compactados na demonstração. Com o backend somam-se o acesso ao
   backend (11 KB) e o cliente do Supabase (55 KB), cerca de 93 KB ao todo, que dá para reduzir (avaliação de
   outubro, I9). O mapa 3D (345 KB compactados) só baixa quando o visitante abre a vista de mapa ou chega ao mapa
   na ficha do imóvel. As páginas mudam sem recarregar.
4. **O cliente muda o próprio site** e vê na hora, sem abrir chamado.
5. **Acessibilidade:** contraste garantido, navegação por teclado, textos para leitores de tela.
6. Captação de proprietários, contatos e WhatsApp no mesmo lugar (Minha conta → Contatos).

**Segurança.** A configuração é escrita pelo cliente, então é tratada como dado não confiável: o site a valida
campo a campo antes de usar (`normalizeSiteConfig`: cores só em `#rrggbb`, imagens só em `https`, redes sociais
só no domínio da rede, listas só com valores conhecidos) e nunca a insere como HTML. No banco, a configuração
precisa ser um objeto de no máximo 64 KB; endereço (slug) e domínio só o suporte muda. As imagens vão para o bucket
`site-assets`, na pasta do cliente, só por donos e administradores, e sem SVG (que pode conter scripts: o editor
converte SVG em PNG).

**O que falta para colocar o site de um cliente no ar com o domínio dele:**
1. **Hospedagem que atende vários domínios.** O GitHub Pages serve um domínio por repositório. Para vários
   clientes, publicar o mesmo `dist/` num serviço que aceite domínios personalizados em quantidade com HTTPS
   automático (Cloudflare Pages ou Cloudflare for SaaS, Vercel, Netlify). O site já descobre o cliente pelo
   domínio (`organizations.custom_domain`) ou por `?imobiliaria=<slug>` no endereço provisório.
2. **Páginas estáticas por cliente** para o Google (hoje a página estática é por anúncio, no endereço do mapa):
   gerar a página inicial, a busca por bairro e as fichas no domínio de cada cliente, com o `sitemap.xml` dele.
   Até lá, o Google indexa o site pelo JavaScript (funciona, mas é mais lento para entrar).
3. Redirecionamentos 301 dos endereços antigos (ver item 9), página de política de privacidade e o CAPTCHA
   (Turnstile) nos formulários, se aparecer spam.
4. Ideias para depois: blog, páginas extras livres, banner com várias fotos na capa, "Seja corretor" (vagas),
   alerta de imóvel novo por e-mail para a busca salva.

*Anotado por Claude (assistente de IA), 13/10/2026, para consulta na manutenção.*

## 13. Mapa: bairro, paisagem, obras e serviço mensal (conversa de 14/10/2026)

**Pedido.** Filtro por bairro que mostre só o bairro e as ruas até 100 m das divisas, e mais vida no mapa sem
perder o estilo low poly:

- postes de luz;
- estrada de chão, calçamento e asfalto diferentes;
- árvores e lagoas mais bonitas.

Atualizar alturas e telhados por imagem de satélite, num serviço à parte que rode uma vez por mês. Nas obras,
mostrar o estado atual de forma translúcida.

**O que foi feito.** Os detalhes estão no README (seções "Paisagem", "Filtro por bairro", "Obras em andamento" e
"Serviço mensal do mapa"). Em resumo:

- **Recorte por bairro:**
  - a expressão `distance` do MapLibre filtra cada camada;
  - uma máscara, calculada no navegador com `polygon-clipping`, cobre o chão de fora;
  - as áreas crescidas 100 m vêm prontas em `bairros-areas.geojson`, carregado só quando se usa o filtro;
  - os empreendimentos fora do recorte também somem.
- **Paisagem** gerada junto com os blocos (`scripts/lib/scenery.mjs`), determinística:
  - pavimento pela tag `surface` do OSM;
  - 41 mil postes (416 do OSM, o resto ilustrativo) com luz à noite;
  - 212 mil árvores (1.071 do OSM);
  - copa facetada nas matas;
  - água facetada.
- **Obras:**
  - andares prontos sólidos, o resto translúcido, e uma grua;
  - colunas novas no banco e histórico mensal (`construction_history`);
  - o anunciante informa pelo formulário; vistoria e imagem ficam para a equipe.
- **Serviço mensal:**
  - `.github/workflows/mapa-mensal.yml` refaz o mapa e abre um PR com o relatório (`scripts/map-changes.mjs`);
  - **ninguém publica sem ler o relatório**;
  - o primeiro teste já pegou um erro real: uma casa estimada com 29 andares. A regra das torres agora exige 70% do
    contorno dentro do lote.
- **Custo no celular:**
  - a primeira versão da paisagem dobrou o tempo de bloqueio do mapa no Lighthouse;
  - textura e shaders foram ajustados até voltar ao nível anterior;
  - a regra para o futuro: **cada camada nova que aparece de longe custa um shader na primeira tela**; prefira
    reaproveitar as expressões das camadas existentes.

**Por que não satélite todo mês** (detalhes e preços em [`avaliacao-2026-10.md`](avaliacao-2026-10.md)):

- um estéreo mensal custaria R$ 30 mil a 103 mil;
- o verão de Joinville é nublado;
- a estimativa pelo cadastro já acerta as casas;
- as licenças de Google, Bing, Mapbox e Airbus impedem usar o derivado como queremos.

**O caminho é:**

- pedir o LiDAR da Prefeitura (2007 e 2010) e uma autorização formal;
- usar o modelo de superfície do Estado para as torres;
- fazer um estéreo único (cerca de R$ 18 mil) do núcleo vertical a cada 1–2 anos;
- **trazer as construtoras como fonte do andamento das obras**.

**Quando o histórico do git pesar** (cerca de 20 MB por mês):

- publicar o `.pmtiles` num armazenamento de objetos, com nome por versão (`joinville-2026-11.pmtiles`), e pôr a
  URL completa em `tiles` no `meta.json` (o app aceita endereço `https://`);
- Cloudflare R2 ou Supabase Storage servem, desde que aceitem `Range` e liberem CORS para o domínio do site;
- o PR mensal passa a levar só o `meta.json` e o relatório.

*Anotado por Claude (assistente de IA), 14/10/2026, para consulta na manutenção.*
