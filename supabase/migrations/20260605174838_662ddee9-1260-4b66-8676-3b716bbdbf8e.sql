ALTER TABLE public.peca_cadastrada_operacoes
  ADD COLUMN IF NOT EXISTS pontos_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS nome_operacao text;

ALTER TABLE public.peca_operacoes_importadas
  ADD COLUMN IF NOT EXISTS pontos_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS nome_operacao text;