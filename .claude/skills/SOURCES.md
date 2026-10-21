# Origem das skills

Skills de terceiros copiadas para cá depois de lidas por inteiro (instruções, referências e scripts).
Cada pasta traz a licença do projeto de origem. Para atualizar, copie de novo do commit novo e leia a
diferença antes do commit: nada aqui é buscado da internet na hora do uso.

| Skills | Origem | Commit | Licença |
| --- | --- | --- | --- |
| `frontend-design`, `webapp-testing` | [anthropics/skills](https://github.com/anthropics/skills) | `dbd4588` | Apache 2.0 (`LICENSE.txt` em cada pasta) |
| `maplibre-tile-sources`, `maplibre-pmtiles-patterns`, `maplibre-source-wiring`, `maplibre-cartography`, `maplibre-fonts-glyphs`, `maplibre-sprites-icons` | [maplibre/maplibre-agent-skills](https://github.com/maplibre/maplibre-agent-skills) | `160418d` | MIT |
| `web-quality-audit`, `performance`, `core-web-vitals`, `accessibility`, `seo`, `best-practices` | [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills) | `afa8da9` | MIT |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) (`063bee9`) com as regras de [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) (`434b7f9`) | — | MIT |
| `cro`, `copywriting`, `pricing`, `schema`, `programmatic-seo` | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | `e85f3cb` | MIT |

## O que mudou em relação à origem

- `web-design-guidelines`: a original baixa as regras de uma URL a cada uso. Aqui elas ficam fixas em
  `guidelines.md`, e o `SKILL.md` ganhou notas para este projeto (TypeScript sem React, textos em
  português).
- Skills de marketing: sem a pasta `evals/` (testes da própria skill, que o Claude não usa).
- As skills do MapLibre e de marketing citam outras skills do mesmo pacote que não foram copiadas
  (por exemplo `maplibre-terrain-rendering`, `seo-audit`, `ai-seo`). Esses links não abrem aqui.
- `cro`, `copywriting`, `pricing`, `schema` e `programmatic-seo` leem `.agents/product-marketing.md`
  quando ele existe. Vale criar esse arquivo com o público, o posicionamento e a prova social do
  produto, para não responder às mesmas perguntas em toda sessão.
