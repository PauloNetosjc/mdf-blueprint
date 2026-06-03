
CREATE TABLE IF NOT EXISTS public.comparacoes_cnc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid,
  peca_id uuid,
  chapa_id uuid,
  arquivo_original_id uuid,
  preview_cnc_id uuid,
  maquina_id uuid,
  nome text,
  status text NOT NULL DEFAULT 'pendente',
  resumo_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  diferencas_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  tolerancias_json jsonb NOT NULL DEFAULT '{"xy":0.5,"z":0.5,"feed":50,"rpm":500}'::jsonb,
  sugestoes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  observacoes text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.comparacoes_cnc TO authenticated;
GRANT ALL ON public.comparacoes_cnc TO service_role;

ALTER TABLE public.comparacoes_cnc ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON public.comparacoes_cnc
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_cmp_projeto ON public.comparacoes_cnc(projeto_id);
CREATE INDEX IF NOT EXISTS idx_cmp_maquina ON public.comparacoes_cnc(maquina_id);
