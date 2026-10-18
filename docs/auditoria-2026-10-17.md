# Auditoria técnica, funcional e estratégica (17/10/2026)

Auditoria somente leitura sobre o commit `e632054` (nomes das ruas no mapa e busca por rua). Complementa
[`avaliacao-2026-10.md`](avaliacao-2026-10.md): aqui ficam os achados novos e as conferências feitas no código. A
lista única do que falta fazer, com a ordem de prioridade, está em [`prioridades.md`](prioridades.md).

**O que foi feito:** leitura do código, das migrations, das edge functions, dos testes e da documentação;
`npm audit --package-lock-only` (0 vulnerabilidades conhecidas, produção e desenvolvimento); requisições GET à
demonstração pública.

**O que não foi feito:** testes, build, Lighthouse e Playwright não rodaram (sem `node_modules`, e instalar estava fora
do escopo); o Supabase não foi iniciado. Os números de desempenho citados vêm da avaliação de outubro, não de medição
própria.

## Veredito

- **Protótipo avançado, com engenharia de produto** no mapa, nas regras do banco e no white label. Ainda não é um
  produto comercial confiável.
- O que separa o projeto de um piloto pago não é o 3D, e sim o básico de um portal com dados reais:
  1. carregar e buscar anúncios no servidor, sem truncar;
  2. não mostrar conteúdo inventado em anúncios reais;
  3. fechar os poucos furos de autorização e privacidade;
  4. LGPD;
  5. hospedagem com vários domínios e monitoramento.
- A arquitetura é boa e deve ser preservada; nenhum desses itens pede reescrever o projeto.

## O que preservar

- **PMTiles estáticos lidos por partes:** sem servidor de mapas, custo quase nulo por visitante.
- **Regras críticas no banco:**
  - `listings_price_rules` impede forjar o preço anterior, sorteia o centro aproximado no servidor e anula a
    exclusividade não conferida;
  - `leads_update_rules` impede o corretor de mudar os dados do visitante;
  - `organizations_update_rules` impede o cliente de trocar slug e domínio.
- **RLS consistente:** funções `security definer set search_path = ''`, view pública separada da view do cliente,
  segundo fator exigido para o papel valer (`mfa_satisfied`), 38 testes de banco.
- **White label como dados validados** (`normalizeSiteConfig`, `safeImage` sem SVG), `escapeHtml` aplicado de forma
  sistemática e CSP gerada no build.
- **Servidor de páginas** agnóstico de hospedagem (`src/seo/siteServer.ts`), com 301 pelo código do anúncio e 404
  com `noindex`.
- **Pipeline de dados determinístico** e PR mensal com relatório antes de publicar o mapa.
- **Estado da interface previsível:** filtros pendente × aplicado, URL normalizada, histórico coerente com o painel.

## Achados

Cada achado: categoria · gravidade · confiança · esforço. O item correspondente em `prioridades.md` aparece entre
colchetes.

### A1. O mapa carrega todos os anúncios da plataforma, e as fotos são truncadas em 1.000 linhas [prioridade 5]

Arquitetura e dados · **crítica com backend** · alta · médio a grande.

- **Onde:** `src/backend/remote.ts:374` (`loadListings`) e `:360` (`photosFor`); `supabase/config.toml:18`
  (`max_rows = 1000`, também o padrão do Supabase hospedado); `src/main.ts:106-116` (`ofSite`).
- **O que acontece:**
  - `public_listings` é lida inteira, sem paginação;
  - as fotos vêm numa segunda consulta, `.in('listing_id', ids)` com todos os ids na URL;
  - o PostgREST corta cada resposta em 1.000 linhas sem erro: com ~10 fotos por anúncio, fotos começam a sumir a
    partir de ~100 anúncios, e anúncios somem acima de 1.000;
  - a URL com centenas de UUIDs tende a passar do limite de tamanho (hipótese, não medida);
  - o mapa embutido no site de uma imobiliária baixa a plataforma inteira e filtra no navegador, então pode faltar
    justamente o anúncio daquele cliente.
- **Nota:** o item I9 da avaliação vale para o site (que usa `site_bootstrap`), não para o mapa.
- **Recomendação:**
  - uma função de busca no banco com os filtros e paginação, devolvendo o resultado já agregado, como
    `site_bootstrap`;
  - para o mapa, um resumo leve (id, ponto ou contorno, preço, tipo) e o anúncio completo só ao abrir a ficha;
  - aproveitar `listings_in_bbox`, que existe no banco e não é usada;
  - o embed filtrado por `org_id` no servidor.
- **Pronto quando:** um teste de backend com 2.000 anúncios × 10 fotos recebe todas as fotos, e o mapa abre com
  5.000 anúncios baixando só o resumo.
- **Feito em 17/10, com resumo e ficha sob demanda** (`supabase/migrations/20261025000001_map_listings.sql`):
  - `map_listings(p_org)` devolve num JSON só (não cortado) o resumo de cada anúncio publicado: tudo o que mapa,
    lista, dica e filtros usam, mais o nome do cliente e a capa (miniatura), sem descrição, vídeo, tour e anunciante;
    `p_org` filtra o embed de um cliente no servidor;
  - `my_map_listings()` faz o mesmo com os anúncios dos clientes de quem entrou (rascunhos e local exato);
  - ao abrir a ficha, `listingDetail` lê o anúncio e todas as suas fotos (e o histórico de preço, se for seu); a
    ficha mostra "Carregando fotos e detalhes…" e, se outro anúncio for aberto antes, a resposta antiga é ignorada;
  - `tests/backend/volume.test.ts`: 5.000 anúncios, 2.000 com 10 fotos; a consulta comum para em 1.000 e o resumo
    traz os 5.000, com a capa certa, em ~0,6 s; as 10 fotos vêm ao abrir; o resumo tem ~780 bytes por anúncio
    (3,9 MB para 5.000, ~250 KB com gzip). `verify:backend` passou com esses 5.000 anúncios no banco.
  - **Fica para depois:** os filtros continuam no navegador (o mapa acinzenta o que não bate, então precisa de todos
    os resumos), e `listings_in_bbox` segue sem uso. Bem acima de 5.000 anúncios, o próximo passo é carregar o
    resumo por área do mapa.

### A2. O build de produção mostra conteúdo fictício em anúncios reais [prioridade 2]

Interface, negócio e jurídico · alta · alta · pequeno.

- **Onde:** `src/ui/drawer.ts:310-330`.
- **O que acontece:**
  - sem planta enviada, a ficha mostra a planta gerada, com "Planta ilustrativa (não corresponde ao imóvel real)";
  - em venda, mostra a "Simulação ilustrativa" de 120 parcelas sem juros;
  - nenhum dos dois depende de `DEMO`.
- **Impacto:** informação enganosa para o consumidor e perda de credibilidade da imobiliária.
- **Recomendação:** em produção, sem planta não mostrar planta; trocar a simulação por um link de simulação real ou
  retirá-la.
- **Pronto quando:** o build com `VITE_DEMO_LISTINGS=false` não tem "ilustrativa" na ficha.
- **Feito em 17/10:** a planta gerada e a simulação só aparecem com `DEMO`; o build de produção não tem esses textos.
  Depois (item 27), a simulação sem juros deu lugar a uma simulação de financiamento real (SAC e Price, juros,
  FGTS), em produção também, com o aviso de que é estimativa.

### A3. O convite depende de "Confirm email" estar ligado [prioridade 1]

Segurança · alta se a configuração estiver errada · média · pequeno.

- **Onde:** `supabase/migrations/20261012000001_staff_invites_audit.sql:172` (`my_invitations`) e `:183`
  (`accept_invitation`); `supabase/config.toml:230` (`enable_confirmations = false` no ambiente local).
- **O que acontece:** `my_invitations` devolve o código dos convites cujo e-mail é o da conta logada, e
  `accept_invitation` só compara o e-mail. Nenhuma das duas confere `auth.users.email_confirmed_at`.
- **Risco:** com a confirmação desligada, qualquer pessoa cria uma conta com o e-mail convidado, vê o código e entra
  na imobiliária, inclusive como dona. O `docs/supabase.md` manda ligar a confirmação, mas a segurança não deveria
  depender só disso. **Não conferido** no projeto real.
- **Recomendação:** exigir e-mail confirmado nas duas funções e cobrir com um teste em `tests/backend/rls.test.ts`.
- **Feito em 17/10, de outro jeito:** no Supabase local, com a confirmação desligada, o próprio cadastro já marca o
  e-mail como confirmado. Exigir `email_confirmed_at` não fecharia o furo. A migration
  `20261024000001_invite_link_only.sql` tira o código de `my_invitations`: a conta vê para qual imobiliária e com qual
  papel foi convidada, mas só aceita com o link enviado por quem convidou. `accept_invitation` também recusa e-mail
  não confirmado, para contas criadas sem confirmação. Teste em `rls.test.ts`.

### A4. LGPD incompleta [prioridade 6]

Já registrado como B2 na avaliação. Conferido no código: o texto de consentimento é montado no navegador
(`drawer.ts:395`) e gravado como veio, sem versão, por `submit_lead`. Falta também política de privacidade e prazo de
retenção.

### A5. Hospedagem com vários domínios e operação mínima [prioridades 8 e 9]

Já registrado como B3. O adaptador da Cloudflare existe, mas o site ainda sai pelo GitHub Pages, que não lê o
`_headers`. Sem monitoramento, homologação nem e2e no CI.

### A6. Só quatro tipos de imóvel [prioridade 11]

Negócio e dados · alta · alta · médio.

- O enum `listing_type` tem apartamento, casa, geminado e terreno.
- `mapPropertyType` (`src/import/vrsync.ts:84`) descarta o resto como "tipo não suportado".
- Cobertura, sala, loja, galpão, chácara e kitnet ficam fora, e a importação XML de uma imobiliária real perde parte
  do estoque.
- **Recomendação:** ampliar o enum seguindo o VRSync; o mapa usa só o ponto e o contorno, então o tipo é rótulo.
- **Feito em 17/10** (`supabase/migrations/20261026000001_more_listing_types.sql`): o enum ganhou cobertura,
  kitnet ou studio, chácara ou sítio, sala comercial, loja e galpão. `mapPropertyType` lê esses tipos do VRSync
  (Penthouse, Kitnet/Studio/Flat/Loft, Farm/Ranch/Chácara/Sítio, Office/Business, Store/Retail/Loja,
  Warehouse/Industrial/Galpão); Hotel e outros seguem como "tipo não suportado". Os filtros mostram os quatro tipos
  de sempre e os novos em "Mais filtros → Outros tipos"; cada tipo tem endereço próprio na URL (`tipo=cobertura`,
  `tipo=sala-comercial`…). No formulário, andar da unidade, andares e torres valem para os tipos em prédio
  (apartamento, cobertura, studio, sala); área do terreno para os de lote próprio; sala, loja e galpão não pedem
  quartos e já vêm com finalidade comercial. Na ficha, nos cartões e no Google, os quartos somem nesses tipos.

### A7. Espelho de vendas só na demonstração [prioridades 4 e 28]

Arquitetura e negócio · alta para incorporadoras · alta · grande.

- Nenhuma migration tem empreendimentos ou unidades; `src/data/load.ts` lê `developments.json` só com `DEMO`. Em
  produção o recurso desaparece.
- A demonstração pública mostra empreendimentos reais (Halsten, Plaenge) com preços inventados (já em B4).
- **Feito em 17/10:** empreendimentos e unidades no banco, com reserva com prazo, preço opcional para o público e
  planilha (`docs/espelho-de-vendas.md`). Os da demonstração continuam só com `DEMO`.

### A8. Gestão do dia a dia insuficiente [prioridade 13]

Interface e negócio · alta · alta · médio.

- A gestão fica no painel lateral do mapa (`src/ui/account.ts`) e exige WebGL e o mapa carregado.
- Não há lista "Meus anúncios" com situação e ações.
- O rascunho existe no banco, mas o formulário nunca envia `published`.
- Os contatos são só os 200 últimos (`remote.ts:596`), sem filtro, busca nem exportação.
- **Feito em 17/10:** a gestão também abre em página própria, `painel.html` (`src/panel/main.ts`), sem WebGL e sem o
  mapa; o painel do mapa tem o link "Gestão em página inteira". "Meus anúncios" lista os anúncios do cliente, rascunhos
  incluídos, com filtro (publicados, rascunhos, reservados, vendidos), busca por título ou código, situação, destaque,
  publicar e despublicar e excluir; só quem criou ou um administrador altera. O formulário tem "Salvar como rascunho" e
  envia `published`. Os contatos vêm em páginas de 30 com total, filtro de situação ("Em aberto" junta as etapas em
  andamento) e busca por nome, e-mail, telefone, anúncio ou mensagem; "Baixar planilha (CSV)" exporta todos os do
  filtro, em páginas abaixo do limite do servidor, com proteção contra fórmulas (`src/backend/leadsCsv.ts`).

### A9. Limite de envios por IP contornável e sujeito a bloqueio falso [prioridade 14]

Segurança e interface · média · média · pequeno.

- `lead_origin` (`20261020000002_lead_captcha.sql:18-25`) e `clientIp` (`supabase/functions/_shared/turnstile.ts`)
  usam o primeiro valor de `x-forwarded-for` quando falta `cf-connecting-ip`, e o primeiro valor é o que o cliente
  envia.
- O limite é de 5 envios em 10 minutos por IP na plataforma inteira, contando os cliques no WhatsApp. Atrás de CGNAT
  de operadora móvel, visitantes diferentes dividem o mesmo IP (hipótese de bloqueio falso).
- **Recomendação:** usar o último salto confiável, não contar `whatsapp` no limite e ligar o Turnstile em produção.
- **Parte feita em 17/10** (`20261024000002_audit_small_fixes.sql`): os cliques no WhatsApp têm limite próprio, 20 em
  10 minutos (acima disso o clique só não é registrado), e não contam mais no limite de 5 mensagens. A função
  `submit-lead` confere se o token do Turnstile foi resolvido no mesmo site que enviou o pedido (cabeçalho `Origin`).
- **Ficou em aberto:** a origem por IP. Trocar o primeiro valor de `x-forwarded-for` pelo último sem saber quais
  proxies o Supabase hospedado põe na frente pode fazer todos os visitantes dividirem o mesmo IP (o do proxy) e
  bloquear o site inteiro depois de 5 mensagens. Conferir no projeto de produção se `cf-connecting-ip` chega (se
  chegar, o furo não existe ali) antes de mudar.

### A10. Administrador rebaixa um dono quando há mais de um [prioridade 15]

Segurança · baixa a média · média · pequeno.

- Política `memberships: admins alteram` (`20261009000001_init.sql:277`): o `USING` só exige `is_org_admin`, sem
  olhar o papel antigo; `memberships_keep_owner` protege só o último dono.
- Administradores também incluem qualquer `user_id` direto em `memberships`, sem convite.
- Sem teste em `rls.test.ts`.
- **Recomendação:** no `USING`, `role <> 'owner' or member_role(org_id) = 'owner'`; inclusão direta só pelo suporte.
- **Feito em 17/10:** o `USING` agora exige ser dono para alterar a linha de um dono; pelo site só se muda a coluna
  `role` (permissão de coluna), então não dá para trocar a pessoa de uma linha; incluir direto só pela equipe. Teste em
  `rls.test.ts`.

### A11. Endereço oculto identificável pelos atributos [prioridade 16]

Privacidade · média · média · pequeno.

- Com o endereço oculto, `public_listings` (`20261019000001_construction_progress.sql:79-87`) ainda mostra
  `building_height_m`, `floors` e `unit_floor`, além do círculo de 150 m. Um prédio alto e único no raio fica
  identificável.
- **Recomendação:** anular altura e andares do prédio quando `address_display <> 'full'`.
- **Feito em 17/10:** `building_height_m`, `floors` e `unit_floor` saem nulos sem o endereço completo. Os andares já
  construídos de uma obra continuam públicos (também estão em `construction_history`): sem o total, dizem pouco.

### A12. Tabela de imobiliárias com leitura pública total [prioridade 17]

Segurança e negócio · baixa a média · alta · pequeno.

- `organizations: leitura pública` (`init.sql:268`, `using (true)`) permite listar todos os clientes da plataforma e
  qualquer coluna que entrar no futuro (plano, cobrança).
- **Recomendação:** expor só uma view com nome, slug, CRECI, domínio e configuração do site.
- **Feito em 17/10, por permissão de coluna:** o público lê só `id`, `name`, `slug`, `creci`, `branding` e
  `custom_domain`; uma coluna nova fica fechada até ser liberada de propósito. Uma view mudaria todas as leituras
  (mapa, prerender, editor) sem ganho: a lista de clientes continua pública, como os próprios sites.

### A13. Cada visita ao site faz duas consultas completas, sem cache [prioridade 18]

Desempenho e custo · média · alta · médio.

- `siteServer.ts:37-52` consulta `site_bootstrap` a cada página, com `max-age=0` (`:169`), e o navegador repete a
  consulta (`src/site/data.ts`). Cada página, inclusive de robôs, traz todos os anúncios e fotos do cliente duas
  vezes.
- **Recomendação:** cache na borda por domínio com invalidação ao publicar; injetar os dados no HTML para o navegador
  não repetir a consulta.

### A14. Mapa sem orientação inicial; mapa embutido pode prender a rolagem no celular [prioridade 19]

Interface · média · média (hipótese) · pequeno.

- Nenhuma dica de navegação; `cooperativeGestures` não é usado.
- No site, o mapa da ficha fica num iframe e responde a toque de um dedo.
- **Recomendação:** `cooperativeGestures` no embed, uma dica de uma linha na primeira visita e menos inclinação na
  abertura no celular; testar em aparelho real.
- **Feito em 17/10:** na primeira visita, uma dica de uma linha explica como mover, dar zoom, girar e inclinar (texto
  próprio para toque); some no primeiro movimento do mapa ou em "Entendi" e não volta nesse navegador
  (`src/ui/mapHint.ts`). O mapa embutido no site usa `cooperativeGestures`: um dedo e a roda do mouse rolam a página, e o
  mapa pede dois dedos ou Ctrl + rolagem, com as mensagens em português, assim como os botões do mapa. No celular, a
  abertura e a "Visão geral" inclinam 45° em vez de 58°. Falta testar em aparelho real.

### A15. Qualidade e CI [prioridade 9]

- Sem ESLint; e2e do mapa, do site e do backend fora do CI.
- `src/site/app.ts` (1.418 linhas) e `src/map/scene.ts` (1.478) concentram muita responsabilidade.
  **Feito em 17/10:** páginas do site em `src/site/pages/` e estilo do mapa base em `src/map/baseStyle.ts`.
- O `main` publica direto no GitHub Pages, sem homologação.
- **Feito em 17/10, em parte:** `.github/workflows/ci.yml` roda testes, build, os três e2e e o backend a cada push e
  pull request, e o `pages.yml` só publica o commit que passou. Faltam o ESLint (o projeto não tem configuração) e a
  homologação (Supabase separado, prioridade 9).

### Menores

- **"Joinville" fixo** (`src/site/routes.ts:65`); o pipeline e o cadastro são específicos de Joinville. Outra cidade
  é projeto de dados, não configuração [prioridade 29]. **Feito em 17/10:** a região sai de
  `scripts/data/region.json` (app e pipeline); ver `docs/nova-regiao.md`.
- **Filtro do mapa base:** `contextFilter` (`scene.ts:449`) usa `in` com a lista literal de todos os prédios
  anunciados e é reaplicado a cada mudança de anúncios. A medir com milhares [prioridade 31].
- **Pinos sem agrupamento:** com muitos anúncios próximos, eles se sobrepõem [prioridade 31].
- **Painel da conta no pacote do mapa:** `AccountPanel` é importado direto em `src/main.ts:37` e vai para todo
  visitante (M5) [prioridade 30].
- **Documento de exclusividade:** o formulário guarda só o nome do arquivo; o bucket `exclusivity-docs` não recebe
  nada e a conferência depende de intervenção manual [prioridade 34].
- **`robots.txt` da demonstração** fica em `/real-state-3d-web-viewer/robots.txt`, onde os robôs não leem. Só afeta
  a demonstração.
- **`.pmtiles` no git:** ~25 MB por mês no histórico [prioridade 32].
- **Turnstile** não confere o `hostname` da resposta (baixa) [prioridade 14].
- **Documentação desatualizada:** `docs/backend.md` §10, item 6, diz que a importação XML precisa remover o EXIF das
  fotos; `scripts/import-xml.mjs:129-131` já remove.

## Inventário: o que é demonstração e o que é produto

| Recurso | Situação |
|---|---|
| Mapa 3D, filtros, recorte por bairro, busca por rua, URL compartilhável | Implementado |
| Ficha do imóvel | Implementada; planta e simulação fictícias em produção (A2) |
| Contas, convites, papéis, duas etapas, lixeira, auditoria | Implementado; depende do Supabase |
| Contatos com aviso por e-mail | Implementado; depende do Resend; lista em páginas, com filtro e planilha (A8) |
| CAPTCHA | Pronto, desligado por padrão |
| Importação XML | Parcial: comando manual com a chave de serviço; os dez tipos do enum são lidos, os outros descartados (A6). **Feito em 17/10:** importação agendada pelo endereço do feed, cadastrado pelo administrador em Minha conta |
| Site white label, editor, histórico de versões | Implementado |
| SEO no domínio do cliente | Código pronto, não publicado (A5) |
| Espelho de vendas | Só demonstração (A7). **Feito em 17/10:** no banco, com reservas e planilha |
| Documento de exclusividade | Só interface |
| Rascunho de anúncio | Só no banco, sem interface |
| Busca por área (`listings_in_bbox`) | Só no banco, sem uso |
| Agendamento de visita, alertas, IA, serviços por perto | Pedido de visita feito em 17/10 (item 26); o resto não existe |

## Testes: o que falta cobrir primeiro

1. Volume: anúncios e fotos acima de 1.000 linhas (A1).
2. Convite com e-mail não confirmado (A3).
3. Administrador rebaixando dono (A10).
4. e2e do contato e da busca no CI.

## Perguntas em aberto

- No Supabase de produção: "Confirm email" está ligado? `max_rows` foi alterado? O Turnstile está ativo? Há backup
  com restauração a um ponto no tempo?
- `cf-connecting-ip` chega sempre ao banco no Supabase hospedado? Define a gravidade de A9.
- Desempenho real: LCP, INP, CLS, quadros por segundo do 3D e memória num Android de entrada.
- Licenças: cadastro do SIMGeo para uso comercial e compatibilidade com a ODbL; autorização das construtoras.
- Decisões do dono do produto:
  1. foco inicial (imobiliárias ou incorporadoras);
  2. o portal com todas as imobiliárias é produto ou só vitrine;
  3. modelo de cobrança;
  4. quando entram outras cidades;
  5. quem opera a importação XML e o suporte.

*Anotado por Claude (assistente de IA), 17/10/2026, para consulta na manutenção.*
