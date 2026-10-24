# Mapa base no armazenamento de objetos

O mapa base são quatro arquivos, `public/data/joinville.pmtiles` (~15 MB), `joinville-detalhe.pmtiles` (~1,2 MB),
`joinville-arvores.pmtiles` (~1,6 MB) e `joinville-telhados.pmtiles` (~1,9 MB), regenerados todo mês pelo workflow
"Mapa mensal". Guardados no git, eles fazem o repositório crescer ~20 MB por mês.
Por isso podem ir para o bucket público `map-tiles` do Supabase, com **nome por versão**:

```
joinville-2026-11-88bad5962e.pmtiles          (região, mês do OSM, 10 primeiros dígitos do SHA-256)
joinville-detalhe-2026-11-1afbdd0f30.pmtiles
joinville-arvores-2026-11-5c03e9b7a1.pmtiles
joinville-telhados-2026-11-0e4f2b8c97.pmtiles
```

Um nome publicado nunca muda de conteúdo: o arquivo é enviado com `cache-control: max-age=31536000` e o navegador ou
a CDN podem guardá-lo para sempre. O mês anterior continua no bucket, para comparação e para voltar atrás (basta
restaurar o `meta.json` antigo). O `meta.json` passa a ter a URL completa em `tiles`, `detailTiles`, `treeTiles` e `roofTiles`; o app, a CSP
(`scripts/lib/csp.mjs`) e os scripts de dados aceitam isso.

## Como ligar

1. Aplique as migrações no Supabase de produção (`20261031000001_map_tiles.sql` cria o bucket; só a chave de
   serviço escreve nele).
2. No GitHub: Settings → Secrets and variables → Actions → crie `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
3. Rode o workflow "Mapa mensal" (Actions → Mapa mensal → Run workflow). Com os segredos, o passo "Envia o mapa
   para o armazenamento" roda `npm run tiles:upload` e o PR leva só o `meta.json` (e o relatório).
4. Depois do merge desse primeiro PR, tire os arquivos do repositório (eles continuam no disco de quem tem o clone):

   ```sh
   git rm --cached public/data/*.pmtiles
   printf '\n# mapa base: no bucket map-tiles (docs/mapa-no-armazenamento.md)\npublic/data/*.pmtiles\n' >> .gitignore
   git commit -m "Mapa base fora do git"
   ```

5. Opcional: apagar os meses antigos do histórico (`git filter-repo --path-glob 'public/data/*.pmtiles'
   --invert-paths`) reescreve todo o histórico e obriga todos a clonar de novo; só vale se o tamanho do clone
   incomodar.

Sem os segredos nada muda: os `.pmtiles` continuam entrando no PR mensal.

## Para quem roda os scripts

- `npm run tiles:upload -- --dry-run` mostra os nomes sem enviar; `-- --local` envia ao Supabase local
  (`npx supabase start`).
- Quem precisa do arquivo local (`npm run import:xml`, o relatório do mapa mensal) usa
  `scripts/lib/local-tiles.mjs`: com uma URL no `meta.json`, ele baixa o arquivo para `public/data/` uma vez (se o
  arquivo local tiver outro conteúdo). `node scripts/lib/local-tiles.mjs` imprime o caminho.
- O build e os testes e2e servem o `meta.json` como está: com as URLs, o mapa é lido do bucket.

## O que o bucket precisa aceitar

- **Range:** o PMTiles é lido por intervalos (`Range: bytes=…`, resposta 206). O Storage do Supabase aceita.
- **CORS:** o Storage responde `Access-Control-Allow-Origin: *` nos objetos públicos.
- **Tamanho:** o bucket aceita até 50 MB por arquivo (o mapa de Joinville tem 15 MB).

Testado em 17/10 com o Supabase local: envio, segunda execução sem reenviar (mesmo conteúdo, mesmo nome), 206 com
`Range`, CORS e o mapa carregando 441 prédios a partir das URLs, sem erros no console.

Trocar para Cloudflare R2 (não cobra tráfego de saída) é trocar o destino do envio no `scripts/upload-tiles.mjs`;
o `meta.json`, o app e a CSP já aceitam qualquer URL.

*Anotado por Claude (assistente de IA), 17/10/2026.*
