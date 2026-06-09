
CREATE TABLE public.etiquetas_planos_corte (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid NOT NULL REFERENCES public.projetos(id) ON DELETE CASCADE,
  plano_corte_id uuid NOT NULL REFERENCES public.planos_corte(id) ON DELETE CASCADE,
  etiquetas_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_etiquetas integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'gerado',
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_etiquetas_pc_plano ON public.etiquetas_planos_corte(plano_corte_id);
CREATE INDEX idx_etiquetas_pc_projeto ON public.etiquetas_planos_corte(projeto_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.etiquetas_planos_corte TO authenticated;
GRANT ALL ON public.etiquetas_planos_corte TO service_role;
ALTER TABLE public.etiquetas_planos_corte ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON public.etiquetas_planos_corte FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
