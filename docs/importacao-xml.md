# Importação de anúncios por XML (VRSync)

Quase todo sistema de imobiliária (CRM) gera um arquivo XML no
formato **VRSync**, o mesmo que manda para ZAP, VivaReal e OLX. Importando esse arquivo, o cliente não recadastra
nada, e pode continuar usando o CRM: rodar a importação de novo atualiza os anúncios.

## Importação automática (pela tela)

**Feito em 17/10.** O administrador da imobiliária (ou o suporte, atendendo o cliente) abre **Minha conta →
Importação automática (XML)**, cola o endereço do feed e salva. A partir daí:

- o workflow **"Importar XML"** (`.github/workflows/import-feeds.yml`, de hora em hora) roda
  `scripts/import-feeds.mjs`, que lê cada feed ativo **a cada 6 horas**, ou na hora seguinte a um clique em
  **"Importar agora"**;
- cada leitura é a mesma importação da linha de comando (abaixo), com `--sync` se a opção "Mandar para a lixeira o
  que sair do XML" estiver marcada;
- a tela mostra a última leitura: quantos entraram, foram atualizados, foram para a lixeira e foram ignorados, com
  os erros e avisos de cada anúncio, ou o motivo de não ter importado nada.

Proteções da leitura sem ninguém olhando:

- endereço fora do ar, resposta que não é VRSync ou XML **sem nenhum anúncio**: nada é importado nem vai para a
  lixeira, e a tela mostra o erro;
- se mais de **30%** dos anúncios importados (e mais de 3) saírem do XML de uma vez, nada vai para a lixeira e a tela
  avisa; se foi de propósito, apague pela tela ou rode a linha de comando com `--force`.

Na primeira vez, configure o segredo `SUPABASE_SERVICE_ROLE_KEY` no GitHub ([`supabase.md`](supabase.md), seção 6).
Para ler um cliente fora de hora: `npm run import:feeds -- --org <id>` (com as variáveis abaixo, ou `--local`).

## Pela linha de comando (suporte)

Na migração de um cliente, para conferir o relatório antes de ligar a importação automática:

1. Peça ao cliente o **link do feed** (o endereço que o CRM usa para os portais) ou o arquivo `.xml`.
2. Cadastre a imobiliária e a equipe antes (Minha conta → Suporte), para os anúncios irem para o corretor certo: o
   e-mail de contato de cada anúncio no XML é comparado com o e-mail dos corretores da equipe.
3. Simule primeiro e leia o relatório:
   ```bash
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<chave de serviço> \
     npm run import:xml -- --org <slug-da-imobiliaria> --url https://crm.exemplo/feed.xml --dry-run
   ```
4. Rode de verdade (sem `--dry-run`). Para sincronizar depois, rode de novo com `--sync`: o que saiu do XML vai para
   a lixeira (dá para restaurar por 30 dias). Anúncios cadastrados pela tela nunca são tocados.

A chave de serviço dá acesso total ao banco: use só no computador da equipe, nunca no site nem em mensagens.
Para testar no Supabase local, troque as variáveis por `--local`.

## O que acontece com cada anúncio

- **Identificação:** pelo `ListingID` do XML (vira o "código de referência"). Importar de novo atualiza o mesmo
  anúncio; mudança de preço entra no histórico (e uma redução aparece riscada, como na tela).
- **Local no mapa:** com `Latitude`/`Longitude`, o anúncio é encaixado no **prédio do mapa** naquele ponto (ou no
  mais próximo, até 25 m). Terreno vira um lote do tamanho informado. Sem coordenadas, o anúncio vai para o
  **bairro** e aparece como localização aproximada; o relatório avisa, e o corretor ajusta em "Editar anúncio".
- **O que mostrar do endereço:** respeita o `displayAddress` do XML (`All`, `Street`, `Neighborhood`). Sem prédio
  identificado, nunca mostra o endereço completo.
- **Fotos:** baixadas do CRM, reduzidas (1600 px e miniatura de 320 px) e **sem os metadados** (incluindo a posição
  GPS que fotos de celular carregam). A foto marcada como `primary` vira a capa; imagens com legenda "Planta" viram a
  planta. Importar de novo só baixa as fotos novas e remove as que saíram.
- **Campos lidos:** título, descrição (sem HTML), tipo, venda/locação, preço, aluguel, condomínio, IPTU, áreas,
  quartos, suítes, banheiros, vagas, andar, andares, ano, comodidades (piscina, churrasqueira, sacada, elevador,
  academia, pets, mobiliado), destaque (`PublicationType`), vídeo, endereço e contato.
- **Ignorados, com o motivo no relatório:** imóveis comerciais (exceto terrenos), rurais, sem preço ou sem área.
- **O que a equipe fez pela tela fica** (**Feito em 17/10**): anúncio despublicado (rascunho) continua despublicado;
  anúncio que alguém da equipe mandou para a lixeira não é restaurado (aparece em "ignorados"; restaure pela Lixeira
  para voltar a importar); anúncio cujo local foi ajustado pela tela (ponto, prédio, lote ou o que mostrar do
  endereço) mantém o local, e só o resto segue o XML. Só volta da lixeira o que a própria importação tirou.

Formato suportado hoje: VRSync. Outros (o XML do Chaves na Mão, o da Imovelweb) podem ser acrescentados com um
tradutor como `src/import/vrsync.ts`.
