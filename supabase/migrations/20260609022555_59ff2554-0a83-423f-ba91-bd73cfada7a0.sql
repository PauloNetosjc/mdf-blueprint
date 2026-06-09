
CREATE TABLE public.almoxarifado_separacoes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid NOT NULL REFERENCES public.projetos(id) ON DELETE CASCADE,
  plano_corte_id uuid NOT NULL REFERENCES public.planos_corte(id) ON DELETE CASCADE,
  almoxarifado_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'gerado',
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_almox_sep_projeto ON public.almoxarifado_separacoes(projeto_id);
CREATE INDEX idx_almox_sep_plano ON public.almoxarifado_separacoes(plano_corte_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.almoxarifado_separacoes TO authenticated;
GRANT ALL ON public.almoxarifado_separacoes TO service_role;

ALTER TABLE public.almoxarifado_separacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON public.almoxarifado_separacoes
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
