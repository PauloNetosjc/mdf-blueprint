-- Centros de trabalho
CREATE TABLE public.centros_trabalho (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'corte',
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.centros_trabalho TO authenticated;
GRANT ALL ON public.centros_trabalho TO service_role;
ALTER TABLE public.centros_trabalho ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.centros_trabalho FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Status de produção por peça
CREATE TABLE public.producao_status_pecas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid NOT NULL,
  projeto_peca_id uuid NOT NULL,
  plano_corte_peca_id uuid,
  etiqueta_id uuid,
  status_corte text NOT NULL DEFAULT 'pendente',
  status_furacao text NOT NULL DEFAULT 'pendente',
  status_borda text NOT NULL DEFAULT 'pendente',
  status_separacao text NOT NULL DEFAULT 'pendente',
  status_almoxarifado text NOT NULL DEFAULT 'pendente',
  status_expedicao text NOT NULL DEFAULT 'pendente',
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (projeto_peca_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.producao_status_pecas TO authenticated;
GRANT ALL ON public.producao_status_pecas TO service_role;
ALTER TABLE public.producao_status_pecas ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.producao_status_pecas FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_psp_projeto ON public.producao_status_pecas(projeto_id);

-- Eventos de produção
CREATE TABLE public.producao_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid,
  projeto_peca_id uuid,
  plano_corte_peca_id uuid,
  etiqueta_id uuid,
  centro_trabalho_id uuid,
  tipo_evento text NOT NULL,
  status_anterior text,
  status_novo text,
  codigo_barras text,
  operador text,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.producao_eventos TO authenticated;
GRANT ALL ON public.producao_eventos TO service_role;
ALTER TABLE public.producao_eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.producao_eventos FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_pe_peca ON public.producao_eventos(projeto_peca_id);
CREATE INDEX idx_pe_projeto ON public.producao_eventos(projeto_id);

-- Ocorrências
CREATE TABLE public.ocorrencias_producao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid,
  projeto_peca_id uuid,
  etiqueta_id uuid,
  centro_trabalho_id uuid,
  tipo text NOT NULL DEFAULT 'outro',
  descricao text,
  status text NOT NULL DEFAULT 'aberta',
  operador text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ocorrencias_producao TO authenticated;
GRANT ALL ON public.ocorrencias_producao TO service_role;
ALTER TABLE public.ocorrencias_producao ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.ocorrencias_producao FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Seed de centros de trabalho ao criar usuário (estende função existente)
CREATE OR REPLACE FUNCTION public.seed_centros_trabalho()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.centros_trabalho (user_id, nome, tipo) VALUES
    (NEW.id, 'Corte', 'corte'),
    (NEW.id, 'Furação', 'furacao'),
    (NEW.id, 'Borda', 'borda'),
    (NEW.id, 'Separação', 'separacao'),
    (NEW.id, 'Almoxarifado', 'almoxarifado'),
    (NEW.id, 'Expedição', 'expedicao');
  RETURN NEW;
END;
$$;