ALTER TABLE public.projeto_pecas
  ADD COLUMN IF NOT EXISTS codigo_peca text,
  ADD COLUMN IF NOT EXISTS indice_peca text,
  ADD COLUMN IF NOT EXISTS origem_importacao text;

ALTER TABLE public.planos_corte
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'gerado',
  ADD COLUMN IF NOT EXISTS origem_importacao text,
  ADD COLUMN IF NOT EXISTS observacao text;

ALTER TABLE public.importacao_etiquetas
  ADD COLUMN IF NOT EXISTS pos_x numeric,
  ADD COLUMN IF NOT EXISTS pos_y numeric,
  ADD COLUMN IF NOT EXISTS rotacao numeric;

CREATE INDEX IF NOT EXISTS idx_projeto_pecas_codigo_peca ON public.projeto_pecas(projeto_id, codigo_peca);
CREATE INDEX IF NOT EXISTS idx_projeto_pecas_indice_peca ON public.projeto_pecas(projeto_id, indice_peca);
CREATE INDEX IF NOT EXISTS idx_planos_corte_status ON public.planos_corte(projeto_id, status);