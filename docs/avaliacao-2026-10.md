# Avaliação do produto (outubro de 2026)

Avaliação realista do mapa 3D, do site das imobiliárias e do backend, pedida pelo dono do produto em 14/10/2026
("acredito que estamos longe de um lançamento"). As fontes são:

- uma auditoria completa sobre o commit `0de02db`: Lighthouse, axe, roteiros de teclado, uso manual no desktop e no
  celular, e leitura do código;
- a pesquisa sobre alturas e telhados por satélite;
- o que foi corrigido em seguida, no mesmo dia;
- a segunda rodada (14 e 15/10), que levou o mapa, o site, o desempenho, a acessibilidade, a segurança e o Google à
  nota 8 (coluna "Hoje" e a situação de cada item abaixo).

As notas e os números de antes vêm da auditoria; os de depois foram medidos de novo onde está indicado.

## Veredito

**O produto é bom para demonstração e para vender a ideia. Depois da segunda rodada, o que falta para um piloto pago
é sobretudo operação e jurídico, e não mais o produto em si.**

- O mapa 3D é a parte mais madura e o diferencial real.
- O site de cada imobiliária cobre o que o mercado de Joinville oferece, com uma interface mais leve que a média.

A auditoria apontou cinco faltas de estrutura. Situação em 15/10:

1. **Google:** resolvido no código. No domínio do cliente, cada página sai com título, descrição, canônico e dados
   estruturados no HTML, e há sitemap e endereços limpos. Falta publicar na hospedagem com um domínio real.
2. **LGPD:** só as fontes passaram a vir do próprio site. Continuam faltando a política de privacidade, os termos e o
   prazo de retenção dos contatos.
3. **Hospedagem para vários domínios:** o adaptador para a Cloudflare Pages está pronto e passou no runtime da
   Cloudflare, rodando na máquina; o projeto em si ainda não foi criado.
4. **Operação:** ainda não há monitoramento, ambiente de homologação nem e2e no CI.
5. **Demonstração separada do produto:** resolvida no build de produção. A demonstração pública ainda mostra
   empreendimentos reais com preços inventados.

**Prazo estimado: 4 a 6 semanas de trabalho de uma pessoa até um piloto pago com 2 ou 3 imobiliárias** (eram 8 a 12
semanas na auditoria). É uma estimativa grosseira (detalhe na lista do fim). Depende do jurídico (LGPD e licença dos
dados da Prefeitura) e do retorno dos primeiros clientes.

## Notas por área (0 a 10)

Critério: quão perto a área está de um lançamento público com clientes pagantes. 8 ou mais significa pronto, com
ajustes menores; 5, funciona na demo, mas com defeitos visíveis; 3 ou menos, faltam peças estruturais.

| Área | Auditoria | 14/10 | Hoje (15/10) | Por quê |
|---|---|---|---|---|
| Mapa 3D | 7 | 7 | 8 | Telhados, arquivo de detalhe e abertura mais rápida (Lighthouse no celular de 51–52 para 67–69); build de produção sem textos nem dados de demonstração; axe sem violações em 8 estados. Falta medir num Android de entrada |
| Site das imobiliárias | 5 | 6 | 8 | Comparação de aluguel, paginação no histórico, "Ver N imóveis", fotos em três tamanhos, histórico de publicações com volta a versões anteriores, "Site não encontrado" e endereços limpos no domínio do cliente. Falta: nunca foi visto com fotos e feed reais |
| Desempenho | 6 | 7 | 8 | Inicial, busca e ficha do site em 99 no celular; o site abre com uma consulta em vez de quatro em série, com fontes próprias e fotos no tamanho da tela. O mapa fica em 67–69 num teste cujo WebGL por software pesa mais que um aparelho real (veja Números) |
| Acessibilidade | 5 | 6 | 8 | Foco nas trocas de página, Esc, aviso com `aria-live`, `aria-pressed`, `h1` no mapa e painéis fechados fora do Tab; axe sem violações em 17 telas do site e 8 estados do mapa. Falta o teste com um leitor de tela de verdade |
| SEO | 2 | 2 | 8 | No domínio do cliente, cada página sai com título, descrição, canônico, Open Graph e dados estruturados no HTML; endereços limpos, sitemap com os anúncios, robots.txt, 301 e 404. Testado no navegador e no runtime da Cloudflare. Falta publicar e acompanhar no Search Console |
| Segurança | 6 | 6 | 8 | CSP e cabeçalhos, verificação em duas etapas (obrigatória para o suporte), CAPTCHA pronto para ligar, fotos presas a quem edita o anúncio e aviso de contato sem duplicar. Falta um teste de invasão feito por terceiros |
| Prontidão para produção | 2 | 2 | 4 | Demonstração separada no build e adaptador da hospedagem pronto; faltam LGPD, o projeto na hospedagem, monitoramento, homologação e e2e no CI |

## O que está bom de verdade

- **Mapa 3D da cidade inteira:**
  - 164.672 prédios; 93% com altura estimada pelo cadastro da Prefeitura;
  - um arquivo base de cerca de 14 MB e um de detalhe (árvores, postes, telhados) só para o zoom 15, lidos por
    partes (o celular baixa só o que aparece);
  - teclado, histórico do navegador e estados vazios úteis ("Remover o preço máximo · 34 imóveis");
  - nenhum erro de console e nota 100 em boas práticas.
- **Diferenciais que não vimos nos sites concorrentes analisados:**
  - o prédio do anúncio em destaque no mapa;
  - o espelho de vendas em 3D com a vista da janela;
  - o preço riscado que vem do histórico real, não de um "de/por" digitado;
  - o recorte por bairro;
  - a obra em andamento.
- **Site das imobiliárias:**
  - 5 modelos e um editor ao vivo;
  - busca no estilo da 636, favoritos e comparação;
  - cerca de 28 KB de JavaScript compactado na demonstração;
  - nota 99 no celular na página inicial, na busca e na ficha.
- **Segurança do navegador:**
  - nenhum texto do cliente vira HTML (um teste com `<img onerror>` no editor apareceu como texto);
  - a configuração é validada campo a campo;
  - as mensagens entre o site e o mapa embutido conferem a origem nos dois sentidos.
- **Banco:**
  - as regras de acesso ficam no Postgres (RLS), com testes automáticos no CI;
  - o slug e o domínio não mudam pelo cliente;
  - os arquivos de cada cliente ficam presos à pasta dele.
- **Base de código:**
  - TypeScript estrito;
  - 151 testes de unidade e 46 de backend;
  - geração dos dados reproduzível: com os mesmos dados de entrada, o `.pmtiles` sai igual byte a byte.

## O que bloqueia o lançamento

### B1. Google: o site do cliente não aparece direito nas buscas (2 a 3 semanas)

- **Problema:**
  - `site.html` devolve o mesmo HTML ("Carregando…") para todas as páginas;
  - título, descrição e dados estruturados só aparecem depois do JavaScript;
  - na ficha, o endereço canônico, o "Compartilhar" e o link do WhatsApp apontam para a página genérica do anúncio no
    domínio da plataforma, com "Ver no mapa 3D" levando ao portal de todas as imobiliárias;
  - o `sitemap.xml` não lista nenhum anúncio.
- **Efeito:** num domínio de cliente, o Google atribuiria as fichas à plataforma, e quem recebe o link pelo WhatsApp
  sai do site da imobiliária.
- **Correção:**
  - páginas pré-renderizadas (ou geradas na borda) por domínio e por rota, com endereços limpos (`/imoveis`,
    `/imovel/<slug>-<código>`);
  - título, descrição, OG, JSON-LD e canônico no domínio do cliente;
  - `sitemap.xml` e `robots.txt` por domínio.
- **Situação (15/10): feito.**
  - `src/seo/siteServer.ts` monta o cabeçalho de cada página no domínio do cliente, e `functions/[[path]].ts` o liga
    na Cloudflare Pages.
  - Testado em unidade, no navegador (e2e com um domínio `.localhost`) e com o `wrangler`, que roda o runtime da
    Cloudflare na máquina.
  - O corpo da página continua montado pelo JavaScript. O Google o executa, e o cabeçalho já traz o essencial para
    os outros robôs e para a prévia do WhatsApp. **Feito em 17/10:** o servidor também manda o conteúdo da página
    (`src/seo/siteBody.ts`), que o site substitui ao carregar.
  - **Falta:** publicar num projeto real, com o domínio de um cliente, e cadastrar o sitemap no Search Console.

### B2. LGPD (1 a 2 semanas, mais a revisão de um advogado)

- **Problema:**
  - não há política de privacidade nem termos;
  - o texto de consentimento não diz finalidade, retenção, direitos, nem quem é controlador e quem é operador;
  - o servidor grava o texto que o navegador envia, sem versão;
  - os contatos não têm prazo de retenção;
  - as fontes do Google enviam o IP do visitante sem aviso.
- **Correção:**
  - política e termos por cliente, com link junto à caixa de consentimento;
  - versão do texto guardada no servidor;
  - rotina de anonimização dos contatos antigos;
  - pedido de exportação e exclusão;
  - fontes hospedadas no próprio site.
- **Situação (15/10):** as fontes passaram a vir do próprio site, e nada mais vai ao Google. O resto continua
  faltando.

### B3. Hospedagem e operação para vários clientes (cerca de 2 semanas)

- **Problema:**
  - o GitHub Pages serve um domínio só;
  - não há `404.html` nem cabeçalhos de segurança (CSP, HSTS, `frame-ancestors`);
  - não há monitoramento de erros nem de disponibilidade;
  - um push no `main` vai direto ao ar;
  - os testes de ponta a ponta não rodam no CI.
- **Correção:**
  - Cloudflare for SaaS, Vercel ou Netlify, com domínios personalizados e certificados automáticos;
  - cabeçalhos configurados;
  - Sentry e um monitor de disponibilidade;
  - um projeto Supabase de homologação;
  - e2e e axe no CI.
- **Situação (15/10):**
  - CSP e cabeçalhos prontos (`public/_headers`), copiados também pelo servidor nas páginas dos clientes;
  - adaptador da Cloudflare Pages pronto e testado com o `wrangler`;
  - 404 nos domínios dos clientes.
  - **Falta:** criar o projeto, monitoramento, homologação e e2e no CI. O CI roda os testes de unidade, o build e os
    testes do banco.

### B4. Demonstração misturada ao produto (3 a 5 dias)

- **Problema:**
  - o mapa traz fixos o título "(demonstração)" e a faixa "Imóveis e valores fictícios", mesmo com o backend real;
  - o espelho de vendas mostra empreendimentos reais da Halsten e da Plaenge, nos endereços reais, com preços e
    disponibilidade inventados. Publicado, é risco de marca e jurídico;
  - os dados da demonstração vão para o build de produção, e `?imobiliaria=exemplo-a` abre o site fictício em
    qualquer domínio.
- **Correção:**
  - modo demonstração separado no build;
  - espelho com dados autorizados vindos do banco (ou empreendimentos fictícios);
  - domínio desconhecido leva a uma página neutra.
- **Situação (15/10):**
  - o build de produção (`VITE_DEMO_LISTINGS=false`) sai sem os imóveis, os empreendimentos, os sites de exemplo e
    os textos de demonstração;
  - endereço ou domínio desconhecido mostra "Site não encontrado" (noindex).
  - **Falta:** o espelho de vendas do produto vir do banco, e trocar na demonstração pública os empreendimentos reais
    por fictícios (ou pedir autorização às construtoras).

## Importante

| Item | Situação |
|---|---|
| I1. A busca de aluguel virava venda ao abrir a ficha | **Corrigido** nos links dos cards e, depois, na comparação (5a2d8b2). Os favoritos não foram conferidos de novo |
| I2. Reservado e vendido sumiam da ficha | **Corrigido:** selo, aviso, chamada de contato ajustada e `LimitedAvailability` no schema |
| I3. Filtros que mostravam uma coisa e aplicavam outra (preço mínimo perdido, bairro com acento) | **Corrigido:** um temporizador por campo; bairro sem acento e sem diferença de maiúsculas |
| I4. Painel de filtros esticado e cabeçalho que rolava para o lado | **Corrigido:** as caixas do painel ficam alinhadas ao topo; o menu recolhe quando não cabe, medido na tela, sem depender de largura fixa |
| I5. No celular, o preço e o contato só apareciam a 2.400 px do topo | **Corrigido:** preço junto ao título e barra fixa com WhatsApp e "Mensagem" |
| I6. A ficha sempre carregava o mapa 3D inteiro | **Corrigido:** o mapa só carrega ao chegar na tela ou no botão "Ver o prédio no mapa 3D" |
| I7. Acessibilidade | **Corrigido:** contraste do site e do mapa; foco no título ao trocar de página, Esc fechando painéis, uma região de aviso com `aria-live`, botões com `aria-pressed`, alvos de 24 px, `h1` no mapa e painéis fechados com `inert`. O axe não acha violações em 17 telas do site e em 8 estados do mapa. **Falta:** o teste com um leitor de tela de verdade |
| I8. O mapa embutido virava o portal ao recarregar o quadro | **Corrigido:** o mapa mantém `embed`, `site`, `cor` e `pagina` no endereço |
| I9. Escala com backend | **Parte corrigida:** o site abre com uma chamada só (`site_bootstrap`), sem o `.in()` de URL longa nem o limite de 1.000 linhas, e o cliente do Supabase baixa junto com o módulo que o usa; com o backend, o JavaScript do site soma cerca de 89 KB compactados (28 do site, 6 do acesso ao backend e 55 do cliente do Supabase). **Falta:** cada visita ainda baixa todos os anúncios do cliente, o que serve até algumas centenas; não foi medido com milhares |
| I10. Editor | **Corrigido:** "Voltar ao original" não pergunta mais "Sair do site?"; histórico das 30 últimas publicações, com volta a uma versão anterior (c672119); o mapa da pré-visualização não recarrega a cada edição |
| I11. CAPTCHA, CSP, 2FA e teste de invasão | **Parte corrigida:** CSP e cabeçalhos, verificação em duas etapas (TOTP, obrigatória para o suporte), CAPTCHA (Turnstile) pronto para ligar e revisão do storage. **Falta:** o teste de invasão feito por terceiros |
| I12. Endereço da página estática muda com o título; vendidos somem sem redirecionamento | **Corrigido nos domínios dos clientes:** o endereço termina no código do anúncio, então um título novo leva ao endereço atual com 301, e um anúncio que saiu do ar responde 404 com noindex. **Feito em 17/10:** nas páginas estáticas do domínio da plataforma também (301 pela função da Cloudflare, `404.html` com noindex) |
| I13. Fotos limitadas a 960 px, sem `srcset` | **Corrigido:** 480, 1024 e 1920 px, com `srcset` e `sizes` nos cards, na galeria e nas páginas estáticas; o importador XML gera os mesmos tamanhos (5a2d8b2) |
| I14. Testes do site, e2e fora do CI, sem lint nem regressão visual | **Parte:** testes de obra, relatório do mapa e mapeamento; axe no e2e do site e do mapa; testes do servidor de páginas, do histórico, das duas etapas e do storage. **Falta:** e2e no CI, lint e regressão visual |

## Melhorias

| Item | Situação |
|---|---|
| M1. Escape na ordem errada na imagem de capa | **Corrigido** |
| M2. DDI repetido no `tel:` | **Corrigido** |
| M3. Paginação com `replaceState` (Voltar pula as páginas), clique do meio bloqueado, `pagina=99` | **Parte corrigida:** a paginação entra no histórico, e `pagina=99` mostra a última página, com o endereço corrigido (5a2d8b2). O clique do meio não foi conferido de novo |
| M4. `?p=qualquer` mostra a inicial; "Imóvel não encontrado" sem `noindex` | **Corrigido:** página desconhecida mostra "Página não encontrada", e as duas páginas têm noindex; no domínio do cliente, respondem 404 |
| M5. O acesso ao backend (11 KB) é carregado mesmo sem backend | **Feito em 17/10:** o cliente do backend e o painel da conta são importados sob demanda, só quando há backend configurado (item 30) |
| M6. Banco e e-mail | **Corrigido:** imagens em `data:image/svg+xml` recusadas, e o aviso de contato por e-mail não sai mais duplicado (49d9120). **Conferido:** o limite de 64 KB da configuração funciona, porque a checagem vê o valor ainda sem compressão (o teste de backend com 70 mil caracteres repetidos é recusado). |
| M7. `app.ts` com 1.200 linhas montando HTML em texto; "Joinville" fixo no código | **Feito em 17/10:** região configurável (item 29); as páginas saíram do `app.ts` para `src/site/pages/` (item 30). O HTML continua montado em texto, com `escapeHtml` |
| M8. Detalhes de interface (rótulo do favorito, caixa "Comparar", filtros do celular sem "Ver N resultados") | **Parte:** os filtros do celular ganharam "Ver N imóveis" (5a2d8b2); os outros dois não foram conferidos de novo |

## Números

**Lighthouse no celular** (rede e CPU simuladas; WebGL por software, o que pesa mais no mapa do que num aparelho
real). "Hoje" foi medido em 15/10 (mapa, inicial e busca) e em 14/10 (ficha):

| Página | Desempenho (auditoria → hoje) | Acessibilidade (auditoria → hoje) | Observação |
|---|---|---|---|
| Site: página inicial | 92–93 → 99 | 93 → 100 | Contraste corrigido: 11 violações → 0; LCP de 1,7 s e 115 KB transferidos |
| Site: busca | 92–93 → 99 | não medida → 100 | |
| Site: ficha do imóvel | 40–54 → 99 | 94 → 100 | LCP de 4,6–5,5 s para 1,6–1,8 s; transferência de 1,7 MB para 119 KB; 63 → 14 requisições |
| Mapa | 54–55 → 67–69 | 96 → 100 | O topo pinta antes do mapa (`src/boot.ts`): FCP e LCP de 0,9 s. O TBT continua alto (5,5 s na última medição) |

No site, a nota de SEO do Lighthouse fica em 63 porque o endereço de demonstração é marcado noindex de propósito.

**O TBT do mapa.** O perfil mostra que quase todo o tempo bloqueado é a compilação dos programas de shader pelo
WebGL por software do teste (SwiftShader). Num aparelho com placa de vídeo essa etapa costuma ser bem mais rápida,
mas isso ainda precisa ser confirmado num celular de entrada.

**O mapa e a paisagem.** A primeira medição depois da paisagem mostrou o mapa bem mais pesado: TBT de 7 a 9 s. O
perfil mostrou duas causas, ambas corrigidas:

1. A textura da água era lida da placa de vídeo, o que é lento. Agora ela fica na memória comum e só aparece de
   perto (zoom 13).
2. A primeira tela compilava 20 programas de shader em vez de 13. As camadas passaram a compartilhar os mesmos
   programas, e agora são 14.

O peso no celular continua sendo o ponto fraco do mapa: 333 KB de código e WebGL obrigatório.

**JavaScript compactado (gzip), medido em 15/10:**
- mapa: 333 KB (345 em 14/10; 327 na auditoria);
- worker do MapLibre: 141 KB (não foi medido de novo);
- site: 28 KB;
- acesso ao backend: 6 KB (eram 11);
- cliente do Supabase: 55 KB (só com backend);
- editor do site: 6 KB, só para quem edita;
- recorte por bairro: 8 KB, carregados só quando se escolhe um bairro.

**Testes (15/10):**
- 151 testes de unidade e 46 de backend;
- 43 checagens do site, 34 do backend no navegador e 77 do mapa, todas passando.
- Em 14/10, o teste do backend no navegador passou na segunda execução. Na primeira, a criação da imobiliária estourou o
  limite de 15 s logo no início, com o Supabase local recém-acionado.
- A primeira rodada do mapa achou um defeito real, já corrigido: escolhendo "Noite" já perto da rua, os postes não
  acendiam.

## Riscos que a auditoria não cobria

- **Dados da Prefeitura sem licença explícita.**
  - As alturas de 93% dos prédios dependem do cadastro do SIMGeo.
  - Um ofício de 2016 diz "não temos óbice" ao uso dos shapefiles do SIMGeo em outras plataformas, citando a fonte
    (foi a base da importação no OSM). Não está claro se vale para o cadastro imobiliário e para uso comercial.
  - Pedir autorização formal à Unidade de Geoprocessamento (SEPUR.UGP) antes de cobrar.
- **ODbL.**
  - As alturas são calculadas sobre os contornos do OpenStreetMap, então a tabela de alturas é uma base derivada.
  - Publicar o mapa obriga a oferecê-la sob a mesma licença (`osmId`, pavimentos, fonte). Isso exige que a
    autorização da Prefeitura seja compatível com a ODbL.
  - Vale validar com um advogado.
- **Nenhum anúncio real ainda.** Os 100 anúncios são fictícios e sem fotos.
  - A importação de XML existe e tem testes, mas não rodou com o feed de uma imobiliária de verdade nem em volume.
  - A galeria e o carrossel nunca foram vistos com fotos reais.
- **Celular.**
  - O mapa exige WebGL e 333 KB de código.
  - Não foi testado em aparelho Android de entrada nem com leitor de tela real.
- **Uma pessoa só no código** e custos de infraestrutura ainda não medidos com tráfego real.
- **Mercado.**
  - A proposta de preço (docs/backend.md, item 11) e o interesse precisam ser validados com 2 ou 3 imobiliárias
    piloto antes de investir nos itens grandes.

## Mapa 3D: o que entrou nesta rodada e os limites

- **Filtro por bairro.**
  - Escolher um ou mais bairros (`?bairro=Glória`) mostra só esses bairros e as ruas até 100 m das divisas:
    - os prédios, as ruas e o verde de fora somem;
    - o chão de fora fica coberto;
    - o mapa enquadra a área.
  - Os empreendimentos fora do recorte também somem do mapa e da lista.
  - **Limites:**
    - os bairros vêm do OpenStreetMap, e Araquari tem só parte dos bairros mapeados;
    - um imóvel sem bairro no endereço não entra no filtro.
- **Pavimento.** Asfalto, calçamento (lajota, paralelepípedo, paver) e estrada de chão, com texturas próprias, mais
  calçadas e faixas nas ruas principais.
  - Vem da tag `surface` do OSM: 3.947 km de rua de carro, dos quais:
    - 1.459 km de asfalto;
    - 377 km de calçamento;
    - 1.427 km de chão;
    - 44 km de outro pavimento;
    - 640 km sem informação, desenhados com a cor neutra.
  - A camada de pavimento da Secretaria de Infraestrutura concorda com o OSM em 91% e poderia completar o que falta
    (ver a pesquisa abaixo).
- **Postes.**
  - Ao todo são 41.012 postes:
    - 416 mapeados no OSM;
    - o resto **ilustrativo**, a cada 38 m nas ruas pavimentadas da área urbana.
  - À noite cada poste projeta no chão uma mancha larga e um ponto mais forte sob a luminária, na cor do seu tipo de
    luz: LED branco neutro nas ruas principais, sódio alaranjado em parte das outras e LED branco quente no resto.
  - Não são as posições reais. O cadastro real da iluminação pública (58 mil pontos) existe com a concessionária da
    PPP.
- **Árvores, matas e água.**
  - 206.242 árvores low-poly: 1.071 do OSM e o resto ilustrativo em praças, matas e bordas de mata, fora de 6 m em
    volta dos prédios e da pista das ruas.
  - As matas são uma copa facetada, um pouco recuada, com árvores na borda e clareiras em volta das casas e das ruas
    de carro.
  - De dia, os prédios projetam a sua sombra no chão, do lado oposto ao sol.
  - A água tem textura facetada e margem.
- **Obras em andamento.**
  - Os andares prontos aparecem sólidos e o resto translúcido, com uma grua.
  - O anúncio mostra "12 de 20 andares", o mês e quem informou: o anunciante, uma vistoria da equipe ou uma imagem
    aérea. Uma informação com mais de 3 meses é marcada como antiga.
  - O banco guarda o histórico mensal.
  - Quem anuncia só consegue registrar como "anunciante".
  - Na demonstração, o andamento das 26 obras é ilustrativo.
- **Serviço mensal** (`.github/workflows/mapa-mensal.yml`).
  - **O que faz:** no dia 3 de cada mês:
    - baixa o OSM e o cadastro;
    - recalcula alturas, pavimento, árvores e postes;
    - gera o mapa;
    - abre um pull request com o relatório de mudanças (`scripts/map-changes.mjs`): prédios novos, removidos e
      redesenhados, alturas por bairro, pavimento, paisagem e anúncios afetados.
  - **Revisão:** nada vai ao ar sem alguém aprovar.
  - **Primeiro teste:** o relatório pegou uma casa em Pirabeiraba que tinha passado de 1 para 29 andares. Metade do
    contorno estava num lote vizinho grande. A estimativa agora exige 70% do contorno dentro do lote para passar de
    4 andares, o que afetou 5 prédios.

## Mapa 3D: melhorias pedidas em 15/10

Seis pedidos do cliente, com o caminho, os dados, o prazo e os riscos de cada um. **Feitos em 15/10: os itens 5, 4 e 6
(etapa 1)**, descritos em cada item; os outros ainda não. Os prazos são de trabalho, sem contar a espera por dados.

1. **Relevo, e a câmera sem atravessar o chão (1 a 2 semanas).**
   - **Hoje:** o mapa é plano. No zoom máximo, com a inclinação de 75°, a câmera fica a uns 30 m do chão e entra nas
     torres.
   - **Dados:** o modelo do terreno (MDT) de 1 m do Estado (SIGSC, 2010–2012, gratuito), conferido com as curvas de
     nível 1:1.000 da Prefeitura (2007/2010). A licença para uso em produto precisa ser confirmada (ver
     [`dados-prefeitura.md`](dados-prefeitura.md)).
   - **Como:**
     - reduzir para 5 a 10 m na cidade e 30 m na serra, e gravar como relevo do MapLibre (`raster-dem`) em PMTiles;
     - ligar o relevo (`setTerrain`) com um sombreado suave das encostas (`hillshade`);
     - prédios, árvores e postes passam a ficar sobre o terreno;
     - a câmera fica sempre acima do terreno e dos telhados: altura mínima conferida a cada movimento e inclinação
       máxima menor de perto.
   - **Riscos:**
     - peso no celular: mais um arquivo e mais trabalho de desenho;
     - peças empilhadas: telhados, andares das obras e a vista da janela precisam usar a mesma altura de terreno do
       prédio. Numa encosta, o MapLibre pode apoiar cada peça numa altura diferente. Conferir nos morros do Boa Vista
       e do Iririú;
     - a licença do MDT do Estado.
2. **Nomes das ruas, e a rua na busca: feito em 17/10.**
   - **No mapa:** nome cinza com contorno claro (à noite, texto claro com contorno escuro), deitado ao longo da rua,
     do zoom 16 em diante. Fica de frente para a câmera e acima dos prédios, para ser lido com o mapa inclinado. O
     MapLibre esconde os nomes que se sobrepõem.
   - **Fonte:** Inter 500, só latim, 24 KB, servida pelo próprio site e desenhada no navegador (`font-faces` do
     MapLibre). Não foi preciso gerar arquivos de glifos. Só é baixada quando o primeiro nome aparece.
   - **Arquivo do mapa:** o nome entrou só no zoom 15 de `joinville.pmtiles`, com os trechos ligados de mesmo nome
     unidos: +190 KB (14,77 → 14,96 MB). `joinville-detalhe.pmtiles` não mudou.
   - **Quantas ruas têm nome:** 11.188 dos 19.090 trechos de via do mapa.
   - **Busca "Bairro ou rua":**
     - lista `public/data/ruas.json`, gerada junto com o mapa: 6.026 entradas, 5.504 nomes. 542 KB, 165 KB com gzip,
       baixada só quando a pessoa começa a digitar;
     - cada rua aparece uma vez por bairro, distrito ou cidade. "Ir para a rua" leva o mapa ao trecho mais longo dela
       ali e destaca a rua em laranja;
     - "Imóveis nesta rua" mostra só os anúncios que mostram a rua; quem escolheu mostrar só o bairro fica de fora. A
       rua vai para o link (`?rua=`) e para a busca do site.
   - **Limites conhecidos:**
     - os anúncios de demonstração mostram só o bairro, então "Imóveis nesta rua" não acha nenhum na demonstração;
     - o filtro e o destaque usam o nome: ruas de mesmo nome em outros bairros entram juntas (o cartão avisa);
     - perto do horizonte, com o mapa inclinado, os nomes ficam pequenos (uns 7 px);
     - à noite, o laranja do destaque fica perto da cor da luz dos postes;
     - as ruas de Pirabeiraba não aparecem num recorte por bairro, porque o distrito não tem bairros;
     - Centro, Itinga e Parque Guarani existem em Joinville e em Araquari: o recorte por bairro inclui as duas
       cidades, igual no mapa e nas sugestões.
3. **Serviços por perto (cerca de 1 semana).**
   - **Feito em 17/10:** a primeira versão, só com o OSM (809 pontos em Joinville: 293 escolas, 103 de saúde, 103
     farmácias, 129 mercados, 37 padarias e 144 parques): "Por perto" na ficha e o filtro "Perto de (até 500 m)".
     As distâncias são calculadas no navegador a partir de `public/data/servicos.json` (46 KB), sem banco. Faltam os
     ícones no mapa e os dados da Prefeitura, do INEP e do CNES; as padarias são o que mais falta no OSM.
   - **Dados, todos abertos:**
     - equipamentos públicos da Prefeitura (`SEPUR/equipamento_publicos_2026_*`: escolas, saúde, lazer, cultura);
     - escolas do INEP e unidades de saúde do CNES, que têm coordenadas;
     - farmácias, mercados, padarias e hospitais do OSM. A cobertura em Joinville precisa ser medida na geração do
       mapa (o serviço de consulta do OSM não respondeu daqui).
   - **No mapa:** ícones discretos, por tipo, ligados por um botão "Serviços".
   - **No anúncio:** o mais próximo de cada tipo, com a distância em linha reta, dita assim (tempo a pé exige rotas).
   - **Na busca:** filtros como "até 500 m de escola" e "até 500 m de mercado".
   - **Atualização:** entra no serviço mensal, junto com o resto do mapa.
   - **Limite:** padarias e mercados pequenos são o que mais falta no OSM. Onde faltar, o anúncio não pode dar a
     entender que não há nenhum por perto.
4. **Luz dos postes mais natural (1 a 2 dias).**
   - **Antes:** cada poste acendia uma mancha redonda de 11 m, com a borda esfumada, a mesma cor e a mesma
     intensidade em todos.
   - **Como:**
     - a luz mais forte embaixo da luminária e caindo devagar, com as manchas vizinhas somando onde se encontram (uma
       camada de intensidade, `heatmap`, ou círculos sobrepostos; a escolha sai do teste no celular);
     - variação fixa por poste, a mesma em toda visita: LED branco nas ruas principais, sódio alaranjado em parte das
       outras, com intensidade e alcance um pouco diferentes;
     - a luminária mais brilhante, com um halo pequeno, visível de longe.
   - **Limite:** a luz é desenhada no chão. Paredes e árvores não recebem a luz dos postes, porque o MapLibre não tem
     luz pontual. Com o cadastro real da iluminação (58 mil pontos), daria para usar o tipo e a potência de cada
     poste.
   - **Feito em 15/10:**
     - duas manchas por poste, ambas esfumadas até a borda: uma larga, de 12 m, e um ponto mais forte, de 4,5 m, sob
       a luminária. Onde as manchas vizinhas se encontram, a luz soma;
     - ficaram os círculos sobrepostos, e não o `heatmap`: o `heatmap` satura, muda de cor com o zoom e não deixa
       cada poste ter a sua cor;
     - o tipo de luz é sorteado na geração do mapa, um por rua, e sai igual em toda visita:
       - LED branco neutro nas avenidas e ruas principais (`primary`, `secondary`, `tertiary`);
       - sódio alaranjado em 15% das outras ruas;
       - LED branco quente no resto;
     - cada poste tem a sua intensidade: nas ruas principais, 25% maior, com variação de 15% para mais ou para menos;
     - à noite, a luminária acende na cor da sua luz;
     - o arquivo de perto só grava o tipo quando não é o branco quente, que é o padrão do estilo. Assim o arquivo não
       cresceu (ver o peso abaixo).
5. **Casas dentro da mata (1 a 2 dias).**
   - **Causa:**
     - as árvores ilustrativas das matas são sorteadas numa grade sem descontar os prédios (`sampleTrees`, em
       `scripts/lib/scenery.mjs`);
     - a copa da mata (a área de mata recuada 6 m e erguida a 6 m) também cobre o que está dentro;
     - onde o OSM marca mata em volta de casas (chácaras, ruas abertas na mata), a mata passa por cima delas.
   - **Feito em 15/10, na geração do mapa** (`clearings` e `cutCanopy`, em `scripts/lib/scenery.mjs`):
     - nenhuma árvore ilustrativa a menos de 6 m de um prédio, nem sobre a pista das ruas (meia largura da via mais
       0,8 m; túneis não contam). As árvores mapeadas no OSM ficam onde estão;
     - a copa da mata é recortada 6 m em volta dos prédios e ao longo das ruas de carro que a atravessam. Trilhas e
       caminhos não cortam a copa, e sobras com menos de 150 m² somem;
     - resultado: 1.120 copas recortadas, sem nenhuma falha de recorte, e 206.242 árvores (eram 212.298, 6.056 a
       menos);
     - falta conferir na área da imagem enviada.
6. **Sol e sombras (3 a 5 dias na primeira etapa).**
   - **Antes:** manhã e tarde já mudavam a luz. A posição do sol vem da hora (biblioteca `suncalc`), e a parede virada
     para o sol fica mais clara. Mas nenhum prédio projetava sombra:
     - o MapLibre GL JS 6.13 não desenha sombras;
     - o [plugin de sombras de 2026](https://maplibre.org/news/2026-09-02-maplibre-newsletter-august-2026/) é para o
       MapLibre Native (aplicativos), não para a web.
   - **Etapa 1, sombra no chão: feita em 15/10** (`src/map/shadows.ts`):
     - a sombra de cada prédio é o contorno estendido na direção oposta ao sol, pelo comprimento que a altura e o
       ângulo do sol dão (às 9h de 20/03, uma torre de 30 m faz uns 44 m de sombra). Na prática, é o casco convexo
       do contorno e da sua cópia deslocada: exato em prédios convexos; num prédio em L, o canto de dentro também
       fica na sombra;
     - fazem sombra os prédios do mapa, os prédios dos anúncios e as torres das obras. De manhã a sombra vai para
       oeste, à tarde para leste, e à noite não há sombra;
     - desenhada como uma camada escura translúcida, que o MapLibre pinta uma vez só por pixel: sombras que se
       cruzam não escurecem duas vezes. Os prédios, desenhados depois, cobrem a parte da sombra que fica atrás deles;
     - aparece no zoom 15,5, quando os prédios chegam à altura cheia, e fica nítida no 16. Começar no 15 não
       compensava: ali os prédios ainda estão subindo, a sombra quase não se vê e o cálculo levava 0,2 s no centro;
     - o cálculo roda no navegador quando a câmera para, com os blocos do mapa já carregados. Não pesa no arquivo
       do mapa e já serve para a etapa 2. O corte em blocos fica com o worker do MapLibre;
     - entram só os prédios a até 1 km do centro da tela no zoom 15,5 (metade a cada zoom a mais, no mínimo
       500 m). No teste, no centro da cidade, foram 2.470 sombras em 102 ms no zoom 15,6 e 871 em 17 a 41 ms de
       perto (zoom 17,6);
     - sombra de prédio sobre outro prédio (na parede ou no telhado) não aparece nesta etapa, nem a das árvores.
   - **Etapa 2, régua de horário e estação (mais 1 a 2 semanas):**
     - arrastar a hora e o mês e ver a sombra andar;
     - no anúncio, o sol do apartamento: quantas horas de sol a fachada recebe no inverno e no verão, já descontando
       os prédios em volta. É argumento de venda que hoje se resume a "face norte".
   - **Etapa 3, sombras completas (depois):** sombra sobre paredes e telhados exige uma camada própria em WebGL
     (shadow mapping), pesada no celular. Só se o produto pedir.
   - **Pronto para comparar:** a biblioteca
     [`mapbox-gl-shadow-simulator`](https://github.com/ted-piotrowski/mapbox-gl-shadow-simulator) (ShadeMap)
     desenha a sombra dos prédios e do relevo sobre o mapa. A licença e o desempenho no celular precisam ser
     conferidos antes de escolher entre ela e a nossa.
   - **Com o relevo:** a mancha da sombra acompanha o terreno sozinha, porque o MapLibre deita as camadas planas sobre
     o relevo. Só o comprimento fica aproximado nas encostas.

**Ordem sugerida**, do mais rápido e visível ao que pede dados e decisões:

1. casas na mata (item 5): feito em 15/10;
2. luz dos postes (item 4): feito em 15/10;
3. sombra no chão (item 6, etapa 1): feito em 15/10;
4. nomes das ruas e a rua na busca (item 2): feito em 17/10;
5. serviços por perto (item 3);
6. relevo (item 1). Mexe em tudo (câmera, prédios, obras, vista da janela) e depende da licença do MDT; vale pedir os
   dados já, para não esperar por eles depois;
7. régua de horário e sol do apartamento (item 6, etapa 2).

Com os três primeiros feitos, faltam cerca de 3 a 4 semanas sem a régua de horário. Se o relevo for o mais importante,
ele pode vir antes; só demora mais para aparecer.

### Peso no carregamento, e o que fica em comum entre os sites (15/10)

**Peso dos itens feitos em 15/10**, medido nos arquivos gerados:

| Arquivo | Antes | Depois | Diferença |
|---|---|---|---|
| `joinville.pmtiles` (zooms 10 a 15) | 14,68 MB | 14,77 MB | +91 KB (+0,6%): os recortes das copas |
| `joinville-detalhe.pmtiles` (zoom 15) | 10,81 MB | 10,76 MB | −44 KB (−0,4%): 6 mil árvores a menos pesam mais que o tipo e a intensidade dos postes |
| Sombras | — | — | nada a baixar: calculadas no navegador |

O navegador só baixa os blocos da área vista (pedidos por faixa de bytes), então a diferença numa tela é de poucos KB.
Nenhum dos três itens precisou do banco.

**Em comum e de cada cliente.** O mapa de Joinville já é um só para todos os sites:
- **em comum, gerado uma vez por mês:** os arquivos do mapa (prédios com altura, telhados, matas com as clareiras,
  árvores, postes com o tipo de luz, ruas com o pavimento). Todo cálculo pesado acontece na geração, uma vez, e o
  resultado fica materializado nos arquivos, servidos como estáticos pela CDN. Mais um site cliente não custa nada a
  mais: todos leem os mesmos arquivos, e o navegador guarda o que já baixou;
- **de cada cliente, no banco:** anúncios, empreendimentos, unidades e preços, separados por cliente;
- **o que não vale materializar:** o que depende de uma escolha de quem olha, como a sombra na hora escolhida. É
  barato de calcular no navegador e caro de guardar: cada horário seria mais uma cópia das sombras dos 164.672
  prédios.

**Peso do item feito em 17/10 (nomes das ruas):** `joinville.pmtiles` +190 KB (+1,3%); `ruas.json` 542 KB (165 KB
com gzip), baixado só ao digitar na busca; fonte de 24 KB, baixada no primeiro nome; o código cresceu uns 3 KB com
gzip. Também não precisou do banco: a lista de ruas é um arquivo estático em comum.

**Os próximos itens seguem o mesmo princípio:**
- **serviços por perto (item 3):**
  - uma tabela de serviços da cidade, em comum, atualizada pelo serviço mensal;
  - para cada anúncio, o serviço mais próximo de cada tipo e a distância são calculados quando o anúncio é salvo e
    guardados junto com ele, e recalculados quando a tabela muda;
  - o filtro "até 500 m de escola" vira uma consulta simples por índice, sem calcular distâncias a cada busca;
- **ruas na busca (item 2):** a lista de ruas com nome e posição, em comum, como arquivo estático ou tabela;
- **relevo (item 1):** o terreno como mais um arquivo do mapa, em comum. A altura do chão de cada anúncio é guardada
  quando ele é salvo, para a vista da janela e as peças empilhadas;
- **sol do apartamento (item 6, etapa 2):** calculado por unidade quando ela é salva e guardado no banco, usando os
  prédios em volta, que vêm dos dados em comum.

Não vale pôr a geometria do mapa no banco para servir os blocos a cada visita: cada tela custaria processamento do
banco, e a conta cresceria com cada site. Os arquivos estáticos na CDN atendem qualquer número de sites quase sem
custo.

### Google Maps Platform: avaliação (15/10)

Pergunta do cliente: o Google Maps Platform pode ser útil? **Como base do mapa, não. Em pontos isolados, sim.**

- **O que ele oferece para estes pedidos** (preços de 15/10/2026):
  - **Cidade em 3D fotográfico, com o relevo** (Photorealistic 3D Tiles):
    - uma malha tirada de fotos aéreas, com terreno, prédios e árvores;
    - 1.000 sessões grátis por mês, depois US$ 6 por mil;
    - a cobertura de Joinville não foi confirmada.
  - **Serviços por perto** (Places, busca por proximidade): farmácias, mercados e padarias, com nota e horário. São
    5.000 consultas grátis por mês na versão Pro, depois US$ 32 por mil.
  - **Nomes de ruas:** já vêm no mapa do Google.
- **Por que não serve de base:**
  - **Contrato.** Os termos proíbem mostrar o conteúdo do Places num mapa que não seja do Google ("Customer must not
    use Google Maps Content from the Places API in conjunction with a non-Google map"). O nosso mapa é MapLibre.
  - **Nada pode ser guardado**, salvo latitude e longitude por até 30 dias. Cada visita a um anúncio vira consulta
    paga: 50 mil visitas por mês, com uma busca cada, dão pelo menos US$ 1.440 por mês (45 mil pagas × US$ 32 por
    mil). Os dados abertos são de graça e ficam no arquivo do mapa.
  - **A malha 3D não separa nada.** É uma casca única, que não sabe o que é prédio, andar ou lote. Com ela não daria
    para destacar o prédio do anúncio, mostrar a obra andar por andar, recortar por bairro nem acender os postes à
    noite, que é o que o mapa faz hoje. E é pesada no celular.
  - **Imagens.** A pesquisa do satélite (abaixo) já tinha visto que os termos do Google não permitem tirar dados das
    imagens (alturas, telhados) para um produto comercial.
  - **Trocar o mapa inteiro pelo do Google** resolveria os nomes e liberaria o Places. Mas seria refazer o mapa, com
    custo por carregamento e sem o controle que temos hoje.
- **O que dá para usar sem conflito:**
  - um botão "Abrir no Google Maps" e "Como chegar" no anúncio, quando o endereço é público. É só um link: sem chave,
    sem custo e sem contrato;
  - talvez uma tela separada, só do Google, com a vista 3D fotográfica do entorno (e nela o Places), se Joinville
    tiver cobertura e o custo couber.
- **Conclusão:** para os seis pedidos, os dados abertos (Estado, Prefeitura, OSM, INEP, CNES) bastam. São de graça e
  ficam no nosso arquivo. Vale rever se o produto precisar de horário de funcionamento e nota dos estabelecimentos,
  que os dados abertos não têm.
- **Fontes** (consultadas em 15/10/2026):
  [preços](https://developers.google.com/maps/billing-and-pricing/pricing),
  [termos dos serviços](https://cloud.google.com/maps-platform/terms/maps-service-terms),
  [3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles-overview).

## Satélite para alturas e telhados: conclusão da pesquisa

A ideia de calcular a altura pela diferença entre imagens (estéreo) funciona. Mas **um serviço mensal por satélite
não se paga em Joinville**:

- **Custo.** Um par estéreo da área construída (cerca de 250 km²) custa US$ 6 mil a 21 mil (R$ 30 mil a 103 mil)
  **por mês**, pelos preços de tabela.
- **Nuvens.** De dezembro a março o céu fica limpo só 24% a 38% do tempo, e o estéreo precisa das vistas limpas na
  mesma passagem.
- **Precisão onde importa.**
  - A estimativa pelo cadastro já acerta as casas: erro médio de 0,3 pavimento, 80% exatas.
  - O erro está nas torres: 2 a 4 pavimentos.
  - O estéreo dá ±1 a 2 m nas torres e não melhora as casas (pixels de 30–50 cm são poucos para uma casa).
- **Inteligência artificial global.** O Google Open Buildings 2.5D superestima as torres do centro em 8 a 12 m;
  serve só para Araquari e para achar prédios novos.
- **Licenças.**
  - Os termos de Google, Bing e Mapbox proíbem tirar dados das imagens deles para um produto comercial.
  - Na Airbus (Pléiades), qualquer modelo de elevação derivado não pode ir a terceiros.
  - O contrato padrão da Planet libera os produtos derivados.
- **Sombras.** Medir pela sombra falha no verão: o sol fica quase a pino e é a época nublada.

**Caminho recomendado:**

1. **Grátis, já:**
   - pedir à Prefeitura, pela Lei de Acesso à Informação:
     - o LiDAR de 2007 e 2010 (o melhor dado de altura que existe da cidade);
     - autorização formal compatível com a ODbL;
     - alvarás e habite-se mensais;
     - o cadastro da iluminação pública;
   - usar o modelo de superfície do Estado (SIGSC, 2010–2012) para conferir as torres;
   - usar a camada de pavimento da SEINFRA mês a mês.
2. **Obras:** a construtora é a fonte viável. A lei de incorporação (Lei 4.591/64, art. 31-D) já obriga um
   demonstrativo trimestral da obra quando há patrimônio de afetação. Propor às construtoras parceiras informar o
   andamento todo mês, como o painel já permite.
3. **Piloto pago, uma vez:**
   - **o quê:** um estéreo do núcleo de prédios altos (cerca de 100 km²);
   - **custo:** por volta de US$ 3,6 mil (R$ 18 mil) no SkySat tri-estéreo da Planet, mais 40 a 80 horas de
     processamento;
   - **renovação:** a cada 12 a 24 meses;
   - **meta:** ±1 pavimento em 80% dos prédios de 6 ou mais andares.
4. **Telhados:** um classificador de 3 classes (plano, duas águas, quatro águas) treinado sobre a imagem do piloto e
   os 1.195 telhados já rotulados no OSM de Joinville.

## Lista antes do lançamento

> **17/10/2026:** esta lista, os itens em aberto acima e os achados da auditoria de 17/10
> ([`auditoria-2026-10-17.md`](auditoria-2026-10-17.md)) foram consolidados numa ordem única de prioridade em
> [`prioridades.md`](prioridades.md). Use aquela lista para decidir o que fazer primeiro.

Ordem sugerida. As estimativas são de trabalho de uma pessoa.

- [ ] Validar preço e interesse com 2 ou 3 imobiliárias piloto, antes de investir nos itens grandes.
- [x] B4: separar a demonstração do produto no build.
- [ ] B4 (resto): espelho de vendas vindo do banco; empreendimentos fictícios na demonstração pública (2 a 3 dias).
- [x] B1: cabeçalho de cada página gerado por domínio, endereços limpos, sitemap por cliente, "Compartilhar" no
      domínio do cliente.
- [ ] B3 e B1 no ar: projeto na Cloudflare Pages com o domínio de um cliente, Search Console, Sentry, monitor de
      disponibilidade, homologação e e2e no CI (1 a 2 semanas). Cabeçalhos e 404 já estão prontos.
- [ ] B2: política, termos, consentimento versionado, retenção, exportação e exclusão (1 a 2 semanas, mais
      advogado). As fontes locais já estão feitas.
- [ ] Autorização da Prefeitura para o cadastro e publicação das alturas sob ODbL.
- [x] I9 (parte): o site abre com uma consulta só, com as fotos juntas.
- [x] I7, I12 e I13; I11 sem o teste de invasão.
- [ ] Teste de invasão por terceiros; I14 (e2e no CI, lint e regressão visual).
- [ ] Primeiro feed XML real importado e revisado com o cliente.
- [ ] Teste em celulares Android de entrada e com leitor de tela.

*Anotado por Claude (assistente de IA), 14/10/2026 (atualizado em 15/10/2026 e 17/10/2026), para consulta na manutenção.*
