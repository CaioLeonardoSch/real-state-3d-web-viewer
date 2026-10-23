# Estudo de design, fase 1: referências (23/10/2026)

Primeira fase do [plano de estudo](estudo-design.md). Reúne o que há de mais novo em portais imobiliários,
sites premiados e técnica de front-end (2025 e 2026) e o que disso pode deixar o nosso site mais atraente e original.

**Como foi feito:** duas rodadas de pesquisa em fontes públicas (anúncios oficiais, páginas de ajuda, imprensa do
setor, documentação técnica) e, na segunda rodada, dez sites abertos num navegador real para ver os padrões de
perto (capturas na seção 3). Números de resultado que vêm da própria empresa ou de fornecedores estão marcados como
"segundo a empresa": não foram confirmados de forma independente. As fontes estão no fim.

## 1. Resumo: o que mudou em 2025 e 2026

1. **A busca virou conversa.** Em um ano, Zillow (out/2025), Redfin (nov/2025 no site, fev/2026 no ChatGPT),
   Realtor.com, realestate.com.au, ImmoScout24, QuintoAndar e ZAP lançaram busca por frase, por voz ou dentro do
   ChatGPT. A Homes.com foi além, com busca por voz que lembra o que a pessoa já disse. No ZAP, segundo a empresa,
   os anúncios mostrados pela busca com IA tiveram 25% mais cliques e 53% mais conversões no beta.
2. **A busca passou a "ver" as fotos.** ImmoScout24, QuintoAndar e a britânica Jitty encontram "varanda com sol",
   "piso de madeira" ou "sala iluminada" mesmo quando o texto do anúncio não fala disso.
3. **O 3D da vizinhança chegou aos grandes portais.** A Zillow lançou o SkyTour (jul/2025, voo de drone em 3D com
   Gaussian splatting, só em anúncios premium) e a Realtor.com o FlyAround (out/2025, sobre o 3D do Google, em todos
   os anúncios com coordenadas). Segundo o Google, 10% de quem abre um anúncio na Realtor.com usa o FlyAround. Nós já
   temos isso em todos os imóveis, com a cidade inteira, a hora do dia e a luz real.
4. **Os portais ajudam a decidir, não só a encontrar.** A Zillow mostra a chance de uma proposta ser aceita (Offer
   Insights), quanto a pessoa pode pagar e quais imóveis cabem nisso (BuyAbility), e um roteiro de visitas
   compartilhado. A Redfin mostra a luz do sol. Homes.com e Realtor.com mostram o tempo até o trabalho.
5. **Os sites premiados de imóveis contam uma história.** Os vencedores do Awwwards de 2026 (Belgrade Arbor, Sobha
   Privy, Realevate, Loam House) têm em comum fotos na hora dourada, títulos que misturam serifa reta e itálico,
   navegação em "pílula" flutuante, imagens com recortes orgânicos e um botão para pausar as animações.
6. **A web ficou fluida sem pesar.** Transições entre páginas, animações ligadas à rolagem, carrosséis só com CSS e
   pré-carregamento das páginas prováveis já funcionam nos navegadores principais. Sem suporte, o site fica como hoje.

**O que isso quer dizer para nós:** o mercado inteiro está correndo atrás de três coisas que nós já temos pela metade
(3D da vizinhança, luz do sol, preço verificável). A originalidade está em fazer delas a cara do site, não em mais
efeitos.

## 2. Novidades dos portais (2025 e 2026)

| Quando | Quem | O que lançou | O que levar para o nosso site |
|---|---|---|---|
| Jun/2025 | ImmoScout24 (Suíça) | Título e texto do anúncio gerados a partir de 3 fotos e dos dados do imóvel. | No painel do corretor: rascunho do texto do imóvel. Ajuda a ter a "página editorial" sem esforço. |
| Jul/2025 | Zillow | SkyTour (voo 3D em volta do imóvel), Offer Insights (chance da proposta), BuyAbility (quanto posso pagar e busca por parcela), roteiro de visitas compartilhado. | "Voar até o imóvel" no nosso 3D (já temos o mapa); busca por parcela mensal (já calculamos parcelas no imóvel); roteiro de visitas no mapa. |
| Set/2025 | Zillow | Decoração virtual com IA: um ícone na foto troca o estilo do cômodo (moderno, escandinavo, industrial), tira os móveis e alterna com a foto original. | Para depois: exige deixar claro que a foto foi alterada e sempre mostrar a original. |
| Set/2025 | ZAP (OLX) | Busca por texto ou voz com IA; 4 em cada 10 brasileiros já usaram IA para procurar imóvel (pesquisa da OLX). | Confirma que o público brasileiro já espera buscar por frase. |
| Out/2025 | Zillow | Primeiro app imobiliário dentro do ChatGPT: perguntas como "o que cabe no meu bolso aqui perto?" voltam com fotos, mapa e preço. | Deixar os imóveis legíveis para assistentes de IA (dados estruturados, páginas pré-renderizadas). |
| Out/2025 | Realtor.com | FlyAround: vista 3D baixa do imóvel e do entorno no anúncio; plano de 2026 é explorar o bairro e os pontos de interesse. | É exatamente a direção do nosso mapa. Fazer o voo e o passeio pelo bairro. |
| Nov/2025 | Redfin | Busca por conversa no site inteiro (home, mapa e anúncio), em vários idiomas; no iPhone em jan/2026. | Uma barra que entende frases e mostra os filtros que entendeu como etiquetas. |
| Nov/2025 | realestate.com.au | Vídeos curtos em carrossel deslizável no app (mercado e comentários de economistas). | Vídeo vertical do imóvel no celular, se o corretor tiver. |
| Fev/2026 | Redfin, realestate.com.au, ImmoScout24, QuintoAndar | Apps dentro do ChatGPT; o do ImmoScout24 encontra características vistas nas fotos. | Idem. |
| Fev/2026 | Homes.com | Homes AI: busca por voz e texto que faz perguntas de volta e lembra o contexto. | Para depois; a busca por frase vem antes. |
| Mar/2026 | Zillow, Rightmove | Zillow Preview (imóveis antes de entrar no MLS); Rightmove com filtros de casa eficiente em energia. | Selo "chegou agora" ou "em breve" para dar sensação de novidade. |
| Set/2026 | Compass | Maior redesenho em 10 anos: imóveis em pré-lançamento com selo e página própria. | Idem. |

Coisas que continuam valendo e que a primeira rodada já tinha levantado: desenhar a área no mapa (Rightmove,
idealista e QuintoAndar, que tem o botão "Desenhar área de busca" flutuando no mapa), busca por tempo de
deslocamento (Homes.com, Realtor.com, Zoopla, Foxtons), opiniões de moradores sobre o bairro (Trulia) e listas de
favoritos compartilhadas com notas e votos (Airbnb).

## 3. Sites premiados vistos de perto

Abertos no Chromium em 1440×900, com uma captura na primeira tela e outra depois de rolar.

| Site | Prêmio | O que se vê | O que é bom ideia para nós |
|---|---|---|---|
| [Belgrade Arbor](https://belgradearbor.rs/en) (Sérvia) | Site do Dia e Prêmio de Desenvolvimento, Awwwards, out/2026 | Menu em pílula flutuante (Menu, logo, Contato) centralizado; texto em serifa condensada grande; fotos em recortes orgânicos, como folhas; botão "Explore in 3D"; barra de progresso da seção. | Menu em pílula que flutua e encolhe; um botão "Ver no 3D" como CTA de destaque; indicador de progresso na página do imóvel. |
| [Azimute Residencial](https://azimuteresidencial.com.br/) (Mauá, SP) | Listado no Awwwards | Foto na hora dourada; título em versalete com serifa e uma palavra em itálico enorme ("horizonte."); legenda "Perspectiva artística"; **botão "Animações" para pausar**; seções numeradas ("01 / O projeto"). | Mistura de serifa reta e itálico nos títulos; botão para pausar as animações (acessível e elegante); seções numeradas. Prova que dá para fazer isso no Brasil. |
| [Loam House](https://residences.loamhouse.com.au) (Austrália) | Menção honrosa, Awwwards, set/2026 | Vista aérea do bairro na hora dourada; título serifado com segunda linha em itálico dourado; formulário num painel escuro translúcido no próprio hero; selo "Final release"; dois CTAs no menu (folheto e visita). | Hero com o bairro, não só o prédio; ação principal (agendar visita) visível desde a primeira tela; selos de escassez verdadeiros. |
| [Realevate](https://realevate.agency/) | Site do Dia, Awwwards, set/2026 | Coleções por estilo de vida em cartões altos e coloridos com título vertical ("By The Sea", "Evergreen", "Urban Living", "Rare Gems"); faixa de texto gigante correndo com uma foto dentro das letras. | **Coleções de Joinville por estilo de vida**: "Perto do verde", "Centro a pé", "Vista para a serra", "Para quem tem cachorro". Mais desejo do que um filtro. |
| [Lev](https://www.lev.com/) (EUA) | Listado no Awwwards | Cidade na hora dourada; uma notificação flutuante "Meet Lev 3.0" no canto; menu com botões em pílula. | Notificação discreta para novidades ("3 imóveis novos no América hoje"). |
| [QuintoAndar](https://www.quintoandar.com.br/) | — | Filtros como etiquetas em linha logo abaixo da busca; "Criar alerta de imóvel" na mesma linha; mapa ao lado com contagens; botão "Desenhar área de busca" flutuando sobre o mapa; fotos do card com pontinhos (carrossel); condomínio e IPTU junto do preço. | Filtros em etiquetas; alerta a um clique da busca; carrossel de fotos no card; custo total do mês junto do preço. |
| [Jitty](https://jitty.com/) (Reino Unido) | — | Menu em pílula translúcida com ícones (Home, Search, Personal Agent, Account); busca por frase no hero; filtros de preço por m², tempo de deslocamento e "luz natural" vista nas fotos. | Preço por m² como filtro e ordenação; "agente pessoal" que acompanha a busca. |

Também foram abertos Sobha Privy Collection, Mr. C Residences e Zillow, mas os dois primeiros só mostraram a tela de
carregamento ou uma cor lisa no tempo da captura, e a Zillow não mostrou nada útil sem interação.

**O que se repete:**
- **hora dourada** em quase todos os heros (fim de tarde, luz quente, sombras longas);
- **serifa com itálico** nos títulos, muitas vezes com uma palavra destacada em outra cor;
- **menu flutuante em pílula**, translúcido, com um único CTA destacado;
- **CTA de 3D ou de visita** visível desde a primeira tela;
- **controle de movimento**: botão para pausar animações.

A hora dourada é a pista mais importante: os sites premiados *fotografam* o fim de tarde, e o nosso mapa consegue
*renderizar* o fim de tarde real de Joinville, no prédio real, em qualquer imóvel.

## 4. Tendências de design de 2026, filtradas

As listas de tendência são feitas por empresas de ferramentas de design, então servem como direção, não como dado.

| Tendência | O que é | Serve para nós? |
|---|---|---|
| Fim da "cara de template" | Reação aos sites iguais feitos por construtores e IA: mais personalidade, tipografia e composição próprias. | Sim, é o ponto de partida do estudo. |
| Tipografia cinética e fontes variáveis | Texto que muda de peso, estica com a rolagem ou reage ao mouse; uma fonte variável num só arquivo. | Com moderação: título do hero e números (desconto, contagem da busca). |
| Vidro "líquido" maduro | Painéis translúcidos para menu fixo, modais e painéis laterais, influência do Liquid Glass da Apple (2025). Desfoque e tom são baratos em CSS; a refração exige filtros SVG pesados. | Sim para painéis sobre o mapa e o menu flutuante (só `backdrop-filter`); não para refração. |
| 3D e experiências imersivas | Cenas 3D que respondem à rolagem e ao mouse (Site do Ano 2025 do Awwwards: o de Lando Norris, com formas que seguem o cursor). | Já é o nosso diferencial; o cuidado é carregar depois do conteúdo. |
| Microinterações com propósito | Movimento só para confirmar, guiar ou explicar; duração entre 200 e 500 ms. | Sim: favoritar, contador da busca, adicionar à comparação. |
| Layout orgânico, grade quebrada | Composições assimétricas, sobreposição, recortes irregulares. | Em pontos de marca (home, sobre); a busca e os cards continuam em grade. |
| Cor intensa ("dopamine design") | Saturação, néon, gradientes fortes. | Não combina com a decisão de comprar um imóvel; no máximo como acento. |
| Conteúdo legível por IA | Estruturar o conteúdo para assistentes resumirem certo. | Sim; já pré-renderizamos as páginas. Revisar dados estruturados. |
| Acessibilidade desde o início | Contraste, foco, teclado e leitor de tela no sistema de design; widgets de acessibilidade sobrepostos não funcionam. | Sim, é regra do estudo. |

## 5. Técnica nova que dá fluidez

| Recurso | Situação | Uso no nosso site |
|---|---|---|
| View Transitions (mesmo documento) | Usado por redBus, Tokopedia e Policybazaar (só relatos, sem números). | O site troca de página com `pushState` (`src/site/app.ts`): a foto do card cresce e vira a galeria. |
| View Transitions (entre documentos) | Chrome 126+ e Safari 18.2+; Firefox parcial. | Para as páginas pré-renderizadas. |
| Animações ligadas à rolagem (`animation-timeline`) | Chromium e Safari; Firefox ainda incerto. | Revelar seções e cards, barra de progresso da página do imóvel, só com CSS. |
| Carrossel só com CSS (`::scroll-button`, `::scroll-marker`) | Chrome e Edge 135+; Safari recente; Firefox atrás de flag. | Carrossel de fotos no card com pontinhos e setas, sem JavaScript. |
| Anchor Positioning | Pronto no Chromium; suporte ainda desigual (State of CSS 2026: a função que mais querem usar e evitam por suporte). | Balões do mapa e dicas presos ao elemento; usar com alternativa. |
| Speculation Rules (pré-carregar a próxima página) | Shopify ligou para todas as lojas em jun/2025; Ray-Ban reduziu o LCP no celular de 4,69 s para 2,66 s (estudo publicado no web.dev, não conferido). | Pré-carregar o imóvel quando o dedo ou o mouse para sobre o card: a página abre instantânea. |

## 6. Ideias próprias que saem do estudo

Juntando as seções 2 a 5 com o que o código já faz. É daqui que deve sair a originalidade.

1. **Hora dourada ao vivo.** O hero mostra o prédio de um imóvel em destaque no mapa 3D, com a luz da hora real de
   Joinville; no fim da tarde, a luz dourada é a de verdade. Nos outros horários, um controle deixa "ver ao pôr do
   sol". Os premiados fotografam a hora dourada; nós a calculamos (`src/map/lighting.ts`).
2. **Sol do imóvel.** Na página do imóvel: horas de sol no verão e no inverno, um controle para arrastar a hora e ver
   a sombra dos prédios vizinhos. A Redfin compra isso de terceiros; nós já temos sol e sombras
   (`src/map/shadows.ts`).
3. **Voar até o imóvel e passear pelo bairro.** Ao abrir o imóvel, a câmera desce da cidade até o prédio (como o
   SkyTour e o FlyAround) e, ao rolar, passa por escola, mercado e parque (scrollytelling).
4. **Coleções de Joinville.** Cartões de estilo de vida no lugar de "destaques": "Perto do verde", "Centro a pé",
   "Vista para a serra", "Rua tranquila". Cada um é uma busca pronta e um voo no mapa.
5. **Busca por frase com etiquetas.** "3 quartos no América até 900 mil com sacada" vira filtros visíveis e
   removíveis. Primeiro com regras simples; IA depois.
6. **Cabe no bolso.** Buscar por parcela mensal e mostrar o custo do mês (parcela, condomínio e IPTU) no card.
   Já calculamos parcelas no imóvel.
7. **Desconto que se vê.** O histórico de preço vira um gráfico pequeno e animado no card e no imóvel. É a nossa
   promessa principal e hoje aparece só em texto.
8. **Decidir a dois.** Favoritos compartilhados com notas e votos, e um roteiro de visitas no mapa para levar ao
   corretor (ideias do Airbnb e da Zillow).
9. **Acabamento de marca.** Menu em pílula flutuante que encolhe ao rolar; títulos com serifa e itálico como opção do
   template; botão para pausar animações; transição card → imóvel; pré-carregamento do imóvel ao passar o mouse.

## 7. Triagem atualizada

Nota de 1 a 5, a revisar depois dos protótipos.

| Ideia | Diferencial | Originalidade na cidade | Esforço | Observação |
|---|---|---|---|---|
| Hora dourada ao vivo (hero) | 5 | 5 | Médio | Cuidar do LCP: imagem estática primeiro, 3D depois. |
| Sol do imóvel | 5 | 5 | Médio | Cálculo pronto no mapa. |
| Voo até o imóvel e passeio pelo bairro | 5 | 5 | Médio | Página do imóvel. |
| Acabamento de marca (menu, tipografia, transições) | 3 | 4 | Pequeno | Maior ganho de fluidez por esforço. |
| Desconto que se vê | 4 | 5 | Pequeno | Dados já existem. |
| Coleções de Joinville | 4 | 5 | Pequeno | Precisa de critérios por bairro e serviços. |
| Busca por frase com etiquetas | 3 | 5 | Médio | |
| Cabe no bolso | 3 | 4 | Pequeno | |
| Decidir a dois | 3 | 5 | Médio | Precisa do backend. |
| Tempo de deslocamento | 4 | 5 | Grande | Motor de rotas; trânsito real. |
| Busca que vê as fotos | 3 | 5 | Grande | Depende de IA e custo por foto. |
| Decoração virtual com IA | 2 | 4 | Grande | Exige aviso claro de foto alterada. |

**Para a fase 2:** hora dourada ao vivo, sol do imóvel, voo e passeio pelo bairro, e o acabamento de marca. Os três
primeiros são o que ninguém na cidade tem; o último é o que mais muda a sensação de site estático.

## 8. Pendências da fase 1

- Abrir no celular os sites da seção 3 e mais Redfin, Zillow, Compass e Airbnb, gravando os fluxos de busca, imóvel e
  favoritos (a Zillow e a Sobha não renderizaram na captura automática).
- Ver de perto mais 5 a 8 vencedores recentes do Awwwards e fluxos de app no Mobbin.
- Confirmar no MDN e no Can I use o suporte atual do Firefox a `animation-timeline` e `::scroll-marker`.
- Preencher a ficha de cada referência (seção 4 do plano).

## Fontes

**Portais**
- Zillow: [5 recursos de jul/2025](https://zillow.mediaroom.com/2025-07-15-Summer-just-got-hotter-Zillow-debuts-five-powerful-new-features),
  [SkyTour (Inman)](https://www.inman.com/2025/11/25/zillows-skytour-uses-complex-3d-tech-to-simplify-home-search/),
  [decoração virtual](https://chicagoagentmagazine.com/2025/09/12/zillow-launches-ai‑powered-virtual-staging-for-showcase-listings/),
  [app no ChatGPT (HousingWire)](https://www.housingwire.com/articles/zillow-chatgpt-launch-app-integration/)
- Redfin: [busca por conversa](https://www.redfin.com/news/redfin-debuts-conversational-search/),
  [app no iPhone](https://www.redfin.com/news/conversational-search-is-now-available-on-the-redfin-iphone-app/),
  [app no ChatGPT (RISMedia)](https://www.rismedia.com/2026/02/09/redfin-extends-ai-powered-home-search-into-chatgpt/),
  [Shadowmap na Redfin](https://shadowmap.org/learn/redfin-integrates-shadowmap-a-new-era-of-sunlight-analysis-for-homebuyers)
- Realtor.com: [FlyAround (HousingWire)](https://www.housingwire.com/articles/realtor-com-releasing-3d-flyaround-property-viewing-tool/),
  [caso no Google Cloud](https://cloud.google.com/customers/realtor),
  [deslocamento (TravelTime)](https://traveltime.com/case-study/realtor-commute-search-traveltime)
- Busca por IA e voz: [Samantha McLean, portais e voz](https://samanthamclean.substack.com/p/every-property-portal-is-racing-to),
  [ZAP com IA (Baguete)](https://www.baguete.com.br/noticias/zap-da-olx-facilita-busca-por-imoveis-ia),
  [pesquisa da OLX (Portas)](https://portas.com.br/noticias/40-dos-brasileiros-usam-ia-para-buscar-imoveis/),
  [QuintoAndar no ChatGPT](https://consumidormoderno.com.br/apps-chatgpt-quinto-andar-cm/),
  [ImmoScout24 e outros (Online Marketplaces)](https://www.onlinemarketplaces.com/articles/product-and-services-roundup-immoscout24-bayut-99-co-avito-zumper/),
  [ImmoScout24, texto automático](https://www.immoscout24.ch/c/en/guide/features/automatically-generated-listing-text)
- Outros: [Jitty, comparação de portais](https://jitty.com/post/the-best-uk-property-portals),
  [realestate.com.au, vídeos curtos](https://www.mediaweek.com.au/rea-goes-full-tiktok-to-hook-property-dreamers/),
  [Compass See It First](https://housingwire.com/articles/compass-com-see-it-first),
  [Altgage, Zillow Preview](https://www.altgage.com/blog/real-estate-listing-platforms-to-find-your-dream-home),
  [Rightmove Draw-a-Search](https://faq.rightmove.co.uk/support/solutions/articles/7000048757-draw-a-search),
  [Trulia What Locals Say](https://inman.com/2018/03/19/trulia-launches-what-locals-say-feature-to-tell-it-like-it-is),
  [Airbnb, listas compartilhadas](https://www.airbnb.com/help/article/1236)

**Design**
- [Awwwards, sites de imóveis](https://www.awwwards.com/websites/real-estate/),
  [Awwwards, vencedores anuais](https://www.awwwards.com/annual-awards/winners),
  [Awwwards, sites do ano](https://www.awwwards.com/websites/sites_of_the_year/)
- [Envato, tendências de 2026](https://elements.envato.com/learn/web-design-trends),
  [Wix, tendências de 2026](https://www.wix.com/blog/web-design-trends),
  [Figma, tendências de 2026](https://www.figma.com/resource-library/web-design-trends/)
- [DesignRush, site de Lando Norris](https://designrush.com/best-designs/websites/lando-norris-website-design),
  [The Modern House (Design Week)](https://www.designweek.co.uk/inspiration/the-modern-house-identity-by-field-projects/)
- [Liquid Glass em CSS e SVG (ekino)](https://medium.com/ekino-france/liquid-glass-in-css-and-svg-839985fcb88d),
  [Supademo, microinterações](https://supademo.com/blog/micro-interaction-examples)

**Técnica**
- [Chrome, casos de View Transitions](https://developer.chrome.com/blog/css-ui-ecommerce-vt),
  [Can I use, View Transitions](https://caniuse.com/cross-document-view-transitions),
  [MDN, View Transition API](https://developer.mozilla.org/docs/Web/API/View_Transition_API)
- [SitePoint, carrosséis com CSS em 2026](https://www.sitepoint.com/scrolldriven-css-in-2026-building-carousels-without-javascript/),
  [State of CSS 2026](https://2026.stateofcss.com/pt-BR/),
  [Mozilla Connect, animation-timeline](https://connect.mozilla.org/t5/ideas/implement-css-scroll-driven-animations-animation-timeline/idc-p/116613)
- [Chrome, guia de Speculation Rules](https://developer.chrome.com/docs/web-platform/implementing-speculation-rules),
  [Shopify, Speculation Rules](https://shopify.dev/docs/storefronts/themes/best-practices/performance/use-speculation-rules),
  [ics.media, Speculation Rules](https://ics.media/en/entry/260415/)
- [Mapbox, scrollytelling](https://mapbox.com/blog/how-to-build-a-scrollytelling-map)
