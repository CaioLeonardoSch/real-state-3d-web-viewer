# Importação de anúncios por XML (VRSync)

Para a equipe de suporte, na migração de um cliente. Quase todo sistema de imobiliária (CRM) gera um arquivo XML no
formato **VRSync**, o mesmo que manda para ZAP, VivaReal e OLX. Importando esse arquivo, o cliente não recadastra
nada, e pode continuar usando o CRM: rodar a importação de novo atualiza os anúncios.

## Como rodar

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

Formato suportado hoje: VRSync. Outros (o XML do Chaves na Mão, o da Imovelweb) podem ser acrescentados com um
tradutor como `src/import/vrsync.ts`.
