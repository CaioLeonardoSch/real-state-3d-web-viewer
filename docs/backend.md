# Backend e hospedagem: o que precisa existir para virar produto

Anotações de 09/10/2026. Hoje o protótipo é 100% estático: arquivos em `public/data/` e anúncios do "Anunciar" no
`localStorage` de cada navegador. Este documento lista o que precisa ir para um backend e como manter tudo rodando
para vários clientes.

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
