
CREATE TABLE public.importacao_preview_chapas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  importacao_id uuid NOT NULL,
  projeto_id uuid,
  chapa_id uuid,
  numero_chapa integer,
  tipo_preview text NOT NULL DEFAULT 'large',
  arquivo_nome text NOT NULL,
  storage_url text,
  pagina_pdf integer,
  largura_chapa numeric,
  altura_chapa numeric,
  metadados_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.importacao_preview_chapas TO authenticated;
GRANT ALL ON public.importacao_preview_chapas TO service_role;
ALTER TABLE public.importacao_preview_chapas ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.importacao_preview_chapas FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_preview_chapas_imp ON public.importacao_preview_chapas(importacao_id);
CREATE INDEX idx_preview_chapas_chapa ON public.importacao_preview_chapas(chapa_id);

CREATE TABLE public.importacao_etiquetas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  importacao_id uuid NOT NULL,
  projeto_id uuid,
  chapa_id uuid,
  peca_id uuid,
  projeto_peca_id uuid,
  nome_arquivo text NOT NULL,
  codigo_completo text,
  referencia text,
  codigo_peca text,
  sufixo text,
  duplicidade integer,
  storage_url text,
  status_vinculo text NOT NULL DEFAULT 'pendente_vinculo',
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.importacao_etiquetas TO authenticated;
GRANT ALL ON public.importacao_etiquetas TO service_role;
ALTER TABLE public.importacao_etiquetas ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.importacao_etiquetas FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_imp_etiquetas_imp ON public.importacao_etiquetas(importacao_id);
CREATE INDEX idx_imp_etiquetas_codigo ON public.importacao_etiquetas(codigo_peca);
