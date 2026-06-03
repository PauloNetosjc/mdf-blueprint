-- Tabelas para biblioteca de Peças Cadastradas (técnica)

CREATE TABLE public.pecas_cadastradas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  codigo text NOT NULL,
  nome text,
  tipo_peca text,
  largura_ref numeric,
  altura_ref numeric,
  espessura_ref numeric,
  pdf_url text,
  pdf_nome text,
  origem text DEFAULT 'TECNICO FURACOES CADASTRO',
  metadados_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pecas_cadastradas TO authenticated;
GRANT ALL ON public.pecas_cadastradas TO service_role;
ALTER TABLE public.pecas_cadastradas ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.pecas_cadastradas FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_pecas_cadastradas_user ON public.pecas_cadastradas(user_id);
CREATE INDEX idx_pecas_cadastradas_codigo ON public.pecas_cadastradas(user_id, codigo);

CREATE TABLE public.peca_cadastrada_operacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  peca_cadastrada_id uuid NOT NULL REFERENCES public.pecas_cadastradas(id) ON DELETE CASCADE,
  face integer NOT NULL DEFAULT 0,
  tipo text NOT NULL,
  x numeric,
  y numeric,
  z numeric,
  diametro numeric,
  profundidade numeric,
  comprimento numeric,
  largura numeric,
  ancora_x text,
  ancora_y text,
  offset_x numeric,
  offset_y numeric,
  ordem integer DEFAULT 0,
  confianca text DEFAULT 'media',
  observacao text,
  dados_brutos jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.peca_cadastrada_operacoes TO authenticated;
GRANT ALL ON public.peca_cadastrada_operacoes TO service_role;
ALTER TABLE public.peca_cadastrada_operacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.peca_cadastrada_operacoes FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_pco_peca ON public.peca_cadastrada_operacoes(peca_cadastrada_id);

CREATE TABLE public.peca_cadastrada_bordas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  peca_cadastrada_id uuid NOT NULL REFERENCES public.pecas_cadastradas(id) ON DELETE CASCADE,
  lado text NOT NULL,
  tem_fita boolean NOT NULL DEFAULT false,
  fita_codigo text,
  fita_descricao text,
  espessura numeric,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.peca_cadastrada_bordas TO authenticated;
GRANT ALL ON public.peca_cadastrada_bordas TO service_role;
ALTER TABLE public.peca_cadastrada_bordas ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.peca_cadastrada_bordas FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_pcb_peca ON public.peca_cadastrada_bordas(peca_cadastrada_id);

-- Trigger atualizado_em
CREATE OR REPLACE FUNCTION public.tg_pecas_cadastradas_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pecas_cadastradas_touch
  BEFORE UPDATE ON public.pecas_cadastradas
  FOR EACH ROW EXECUTE FUNCTION public.tg_pecas_cadastradas_touch();