# O que falta fazer, em ordem de prioridade (17/10/2026)

Lista única e consolidada do que ainda está em aberto, do mais urgente ao menos urgente. Junta:

- a auditoria de 17/10 ([`auditoria-2026-10-17.md`](auditoria-2026-10-17.md), achados A1 a A15);
- a avaliação de outubro ([`avaliacao-2026-10.md`](avaliacao-2026-10.md): B1 a B4, I1 a I14, M1 a M8, "Lista antes
  do lançamento" e os pedidos do mapa de 15/10);
- o backend ([`backend.md`](backend.md): seção 1, seção 8 e a lista de segurança da seção 10);
- a concorrência ([`analise-concorrencia.md`](analise-concorrencia.md));
- os "Próximos passos" do [`README.md`](../README.md).

O que já foi feito nessas fontes não entra aqui. Quando um item terminar, marque-o nesta lista e na fonte de origem.

**Como ler as colunas:**
- **Impacto:** o que muda para visitantes, imobiliárias ou para o negócio.
- **Esforço:** pequeno (até 3 dias), médio (1 a 2 semanas), grande (mais de 2 semanas), para uma pessoa.
- **Risco:** a chance de o trabalho quebrar algo que funciona hoje ou de dar errado.
- **Dependências:** o que precisa existir ou ser decidido antes.

## P0: bloqueadores

Segurança, integridade ou funcionamento que impedem um piloto com clientes reais.

| # | Item | Impacto | Esforço | Risco | Dependências | Origem |
|---|---|---|---|---|---|---|
| 1 | ~~Convite só aceito com e-mail confirmado (`my_invitations` e `accept_invitation`), com teste no `rls.test.ts`~~ **Feito em 17/10:** a lista da conta não traz mais o código; aceitar exige o link (ver A3) | Alto: evita que alguém entre como dono de uma imobiliária | Pequeno | Baixo | — | A3 |
| 2 | ~~Tirar da produção a planta ilustrativa e a simulação sem juros da ficha do mapa~~ **Feito em 17/10** | Alto: conteúdo enganoso em anúncio real | Pequeno | Baixo | — | A2 |
| 3 | Conferir o Supabase de produção: "Confirm email" ligado, `max_rows`, Turnstile ativo, backup com restauração a um ponto no tempo, recusa de senhas vazadas | Alto: várias proteções dependem dessa configuração | Pequeno | Baixo | Plano Pro (backup e senhas vazadas) | A3, A9, backend §10 |
| 4 | Trocar os empreendimentos reais da demonstração pública por fictícios (ou pedir autorização às construtoras) | Alto: risco de marca e jurídico, já no ar | Pequeno | Baixo | — | B4, A7 |
| 5 | ~~Busca e carregamento no servidor: resumo leve para o mapa, anúncio completo ao abrir a ficha, embed filtrado por imobiliária, fotos sem o corte de 1.000 linhas~~ **Feito em 17/10** (ver A1); os filtros seguem no navegador e a carga por área do mapa fica para quando passar de ~5.000 anúncios | Muito alto: hoje fotos e anúncios somem em silêncio com volume real | Médio a grande | Médio: mexe na sincronia mapa, lista e URL; rodar os e2e antes | Definir o formato da busca | A1, I9, README |
| 6 | LGPD: política e termos por cliente, texto de consentimento versionado no servidor, prazo de retenção com anonimização, exportação e exclusão a pedido, contrato de tratamento com cada imobiliária | Alto: requisito legal para receber contatos | Médio | Baixo | Advogado; definir controlador e operador | B2, A4, backend §10 |
| 7 | Autorização da Prefeitura para o cadastro (SIMGeo) e para publicar as alturas sob ODbL | Alto: 93% das alturas dependem disso | Pequeno (o trabalho), espera longa | Médio: sem autorização, as alturas voltam a 6 m | Pedido à SEPUR.UGP; advogado | Avaliação, "Riscos" |
| 8 | Hospedagem com vários domínios: projeto na Cloudflare Pages, domínio de um cliente com HTTPS (Cloudflare for SaaS), `PLATFORM_HOSTS`, Search Console | Alto: sem isso não há site de cliente nem SEO no ar | Médio | Médio | Escolha da hospedagem; um cliente piloto | B1, B3, A5 |
| 9 | Operação mínima: Sentry, monitor de disponibilidade, Supabase de homologação, ~~e2e no CI, `main` sem publicar direto em produção~~ (**feito em 17/10:** `ci.yml`, e o Pages só publica com o CI verde), lint no CI (falta configurar o ESLint) | Alto: hoje um erro em produção passa despercebido | Pequeno a médio | Baixo | 8 | B3, I14, A15, backend §10 |

## P1: fundamentais

Uso no dia a dia, dados, conversão e confiabilidade.

| # | Item | Impacto | Esforço | Risco | Dependências | Origem |
|---|---|---|---|---|---|---|
| 10 | Validar preço e interesse com 2 ou 3 imobiliárias piloto, antes dos itens grandes | Alto: decide o que entra em P2 | Pequeno a médio | Baixo | 2, 4 | Lista antes do lançamento, backend §11 |
| 11 | ~~Mais tipos de imóvel (cobertura, sala, loja, galpão, chácara, kitnet…) e o mapeamento do VRSync~~ **Feito em 17/10** (ver A6) | Alto: a importação hoje descarta parte do estoque | Médio | Baixo | — | A6 |
| 12 | Importar e revisar com o cliente o primeiro feed XML real (fotos reais na galeria) | Alto: prova o fluxo com dados de verdade | Pequeno | Médio | 5, 10, 11 | Lista antes do lançamento |
| 13 | ~~Gestão sem o mapa: lista "Meus anúncios" (situação, publicar e despublicar, rascunho, destaque) e contatos paginados com filtro e exportação~~ **Feito em 17/10** (ver A8) | Alto: trabalho diário do corretor | Médio | Baixo | — | A8 |
| 14 | Limite de envios: IP do último salto confiável, cliques no WhatsApp fora da conta, Turnstile ligado (e conferir o `hostname`). **Parte feita em 17/10:** cliques no WhatsApp com limite próprio (20 em 10 min), fora da conta das mensagens; o Turnstile confere o site de origem. **Falta:** o IP do último salto confiável (conferir no Supabase de produção quais cabeçalhos chegam) e ligar o Turnstile em produção (item 3) | Médio: contorno do limite e bloqueio de visitantes legítimos | Pequeno | Baixo | 3 | A9 |
| 15 | ~~Administrador não rebaixa dono nem inclui pessoas sem convite, com teste~~ **Feito em 17/10** | Médio | Pequeno | Baixo | — | A10 |
| 16 | ~~View pública sem altura e andares do prédio quando o endereço é oculto~~ **Feito em 17/10** | Médio: privacidade do endereço | Pequeno | Baixo | — | A11 |
| 17 | ~~Leitura pública de imobiliárias só pelos campos do site (view), não pela tabela inteira~~ **Feito em 17/10:** por permissão de coluna, não por view | Baixo a médio | Pequeno | Baixo: conferir quem lê `organizations` hoje | — | A12 |
| 18 | Cache das páginas do cliente na borda, com invalidação ao publicar, e dados já no HTML para o navegador não repetir a consulta | Médio: custo e velocidade com tráfego | Médio | Médio | 5, 8 | A13, I9 |
| 19 | ~~Mapa: dica de navegação na primeira visita, `cooperativeGestures` no mapa embutido, menos inclinação ao abrir no celular~~ **Feito em 17/10** (ver A14) | Médio: primeira impressão e rolagem no celular | Pequeno | Baixo | — | A14 |
| 20 | Testes em Android de entrada e com leitor de tela (NVDA, VoiceOver, TalkBack) | Médio: desempenho real do 3D e acessibilidade | Pequeno | Baixo | Aparelhos | Lista antes do lançamento, I7 |
| 21 | Teste de invasão por terceiros e "Security Advisor" do Supabase sem alertas | Médio | Pequeno (contratação) | Baixo | 1, 3, 14 a 17 | I11, backend §10 |
| 22 | Decidir se a verificação em duas etapas vira obrigatória para donos e administradores | Médio | Pequeno | Baixo | Decisão do dono do produto | Backend §10 |

## P2: evolução do produto

Gestão, personalização, SEO, experiência 3D e escala. Depois do retorno dos pilotos (10).

| # | Item | Impacto | Esforço | Risco | Dependências | Origem |
|---|---|---|---|---|---|---|
| 23 | Cobrança: tabela de assinaturas, gateway (Asaas ou Iugu) com webhook, limites por plano, inadimplência em etapas | Alto para o negócio | Médio | Médio | 10; contrato | Backend §1 e §11 |
| 24 | ~~Métricas por cliente: visualizações, cliques e contatos por anúncio~~ **Feito em 17/10:** seção "Desempenho dos anúncios" em Minha conta e no painel (7/30/90/365 dias, exporta CSV); visualização contada uma vez por navegador por dia, sem a equipe e sem rascunhos | Alto: justifica a assinatura | Médio | Baixo | 5 | Backend §1 |
| 25 | ~~Importação XML agendada (feed lido sozinho), sem a linha de comando do suporte~~ **Feito em 17/10:** o administrador informa o endereço do XML em Minha conta → "Importação automática (XML)"; o workflow "Importar XML" lê cada feed a cada 6 horas (ou na hora seguinte a "Importar agora") e a tela mostra o resultado; feed fora do ar, vazio ou cortado em mais de 30% não manda nada para a lixeira, e o que a equipe fez pela tela (despublicar, lixeira, local ajustado) é respeitado | Alto: menos trabalho manual | Médio | Médio | 11, 12 | A6, backend §1 |
| 26 | ~~Agendamento de visita na ficha~~ **Feito em 17/10:** "Quero agendar uma visita" no formulário do mapa e do site (dia de amanhã a 14 dias, período opcional; o servidor aceita até 30 dias); chega como contato com "Visita pedida", no e-mail com o assunto "Pedido de visita" | Médio: conversão | Pequeno a médio | Baixo | 6 | Auditoria §10 |
| 27 | ~~Simulação de financiamento real (SAC e Price, juros, FGTS)~~ **Feito em 17/10:** no mapa e no site, para imóveis à venda; substitui a simulação sem juros da demonstração | Médio | Pequeno a médio | Baixo: textos de aviso | 2 | Concorrência |
| 28 | ~~Espelho de vendas no banco: empreendimento, torre, andar e unidade, com situação, preço, reserva com prazo e importação por planilha~~ **Feito em 17/10:** tabelas com permissões, reserva com prazo que vence sozinha, preço escondido do público quando a incorporadora quer, planilha de ida e volta em Minha conta e ações no mapa; o desenho é enviado pelo suporte (`npm run developments:upload`); ver `docs/espelho-de-vendas.md` (uma torre desenhada por empreendimento) | Alto para incorporadoras | Grande | Médio | 5, 10 (uma incorporadora interessada) | B4, A7, backend §1 |
| 29 | ~~Região configurável: tirar "Joinville" fixo e preparar outra cidade no pipeline~~ **Feito em 17/10:** cidade, UF, fuso, municípios, extrato do OSM e cadastro saem de `scripts/data/region.json`, lido pelo app e pelo pipeline; sem cadastro, as alturas vêm do OSM; passo a passo em `docs/nova-regiao.md` (imóveis de demonstração e fuso do banco continuam de Joinville) | Médio | Médio | Médio: o cadastro de alturas é da Prefeitura de Joinville | 7 | M7, A menores |
| 30 | ~~Dividir `src/site/app.ts` e `src/map/scene.ts`; painel da conta carregado sob demanda~~ **Feito em 17/10:** o estilo do mapa base saiu do `scene.ts` para `src/map/baseStyle.ts` (scene com 968 linhas); as páginas do site foram para `src/site/pages/` (início, busca, imóvel e demais), e o `app.ts` ficou com estado, rotas, cabeçalho e rodapé (483 linhas); o acesso ao backend e o painel da conta só são baixados quando há backend (o mapa de demonstração deixou de baixar 92 KB sem compressão) | Médio: manutenção e peso do mapa | Médio | Médio | 9 (e2e no CI) | M5, M7, A15 |
| 31 | ~~Pinos agrupados com contagem e medição do filtro do mapa base com milhares de anúncios~~ **Feito em 17/10:** pinos da busca que se sobrepõem viram um grupo com a contagem só na visão 2D, até o zoom 13 (clique aproxima até ele se abrir; com os prédios 3D cada imóvel tem o seu pino, e o grupo nunca cobre o prédio); o filtro que esconde os prédios anunciados passou de `in` para `match`: com 5.000 anúncios, 20.000 prédios são filtrados em ~1 ms em vez de ~160 ms (`node scripts/bench-context-filter.mjs`) | Médio: legibilidade e desempenho com volume | Pequeno a médio | Baixo | 5 | A menores |
| 32 | ~~`.pmtiles` num armazenamento de objetos com nome por versão, fora do histórico do git~~ **Feito em 17/10:** bucket `map-tiles`, `npm run tiles:upload` (nome `<região>-<mês>-<hash>.pmtiles`, cache de um ano) e o mapa mensal envia quando há os segredos; o PR leva só o `meta.json`. Falta criar os segredos e tirar os `.pmtiles` do git ([docs/mapa-no-armazenamento.md](mapa-no-armazenamento.md)) | Médio: o repositório cresce ~25 MB por mês | Pequeno | Baixo | 8 | Mapa mensal, backend §13 |
| 33 | ~~SEO: corpo da página gerado no servidor e páginas estáticas da plataforma com 301 e 404~~ **Feito em 17/10:** o servidor manda o conteúdo da página em `#site` (`src/seo/siteBody.ts`); na plataforma, título antigo → 301 pelo código (função da Cloudflare, testada com o `wrangler`) e anúncio que saiu → `404.html` com noindex ([backend.md §12](backend.md)) | Médio | Médio | Médio | 8 | B1, I12 |
| 34 | ~~Documento de exclusividade: envio ao bucket privado e conferência pelo suporte na tela~~ **Feito em 17/10:** o formulário envia o PDF, JPG ou PNG (até 10 MB) para `exclusivity-docs` na pasta do anúncio; o suporte vê a fila em Minha conta → "Exclusividades a conferir", abre o documento por link temporário e confirma ou recusa com motivo (`review_exclusivity`); o selo só aparece depois de confirmado, e trocar o documento volta para a fila; o anunciante vê o resultado ao editar | Baixo a médio | Pequeno | Baixo | — | A menores |
| 35 | ~~Moderação: fila de aprovação e denúncias~~ **Feito em 17/10:** o suporte liga a aprovação prévia por cliente (anúncio novo entra "em análise" e só aparece no público depois de aprovado; recusado volta para a análise quando corrigido) e vê a fila em Minha conta → "Suporte: moderação", com aprovar, recusar e tirar do ar com motivo; o visitante denuncia na ficha do mapa (vendido, desatualizado, dados errados, golpe, outro; até 3 por anúncio e 20 por dia por origem), e a denúncia aparece para os administradores do cliente em "Denúncias dos visitantes", que a encerram | Médio (modo portal) | Médio | Baixo | 13 | Backend §1 |
| 36 | ~~Mapa: serviços por perto (pedido 3 de 15/10)~~ **Feito em 17/10:** a geração do mapa extrai do OSM escolas, saúde, farmácias, mercados, padarias e parques (`services.geojson`; `npm run data:services` junta os repetidos a menos de 50 m e grava `public/data/servicos.json`, 809 pontos, 46 KB, também no serviço mensal); a ficha do anúncio mostra "Por perto" com o mais próximo de cada tipo até 2 km, em linha reta ("cerca de" quando o endereço é oculto, "nenhum mapeado" quando falta no OSM), e a busca ganhou "Perto de (até 500 m)" com escola, mercado, farmácia, saúde e parque (`perto=` na URL). Ficaram para depois: os ícones no mapa e os dados da Prefeitura, do INEP e do CNES | Médio | Médio | Baixo | — | Avaliação, pedidos de 15/10 |
| 37 | Mapa: relevo com a câmera sempre acima do chão (pedido 1; pedir os dados do MDT já) **Feito em 17/10, a parte que não depende do MDT:** a câmera não fica mais dentro das torres. Ao fim de cada movimento o mapa calcula onde ela está e a altura do prédio mais alto a até 20 m dela; se faltar folga de 12 m sobre o telhado, a câmera se inclina para cima mantendo a distância, ou se afasta quando nem olhando para baixo bastaria (`src/map/cameraGuard.ts`). O relevo em si continua esperando a licença do MDT do Estado | Médio | Médio | Alto: mexe em câmera, prédios, obras e vista da janela | Licença do MDT | Avaliação, pedidos de 15/10 |
| 38 | ~~Mapa: régua de horário e sol de cada apartamento (pedido 6, etapa 2)~~ **Feito em 17/10:** "Hora e época" ao lado de Manhã/Tarde/Noite abre a régua: arrastar a hora (5h30 às 19h30) e escolher verão, outono/primavera ou inverno move o sol, a luz e a sombra dos prédios (de noite o mapa passa para o tema noturno). Na ficha, "Sol do imóvel" mostra as horas de sol direto em cada fachada (norte, leste, sul, oeste) no inverno e no verão, no andar da unidade, descontando a sombra dos prédios a até 300 m (`src/map/sunHours.ts`; amostra a cada 10 minutos, cerca de 15 ms). Não considera árvores nem relevo, e a fachada de cada lado é a parede mais comprida do contorno | Médio: diferencial | Médio | Baixo | — | Avaliação, pedidos de 15/10 |
| 39 | ~~Pendências pequenas: clique do meio na paginação (M3), detalhes de interface (M8), favoritos no modo aluguel (I1), `robots.txt` da demonstração, item 6 do `backend.md` §10 desatualizado~~ **Feito em 17/10:** favoritos seguem o modo da busca (aluguel ou venda) com link para trocar; coração com rótulo "Salvar nos favoritos" e dica; clique do meio na paginação conferido (já abria outra aba); `robots.txt` da demonstração fica como limitação do GitHub Pages (no domínio do cliente funciona); `backend.md` corrigido (a importação XML já tira o GPS das fotos) | Baixo | Pequeno | Baixo | — | M3, M8, I1, A menores |

## P3: diferenciais futuros

Dependem de validação comercial. Não começar antes de P0 e P1.

| # | Item | Impacto | Esforço | Risco | Dependências | Origem |
|---|---|---|---|---|---|---|
| 40 | ~~Buscas salvas e alertas de novos imóveis~~ **Feito em 17/10:** "Salvar busca" guarda até 10 buscas no navegador e Favoritos mostra cada uma com o total e os novos desde a última visita; no site com backend, "Receber por e-mail" grava o alerta (tabela `search_alerts`, só pelas funções do banco, com limites e o anti-robô), o visitante confirma pelo link do e-mail e o workflow "Alertas de imóveis" manda uma vez por dia os imóveis publicados depois do último aviso, com link de saída; pedido sem confirmação some em 30 dias | Médio | Médio | Baixo | 5, 6 | Backend §1, concorrência |
| 41 | Busca conversacional com IA | Incerto | Médio | Médio | 5 | Auditoria §10 |
| 42 | Análise de investimento e preço justo por m² | Incerto | Grande | Alto: não há dados de mercado reais | Fonte de dados | Concorrência |
| 43 | Isócronas e desenho de área no mapa **Feito em 18/10, o desenho de área:** o botão de traço pontilhado do mapa abre a barra "Desenhe a área da busca" (cliques marcam os cantos, o primeiro ponto ou "Concluir" fecha, "Usar a área visível" pelo teclado); a lista fica com os imóveis cujo ponto está dentro, o mapa é recortado com 100 m em volta, e a área vai para o formulário (chip) e o endereço (`?area=`). Faltam as isócronas, que precisam de um grafo de rotas (OSRM, Valhalla ou um grafo das vias do OSM montado na geração do mapa) | Médio | Médio | Baixo | 5 | Concorrência |
| 44 | Camadas da Prefeitura (inundação, zoneamento, lote real) | Médio | Médio | Médio | 7 | Backend §8 |
| 45 | Anunciar pela unidade no 3D | Alto (diferencial) | Grande | Médio | 28 | Backend §8 |
| 46 | Espelho com a identidade de cada construtora e disponibilidade ao vivo para corretores credenciados | Alto para incorporadoras | Grande | Médio | 28 | Backend §8 |
| 47 | Aviso de contato por WhatsApp (API paga do WhatsApp Business) | Médio | Médio | Baixo | Custo da API | Backend §1 |
| 48 | Prédio "hero" com janelas por unidade (Three.js) | Médio | Grande | Médio | 28 | README |
| 49 | Dados do mapa: pavimento da Secretaria de Infraestrutura, iluminação pública, LiDAR, estéreo e classificador de telhados | Baixo a médio | Grande | Médio | 7, dados externos | README, avaliação |
| 50 | Deduplicação de anúncios repetidos (só num portal com vários anunciantes) | Baixo hoje | Médio | Médio | Decisão sobre o portal | Backend §5 e §8 |

## Decisões que travam a ordem

- **Antes de 5:** o formato da busca no servidor (o que o mapa recebe resumido e o que vem só na ficha).
- **Antes de 6:** quem é controlador e quem é operador dos dados (imobiliária ou plataforma).
- **Antes de 8:** a hospedagem (Cloudflare Pages é a recomendada) e o primeiro cliente piloto.
- **Antes de 23 e 28:** o foco inicial (imobiliárias ou incorporadoras) e o modelo de cobrança, a partir do retorno
  de 10.
- **Antes de 29:** quando entram outras cidades.
- **Sempre:** o portal com todas as imobiliárias é produto ou só vitrine; quem opera a importação XML e o suporte.

*Anotado por Claude (assistente de IA), 17/10/2026, para consulta na manutenção.*
