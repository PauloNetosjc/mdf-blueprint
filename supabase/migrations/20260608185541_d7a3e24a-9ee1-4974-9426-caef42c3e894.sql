
ALTER TABLE public.projeto_pecas
  ADD COLUMN IF NOT EXISTS peca_cadastrada_id uuid NULL REFERENCES public.pecas_cadastradas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dados_tecnicos_aplicados_json jsonb NULL,
  ADD COLUMN IF NOT EXISTS status_tecnico text NULL,
  ADD COLUMN IF NOT EXISTS codigo text NULL,
  ADD COLUMN IF NOT EXISTS veio boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_projeto_pecas_peca_cadastrada
  ON public.projeto_pecas(peca_cadastrada_id);
