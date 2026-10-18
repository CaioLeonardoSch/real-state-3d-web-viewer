# Espelho de vendas no banco

**Feito em 17/10:** os empreendimentos deixam de existir só na demonstração. Cada incorporadora cliente tem os seus
no Supabase (migration `20261030000001_developments.sql`), com a situação, o preço e as reservas de cada unidade
atualizados por ela, e o mapa mostra o espelho ao vivo.

## Quem faz o quê

| Quem | O que faz |
| --- | --- |
| Suporte da plataforma | Desenha a torre (`npm run data:developments`) e envia para o cliente (`npm run developments:upload`) |
| Administrador da incorporadora | Publica, esconde os preços do público, define o prazo da reserva, marca vendida, desfaz qualquer reserva e importa a planilha |
| Corretor da incorporadora | Vê o espelho com preços e reservas, reserva uma unidade disponível e desfaz as próprias reservas |
| Imobiliária parceira credenciada | Vê o espelho publicado com preços e situação ao vivo, reserva dentro da cota e desfaz as reservas dela (o administrador dela desfaz as da equipe); quem reservou, só nas dela |
| Público | Vê só os empreendimentos publicados; o preço, só quando a incorporadora mostra ("Preços sob consulta") |
| Outra imobiliária ou incorporadora (não credenciada) | Não vê nem altera nada |

## O desenho: suporte

O desenho 3D (andares, formas das unidades, células, terreno) continua saindo do gerador
(`scripts/data/developments.mjs` → `public/data/developments.json`). Para entregar a uma incorporadora:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npm run developments:upload -- --org <slug-ou-id-do-cliente> --only cora [--publish] [--dry-run]
```

- Sem `--publish`, o empreendimento fica visível só para a equipe da incorporadora (ela publica em Minha conta).
- As unidades entram **disponíveis e sem preço** (os preços da demonstração são inventados). `--with-sales` copia
  preço e situação do arquivo.
- Enviar de novo atualiza o desenho e **mantém** situação, preço e reservas das unidades que já existem (achadas pela
  torre e pelo número). Unidades que saíram do desenho aparecem em `notInDrawing`; `--prune` as remove.
- O endereço (`?empreendimento=cora`) é único: o script recusa um endereço que já é de outro cliente.
- `--local` usa o Supabase local (`npm run db:start`).

Um empreendimento do banco com o mesmo endereço de um da demonstração toma o lugar dele no mapa.

## O dia a dia: incorporadora

**No mapa** (logada), ao abrir uma unidade do próprio empreendimento: "Reservar" (com um campo opcional "Para quem"),
"Desfazer reserva", "Marcar como vendida" e "Voltar para disponível". A ficha mostra quem reservou e até quando.

**Em Minha conta → Espelho de vendas:** os totais por situação, as reservas ativas (com "Desfazer"), o link para o
mapa e, para administradores, "Publicado no mapa", "Mostrar os preços ao público", o prazo da reserva (1 a 168 h),
"Baixar planilha" e "Enviar planilha".

### Planilha

A planilha baixada tem Torre, Andar, Unidade, Planta, Área (m²), Quartos, Suítes, Vagas, Preço, Situação, Reservada
até, Reservada por e Observação da reserva (`;` entre colunas, como a de contatos; abre no Excel e no Google
Planilhas).

Ao enviar de volta:

- só a coluna **Unidade** é obrigatória; o que não tiver coluna fica como está; também lê `,` como separador e
  nomes como Apto, Bloco, Valor, Status, sem acento;
- as unidades são achadas pela torre e pelo número; as que não existem no desenho voltam numa lista e nada muda nelas
  (o desenho é do suporte);
- **preço em branco** deixa a unidade "sob consulta"; "R$ 1.234.567,89" e "1.200.000" são lidos;
- situação: Disponível, Reservada ou Vendida (também livre, à venda, vendido, indisponível);
- "Reservada até" aceita dd/mm/aaaa (vale até 23h59) ou dd/mm/aaaa hh:mm, no horário de Brasília; uma reserva sem
  data ganha o prazo padrão;
- qualquer erro (com o número da linha) cancela o envio inteiro.

## Reservas

- O prazo vem do empreendimento (padrão 24 h); um administrador pode escolher outro prazo de até 7 dias.
- Não dá para reservar uma unidade vendida ou já reservada; o banco trava a linha, então dois corretores ao mesmo
  tempo não reservam a mesma unidade.
- Reservar só pela função `reserve_unit`: gravar "reservada" direto na tabela é recusado (a reserva sempre tem prazo).
- **Vencimento:** a view pública, a lista da equipe e o app já mostram uma reserva vencida como disponível; a cada
  10 minutos o `pg_cron` grava a mudança (`release_expired_reservations`).

## Identidade do lançamento

**Feito em 18/10 (item 46).** Em Minha conta → Espelho de vendas → "Identidade do lançamento", o administrador escolhe
a cor principal e a segunda cor, o estilo da letra (Moderna, Clássica, Geométrica ou Elegante, todas do sistema,
sem fonte externa), envia o logotipo (PNG, JPEG ou WebP até 1 MB, guardado no bucket `site-assets`) e lista até 8
materiais, um por linha, como `Book do lançamento | https://…`. No mapa, o painel do empreendimento mostra a faixa
com o logotipo e o nome da incorporadora nas cores dela, os botões principais na cor principal (o texto fica branco
ou escuro, o que se ler melhor) e os materiais em "Materiais do lançamento". O banco recusa cor fora de `#rrggbb`,
logotipo que não seja endereço http(s) ou do site, estilo desconhecido e material sem nome ou sem `https://`.

## Imobiliárias parceiras

**Feito em 18/10 (item 46).** Em Minha conta → Espelho de vendas, cada empreendimento tem "Imobiliárias parceiras":
o administrador da incorporadora credencia uma imobiliária pelo endereço dela no site (`?imobiliaria=<endereço>`)
com uma **cota** de reservas ativas (1 a 500, ou em branco sem limite), muda a cota credenciando de novo e
descredencia (as reservas ativas da parceira voltam a ficar disponíveis; as da incorporadora ficam).

- A parceira só vê o empreendimento **publicado**. Em Minha conta dela aparece "Como imobiliária parceira", com a
  cota e as reservas ativas; no mapa, ao abrir o empreendimento, ela vê preço e situação ao vivo mesmo com os preços
  escondidos do público, e reserva como a equipe da incorporadora, no prazo do empreendimento.
- Quem reservou e a observação: a parceira vê só nas reservas dela (as outras imobiliárias são concorrentes); a
  incorporadora vê tudo, com o nome da imobiliária que reservou (`reserved_org`), e as reservas ativas por parceira.
- Desfazer: quem reservou, um administrador da incorporadora ou um administrador da parceira que reservou.
- Vender, mudar preço e importar a planilha continuam só com a incorporadora.

## O que o banco garante (testado em `tests/backend/rls.test.ts`)

- o público lê só `public_developments` e `public_development_units` (publicados; preço só com "mostrar preços");
- só membros leem as tabelas; só administradores alteram empreendimento e unidades, e só nas colunas de venda
  (o desenho e o endereço só pela chave de serviço);
- reservar: qualquer membro; desfazer: quem reservou ou um administrador; outra incorporadora recebe "não encontrada";
- importar: só administradores do empreendimento, até 5.000 linhas;
- parceiras: só o administrador da incorporadora credencia e descredencia; a parceira reserva só no publicado e
  dentro da cota (trava a linha do credenciamento, então duas reservas ao mesmo tempo não passam do limite), não
  altera unidade nem empreendimento e não vê quem reservou pelas outras; o público não lê os credenciamentos;
- identidade: só administradores alteram; o banco confere o formato (`valid_development_brand`).

## Ainda não

- Várias torres desenhadas no mesmo empreendimento: a coluna `tower` existe (planilha e ids), mas o desenho 3D é de
  uma torre só.
- A parceira vender (marcar como vendida) e o link do corretor com a marca dele; o painel por canal mostra só as
  reservas ativas, não as vendas.
- Histórico de quem mudou cada unidade (hoje fica só o último: `updated_by`, `updated_at`).
- Integração com o sistema de vendas da incorporadora (a planilha é a ponte).
- Um empreendimento novo aparece no mapa ao recarregar a página.
