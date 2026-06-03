
CREATE TABLE public.almoxarifado_itens_catalogo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  referencia text NOT NULL,
  descricao text NOT NULL,
  categoria text NOT NULL DEFAULT 'outro',
  unidade text NOT NULL DEFAULT 'un',
  estoque_atual numeric NOT NULL DEFAULT 0,
  estoque_minimo numeric NOT NULL DEFAULT 0,
  custo_unitario numeric NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.almoxarifado_itens_catalogo TO authenticated;
GRANT ALL ON public.almoxarifado_itens_catalogo TO service_role;

ALTER TABLE public.almoxarifado_itens_catalogo ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_all ON public.almoxarifado_itens_catalogo
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_almox_cat_user ON public.almoxarifado_itens_catalogo(user_id);
CREATE INDEX idx_almox_cat_categoria ON public.almoxarifado_itens_catalogo(categoria);


CREATE TABLE public.projeto_almoxarifado_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid NOT NULL,
  item_catalogo_id uuid,
  referencia text,
  descricao text NOT NULL,
  categoria text NOT NULL DEFAULT 'outro',
  quantidade numeric NOT NULL DEFAULT 1,
  unidade text NOT NULL DEFAULT 'un',
  ambiente text,
  modulo text,
  status text NOT NULL DEFAULT 'pendente',
  separado_em timestamptz,
  separado_por text,
  observacao text,
  origem text NOT NULL DEFAULT 'manual',
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projeto_almoxarifado_itens TO authenticated;
GRANT ALL ON public.projeto_almoxarifado_itens TO service_role;

ALTER TABLE public.projeto_almoxarifado_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_all ON public.projeto_almoxarifado_itens
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_proj_almox_projeto ON public.projeto_almoxarifado_itens(projeto_id);
CREATE INDEX idx_proj_almox_status ON public.projeto_almoxarifado_itens(status);


CREATE TABLE public.almoxarifado_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  item_catalogo_id uuid,
  projeto_id uuid,
  tipo_movimento text NOT NULL DEFAULT 'ajuste',
  quantidade numeric NOT NULL DEFAULT 0,
  unidade text NOT NULL DEFAULT 'un',
  origem text,
  operador text,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.almoxarifado_movimentos TO authenticated;
GRANT ALL ON public.almoxarifado_movimentos TO service_role;

ALTER TABLE public.almoxarifado_movimentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_all ON public.almoxarifado_movimentos
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_almox_mov_item ON public.almoxarifado_movimentos(item_catalogo_id);
CREATE INDEX idx_almox_mov_projeto ON public.almoxarifado_movimentos(projeto_id);
