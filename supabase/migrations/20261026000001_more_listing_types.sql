-- A6 (prioridade 11): além de apartamento, casa, geminado e terreno, os tipos que os feeds VRSync trazem e que antes
-- eram descartados na importação: cobertura, kitnet ou studio, chácara ou sítio, sala comercial, loja e galpão.
alter type public.listing_type add value if not exists 'penthouse';
alter type public.listing_type add value if not exists 'studio';
alter type public.listing_type add value if not exists 'farm';
alter type public.listing_type add value if not exists 'office';
alter type public.listing_type add value if not exists 'store';
alter type public.listing_type add value if not exists 'warehouse';
