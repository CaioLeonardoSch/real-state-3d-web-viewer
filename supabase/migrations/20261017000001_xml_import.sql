-- Importação de feeds XML (VRSync) dos sistemas das imobiliárias: scripts/import-xml.mjs.

-- De onde veio o anúncio ('xml' = importado). Uma nova importação com --sync só manda para a lixeira o que veio do
-- XML; o que foi cadastrado pela tela nunca é tocado.
alter table public.listings add column import_source text check (import_source in ('xml'));
-- endereço original da foto no feed: importar de novo não baixa a mesma foto duas vezes
alter table public.listing_photos add column source_url text;
create index listing_photos_source_idx on public.listing_photos (listing_id, source_url) where source_url is not null;

-- Anúncio sem prédio identificado no mapa (feed sem coordenadas, ou coordenada fora de um prédio) só pode ser
-- mostrado como aproximado: o site desenha o círculo, e o corretor escolhe o prédio depois em "Editar anúncio".
alter table public.listings drop constraint building_has_osm;
alter table public.listings add constraint building_has_osm
  check (type = 'land' or building_osm_id is not null or address_display <> 'full');
alter table public.listings drop constraint land_has_lot;
alter table public.listings add constraint land_has_lot
  check (type <> 'land' or lot is not null or address_display <> 'full');
