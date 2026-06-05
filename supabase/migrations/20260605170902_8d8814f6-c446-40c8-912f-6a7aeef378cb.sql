
-- 1) Tabela de vínculos entre peças do projeto e biblioteca
CREATE TABLE IF NOT EXISTS public.vinculos_peca_cadastrada (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid NOT NULL,
  projeto_peca_id uuid NOT NULL,
  peca_cadastrada_id uuid,
  tipo_vinculo text NOT NULL DEFAULT 'manual',
  confianca text NOT NULL DEFAULT 'media',
  status text NOT NULL DEFAULT 'sugerido',
  motivo text,
  metadados_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (projeto_peca_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vinculos_peca_cadastrada TO authenticated;
GRANT ALL ON public.vinculos_peca_cadastrada TO service_role;

ALTER TABLE public.vinculos_peca_cadastrada ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON public.vinculos_peca_cadastrada
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.tg_vinculos_pc_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_vinculos_pc_touch BEFORE UPDATE ON public.vinculos_peca_cadastrada
  FOR EACH ROW EXECUTE FUNCTION public.tg_vinculos_pc_touch();

CREATE INDEX IF NOT EXISTS idx_vinc_pc_projeto ON public.vinculos_peca_cadastrada(projeto_id);
CREATE INDEX IF NOT EXISTS idx_vinc_pc_cadastrada ON public.vinculos_peca_cadastrada(peca_cadastrada_id);

-- 2) Estender peca_operacoes_importadas para suportar origem biblioteca
ALTER TABLE public.peca_operacoes_importadas
  ADD COLUMN IF NOT EXISTS projeto_peca_id uuid,
  ADD COLUMN IF NOT EXISTS peca_cadastrada_id uuid,
  ADD COLUMN IF NOT EXISTS x1 numeric,
  ADD COLUMN IF NOT EXISTS x2 numeric,
  ADD COLUMN IF NOT EXISTS y1 numeric,
  ADD COLUMN IF NOT EXISTS y2 numeric,
  ADD COLUMN IF NOT EXISTS revisada boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_opimp_projeto_peca ON public.peca_operacoes_importadas(projeto_peca_id);

-- 3) Tabela de bordas importadas (engenharia da biblioteca aplicada à peça do projeto)
CREATE TABLE IF NOT EXISTS public.peca_bordas_importadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid,
  projeto_peca_id uuid NOT NULL,
  peca_cadastrada_id uuid,
  lado text NOT NULL,
  tem_fita boolean NOT NULL DEFAULT false,
  fita_codigo text,
  fita_descricao text,
  espessura numeric,
  largura numeric,
  cor text,
  indicador_desenho text,
  origem text NOT NULL DEFAULT 'biblioteca_pecas_cadastradas',
  status text NOT NULL DEFAULT 'aguardando_revisao',
  divergencia text,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.peca_bordas_importadas TO authenticated;
GRANT ALL ON public.peca_bordas_importadas TO service_role;

ALTER TABLE public.peca_bordas_importadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON public.peca_bordas_importadas
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_bordimp_projeto_peca ON public.peca_bordas_importadas(projeto_peca_id);

NOTIFY pgrst, 'reload schema';
