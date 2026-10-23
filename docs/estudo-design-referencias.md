# Estudo de design, fase 1: referências (23/10/2026)

Primeira fase do [plano de estudo](estudo-design.md). Reúne o que portais, imobiliárias e produtos de fora do setor
fazem de mais interessante em UX e o que disso combina com o nosso site.

**Como foi feito:** pesquisa em fontes públicas (anúncios dos produtos, páginas de ajuda, documentação técnica,
imprensa do setor). Números de resultado que vêm de fornecedores estão marcados como "segundo o fornecedor": não
foram confirmados de forma independente. Falta a parte prática da fase: abrir cada site no celular e no computador,
gravar os fluxos e preencher a ficha da seção 4 do plano. As fontes estão no fim do documento.

## 1. Resumo

1. **O mapa 3D já faz o que os grandes portais compram de terceiros.** A Redfin colocou nos anúncios um resumo da
   luz do sol feito pela Shadowmap; a Homes.com, a Realtor.com e a Zoopla usam a TravelTime para busca por tempo de
   deslocamento. Nós já calculamos a posição real do sol (`src/map/lighting.ts`, com suncalc) e as sombras dos
   prédios (`src/map/shadows.ts`). Falta transformar isso em informação para o visitante.
2. **A busca está deixando de ser um formulário.** Zillow e QuintoAndar aceitam frases ("casa de 700 mil em
   Charlotte com quintal"; "apartamento com chão de taco e sala iluminada"). Rightmove e idealista deixam desenhar a
   área no mapa com o dedo.
3. **A marca vem do conteúdo, não do enfeite.** A The Modern House vende imóveis como uma revista: fotografia de
   arquitetura encomendada, textos bem escritos e animações curtas e discretas. É isso que dá cara própria, e não o
   número de efeitos.
4. **O bairro é parte do imóvel.** Trulia juntou opiniões de moradores, imagens de drone, segurança e escolas em
   páginas de bairro. O mapa 3D é o melhor lugar possível para contar isso.
5. **A fluidez agora é barata.** View Transitions entre páginas já funciona no Chrome e no Safari, e as animações
   ligadas à rolagem funcionam só com CSS no Chromium e no Safari. No navegador sem suporte, o site continua igual ao
   de hoje.

## 2. Referências por tema

### 2.1 Mapa como interface principal

| Referência | O que faz | O que levar para o nosso site |
|---|---|---|
| Redfin | A lista se atualiza enquanto a pessoa move ou aproxima o mapa, sem botão de buscar. Pinos com o preço, tamanho e contraste pensados para ler o valor de relance. | Busca que responde ao mapa em tempo real; o preço dentro do marcador. |
| Zillow e Rightmove | Agrupam os imóveis em regiões densas. | Já fazemos agrupamento; avaliar como o grupo se abre (animação, contagem). |
| Realtor.com (antigo) | Citado como exemplo do que evitar: trocar entre lista e mapa quebra o fluxo. | Mapa e lista lado a lado no computador; no celular, lista arrastável por cima do mapa. |
| Rightmove "Draw-a-Search" e idealista "desenhe sua área" | A pessoa desenha a área com o dedo ou o mouse, salva o desenho e recebe alertas de imóveis novos ali. | Desenhar a área sobre o 3D e ligar ao alerta que já existe (`src/site/alerts.ts`). |

### 2.2 Luz do sol e tempo de deslocamento

| Referência | O que faz | O que levar |
|---|---|---|
| Redfin + Shadowmap | No anúncio, um resumo da luz do sol no verão e no inverno; um link abre a simulação por hora e data. Segundo o fornecedor, o willhaben.at tem mais contatos com o "passeio do sol" nos anúncios. | Um bloco "Sol" na página do imóvel, calculado pelo nosso mapa: horas de sol por estação e um controle para arrastar a hora. Nenhum concorrente de Joinville tem isso. |
| Homes.com, Realtor.com, Apartments.com, Zoopla, Foxtons (TravelTime) | A pessoa informa um destino (trabalho, escola), o meio de transporte e o tempo máximo; o site filtra os imóveis e desenha a área alcançável. Apartments.com simula horário de pico. Segundo o fornecedor, a Zoopla teve 300% mais conversão. | "Até 15 min do meu trabalho" na busca e no imóvel. Cuidado: motores com base no OpenStreetMap usam o limite de velocidade e não o trânsito, então o pico parece mais curto do que é. Mostrar faixas ("15 a 20 min") e não um número exato. |

### 2.3 Busca por frase

| Referência | O que faz | O que levar |
|---|---|---|
| Zillow | Frases na barra principal desde 2023; depois incluiu deslocamento, orçamento, escolas e pontos próximos. | Uma barra que entende frases e as transforma nos filtros que já existem, mostrados como chips que a pessoa pode remover. A frase vira filtros visíveis, então não é uma caixa-preta. |
| QuintoAndar | Busca por texto ou voz e análise das fotos ("sala iluminada"); mais de 70 filtros; busca também pelo ChatGPT. | O mesmo princípio em escala menor; a análise de fotos fica para depois. |

### 2.4 Bairro e contexto

| Referência | O que faz | O que levar |
|---|---|---|
| Trulia "What Locals Say" e Trulia Neighborhoods | Enquetes com moradores (estacionamento, cães, vizinhos) no anúncio; depois, páginas de bairro com drone, segurança e escolas. | Página de bairro com voo de câmera no 3D, serviços próximos (já temos `data:services`) e, mais tarde, opiniões de moradores. |
| Mapbox Interactive Storytelling | Modelo de "scrollytelling": a história é dividida em capítulos, e cada capítulo leva a câmera a uma vista do mapa conforme a pessoa rola. | A narrativa do bairro na página do imóvel: rolar e a câmera passar por escola, mercado e parque. Dá para fazer com o MapLibre e o `IntersectionObserver` que já usamos. |

### 2.5 Marca e conteúdo

| Referência | O que faz | O que levar |
|---|---|---|
| The Modern House | Os fundadores vieram de revistas: fotografia de arquitetura encomendada, textos aprofundados sobre cada casa, tipografia limpa em muito branco, animações curtas e sutis. Depois virou revista impressa. | Página do imóvel com "história" (texto do corretor, fotos grandes) e um template com tipografia editorial. O efeito vem do conteúdo; o movimento só acompanha. |
| Hilton & Hyland (citado em lista de 2026) | Vídeo e fotografia ocupando a tela inteira na home. | Hero com vídeo ou foto como opção do template, mas com o mapa 3D como alternativa própria. |
| Compass "See It First" (set/2026) | Maior redesenho em dez anos: imóveis em pré-lançamento com selo e página própria, entrando na busca desde a home. | Um selo e uma seção de "chegou agora" ou "em breve" para dar sensação de novidade. Encaixa em lançamentos. |

### 2.6 Decisão a dois

| Referência | O que faz | O que levar |
|---|---|---|
| Airbnb, listas compartilhadas | Quem foi convidado para a lista escreve notas, vota a favor ou contra cada opção e vê quem participa; o link sozinho dá acesso só para ver. | Favoritos compartilhados com o cônjuge ou a família, com notas e votos, e um link para levar ao corretor. Imóvel é decisão de casal; nenhum site da cidade ajuda nisso. |

### 2.7 Movimento e fluidez (técnica)

| Recurso | Situação | Uso no nosso site |
|---|---|---|
| View Transitions (mesmo documento) | Usado em produção por redBus, Tokopedia e Policybazaar (só relatos qualitativos, sem números). | O site troca de página com `pushState` (`src/site/app.ts`), então dá para usar `document.startViewTransition`: a foto do card cresce e vira a galeria. |
| View Transitions (entre documentos) | Chrome 126+ e Safari 18.2+; Firefox parcial. Sem suporte, o link funciona normalmente. | Para as páginas pré-renderizadas, se um dia a navegação deixar de ser SPA. |
| Animações ligadas à rolagem (`animation-timeline: view()`) | Chromium e Safari; Firefox ainda incerto. | Revelação de seções e cards só com CSS; sem suporte, o conteúdo aparece parado, como hoje. Sempre desligado com `prefers-reduced-motion`. |

## 3. Primeira triagem

Nota de 1 a 5, a revisar depois da navegação prática.

| Padrão | Encaixe com o diferencial | Originalidade em Joinville | Esforço | Observação |
|---|---|---|---|---|
| Bloco "Sol" no imóvel | 5 | 5 | Médio | O cálculo já existe no mapa. |
| Narrativa do bairro com a câmera | 5 | 5 | Médio | Página do imóvel e de bairro. |
| Transição card → imóvel | 3 | 4 | Pequeno | Maior ganho de "fluidez" por esforço. |
| Busca por frase com chips | 3 | 5 | Médio | Começar com regras simples; IA depois. |
| Favoritos a dois | 3 | 5 | Médio | Precisa do backend (Supabase). |
| Tempo de deslocamento | 4 | 5 | Grande | Precisa de um motor de rotas; cuidado com o trânsito. |
| Desenhar a área no mapa | 4 | 4 | Médio | Liga ao alerta existente. |
| Mapa e lista ao vivo | 4 | 3 | Médio | Avaliar o que a busca já faz. |
| Revelação ao rolar | 2 | 3 | Pequeno | Acabamento, não diferencial. |
| Selo "chegou agora" | 2 | 3 | Pequeno | Usa a data de cadastro. |
| Página do imóvel editorial | 3 | 4 | Médio | Depende de o corretor escrever o texto. |

**Para a fase 2:** os quatro primeiros, porque juntam o que mais nos diferencia (sol, bairro) com o que mais muda a
sensação de fluidez (transições, busca).

## 4. Pendências da fase 1

- Navegar no celular e no computador por Redfin, Zillow, QuintoAndar, Rightmove, idealista, The Modern House,
  Compass e Airbnb, gravando os fluxos de busca, imóvel e favoritos.
- Procurar de 5 a 8 sites premiados nas galerias (Awwwards, Godly, Land-book) e fluxos de app no Mobbin para ampliar
  as referências de movimento e tipografia.
- Confirmar o suporte atual do Firefox a `animation-timeline` no MDN e no Can I use.
- Preencher a ficha de cada referência (seção 4 do plano).

## Fontes

- Mapa: [Raw Studio, mapas como UX central](https://raw.studio/blog/using-maps-as-the-core-ux-in-real-estate-platforms/),
  [Redfin, agrupamento animado](https://www.redfin.com/news/cluster_buck_rogers/)
- Desenhar área: [Rightmove, ajuda do Draw-a-Search](https://faq.rightmove.co.uk/support/solutions/articles/7000048757-draw-a-search),
  [Rightmove, áreas salvas](https://www.rightmove.co.uk/news/?p=80605),
  [idealista na App Store](https://apps.apple.com/app/idealista-com/id465958311)
- Sol: [Shadowmap, integração com a Redfin](https://shadowmap.org/learn/redfin-integrates-shadowmap-a-new-era-of-sunlight-analysis-for-homebuyers),
  [Shadowmap para portais](https://www.shadowmap.org/enterprise/property-platforms)
- Deslocamento: [TravelTime, Realtor.com](https://traveltime.com/case-study/realtor-commute-search-traveltime),
  [TravelTime, CoStar (Homes.com e Apartments.com)](https://traveltime.com/case-study/costar-property-portals),
  [TravelTime, filtrar e ordenar](https://docs.traveltime.com/use-case/property-portal/filter-and-rank),
  [TravelTime, Foxtons](https://traveltime.com/case-study/isochrone-map-example-case-study-foxtons)
- Busca por frase: [The Title Report, Zillow](https://www.thetitlereport.com/articles/87414.aspx),
  [nowbam, atualização da Zillow](https://nowbam.com/goodbye-to-filters-zillows-ai-powered-home-search-is-smarter-than-ever/),
  [Consumidor Moderno, QuintoAndar no ChatGPT](https://consumidormoderno.com.br/apps-chatgpt-quinto-andar-cm/),
  [QuintoAndar, filtros](https://www.quintoandar.com.br/guias/?p=2442529)
- Bairro: [Inman, Trulia What Locals Say](https://inman.com/2018/03/19/trulia-launches-what-locals-say-feature-to-tell-it-like-it-is),
  [TechCrunch, Trulia Neighborhoods](https://techcrunch.com/2018/08/14/trulia-crowdsources-neighborhood-reviews-so-you-wont-regret-your-move/),
  [Mapbox, scrollytelling](https://mapbox.com/blog/how-to-build-a-scrollytelling-map),
  [Mapbox, storytelling 3D](https://www.mapbox.com/blog/interactive-storytelling-3d-maps-with-mapbox-gl-js-v2)
- Marca: [Design Week, identidade da The Modern House](https://www.designweek.co.uk/inspiration/the-modern-house-identity-by-field-projects/),
  [Wikipedia, The Modern House](https://en.wikipedia.org/wiki/The_Modern_House),
  [Luxury Presence, melhores sites de 2026](https://www.luxurypresence.com/blogs/best-realtor-websites/),
  [HousingWire, Compass See It First](https://housingwire.com/articles/compass-com-see-it-first)
- Listas compartilhadas: [Airbnb, ajuda das listas](https://www.airbnb.com/help/article/1236)
- Técnica: [Chrome, casos de View Transitions](https://developer.chrome.com/blog/css-ui-ecommerce-vt),
  [Can I use, View Transitions entre documentos](https://caniuse.com/cross-document-view-transitions),
  [MDN, View Transition API](https://developer.mozilla.org/docs/Web/API/View_Transition_API),
  [Mozilla Connect, animation-timeline](https://connect.mozilla.org/t5/ideas/implement-css-scroll-driven-animations-animation-timeline/idc-p/116613)
