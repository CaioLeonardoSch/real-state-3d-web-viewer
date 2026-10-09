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
