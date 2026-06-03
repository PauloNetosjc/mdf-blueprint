CREATE TABLE public.previews_cnc_chapas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid,
  plano_id uuid,
  plano_chapa_id uuid,
  chapa_id uuid,
  maquina_id uuid,
  versao integer NOT NULL DEFAULT 1,
  nome_arquivo text NOT NULL,
  conteudo text NOT NULL,
  parametros_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  validacoes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'rascunho',
  validado_por text,
  validado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.previews_cnc_chapas TO authenticated;
GRANT ALL ON public.previews_cnc_chapas TO service_role;

ALTER TABLE public.previews_cnc_chapas ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_all ON public.previews_cnc_chapas
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_previews_cnc_chapas_plano ON public.previews_cnc_chapas(plano_id);
CREATE INDEX idx_previews_cnc_chapas_chapa ON public.previews_cnc_chapas(plano_chapa_id);