ALTER TABLE public.pecas DROP CONSTRAINT IF EXISTS pecas_codigo_key;
CREATE UNIQUE INDEX IF NOT EXISTS pecas_user_codigo_key ON public.pecas(user_id, codigo);