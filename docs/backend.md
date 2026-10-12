# Backend e hospedagem: o que precisa existir para virar produto

Anotações de 09/10/2026. O protótipo começou 100% estático (arquivos em `public/data/` e anúncios no `localStorage`).
Este documento lista o que precisa ir para um backend e como manter tudo rodando para vários clientes.

**Situação (12/10/2026):** iniciado no Supabase, ver [`supabase.md`](supabase.md). Prontos: itens 1 (contas,
imobiliárias e papéis dono/administrador/corretor, com isolamento por RLS; imobiliárias cadastradas só pelo
suporte; corretores por convite; registro de auditoria), 2 (criar, alterar situação e preço, excluir; busca por área
com PostGIS; edição completa em 13/10/2026) e 3 (fotos com miniatura e planta no storage). Faltam: envio
automático dos convites por e-mail e os itens 4 a 13. Lixeira e histórico de alterações pela tela: 14/10/2026.

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
   e/ou WhatsApp). Exige consentimento conforme a LGPD.
5. **Espelho de vendas.** Unidades por empreendimento com situação (disponível, reservado, vendido) e preço, editados
   pela incorporadora. O ideal é integrar com o sistema de vendas dela.
6. **Página própria de cada imóvel,** que o Google consiga indexar. Hoje o app é um mapa só, invisível para busca.
7. **Termos de uso, política de privacidade e CRECI** nos anúncios de corretores e imobiliárias.

### Logo depois

8. **Importação dos anúncios** do sistema que a imobiliária já usa. Elas mandam o mesmo cadastro para ZAP e VivaReal
   em XML; ler esse arquivo evita cadastro duplicado e é o que faz uma imobiliária adotar o produto.
9. **Favoritos, buscas salvas e alertas** de novos imóveis (e-mail ou push).
10. **Moderação:** fila de aprovação, denúncias, histórico de alterações.
11. **Métricas por cliente:** visualizações, cliques e contatos por anúncio (o relatório que justifica a assinatura).
12. **Cobrança** da assinatura (Asaas, Iugu, Stripe…).

### Dados do mapa (rotina, não servidor)

13. **Atualização periódica** do OSM, do cadastro da Prefeitura, das alturas e do `.pmtiles`. Hoje é
    `npm run data`; em produção vira um job agendado (mensal, por exemplo) que publica o arquivo novo no storage.
    O mapa base não precisa de servidor: é um arquivo estático lido por intervalos.

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
3. ~~**Lixeira em vez de exclusão definitiva**~~ feita em 14/10/2026 (30 dias para restaurar). Falta ativar os
   backups com restauração a um ponto no tempo (plano Pro).
4. **Contas:** CAPTCHA no login e no cadastro (o Supabase integra hCaptcha e Turnstile), verificação em duas etapas
   para administradores, recusa de senhas vazadas (recurso do plano Pro).
5. **Limites contra abuso** quando houver formulário de contato público: limite de envios por IP e CAPTCHA.
6. **Fotos sem localização:** fotos de celular carregam as coordenadas GPS de onde foram tiradas, o que revelaria o
   endereço de quem escolheu escondê-lo. O site já remove esses dados ao redimensionar a foto; a importação por XML
   precisa fazer o mesmo no servidor.
7. **LGPD:** termos de uso, política de privacidade, contrato de tratamento de dados com cada imobiliária (ela é a
   controladora dos dados dos clientes dela; nós somos operadores) e exclusão de dados a pedido.
8. **Antes de lançar:** revisão de segurança por alguém de fora (teste de invasão), o "Security Advisor" do painel do
   Supabase sem alertas e monitoramento de erros (Sentry).

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
