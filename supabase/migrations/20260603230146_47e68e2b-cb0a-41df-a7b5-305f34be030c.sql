ALTER TABLE public.pecas_cadastradas
  ADD COLUMN IF NOT EXISTS parser_alertas_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resumo_parser_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS motivo_status text;

NOTIFY pgrst, 'reload schema';