# Passo a passo: o que falta da sua parte (18/10/2026)

O código dos itens de `prioridades.md` está pronto e testado no CI. O que sobra são contas, configurações, decisões e
testes com gente e aparelhos de verdade. A ordem abaixo segue as dependências: cada etapa usa o que a anterior deixou
pronto. Ao lado de cada etapa está o item de `prioridades.md` e o documento com o detalhe.

## Etapa 0. O projeto rodando no seu computador (meio dia)

Precisa de: Node 22, Git, Docker Desktop (para o Supabase local) e uns 10 GB livres.

```bash
git clone https://github.com/CaioLeonardoSch/real-state-3d-web-viewer.git
cd real-state-3d-web-viewer
npm ci
npx playwright install chromium
npm run dev            # http://localhost:5173: o mapa com a demonstração, sem backend
```

Confira com os mesmos testes do CI (se passam aí, o ambiente está certo):

```bash
npm run lint && npm test && npm run build
npm run verify:e2e     # ~10 min, 114 checagens no navegador
npm run verify:site    # o site da imobiliária
```

**Backend local** (o Supabase inteiro em Docker, com dados de teste):

```bash
npm run db:start       # a primeira vez baixa as imagens (alguns GB)
npm run db:reset       # banco limpo a partir das migrações
npm run test:backend   # permissões, convites, contatos, 2 etapas...
npm run verify:backend # o fluxo completo no navegador
```

O `db:start` mostra a URL e a chave local. Ponha as duas num `.env.local` (`VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY`) e rode `npm run dev` de novo: aparece o botão **Entrar**, e o fluxo de suporte →
imobiliária → corretor de `docs/supabase.md` §3 funciona todo no seu computador, sem custo e sem risco.

**Teste essencial desta etapa:** finja ser um corretor (o que você queria fazer). Crie uma imobiliária, convide a si
mesmo com outro e-mail (para ver os e-mails, tire `mailpit` do `-x` do `db:start`: o endereço da caixa de
entrada aparece na saída), anuncie uma casa e um apartamento pelo endereço ("Localizar pelo
endereço"), um sem número no cadastro e um terreno. Anote o que for difícil: é o melhor retorno antes dos pilotos.

## Etapa 1. Tirar o risco da demonstração pública (1 a 2 horas, item 4)

Os empreendimentos da demonstração usam nomes de construtoras reais. Troque por fictícios em
`scripts/data/developments.mjs` (nome e incorporadora de cada um) e rode `npm run data:developments`, ou peça
autorização por escrito às construtoras. Faça isso antes de mostrar o link a qualquer pessoa.

## Etapa 2. Pedido à Prefeitura (comece já, a resposta demora; item 7)

Mande o pedido à SEPUR.UGP para usar o cadastro do SIMGeo (alturas e endereços) e publicar as alturas sob a ODbL. O
texto sugerido e o que pedir estão em `docs/dados-prefeitura.md`. Sem a autorização, as alturas voltam a 6 m e o
"Localizar pelo endereço" precisa sair. Vale um advogado olhar a licença.

## Etapa 3. Supabase de produção e de homologação (meio dia; itens 3 e 9)

1. Crie **dois** projetos (São Paulo): `producao` e `homologacao`. Siga `docs/supabase.md` §1 e §2 nos dois.
2. No de produção, confira (item 3):
   - Authentication → Email: **Confirm email** ligado;
   - Authentication → Passwords: **recusar senhas vazadas** (Have I Been Pwned) e mínimo de 10 caracteres;
   - Project Settings → API: **max rows** em 1000;
   - Plano **Pro**, com backup e **restauração a um ponto no tempo** (PITR). Teste uma restauração no de homologação;
   - **SMTP próprio** (Resend é o mais simples) em Authentication → Emails;
   - **Advisors → Security Advisor** sem alertas (item 21) e **Performance Advisor** sem itens vermelhos.
3. Faça de você o suporte (`docs/supabase.md` §3) e ative a verificação em duas etapas.
4. **Teste essencial:** no de homologação, repita o fluxo da etapa 0 com e-mails reais (convite chega? link de
   confirmação abre o site certo?). Use o de homologação para tudo que for experiência daqui em diante.

## Etapa 4. Hospedagem com domínio próprio (1 dia; item 8)

1. Conta na **Cloudflare** e um domínio para a plataforma (ex.: `mapa3d.com.br`).
2. **Cloudflare Pages** ligado a este repositório (build `npm run build`, pasta `dist`), com as variáveis do
   `docs/supabase.md` §2 e `PLATFORM_HOSTS` (os domínios da própria plataforma; ver `docs/backend.md` §12).
3. Para o domínio de um cliente: **Cloudflare for SaaS** (custom hostnames) e o CNAME do cliente apontando para você.
4. **Google Search Console**: verifique o domínio, envie o `sitemap.xml` e, depois de uns dias, confira se as
   páginas dos imóveis foram indexadas.
5. **Teste essencial:** abra o site pelo domínio do cliente no celular, no 4G, e confira o cadeado (HTTPS), o mapa, o
   contato e o WhatsApp.

## Etapa 5. Operação mínima (2 horas; item 9)

- **Sentry** (plano gratuito): crie o projeto JavaScript e me passe o DSN. A integração no código é pequena e eu faço.
- **Monitor de disponibilidade** (UptimeRobot ou Better Stack, grátis): o site, uma página de imóvel e a URL do
  Supabase, a cada 5 minutos, com aviso por e-mail ou WhatsApp.
- **Teste essencial:** derrube de propósito (uma URL errada no monitor) e veja o aviso chegar.

## Etapa 6. Proteção contra spam (1 hora; item 14)

1. **Turnstile** da Cloudflare: crie o site, ponha a Site Key em `VITE_TURNSTILE_SITE_KEY` e a Secret no Supabase
   (`docs/supabase.md` §9). Confira o `hostname` aceito.
2. O limite de envios identifica o visitante pelo `cf-connecting-ip` (ou o primeiro `x-forwarded-for`). Esses
   cabeçalhos só são confiáveis se a chamada passa por um proxy que os reescreve; quem chama o Supabase direto pode
   forjá-los. Quando a hospedagem estiver definida (etapa 4), me diga e eu fixo o cabeçalho certo para ela.
3. **Teste essencial:** do mesmo celular, mande 6 contatos em 10 minutos para anúncios diferentes, com e-mails
   diferentes: o sexto deve ser recusado com a mensagem certa. Repetir o mesmo e-mail no mesmo anúncio é recusado
   já no quarto.

## Etapa 7. Decisões que só você toma (itens 22, 23 e Google Maps)

- **Duas etapas** obrigatória para donos e administradores das imobiliárias? Hoje é obrigatória só para o suporte.
  Minha sugestão: obrigatória para donos, opcional para corretores.
- **Cobrança** (item 23): preço, plano, contrato e meio de pagamento (proposta em `docs/backend.md` §11). Decida antes
  dos pilotos para ter um número a validar.
- **Google Maps** (busca de endereço e ponto no mapa): precisa de chave e conta de cobrança, e os termos limitam o uso
  com um mapa que não é do Google. Avalie depois de cadastrar alguns anúncios fingindo ser corretor: se o "Localizar
  pelo endereço" e o "Marcar no mapa" bastarem, não precisa.

## Etapa 8. Pilotos e o primeiro XML real (2 a 4 semanas; itens 10 e 12)

1. Escolha 2 ou 3 imobiliárias de Joinville. Peça a URL do XML que elas já mandam para os portais (VRSync/ZAP).
2. Importe no Supabase de homologação: `npm run import:xml` (ver `docs/importacao-xml.md`) e revise com o cliente,
   anúncio por anúncio: fotos, endereço, tipo, preço, o prédio certo no mapa.
3. **Teste essencial:** importe duas imobiliárias e confira que uma nunca vê a outra: logado como corretor da
   primeira, o mapa só tem os anúncios dela; o site de cada uma só mostra os dela; deslogado, o mapa da plataforma só
   mostra a demonstração. Se algum anúncio vazar de um cliente para outro, pare tudo e me avise.
4. Pergunte: pagariam quanto? O que faria largar o portal atual? O que falta? Isso decide a P2.

## Etapa 9. Aparelhos e acessibilidade (meio dia; item 20)

- Um Android de entrada (2 a 3 GB de RAM): o mapa abre em quanto tempo? Trava ao girar? Esquenta?
- **TalkBack** (Android), **VoiceOver** (iPhone) e **NVDA** (Windows, grátis): dá para buscar, abrir um imóvel e mandar
  um contato só com o leitor de tela?
- Anote o modelo do aparelho e o que travou, e me passe.

## Etapa 10. Teste de invasão (contratação; item 21)

Quando as etapas 3 a 6 estiverem no ar, contrate um teste de invasão externo (pentest de aplicação web, escopo: o
site, o Supabase e as funções). Antes, o Security Advisor do Supabase precisa estar sem alertas.

## Resumo da ordem

| Quando | Etapas |
|---|---|
| Esta semana | 0 (local), 1 (demonstração), 2 (pedido à Prefeitura) |
| Próximas 2 semanas | 3 (Supabase), 4 (domínio), 5 (monitoramento), 6 (Turnstile), 7 (decisões) |
| Depois | 8 (pilotos e XML), 9 (aparelhos), 10 (pentest) |
