
ALTER TABLE public.peca_operacoes_importadas
  ADD COLUMN IF NOT EXISTS confianca_parser text NOT NULL DEFAULT 'media',
  ADD COLUMN IF NOT EXISTS ferramenta text,
  ADD COLUMN IF NOT EXISTS ordem integer,
  ADD COLUMN IF NOT EXISTS status_vinculo text NOT NULL DEFAULT 'vinculado',
  ADD COLUMN IF NOT EXISTS convertida_operacao_id uuid;

ALTER TABLE public.arquivos_tecnicos
  ADD COLUMN IF NOT EXISTS status_analise text NOT NULL DEFAULT 'nao_analisado',
  ADD COLUMN IF NOT EXISTS analise_resumo_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS analisado_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_poi_projeto ON public.peca_operacoes_importadas(projeto_id);
CREATE INDEX IF NOT EXISTS idx_poi_peca ON public.peca_operacoes_importadas(peca_id);
CREATE INDEX IF NOT EXISTS idx_poi_arquivo ON public.peca_operacoes_importadas(arquivo_tecnico_id);
