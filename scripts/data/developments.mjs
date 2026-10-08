// Developments shown with their units ("espelho de vendas 3D"). Input of scripts/generate-developments.mjs.
//
// What is PUBLIC (from the developers' sites and the press, consulted on 2026-10-08) is listed in `facts`
// and `sources`. Everything else — how units are stacked per floor, which plan sits where, the footprint
// of the tower, prices and availability — is an ESTIMATE for the demo and listed in `estimates`.
// Prices and availability are always fictional.
//
// Locations: geocoded with Nominatim (house number) on 2026-10-08, except Aman (see below).

/** Typical floor helper: the same units on every floor from `from` to `to`. */
const tipo = (from, to, units) => ({ use: 'residential', from, to, units });

export const DEVELOPMENTS = [
  {
    id: 'cora',
    name: 'Cora',
    developer: 'Halsten',
    street: 'Rua Benjamin Constant',
    address: 'Rua Benjamin Constant, 975 – América',
    location: [-48.8588289, -26.2849758],
    locationNote: 'Nominatim, nº 975',
    stage: 'construction',
    delivery: '08/2028',
    floorHeightM: 3.0,
    pricePerM2: 11000,
    grid: { cols: 3, rows: 2 },
    facts: [
      'Rua Benjamin Constant, 975, América',
      'Em obras: 38% em agosto/2026; entrega prevista 08/2028 (Halsten)',
      'Plantas de 65 a 146 m², do 5º ao 19º pavimento',
      'Apto A 65,94 m² · Apto D (final 2) 146,12 m²',
      '1 a 3 suítes · 1 a 2 vagas · 3 elevadores sociais',
    ],
    estimates: ['6 unidades por andar', 'distribuição das plantas por final', 'térreo, 3 garagens e lazer no 4º', 'formato e posição da torre'],
    sources: [
      { label: 'Halsten – Cora', url: 'https://halsten.com.br/en/empreendimentos/cora/' },
      { label: 'Apto.vc – Cora', url: 'https://apto.vc/br/sc/joinville/america/cora' },
    ],
    levels: [
      { use: 'lobby', from: 0, to: 0 },
      { use: 'garage', from: 1, to: 3 },
      { use: 'leisure', from: 4, to: 4 },
      tipo(5, 19, [
        { final: 1, plan: 'Apto C', cells: [0], areaM2: 86.11, bedrooms: 3, suites: 1, parking: 2 },
        { final: 2, plan: 'Apto D', cells: [1], areaM2: 146.12, bedrooms: 3, suites: 3, parking: 2 },
        { final: 3, plan: 'Apto A', cells: [2], areaM2: 65.94, bedrooms: 2, suites: 1, parking: 1 },
        { final: 4, plan: 'Apto B', cells: [3], areaM2: 69.0, bedrooms: 2, suites: 1, parking: 1 },
        { final: 5, plan: 'Apto C', cells: [4], areaM2: 86.11, bedrooms: 3, suites: 1, parking: 2 },
        { final: 6, plan: 'Apto A', cells: [5], areaM2: 65.94, bedrooms: 2, suites: 1, parking: 1 },
      ]),
    ],
  },
  {
    id: 'morada-de-gaia',
    name: 'Morada de Gaia',
    developer: 'Halsten',
    street: 'Rua XV de Novembro',
    address: 'Rua XV de Novembro, 1208 – América',
    location: [-48.8538518, -26.2983854],
    locationNote: 'Nominatim, nº 1208',
    stage: 'ready',
    delivery: 'entregue em 2025',
    floorHeightM: 3.0,
    pricePerM2: 11800,
    grid: { cols: 2, rows: 2 },
    facts: [
      'Rua XV de Novembro, 1208, América',
      'Obra concluída (100% em setembro/2025)',
      'Plantas de 78,90 a 140,72 m², mais de 15 variações',
      '1 suíte + 2 dormitórios a 3 suítes · 1 a 2 vagas',
    ],
    estimates: ['número de andares (14 residenciais)', '4 unidades por andar', 'distribuição das plantas', 'formato e posição da torre'],
    sources: [
      { label: 'Halsten – Morada de Gaia', url: 'https://halsten.com.br/en/empreendimentos/morada-de-gaia/' },
      { label: 'Apto.vc – Morada de Gaia', url: 'https://apto.vc/br/sc/joinville/america/morada-de-gaia' },
    ],
    levels: [
      { use: 'lobby', from: 0, to: 0 },
      { use: 'garage', from: 1, to: 2 },
      { use: 'leisure', from: 3, to: 3 },
      tipo(4, 17, [
        { final: 1, plan: '3 suítes', cells: [0], areaM2: 140.72, bedrooms: 3, suites: 3, parking: 2 },
        { final: 2, plan: '2 suítes + 1', cells: [1], areaM2: 112.4, bedrooms: 3, suites: 2, parking: 2 },
        { final: 3, plan: '1 suíte + 2', cells: [2], areaM2: 78.9, bedrooms: 3, suites: 1, parking: 1 },
        { final: 4, plan: '1 suíte + 2', cells: [3], areaM2: 84.6, bedrooms: 3, suites: 1, parking: 1 },
      ]),
    ],
  },
  {
    id: 'landhaus',
    name: 'Landhaus',
    developer: 'Plaenge',
    street: 'Rua Visconde de Mauá',
    address: 'Rua Visconde de Mauá, 1297 (esquina com a Gen. Andrade Neves) – América',
    location: [-48.8551368, -26.2807276],
    locationNote: 'Nominatim, nº 1297',
    stage: 'construction',
    delivery: '04/2027',
    floorHeightM: 3.15,
    pricePerM2: 13200,
    grid: { cols: 2, rows: 2 },
    expectedUnits: 59,
    facts: [
      'Rua Visconde de Mauá, 1297, esquina com a Rua General Andrade Neves, América',
      'Em obras; conclusão prevista para abril/2027 (Plaenge)',
      '59 apartamentos',
      'Finais 01 (169,8 m²), 02 (174,9 m²), 03 (147,74 m²) e 04 (159,98 m²), 3 suítes; cobertura de 385,2 m² com 4 suítes',
      'Pé-direito de piso a piso 3,15 m · 2 a 4 vagas · 3 elevadores',
    ],
    estimates: ['14 andares-tipo com 4 unidades e cobertura no 17º', 'térreo e 2 garagens', 'formato e posição da torre'],
    sources: [
      { label: 'Plaenge – Landhaus Joinville', url: 'https://www.plaenge.com.br/joinville/landhaus-joinville' },
      { label: 'Anagê – Landhaus', url: 'https://lancamentos.anageimoveis.com.br/lancamento/landhaus/' },
      { label: 'Plaenge: 59 apartamentos (Acontecendo Aqui)', url: 'https://acontecendoaqui.com.br/?p=253488' },
    ],
    levels: [
      { use: 'lobby', from: 0, to: 0 },
      { use: 'garage', from: 1, to: 2 },
      tipo(3, 16, [
        { final: 1, plan: 'Final 01', cells: [0], areaM2: 169.8, bedrooms: 3, suites: 3, parking: 3 },
        { final: 2, plan: 'Final 02', cells: [1], areaM2: 174.9, bedrooms: 3, suites: 3, parking: 3 },
        { final: 3, plan: 'Final 03', cells: [2], areaM2: 147.74, bedrooms: 3, suites: 3, parking: 2 },
        { final: 4, plan: 'Final 04', cells: [3], areaM2: 159.98, bedrooms: 3, suites: 3, parking: 3 },
      ]),
      tipo(17, 17, [
        { final: 1, plan: 'Cobertura', cells: [0, 1], areaM2: 385.2, bedrooms: 4, suites: 4, parking: 4 },
        { final: 3, plan: 'Final 03', cells: [2], areaM2: 147.74, bedrooms: 3, suites: 3, parking: 2 },
        { final: 4, plan: 'Final 04', cells: [3], areaM2: 159.98, bedrooms: 3, suites: 3, parking: 3 },
      ]),
    ],
  },
  {
    id: 'aman',
    name: 'Aman',
    developer: 'Plaenge',
    street: 'Rua Benjamin Constant',
    address: 'Rua Benjamin Constant, 915 – América',
    // Nominatim has no nº 915: interpolated between nº 900 and nº 975 on the same street.
    location: [-48.8572772, -26.2843169],
    locationNote: 'interpolado entre os nºs 900 e 975 (Nominatim)',
    stage: 'launch',
    delivery: '03/2029',
    floorHeightM: 3.15,
    pricePerM2: 13800,
    grid: { cols: 2, rows: 2 },
    expectedUnits: 67,
    facts: [
      'Rua Benjamin Constant, 915 (a Plaenge situa no América; o site cita Glória)',
      'Lançamento; conclusão prevista para março/2029 (Plaenge)',
      'Torre única de 20 andares, 67 apartamentos, 3 pavimentos de garagem',
      'Plantas de 135 a 320 m², 2 a 4 suítes; Final 01 com 157 m² e 3 suítes',
      'Tipologias: Finais 01–04, Garden 02 e 03, Duplex, Penthouse 01 e 02',
    ],
    estimates: ['posição de cada tipologia por andar', 'áreas das plantas além da Final 01', 'formato e posição da torre'],
    sources: [
      { label: 'Plaenge – Aman', url: 'https://www.plaenge.com.br/joinville/aman' },
      { label: 'Grupo Amanhã – lançamento do Aman', url: 'https://amanha.com.br/categoria/negocios-do-sul1/plaenge-anuncia-quarto-lancamento-da-marca-em-joinville' },
      { label: 'Plaenge: 67 apartamentos (Acontecendo Aqui)', url: 'https://acontecendoaqui.com.br/?p=253488' },
    ],
    levels: [
      { use: 'garage', from: 0, to: 2 },
      tipo(3, 3, [
        { final: 1, plan: 'Final 01', cells: [0], areaM2: 157, bedrooms: 3, suites: 3, parking: 3 },
        { final: 2, plan: 'Garden 02', cells: [1], areaM2: 248, bedrooms: 3, suites: 3, parking: 3 },
        { final: 3, plan: 'Garden 03', cells: [2], areaM2: 236, bedrooms: 3, suites: 3, parking: 3 },
        { final: 4, plan: 'Final 04', cells: [3], areaM2: 162, bedrooms: 3, suites: 3, parking: 3 },
      ]),
      tipo(4, 18, [
        { final: 1, plan: 'Final 01', cells: [0], areaM2: 157, bedrooms: 3, suites: 3, parking: 3 },
        { final: 2, plan: 'Final 02', cells: [1], areaM2: 135, bedrooms: 3, suites: 2, parking: 2 },
        { final: 3, plan: 'Final 03', cells: [2], areaM2: 138, bedrooms: 3, suites: 2, parking: 2 },
        { final: 4, plan: 'Final 04', cells: [3], areaM2: 162, bedrooms: 3, suites: 3, parking: 3 },
      ]),
      tipo(19, 19, [
        { final: 1, plan: 'Penthouse 01', cells: [0], areaM2: 320, bedrooms: 4, suites: 4, parking: 4 },
        { final: 2, plan: 'Penthouse 02', cells: [1], areaM2: 305, bedrooms: 4, suites: 4, parking: 4 },
        { final: 3, plan: 'Duplex', cells: [2, 3], areaM2: 290, bedrooms: 4, suites: 4, parking: 4 },
      ]),
    ],
  },
  {
    id: 'hausgarten',
    name: 'Hausgarten',
    developer: 'Plaenge',
    street: 'Rua Jaraguá',
    address: 'Rua Jaraguá, 798 – América',
    location: [-48.8531827, -26.2915343],
    locationNote: 'Nominatim, nº 798',
    stage: 'launch',
    delivery: 'a definir',
    floorHeightM: 3.15,
    pricePerM2: 13500,
    grid: { cols: 2, rows: 2 },
    expectedUnits: 70,
    facts: [
      'Rua Jaraguá, 798, América',
      'Lançamento (Plaenge); VGV de R$ 160 milhões',
      '70 apartamentos de 154 a 197 m², 3 suítes',
      'Tipologias: Finais 1–4, Garden 1 e 2, Penthouse 1 e 2; Final 1 com 154 m²',
    ],
    estimates: ['18 andares residenciais', 'posição de cada tipologia por andar', 'áreas além da Final 1', 'formato e posição da torre'],
    sources: [
      { label: 'Plaenge – Hausgarten', url: 'https://www.plaenge.com.br/joinville/hausgarten' },
      {
        label: 'SC Real – Hausgarten',
        url: 'https://www.screal.tv.br/noticia/27814/sc-real-construcao-amp-mercado/novo-projeto-da-plaenge-tem-forte-presenca-do-verde-e-inspiracao-no-bem-estar.html',
      },
    ],
    levels: [
      { use: 'lobby', from: 0, to: 0 },
      { use: 'garage', from: 1, to: 2 },
      tipo(3, 3, [
        { final: 1, plan: 'Garden 1', cells: [0], areaM2: 197, bedrooms: 3, suites: 3, parking: 3 },
        { final: 2, plan: 'Garden 2', cells: [1], areaM2: 197, bedrooms: 3, suites: 3, parking: 3 },
        { final: 3, plan: 'Final 3', cells: [2], areaM2: 165, bedrooms: 3, suites: 3, parking: 2 },
        { final: 4, plan: 'Final 4', cells: [3], areaM2: 170, bedrooms: 3, suites: 3, parking: 3 },
      ]),
      tipo(4, 19, [
        { final: 1, plan: 'Final 1', cells: [0], areaM2: 154, bedrooms: 3, suites: 3, parking: 2 },
        { final: 2, plan: 'Final 2', cells: [1], areaM2: 158, bedrooms: 3, suites: 3, parking: 2 },
        { final: 3, plan: 'Final 3', cells: [2], areaM2: 165, bedrooms: 3, suites: 3, parking: 2 },
        { final: 4, plan: 'Final 4', cells: [3], areaM2: 170, bedrooms: 3, suites: 3, parking: 3 },
      ]),
      tipo(20, 20, [
        { final: 1, plan: 'Penthouse 1', cells: [0, 1], areaM2: 197, bedrooms: 3, suites: 3, parking: 3 },
        { final: 3, plan: 'Penthouse 2', cells: [2, 3], areaM2: 197, bedrooms: 3, suites: 3, parking: 3 },
      ]),
    ],
  },
];
