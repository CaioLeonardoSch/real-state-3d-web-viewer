# Preparar outra cidade

**Feito em 17/10:** a região deixou de estar fixa no código. Tudo que diz qual cidade é sai de
`scripts/data/region.json`, lido pelo pipeline de dados (`scripts/lib/region.mjs`) e pelo app
(`src/config/region.ts`): títulos ("Imóveis em …"), cidade padrão do cadastro de imóvel, nome do site nas páginas
geradas, fuso da iluminação e crédito do cadastro no mapa.

## 1. `scripts/data/region.json`

| Campo | Para que serve |
|---|---|
| `id` | Nome do arquivo de mapa (`public/data/<id>.pmtiles`) e da região em `meta.json`. Só letras minúsculas, números e hífen. |
| `name` | Nome da região inteira, como aparece no mapa ("Joinville e Araquari"). |
| `city` | Cidade principal: títulos do site, cidade padrão dos formulários, "<cidade> e região" nas páginas dos imóveis. |
| `uf` | Sigla do estado (dados estruturados das páginas). |
| `utcOffset` | Fuso fixo da iluminação (`-03:00` para quase todo o Brasil, `-04:00` no Amazonas, Mato Grosso etc.). |
| `municipios` | Municípios do OSM (`admin_level=8`) cuja união é o limite da região. |
| `osmExtract` | Endereço do extrato `.osm.pbf` do estado (Geofabrik ou openstreetmap.fr). |
| `cadastre` | Cadastro da prefeitura para as alturas: `{source, label, url}`, ou `null` sem cadastro. |
| `maxFloors` | Teto de pavimentos aceitos do cadastro (descarta lotes com área absurda). |

## 2. Rodar o pipeline

```bash
npm run data:download   # baixa o extrato do estado para .cache/osm-pbf/
npm run data:region     # recorta os municípios, gera bairros, ruas, lugares e meta.json
npm run data:cadastre   # só faz algo quando há cadastro suportado
npm run data:heights    # idem; sem cadastro grava {} e as alturas vêm do OSM
npm run data:tiles      # gera public/data/<id>.pmtiles
```

O workflow mensal (`.github/workflows/mapa-mensal.yml`) lê o nome do `.pmtiles` de `public/data/meta.json`, então
serve para qualquer região sem mudança.

## 3. Alturas sem cadastro

Só o cadastro de Joinville (SIMGeo) tem leitor (`source: "joinville-simgeo"`, lista em
`CADASTRE_SOURCES` de `scripts/lib/region.mjs`). Em outra cidade, com `cadastre: null`, a altura de cada prédio vem
das marcações do OSM (`height`, `building:levels`) ou é 6 m. O mapa funciona, mas a maioria dos prédios fica baixa.
Para ter alturas boas, escreva um baixador para o cadastro da nova prefeitura em `scripts/download-cadastre.mjs`,
acrescente o `source` em `CADASTRE_SOURCES` e confira `scripts/lib/cadastre-floors.mjs` (área construída por lote ÷
área do prédio). `docs/dados-prefeitura.md` mostra como foi feito para Joinville.

## 4. O que continua sendo de Joinville

- **Imóveis e empreendimentos de demonstração** (`scripts/data/developments.mjs`, `public/data/listings.json`,
  `developments.json`, `sites.json`): têm endereços e bairros de Joinville. Gere de novo com `npm run data:listings`
  e `data:developments` (os bairros vêm da nova região, os empreendimentos precisam ser reescritos) ou desligue a
  demonstração com `VITE_DEMO_LISTINGS=false`.
- **Fuso do banco:** as estatísticas diárias (`listing_stats`) contam o dia em `America/Sao_Paulo`. Para uma
  região em outro fuso, troque nas migrações.
- **Textos do README e da documentação**, que descrevem a demonstração de Joinville.
