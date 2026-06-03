
CREATE TABLE public.importacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid,
  nome_arquivo text NOT NULL,
  tipo text NOT NULL DEFAULT 'promob_zip',
  status text NOT NULL DEFAULT 'pendente',
  cliente_detectado text,
  projeto_detectado text,
  ambiente_detectado text,
  resumo_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  erros_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.importacoes TO authenticated;
GRANT ALL ON public.importacoes TO service_role;
ALTER TABLE public.importacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.importacoes
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.importacao_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  importacao_id uuid NOT NULL,
  nome_arquivo text NOT NULL,
  caminho_original text NOT NULL,
  tipo_arquivo text,
  origem_pasta text,
  status_leitura text NOT NULL DEFAULT 'encontrado',
  storage_url text,
  metadados_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.importacao_arquivos TO authenticated;
GRANT ALL ON public.importacao_arquivos TO service_role;
ALTER TABLE public.importacao_arquivos ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.importacao_arquivos
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_imp_arq_imp ON public.importacao_arquivos(importacao_id);

CREATE TABLE public.arquivos_tecnicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid,
  peca_id uuid,
  chapa_id uuid,
  importacao_id uuid,
  origem_pasta text,
  tipo_arquivo text,
  nome_arquivo text NOT NULL,
  storage_url text,
  dados_extraidos_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.arquivos_tecnicos TO authenticated;
GRANT ALL ON public.arquivos_tecnicos TO service_role;
ALTER TABLE public.arquivos_tecnicos ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.arquivos_tecnicos
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_arq_tec_projeto ON public.arquivos_tecnicos(projeto_id);
CREATE INDEX idx_arq_tec_imp ON public.arquivos_tecnicos(importacao_id);

CREATE TABLE public.peca_operacoes_importadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid,
  peca_id uuid,
  arquivo_tecnico_id uuid,
  origem text,
  face text,
  tipo_operacao text,
  x numeric,
  y numeric,
  z numeric,
  diametro numeric,
  profundidade numeric,
  largura numeric,
  comprimento numeric,
  dados_brutos jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.peca_operacoes_importadas TO authenticated;
GRANT ALL ON public.peca_operacoes_importadas TO service_role;
ALTER TABLE public.peca_operacoes_importadas ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.peca_operacoes_importadas
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_op_imp_projeto ON public.peca_operacoes_importadas(projeto_id);
