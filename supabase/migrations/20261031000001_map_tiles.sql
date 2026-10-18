-- Tiles do mapa (.pmtiles) fora do git: um arquivo por versão mensal, com o nome que nunca muda de conteúdo
-- (<região>-<mês>-<hash>.pmtiles), lido pelo navegador por range requests. Público para leitura; só o serviço mensal
-- (chave service_role, em .github/workflows/mapa-mensal.yml) grava: não há política de escrita para os usuários.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('map-tiles', 'map-tiles', true, 52428800, array['application/vnd.pmtiles', 'application/octet-stream'])
on conflict (id) do nothing;
