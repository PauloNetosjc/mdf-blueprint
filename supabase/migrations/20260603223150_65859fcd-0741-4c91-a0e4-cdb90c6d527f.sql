ALTER TABLE public.pecas_cadastradas
  ADD COLUMN IF NOT EXISTS codigo_completo TEXT,
  ADD COLUMN IF NOT EXISTS prefixo TEXT,
  ADD COLUMN IF NOT EXISTS codigo_principal TEXT,
  ADD COLUMN IF NOT EXISTS sufixo TEXT;

UPDATE public.pecas_cadastradas SET codigo_completo = codigo WHERE codigo_completo IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pecas_cadastradas_user_codigo_completo_uidx
  ON public.pecas_cadastradas (user_id, codigo_completo);