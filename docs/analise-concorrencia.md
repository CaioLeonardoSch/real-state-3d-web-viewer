# Concorrência em Joinville e onde o mapa 3D pode ganhar

Pesquisa feita em 08/10/2026 em sites públicos. Os sites de VivaReal e Sacada Imóveis bloquearam a leitura
automática (HTTP 403), então as informações sobre eles vêm de terceiros e devem ser conferidas. "Não encontrado"
quer dizer que o recurso não apareceu na página analisada, não que ele com certeza não exista.

## Resumo

- Os **portais nacionais** (ZAP, VivaReal, OLX, Imovelweb/Wimóveis e QuintoAndar) têm volume de anúncios, muitos
  filtros, alertas, fotos, vídeos e às vezes tour 360°. O mapa deles é 2D e serve para localizar o imóvel, não para
  entender o entorno.
- Os **sites das imobiliárias locais** são formulários de busca com cards. Nos que analisei não havia busca por
  mapa, tour virtual nem simulação. O que mais se destaca neles são buscas rápidas ("com piscina", "aceita
  permuta"), favoritos e o botão de WhatsApp.
- O **Apto.vc** (lançamentos) é o concorrente local mais completo em ferramentas: modo mapa, comparação,
  calculadoras e preço médio do m² por bairro.
- **Nenhum** dos sites analisados mostra o imóvel numa maquete 3D do bairro, simula o sol ou mostra a vista por
  andar. Esse é o espaço do protótipo. Em contrapartida, ele ainda não tem o básico que todos têm: fotos, contato
  e favoritos.

## Quem são os concorrentes

| Concorrente | Tipo | O que oferece (verificado ou citado) | O que não encontrei |
|---|---|---|---|
| ZAP, VivaReal e OLX (Grupo OLX) | Portais nacionais | Um cadastro publica nos três portais. Mais de 80 filtros (campanha de 2019–2020). Desenhar área no mapa (ajuda do VivaReal). App de realidade aumentada ZAP Explora (antigo, talvez descontinuado). | Não consegui abrir as páginas do bairro América (403). |
| Imovelweb / Wimóveis | Portal nacional, forte no Sul e Sudeste | Abas Fotos, Vídeos, Plantas, Mapa e Tour 360° nos anúncios, mas nem todo anúncio tem esse conteúdo. Muitos anúncios ocultam o endereço. Zibell e outras imobiliárias locais anunciam lá. | — |
| QuintoAndar | Portal e intermediação | Mais de 70 filtros (pets, mobília, rua silenciosa, home office, acessibilidade). Alertas ("Farejar imóvel"). Busca conversacional por texto ou voz desde 2025. "Ver mapa". | Compra e venda em Joinville: as notícias encontradas citam só São Paulo e Rio de Janeiro. |
| Apto.vc | Portal de lançamentos | Filtros de quartos, situação e preço. Ordenação por preço e metragem. Modo mapa. Comparar. Calculadoras de poder de compra, comprar × alugar, financiamento e INCC. WhatsApp. No América: m² médio de R$ 11.842 (Joinville: R$ 11.172) e 4 lançamentos. | Tour virtual, plantas, alertas. |
| Rede Mais | Rede de 8 imobiliárias locais (desde 2007) | Venda e locação, 16 tipos de imóvel, busca por texto, código e localização, selo "estuda permuta". | Mapa, tour, favoritos, simulação, WhatsApp. |
| Sacada Imóveis | Imobiliária da Rede Mais (34 anos, mais de 1.100 imóveis) | — | O site bloqueou a leitura. |
| Príncipe Imóveis | Imobiliária local, médio e alto padrão | Comprar, alugar e lançamentos. Filtros de bairros (vários), quartos, valor e **condomínio**. Buscas rápidas: piscina, varanda gourmet, armários, aceita permuta. Favoritos. WhatsApp com mensagem pronta. Código do imóvel. | Mapa, tour, comparação, simulação. |
| Zibell, Galeria, Sobrado, Koncreta, Delta, Garten | Imobiliárias tradicionais | Venda, locação e administração. Várias anunciam nos portais. | Não analisei os sites um a um. |

O preço do m² varia muito conforme a fonte: R$ 8.272 (FipeZap, junho de 2026, alta de 6,8% em 12 meses), R$ 11.172
(Apto.vc, só lançamentos) e cerca de R$ 6.700 para o grupo de bairros do América (estudo da Brain, sem data). As
metodologias são diferentes, então não dá para comparar os números diretamente.

## Onde o protótipo já está à frente

1. **Contexto 3D real.** O imóvel aparece destacado no prédio real do OpenStreetMap, entre os vizinhos. Dá para
   ver altura, recuo e densidade da quadra antes da visita.
2. **Luz do dia.** Manhã, tarde e noite com o sol na posição calculada (suncalc). Nenhum concorrente mostra isso.
3. **Localização aproximada transparente.** O Wimóveis esconde o endereço sem explicar. O protótipo mostra um raio
   de 150 m e avisa que a posição exata não é exibida.
4. **Busca que não termina vazia.** Diz qual filtro remover e qual é o valor mais próximo disponível.
5. **Novidades desta versão:**
   - filtro e ordenação por **R$/m²**, o dado que o Apto.vc só mostra como média;
   - **comodidades**, incluindo "aceita permuta", que as imobiliárias locais destacam;
   - situação (pronto ou em construção), banheiros, vagas e área máxima;
   - **cadastro clicando no prédio do mapa**, mais rápido que digitar endereço.
6. **Link compartilhável** com filtros e imóvel aberto, e **acessibilidade** (lista navegável por teclado e leitor
   de tela), algo raro nos sites locais.

## O que falta para competir (o básico)

| Lacuna | Quem já tem | Prioridade |
|---|---|---|
| Fotos e vídeo do imóvel | Todos | Alta. Sem fotos o anúncio não converte. |
| Contato: WhatsApp com mensagem pronta e formulário de lead | Príncipe, Apto.vc, portais | Alta |
| Favoritos | Príncipe, portais | Alta (simples) |
| Busca por código e por texto | Rede Mais, Príncipe | Média (simples) |
| Condomínio e IPTU no anúncio e no filtro | Príncipe | Média |
| Simulação de financiamento real (SAC/Price, juros, FGTS) | Apto.vc | Média. A atual é sem juros. |
| Alertas de novos imóveis | QuintoAndar, portais | Média. Precisa de backend. |
| Locação, além de venda | Rede Mais, Príncipe, portais | Depende do modelo de negócio |
| Comparar imóveis | Apto.vc | Baixa |
| Vários bairros | Todos | Necessária para sair do piloto no América |

## Vantagens que podemos construir

Ordenadas por impacto e por quanto se apoiam no que só o mapa 3D faz.

1. **Sol na fachada e no andar.** Calcular quantas horas de sol direto cada fachada e cada andar recebem ao longo do
   ano, com sombra dos prédios vizinhos, e filtrar por "sol da manhã". Em Joinville, cidade úmida e chuvosa, sol e
   ventilação pesam na escolha (mofo, umidade). Exige sombras reais: shadow mapping numa camada Three.js, já
   prevista nos próximos passos do README. É o diferencial mais forte e o mais difícil de copiar.
2. **"Veja a vista do 8º andar".** Posicionar a câmera na altura do pavimento escolhido e mostrar o que se vê de
   cada lado: prédios vizinhos, rio, áreas verdes. O MapLibre permite câmera livre, então isso é viável sem
   modelos detalhados.
3. **Risco de alagamento e altitude.** Joinville convive com enchentes e marés. Uma camada de áreas sujeitas a
   alagamento e a cota do terreno responderia a uma dúvida real de quem compra. É preciso **confirmar se a
   Prefeitura ou a Defesa Civil publicam esses dados em formato aberto** antes de prometer o recurso.
4. **Preço justo por m².** Mostrar em cada anúncio a diferença para a mediana do bairro e do tipo ("8% abaixo da
   média de casas no América"). O protótipo já calcula o R$/m²; falta uma base de referência (FipeZap ou dados
   próprios).
5. **Tempo a pé e de carro.** Escolas, hospitais, Centro, universidades e polos de emprego, com isócronas
   calculadas nas vias do OSM que já estão no projeto. É o que o QuintoAndar oferece com filtros como "perto do
   metrô", só que visual.
6. **Desenhar a área de busca no mapa.** Paridade com o VivaReal, com a vantagem de mostrar o resultado em 3D.
7. **Busca conversacional.** "Casa com quintal, sol da manhã, até R$ 900 mil, perto de escola." Paridade com o
   QuintoAndar, mas usando critérios que só o 3D sabe responder (sol, vista, altura).
8. **Versão para imobiliárias locais.** Os sites locais não têm mapa. O mapa 3D pode ser oferecido como
   ferramenta incorporável (white-label) para a Rede Mais e imobiliárias tradicionais, com o cadastro "clique no
   prédio" desta versão como porta de entrada para o corretor. Isso transforma concorrentes em clientes.

## Próximos passos sugeridos

- **Curto prazo (parte da frente).** Fotos no anúncio, WhatsApp e formulário de lead, favoritos, busca por código,
  condomínio e IPTU. Tudo isso cabe no front-end atual, com `localStorage` ou um backend simples.
- **Médio prazo (diferenciais).** Vista por andar, preço justo por m², isócronas e desenho de área.
- **Longo prazo.** Sombras reais e horas de sol por fachada, camada de alagamento (se houver dados abertos),
  backend com alertas, mais bairros e versão white-label para imobiliárias.

## Fontes

- Imobiliárias e portais: [Rede Mais](https://www.redemaisimoveisjoinville.com.br/),
  [Príncipe Imóveis](https://www.principeimoveisjoinville.com.br/), [Sacada Imóveis](https://sacadaimoveis.com.br/),
  [Apto.vc – América](https://apto.vc/br/sc/joinville/america),
  [Wimóveis – imobiliárias de Joinville](https://www.wimoveis.com.br/imobiliarias-joinville-sc.html),
  [Wimóveis – Zibell](https://www.wimoveis.com.br/imobiliarias/zibell-imoveis_47148801).
- Guias e listas: [Guia das principais imobiliárias de Joinville](https://publicidadeimobiliaria.com/guia-a-lista-das-principais-imobiliarias-de-joinville-sc/),
  [oHub](https://www.ohub.com.br/empresas/imobiliarias/sc/joinville),
  [Imóvel Guide](https://imovelguide.com.br/guia/imobiliarias/sc/joinville).
- Grupo OLX: [nossos portais](https://grupoolx.com.br/nossos-portais),
  [comparativo de portais 2026](https://www.eucorretor.app/blog/2026-06-14-onde-anunciar-imovel-melhores-portais/),
  [ZAP Explora](https://acontecendoaqui.com.br/tech/zap-lanca-app-em-realidade-aumentada/).
- QuintoAndar: [como usar o app](https://www.quintoandar.com.br/guias/?p=2441888),
  [busca com IA](https://startups.com.br/negocios/proptechs/quintoandar-lanca-app-no-chatgpt-para-ampliar-busca-por-imoveis/),
  [compra e venda](https://neofeed.com.br/startups/alem-do-aluguel-quintoandar-expande-operacao-de-compra-e-venda-de-imovel).
- Mercado: [valor do m² em Joinville (FipeZap)](https://myside.com.br/guia-imoveis/valor-metro-quadrado-joinville-sc),
  [estudo por bairros (NSC)](https://www.nsctotal.com.br/?p=5505128),
  [valorização (NSC)](https://www.nsctotal.com.br/?p=7304283),
  [Sinduscon Joinville (CBIC)](https://cbic.org.br/sinduscon-joinville-mercado-imobiliario-joinvilense-cresce-acima-da-media-estadual/).
- Maquetes digitais com insolação: [iTeleport](https://iteleport.com.br/en/solutions/teleport-city-en).
