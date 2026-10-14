# Avaliação do produto (outubro de 2026)

Avaliação realista do mapa 3D, do site das imobiliárias e do backend, pedida pelo dono do produto em 14/10/2026
("acredito que estamos longe de um lançamento"). As fontes são:

- uma auditoria completa sobre o commit `0de02db`: Lighthouse, axe, roteiros de teclado, uso manual no desktop e no
  celular, e leitura do código;
- a pesquisa sobre alturas e telhados por satélite;
- o que foi corrigido em seguida, no mesmo dia.

As notas e os números de antes vêm da auditoria; os de depois foram medidos de novo onde está indicado.

## Veredito

**O produto é bom para demonstração e para vender a ideia. Ainda está longe de um lançamento com clientes pagantes.**

- O mapa 3D é a parte mais madura e o diferencial real.
- O site de cada imobiliária cobre o que o mercado de Joinville oferece, com uma interface mais leve que a média.

O que falta é estrutura. Numa demonstração ninguém percebe, mas sem isso não dá para cobrar de um cliente:

1. **Google:** o site do cliente não é indexável de forma útil, e o crédito das páginas vai para o domínio da plataforma.
2. **LGPD:** não há política de privacidade, termos nem prazo de retenção dos contatos.
3. **Hospedagem para vários domínios:** hoje o site só sai pelo GitHub Pages.
4. **Operação:** não há monitoramento nem ambiente de homologação.
5. **Demonstração separada do produto:** hoje o build de produção leva textos e dados fictícios, inclusive
   empreendimentos reais com preços inventados.

**Prazo estimado: 8 a 12 semanas de trabalho de uma pessoa até um piloto pago com 2 ou 3 imobiliárias.** É uma
estimativa grosseira (detalhe na lista do fim). Depende do jurídico (LGPD e licença dos dados da Prefeitura) e do
retorno dos primeiros clientes.

## Notas por área (0 a 10)

Critério: quão perto a área está de um lançamento público com clientes pagantes. 8 ou mais significa pronto, com
ajustes menores; 5, funciona na demo, mas com defeitos visíveis; 3 ou menos, faltam peças estruturais.

| Área | Auditoria | Hoje | Por quê |
|---|---|---|---|
| Mapa 3D | 7 | 7 | Ganhou o recorte por bairro, a paisagem e as obras, mas continua pesado no celular e com textos de demonstração fixos |
| Site das imobiliárias | 5 | 6 | A maioria dos defeitos visíveis foi corrigida (I1 a I5, I8 e "Voltar ao original"); faltam a comparação no aluguel, o foco nas trocas de página e a paginação |
| Desempenho | 6 | 7 | A ficha do imóvel foi de 40–54 para 99 no celular; o mapa continua em 51–52 |
| Acessibilidade | 5 | 6 | Contraste corrigido no site e no mapa; faltam foco, Esc, `aria-live` e o padrão de abas |
| SEO | 2 | 2 | Nada mudou; é o maior bloqueio |
| Segurança | 6 | 6 | Sem CAPTCHA, CSP, 2FA nem teste de invasão |
| Prontidão para produção | 2 | 2 | O serviço mensal do mapa ajuda, mas os bloqueios abaixo continuam |

## O que está bom de verdade

- **Mapa 3D da cidade inteira:**
  - 164.672 prédios; 93% com altura estimada pelo cadastro da Prefeitura;
  - um único arquivo de 20 MB, lido por partes (o celular baixa só o que aparece);
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
  - cerca de 27 KB de JavaScript compactado na demonstração;
  - nota 92–93 no celular na página inicial e na busca.
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
  - 125 testes de unidade e 39 de backend;
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

## Importante

| Item | Situação |
|---|---|
| I1. A busca de aluguel virava venda ao abrir a ficha | **Corrigido** nos links dos cards. **Falta:** a comparação e os favoritos ainda mostram preço e m² de venda |
| I2. Reservado e vendido sumiam da ficha | **Corrigido:** selo, aviso, chamada de contato ajustada e `LimitedAvailability` no schema |
| I3. Filtros que mostravam uma coisa e aplicavam outra (preço mínimo perdido, bairro com acento) | **Corrigido:** um temporizador por campo; bairro sem acento e sem diferença de maiúsculas |
| I4. Painel de filtros esticado e cabeçalho que rolava para o lado | **Corrigido:** as caixas do painel ficam alinhadas ao topo; o menu recolhe quando não cabe, medido na tela, sem depender de largura fixa |
| I5. No celular, o preço e o contato só apareciam a 2.400 px do topo | **Corrigido:** preço junto ao título e barra fixa com WhatsApp e "Mensagem" |
| I6. A ficha sempre carregava o mapa 3D inteiro | **Corrigido:** o mapa só carrega ao chegar na tela ou no botão "Ver o prédio no mapa 3D" |
| I7. Acessibilidade | **Parte corrigida:** contraste do site (cor principal e de destaque ajustadas para 4,5:1), do laranja do mapa, do preço reduzido e do WhatsApp; nome acessível no WhatsApp do cabeçalho; aviso do editor para destaque muito claro. **Falta:** foco nas trocas de página, Esc fechando painéis, `aria-live` na contagem, padrão de abas, `h1` no mapa |
| I8. O mapa embutido virava o portal ao recarregar o quadro | **Corrigido:** o mapa mantém `embed`, `site`, `cor` e `pagina` no endereço |
| I9. Escala com backend | **Falta:** cada visita baixa todos os anúncios do cliente; `.in()` com centenas de ids passa de 8 KB de URL; limite de 1.000 linhas sem paginação; 5 requisições em série; com o backend o JavaScript do site soma cerca de 93 KB compactados (27 do site, 11 do acesso ao backend e 55 do cliente do Supabase) |
| I10. Editor | **Corrigido:** "Voltar ao original" não pergunta mais "Sair do site?". **Falta:** histórico de publicações e desfazer o que já foi publicado; a pré-visualização redesenha tudo a cada tecla |
| I11. CAPTCHA, CSP, 2FA e teste de invasão | **Falta** |
| I12. Endereço da página estática muda com o título; vendidos somem sem redirecionamento | **Falta** |
| I13. Fotos limitadas a 960 px, sem `srcset` | **Falta** |
| I14. Testes do site, e2e fora do CI, sem lint nem regressão visual | **Parte:** testes novos de obra, relatório do mapa e mapeamento. **Falta** o resto |

## Melhorias

| Item | Situação |
|---|---|
| M1. Escape na ordem errada na imagem de capa | **Corrigido** |
| M2. DDI repetido no `tel:` | **Corrigido** |
| M3. Paginação com `replaceState` (Voltar pula as páginas), clique do meio bloqueado, `pagina=99` | **Falta** |
| M4. `?p=qualquer` mostra a inicial; "Imóvel não encontrado" sem `noindex` | **Falta** |
| M5. O acesso ao backend (11 KB) é carregado mesmo sem backend | **Falta** |
| M6. Banco e e-mail | **Corrigido:** imagens em `data:image/svg+xml` recusadas. **Conferido:** o limite de 64 KB da configuração funciona, porque a checagem vê o valor ainda sem compressão (o teste de backend com 70 mil caracteres repetidos é recusado). **Falta:** o aviso de contato por e-mail pode sair duplicado (`notify-lead` não é atômico) |
| M7. `app.ts` com 1.200 linhas montando HTML em texto; "Joinville" fixo no código | **Falta** |
| M8. Detalhes de interface (rótulo do favorito, caixa "Comparar", filtros do celular sem "Ver N resultados") | **Falta** |

## Números

**Lighthouse no celular** (rede e CPU simuladas; WebGL por software, o que pesa mais no mapa do que num aparelho
real). "Hoje" foi medido depois das correções, com 2 ou 3 execuções:

| Página | Desempenho (auditoria → hoje) | Acessibilidade (auditoria → hoje) | Observação |
|---|---|---|---|
| Site: página inicial | 92–93 → 91–98 | 93 → 100 | Contraste corrigido: 11 violações → 0 |
| Site: ficha do imóvel | 40–54 → 99 | 94 → 100 | LCP de 4,6–5,5 s para 1,6–1,8 s; transferência de 1,7 MB para 119 KB; 63 → 14 requisições |
| Mapa | 54–55 → 51–52 | 96 → 100 | TBT de 3,4–3,5 s para 2,6–4,1 s; primeiro desenho 0,3 s mais lento (+18 KB de código) |

A busca do site não foi medida de novo (92–93 na auditoria; nada mudou no carregamento dela).

**O mapa e a paisagem.** A primeira medição depois da paisagem mostrou o mapa bem mais pesado: TBT de 7 a 9 s. O
perfil mostrou duas causas, ambas corrigidas:

1. A textura da água era lida da placa de vídeo, o que é lento. Agora ela fica na memória comum e só aparece de
   perto (zoom 13).
2. A primeira tela compilava 20 programas de shader em vez de 13. As camadas passaram a compartilhar os mesmos
   programas, e agora são 14.

O peso no celular continua sendo o ponto fraco do mapa: 345 KB de código e WebGL obrigatório.

**JavaScript compactado (gzip):**
- mapa: 345 KB (eram 327; a paisagem, as obras e o recorte por bairro somaram 18 KB);
- worker do MapLibre: 141 KB;
- site: 27 KB;
- acesso ao backend: 11 KB;
- cliente do Supabase: 55 KB (só com backend);
- recorte por bairro: 9 KB, carregados só quando se escolhe um bairro.

**Testes (14/10, depois das correções):**
- 125 testes de unidade e 39 de backend;
- 29 checagens do site, 27 do backend no navegador e 76 do mapa, todas passando.
- O teste do backend no navegador passou na segunda execução. Na primeira, a criação da imobiliária estourou o
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
  - O mapa exige WebGL e 345 KB de código.
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
  - À noite cada poste projeta uma mancha de luz.
  - Não são as posições reais. O cadastro real da iluminação pública (58 mil pontos) existe com a concessionária da
    PPP.
- **Árvores, matas e água.**
  - 212.298 árvores low-poly: 1.071 do OSM e o resto ilustrativo em praças, matas e bordas de mata.
  - As matas são uma copa facetada, um pouco recuada, com árvores na borda.
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

Ordem sugerida. As estimativas são de trabalho de uma pessoa.

- [ ] Validar preço e interesse com 2 ou 3 imobiliárias piloto, antes de investir nos itens grandes.
- [ ] B4: separar a demonstração do produto (3 a 5 dias).
- [ ] B3: hospedagem para vários domínios, cabeçalhos, 404, Sentry, monitor de disponibilidade e homologação (2
      semanas).
- [ ] B1: páginas pré-renderizadas por domínio, endereços limpos, sitemap por cliente, "Compartilhar" no domínio do
      cliente (2 a 3 semanas).
- [ ] B2: política, termos, consentimento versionado, retenção, exportação e exclusão, fontes locais (1 a 2 semanas,
      mais advogado).
- [ ] Autorização da Prefeitura para o cadastro e publicação das alturas sob ODbL.
- [ ] I9: consultas paginadas por cliente, fotos agregadas, requisições em paralelo (1 semana).
- [ ] I7 (resto), I11, I12, I13 e I14: foco e Esc, CAPTCHA, CSP, 2FA, URLs estáveis, fotos maiores, e2e no CI (2 a
      3 semanas).
- [ ] Primeiro feed XML real importado e revisado com o cliente.
- [ ] Teste em celulares Android de entrada e com leitor de tela.

*Anotado por Claude (assistente de IA), 14/10/2026, para consulta na manutenção.*
