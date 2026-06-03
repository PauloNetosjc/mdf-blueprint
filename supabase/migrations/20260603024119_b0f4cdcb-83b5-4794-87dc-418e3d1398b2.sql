CREATE TABLE public.etiquetas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid NOT NULL,
  plano_id uuid,
  plano_chapa_id uuid,
  plano_corte_peca_id uuid,
  projeto_peca_id uuid NOT NULL,
  numero_chapa integer NOT NULL DEFAULT 1,
  indice_peca text NOT NULL DEFAULT '1A',
  codigo_barras text NOT NULL,
  qr_code text,
  conteudo_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status_impressao text NOT NULL DEFAULT 'pendente',
  impresso_em timestamptz,
  quantidade_impressoes integer NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.etiquetas TO authenticated;
GRANT ALL ON public.etiquetas TO service_role;

ALTER TABLE public.etiquetas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON public.etiquetas
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_etiquetas_projeto ON public.etiquetas(projeto_id);
CREATE INDEX idx_etiquetas_plano ON public.etiquetas(plano_id);
CREATE UNIQUE INDEX idx_etiquetas_codigo ON public.etiquetas(user_id, codigo_barras);

-- Tabela de configuração de impressão por usuário
CREATE TABLE public.etiqueta_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() UNIQUE,
  largura_mm numeric NOT NULL DEFAULT 80,
  altura_mm numeric NOT NULL DEFAULT 50,
  margem_mm numeric NOT NULL DEFAULT 5,
  colunas integer NOT NULL DEFAULT 2,
  linhas integer NOT NULL DEFAULT 5,
  espacamento_h_mm numeric NOT NULL DEFAULT 3,
  espacamento_v_mm numeric NOT NULL DEFAULT 3,
  orientacao text NOT NULL DEFAULT 'retrato',
  campos_visiveis jsonb NOT NULL DEFAULT '{"cliente":true,"projeto":true,"ambiente":true,"modulo":true,"peca":true,"chapa":true,"numero_peca":true,"dimensoes":true,"fita":true,"codigo_item":true,"codigo_barras":true,"qr_code":false,"mini_mapa":true,"observacao":true}'::jsonb,
  preset text NOT NULL DEFAULT 'media',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.etiqueta_config TO authenticated;
GRANT ALL ON public.etiqueta_config TO service_role;

ALTER TABLE public.etiqueta_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON public.etiqueta_config
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);