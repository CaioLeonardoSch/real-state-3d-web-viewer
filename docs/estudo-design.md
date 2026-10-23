# Plano de estudo: design moderno e UX para o site (23/10/2026)

Objetivo: chegar a uma direção visual **própria** para o site das imobiliárias, mais dinâmica e fluida que a atual,
sem copiar os sites da cidade. O estudo termina com uma direção escolhida, protótipos testados com pessoas e itens
prontos para entrar em [`prioridades.md`](prioridades.md).

## 1. Ponto de partida

O que já temos e nenhum concorrente de Joinville tem (é daqui que a originalidade deve sair):

- **mapa 3D da cidade**, com prédios reais, hora do dia e época do ano;
- **desconto verificável**: o preço anterior vem do histórico da plataforma;
- comparação de imóveis, favoritos, alertas, parcelas do financiamento, agendamento de visita, vídeo e tour;
- white label: tudo o que sair do estudo precisa funcionar como template ou opção de configuração.

O que falta, pela comparação com os sites da cidade (GW, Nozz, Perfil, The Office e outros):

- a primeira tela fala do produto, não da imobiliária; não há foto nem marca forte;
- cabeçalho com 11 alvos de clique, com cara de portal;
- tipografia neutra (system-ui ou Inter, títulos na mesma fonte do texto);
- quase nenhum movimento: só transições de hover de 0,15s, nada ao rolar nem ao trocar de página.

## 2. Pergunta que o estudo responde

> Como o site pode parecer **a cidade ao vivo**, e não um catálogo, mantendo a cara de cada imobiliária?

Três hipóteses de direção, a validar na fase 3:

| Direção | Ideia | Por que combina conosco |
|---|---|---|
| **A. Cidade viva** | O mapa 3D é o palco: abre na hora real de Joinville, a câmera passeia devagar, painéis translúcidos por cima. | Usa o diferencial logo na primeira tela; ninguém consegue imitar. |
| **B. Editorial** | Revista de imóveis: títulos grandes com serifa, muito espaço, fotos amplas, guias de bairro. | Dá a cara de marca que os concorrentes têm, com mais sofisticação. |
| **C. Transparência** | Os números são heróis: gráfico do preço, desconto real, custo mensal, tempo até o centro. | Leva a promessa "desconto de verdade" para o visual. |

O resultado provável é uma mistura (por exemplo, A na home e C na página do imóvel). A escolha sai dos testes, não
de gosto pessoal.

## 3. O que estudar

### 3.1 Referências (fase 1)

Analisar como cada uma resolve o problema, não copiar a aparência.

**Imóveis**
- QuintoAndar e Loft: busca no celular, filtros em bottom sheet, fluxo até a visita.
- Zillow e Redfin: mapa e lista sincronizados, histórico de preço, alerta de queda.
- Idealista e Rightmove: densidade de informação nos cards, busca por desenho no mapa.
- The Modern House e Fantastic Frank: imóvel apresentado como editorial, fotografia e tipografia.
- Compass e Sotheby's Realty: marca forte com catálogo grande.

**Fora de imóveis** (movimento, fluidez e narrativa)
- Airbnb: barra de categorias, mapa com preços, listas compartilhadas, transição do card para a página.
- Páginas de produto da Apple: narrativa guiada pela rolagem.
- Linear e Stripe: microinterações e degradês com movimento contido.
- Reportagens interativas com mapa (NYT, Bloomberg CityLab): câmera que acompanha o texto.
- Google Earth e demos de MapLibre/Mapbox: câmera, luz e rótulos em 3D.

**Galerias para buscar mais exemplos:** Awwwards (categoria Real Estate), Godly, Land-book, Mobbin (fluxos de
aplicativos), Page Flows.

### 3.2 Padrões de UX que combinam com o site (fase 2)

Cada padrão vai para a ficha da seção 4. "Já existe" quer dizer que a função existe e o estudo é sobre como
apresentá-la melhor.

| Padrão | O que é | Situação |
|---|---|---|
| Hero vivo | Mapa 3D em movimento lento atrás da busca, imagem estática até carregar. | Novo |
| Cabeçalho que se transforma | Transparente sobre o hero, compacto e sólido ao rolar; menu curto e gaveta lateral. | Novo |
| Transição card → imóvel | A foto do card cresce e vira a galeria (View Transitions API). | Novo |
| Revelação ao rolar | Seções e cards entram em sequência (`animation-timeline: view()`). | Novo |
| Mapa e lista sincronizados | Passar o mouse no card acende o prédio no mapa, e o contrário. | Avaliar o que existe |
| Busca falada | Frases e chips: "3 quartos no América até 900 mil". | Novo |
| Sol na varanda | Mostrar luz e sombra do imóvel por hora e estação ("sol da manhã na sala"). | Novo, usa o mapa |
| Tempo de deslocamento | Isócronas: "até 15 min do trabalho", digitando um endereço. | Novo |
| Narrativa do bairro | Ao rolar a página do imóvel, a câmera passa por escola, mercado e parque. | Novo |
| Histórico de preço visual | Gráfico do preço e do desconto, que hoje aparecem só em texto. | Já existe |
| Comparar lado a lado | Tabela com diferenças destacadas e mini mapa. | Já existe |
| Favoritos a dois | Lista compartilhada com o cônjuge, com notas e votos. | Ampliar favoritos |
| Parcela no card | Custo mensal estimado junto do preço. | Já existe no detalhe |
| Bottom sheet no celular | Mapa ocupando a tela com a lista arrastável por cima. | Avaliar |
| Esqueletos e respostas imediatas | Carregamento com formas, contador da busca animado. | Parcial |

### 3.3 Fundamentos visuais

- **Tipografia:** pares de fontes por direção (serifa de títulos com sans de texto; uma sans geométrica forte).
  Escala fluida com `clamp()`.
- **Cor:** paleta por hora do dia ligada ao mapa (manhã, tarde, noite), mantendo a cor da imobiliária como acento.
- **Movimento:** tabela de durações e curvas (curto 150 ms, médio 300 ms, câmera 2 a 8 s), o que se move e o que
  nunca se move. Tudo desligável com `prefers-reduced-motion`.
- **Fotografia:** regras para fotos de cliente (proporção, corte, tratamento) e o que fazer quando não houver foto.

## 4. Como avaliar cada referência ou padrão

Uma ficha por item, numa planilha:

| Campo | Pergunta |
|---|---|
| O que é | Descrição e link ou print. |
| Por que funciona | Qual problema do visitante resolve. |
| Encaixe | Reforça o mapa 3D, o desconto verificável ou a marca da imobiliária? |
| White label | Funciona com as cores, fontes e fotos de qualquer cliente? |
| Celular | Funciona bem com o dedo e numa tela pequena? |
| Desempenho | Afeta LCP, INP ou CLS? O mapa continua carregando depois do conteúdo? |
| Acessibilidade | Contraste, teclado, leitor de tela, movimento reduzido. |
| Esforço | Pequeno, médio ou grande (mesma escala de `prioridades.md`). |
| Nota | De 1 a 5 em impacto e em originalidade. |

Corte: entra na fase 3 o que tiver encaixe claro, funcionar no celular e não piorar o desempenho.

## 5. Fases

| Fase | O que fazer | Entrega | Duração |
|---|---|---|---|
| 1. Referências | Navegar e fichar de 15 a 20 sites (seção 3.1), gravando os fluxos no celular e no computador. Pesquisa feita em [`estudo-design-referencias.md`](estudo-design-referencias.md); falta a navegação prática. | Planilha e pasta de prints/vídeos. | 3 dias |
| 2. Padrões | Fichar os padrões da seção 3.2 e outros que aparecerem. Ver o que o código já suporta. | Lista priorizada de padrões. | 2 dias |
| 3. Direções | Um moodboard por direção (A, B, C) e a home e a página do imóvel prototipadas em código, com dados da demo. | 3 protótipos navegáveis. | 1 semana |
| 4. Testes | 5 a 8 pessoas que buscaram imóvel no último ano: teste de 5 segundos, preferência entre as direções, tarefa "ache um apartamento de 2 quartos no América e marque visita". Medir também Lighthouse no celular. | Relatório com o que funcionou. | 3 dias |
| 5. Decisão | Escolher a direção, definir o template (ou as opções de configuração) e quebrar em itens. | Itens novos em `prioridades.md`. | 1 dia |

Total aproximado: 3 semanas para uma pessoa.

## 6. Regras durante o estudo

- **Destaque:** parecer com outros sites em convenções (menu, busca, cards) não é problema; o que importa é que o
  site se destaque. Os sites da cidade e o do corretor são só contexto do mercado, não a base das decisões: a
  direção sai das referências da seção 3, dos nossos diferenciais e dos testes.
- **Desempenho antes de efeito:** LCP abaixo de 2,5 s no celular em 4G; o mapa 3D nunca bloqueia o primeiro conteúdo.
- **Movimento com propósito:** cada animação precisa explicar algo (de onde veio, para onde foi, o que mudou).
- **Nada quebra o que funciona:** os templates atuais continuam iguais; o resultado entra como template novo.
