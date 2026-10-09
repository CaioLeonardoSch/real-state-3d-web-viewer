# Dados da Prefeitura de Joinville úteis para o mapa

Avaliação de 09/10/2026. A Prefeitura publica um servidor ArcGIS aberto, sem login:
`https://geo.joinville.sc.gov.br/server/rest/services`. É o mesmo servidor usado pelo
[SIMGeo](https://www.joinville.sc.gov.br/servicos/acessar-sistema-de-informacoes-municipais-georreferenciadas-simgeo/).
As camadas aceitam consulta (`/query`, até 2.000 feições por chamada, com paginação) e devolvem GeoJSON. Consultei as
camadas abaixo diretamente.

**Antes de usar em produto**, confirme a licença e as condições de uso com a Unidade de Geoprocessamento (SEPUR.UGP),
pelo e-mail simgeo@joinville.sc.gov.br ou pelo telefone (47) 3422-7333. O servidor é público, mas não encontrei um
termo de licença explícito.

## O problema que precisa de solução: altura dos prédios

No OpenStreetMap, **56.440 dos 57.261 prédios da região (98,6%) não têm altura nem número de pavimentos**. O mapa
desenha todos esses com 6 m. Nenhuma camada pública da Prefeitura traz "edificação com altura" pronta, mas há três
caminhos.

### 1. Cadastro imobiliário: área construída por lote (melhor custo-benefício)

Camada `SEFAZ/lotes_joinsgc_sefaz`, com **66.708 lotes na região**. Campos verificados:

- `area_construida`, `area_terreno` e `testada_principal`;
- `logradouro`, `numero` e `bairro`;
- `baldio` (lote vago: sim ou não);
- `matricula_ri`, além do contorno do lote.

Exemplo real, Rua Frei Caneca, 139, América: terreno de 365 m² e 217,85 m² construídos.

- **Altura estimada.** Pavimentos ≈ área construída do lote ÷ área de projeção do prédio no OSM, e altura ≈
  pavimentos × 3 m. Para prédios de apartamentos o erro é pequeno, porque a área construída inclui todos os andares.
  Para casas com edícula ou lotes com vários prédios é preciso dividir a área entre os prédios do lote.
- **Terrenos de verdade.** `baldio = Sim` marca os lotes vagos. Os terrenos à venda poderiam ser desenhados no lote
  real, em vez dos retângulos gerados hoje.
- **Endereço.** Rua e número por lote resolvem a geocodificação, que hoje usa o Nominatim e falhou no caso do Aman.

### 2. Levantamento a laser (LiDAR) da Prefeitura

A Prefeitura contratou levantamentos com perfilamento a laser:

- **2007**, perímetro urbano: 4 pontos/m², ortofotos de 7 cm e restituição 1:1.000;
- **2010**, município inteiro: 1 ponto/m².

O servidor publica ortofotos (`ortofoto_2007`, `ortofoto_2010`), curvas de nível e pontos cotados de 2007 e 2010
(`SEPUR/curva_nivel_*`, `SEPUR/topografia_simgeo_v4`). **Não encontrei a nuvem de pontos nem o modelo de superfície
(MDS) publicados.** Altura de prédio = MDS − terreno, então seria preciso **pedir os arquivos à SEPUR.UGP**. São
dados de 2007 e 2010: mostram bem o tecido da cidade, mas não os prédios novos.

### 3. Modelo de superfície do Estado (SIGSC)

O levantamento aerofotogramétrico de Santa Catarina (2010–2012) gerou MDS e MDT com resolução de 1 m, em GeoTIFF,
com download gratuito na plataforma [SIGSC](https://sigsc2.ciasc.sc.gov.br/) (o portal estava lento no teste;
contato geoprocessamento@sde.sc.gov.br). Dá para calcular a altura de **todos** os contornos do OSM de uma vez: a
média de (MDS − MDT) dentro de cada contorno. Mesma limitação de data: não tem os prédios depois de 2012.

### Prédios novos

- **`SEPUR/outorga_onerosa_do_direito_de_construir_oodc_sepur`**: 51 lotes na região com outorga para construir acima
  do básico, com o campo `altura` (por exemplo 25, 30 ou 45 m). É exatamente o grupo de torres novas que os
  levantamentos antigos não têm.
- **`SEPUR/estudos_de_Impacto_de_vizinhança_eiv_sepur`**: 98 Estudos de Impacto de Vizinhança na região, com
  empreendedor (por exemplo "RÔGGA S.A. CONSTRUTORA E INCORPORADORA"), uso (residencial, comercial…), área do
  empreendimento, população estimada, situação (aprovado, arquivado) e link do processo. É uma **lista de lançamentos
  futuros** antes mesmo da divulgação comercial, útil tanto para o mapa quanto para prospectar incorporadoras como
  clientes.

**Caminho recomendado:** cadastro (1) para a altura de todos os prédios agora, OODC para as torres novas, e o MDS do
Estado (3) para conferir. O LiDAR municipal (2) entra quando houver contato com a Prefeitura.

## Outras camadas que valorizam o produto

| Camada | Conteúdo | Uso no produto |
|---|---|---|
| `simgeo/defesa_civil` | Manchas de inundação: modelo atual, futuro e por tempo de retorno (5, 10, 25 e 50 anos), do PDDU | Camada "risco de alagamento" e aviso na ficha do imóvel (4 manchas do modelo atual tocam a região) |
| `SEPUR/curva_nivel_2010_1_1000_sepur`, pontos cotados | Relevo 1:1.000 | Cota do terreno ("este lote está 2 m acima da rua") |
| `simgeo/zoneamento_470_2017`, `SEPUR/macrozoneamento_sepur` | Zoneamento (LC 470/2017) | O que pode ser construído no terreno (gabarito, uso) |
| `simgeo/lotes`, `SEFAZ/lotes_urbanos_sefaz` | Contorno dos lotes, quadra e lote | Desenhar o lote do imóvel |
| `SEPUR/limite_de_bairros_sepur` | Limites oficiais de bairro | Conferir os limites do OSM |
| `SEPUR/equipamento_publicos_2026_*` | Escolas, saúde, lazer, cultura | Tempo a pé até serviços |
| `base_geo/Pontos_de_ônibus`, rotas de transporte | Transporte coletivo | Filtro "perto de ônibus" |
| `simgeo/censo`, `SEPUR/ibge_rendimento_medio_*` | Dados do IBGE por setor e bairro | Perfil do bairro |
| `ortofoto_2007`, `ortofoto_2010`, `simgeo/orbital_2022` | Imagens aéreas e de satélite | Fundo de imagem opcional |

## Fontes

- [Downloads do SIMGeo](https://www.joinville.sc.gov.br/publicacoes/downloads-sistema-de-informacoes-municipais-georreferenciadas-simgeo/)
- [Orientações de uso do SIMGeo (07/2026)](https://www.joinville.sc.gov.br/wp-content/uploads/2026/07/Orientacoes-de-Uso-do-SimGeo-atualizado-em-09072026.pdf)
- [Unidade de Geoprocessamento](https://www.joinville.sc.gov.br/institucional/sepur/ugp/)
- [Levantamentos de 2007 e 2010 (apresentação da Prefeitura, MundoGEO Connect 2011)](https://mundogeoconnect.com/2011/arquivos/palestras/celso_voos_vieira-produtos_cartograficos_e_gerenciamento_de_bases_geoespaciais_na_gestao_municipal.pdf)
- [Nota explicativa do aerolevantamento de SC (SIGSC)](https://sigsc2.ciasc.sc.gov.br/3_Nota_Explicativa_Metodologia%20de%20Consolidacao_do_Aerolavantamento-SC_v1.pdf)
- [Importação do SIMGeo no OpenStreetMap (wiki)](https://wiki.openstreetmap.org/wiki/Pt:Joinville/ImportSIMGeo)
- Servidor ArcGIS da Prefeitura: `https://geo.joinville.sc.gov.br/server/rest/services`
