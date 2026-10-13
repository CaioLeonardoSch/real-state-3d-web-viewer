-- Convites enviados por e-mail (função send-invite): quando foi enviado, para não repetir.
alter table public.invitations add column emailed_at timestamptz;
