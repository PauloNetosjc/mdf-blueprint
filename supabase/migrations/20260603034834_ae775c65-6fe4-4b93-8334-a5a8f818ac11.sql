-- Estender previews_cnc_chapas
ALTER TABLE public.previews_cnc_chapas
  ADD COLUMN IF NOT EXISTS status_homologacao text NOT NULL DEFAULT 'rascunho',
  ADD COLUMN IF NOT EXISTS checklist_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS observacao_homologacao text,
  ADD COLUMN IF NOT EXISTS aprovado_por text,
  ADD COLUMN IF NOT EXISTS aprovado_em timestamptz,
  ADD COLUMN IF NOT EXISTS reprovado_por text,
  ADD COLUMN IF NOT EXISTS reprovado_em timestamptz,
  ADD COLUMN IF NOT EXISTS exportado_por text,
  ADD COLUMN IF NOT EXISTS exportado_em timestamptz,
  ADD COLUMN IF NOT EXISTS enviado_maquina_por text,
  ADD COLUMN IF NOT EXISTS enviado_maquina_em timestamptz;

-- Estender previews_cnc (peça)
ALTER TABLE public.previews_cnc
  ADD COLUMN IF NOT EXISTS status_homologacao text NOT NULL DEFAULT 'rascunho',
  ADD COLUMN IF NOT EXISTS checklist_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS observacao_homologacao text,
  ADD COLUMN IF NOT EXISTS aprovado_em timestamptz,
  ADD COLUMN IF NOT EXISTS reprovado_por text,
  ADD COLUMN IF NOT EXISTS reprovado_em timestamptz,
  ADD COLUMN IF NOT EXISTS exportado_por text,
  ADD COLUMN IF NOT EXISTS exportado_em timestamptz,
  ADD COLUMN IF NOT EXISTS enviado_maquina_por text,
  ADD COLUMN IF NOT EXISTS enviado_maquina_em timestamptz;

-- Tabela de auditoria
CREATE TABLE IF NOT EXISTS public.auditoria_eventos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid,
  peca_id uuid,
  chapa_id uuid,
  plano_id uuid,
  entidade_tipo text NOT NULL,
  entidade_id uuid,
  acao text NOT NULL,
  dados_antes_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  dados_depois_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  operador text,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auditoria_eventos TO authenticated;
GRANT ALL ON public.auditoria_eventos TO service_role;

ALTER TABLE public.auditoria_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON public.auditoria_eventos
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_auditoria_user ON public.auditoria_eventos(user_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_projeto ON public.auditoria_eventos(projeto_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON public.auditoria_eventos(entidade_tipo, entidade_id);
