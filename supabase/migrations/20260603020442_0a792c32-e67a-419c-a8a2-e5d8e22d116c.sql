
-- ============ PROJETOS ============
CREATE TABLE public.projetos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  nome text NOT NULL,
  cliente text,
  ambiente text,
  observacao text,
  status text NOT NULL DEFAULT 'ativo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projetos TO authenticated;
GRANT ALL ON public.projetos TO service_role;
ALTER TABLE public.projetos ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.projetos FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ CHAPAS ============
CREATE TABLE public.chapas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  nome text NOT NULL,
  codigo text NOT NULL,
  tipo text NOT NULL DEFAULT 'MDP',
  cor text NOT NULL DEFAULT '#d6c6a8',
  espessura numeric NOT NULL,
  largura numeric NOT NULL DEFAULT 2750,
  altura numeric NOT NULL DEFAULT 1850,
  veio text NOT NULL DEFAULT 'nenhum',
  permite_rotacao boolean NOT NULL DEFAULT true,
  estoque integer NOT NULL DEFAULT 0,
  custo numeric NOT NULL DEFAULT 0,
  ativa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chapas TO authenticated;
GRANT ALL ON public.chapas TO service_role;
ALTER TABLE public.chapas ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.chapas FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ FITAS ============
CREATE TABLE public.fitas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  codigo text NOT NULL,
  descricao text NOT NULL,
  cor text NOT NULL DEFAULT '#cccccc',
  espessura numeric NOT NULL DEFAULT 0.45,
  largura numeric NOT NULL DEFAULT 22,
  chapa_id uuid REFERENCES public.chapas(id) ON DELETE SET NULL,
  estoque_m numeric NOT NULL DEFAULT 0,
  custo numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fitas TO authenticated;
GRANT ALL ON public.fitas TO service_role;
ALTER TABLE public.fitas ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.fitas FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ PROJETO_PECAS ============
CREATE TABLE public.projeto_pecas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid NOT NULL REFERENCES public.projetos(id) ON DELETE CASCADE,
  peca_id uuid REFERENCES public.pecas(id) ON DELETE SET NULL,
  descricao text NOT NULL,
  quantidade integer NOT NULL DEFAULT 1,
  altura numeric NOT NULL,
  largura numeric NOT NULL,
  espessura numeric NOT NULL DEFAULT 15,
  chapa_id uuid REFERENCES public.chapas(id) ON DELETE SET NULL,
  fita_codigo text,
  modulo text,
  observacao text,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projeto_pecas TO authenticated;
GRANT ALL ON public.projeto_pecas TO service_role;
ALTER TABLE public.projeto_pecas ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.projeto_pecas FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_projeto_pecas_projeto ON public.projeto_pecas(projeto_id);

-- ============ PLANOS_CORTE ============
CREATE TABLE public.planos_corte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  projeto_id uuid NOT NULL REFERENCES public.projetos(id) ON DELETE CASCADE,
  versao integer NOT NULL DEFAULT 1,
  aproveitamento_medio numeric NOT NULL DEFAULT 0,
  total_chapas integer NOT NULL DEFAULT 0,
  total_pecas integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.planos_corte TO authenticated;
GRANT ALL ON public.planos_corte TO service_role;
ALTER TABLE public.planos_corte ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.planos_corte FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ PLANO_CORTE_CHAPAS ============
CREATE TABLE public.plano_corte_chapas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  plano_id uuid NOT NULL REFERENCES public.planos_corte(id) ON DELETE CASCADE,
  chapa_id uuid NOT NULL REFERENCES public.chapas(id) ON DELETE RESTRICT,
  indice integer NOT NULL,
  aproveitamento numeric NOT NULL DEFAULT 0,
  area_usada numeric NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plano_corte_chapas TO authenticated;
GRANT ALL ON public.plano_corte_chapas TO service_role;
ALTER TABLE public.plano_corte_chapas ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.plano_corte_chapas FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ PLANO_CORTE_PECAS ============
CREATE TABLE public.plano_corte_pecas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  plano_chapa_id uuid NOT NULL REFERENCES public.plano_corte_chapas(id) ON DELETE CASCADE,
  projeto_peca_id uuid NOT NULL REFERENCES public.projeto_pecas(id) ON DELETE CASCADE,
  x numeric NOT NULL,
  y numeric NOT NULL,
  largura numeric NOT NULL,
  altura numeric NOT NULL,
  rotacionada boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plano_corte_pecas TO authenticated;
GRANT ALL ON public.plano_corte_pecas TO service_role;
ALTER TABLE public.plano_corte_pecas ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.plano_corte_pecas FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ SOBRAS_CHAPA ============
CREATE TABLE public.sobras_chapa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  plano_chapa_id uuid NOT NULL REFERENCES public.plano_corte_chapas(id) ON DELETE CASCADE,
  x numeric NOT NULL,
  y numeric NOT NULL,
  largura numeric NOT NULL,
  altura numeric NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sobras_chapa TO authenticated;
GRANT ALL ON public.sobras_chapa TO service_role;
ALTER TABLE public.sobras_chapa ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.sobras_chapa FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ SEED em handle_new_user_seed ============
CREATE OR REPLACE FUNCTION public.handle_new_user_seed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_maquina_id uuid;
  v_ferr_face uuid;
  v_ferr_lateral uuid;
  v_peca_id uuid;
  v_face0 uuid;
  v_face1 uuid;
  v_face3 uuid;
BEGIN
  INSERT INTO public.maquinas (user_id, nome) VALUES (NEW.id, 'Furadeira CNC Padrão')
  RETURNING id INTO v_maquina_id;

  INSERT INTO public.ferramentas (user_id, maquina_id, nome, codigo, tipo, diametro, profundidade_maxima, face_permitida, entrada_por_cima, entrada_lateral)
  VALUES (NEW.id, v_maquina_id, 'Broca Face 8mm', 'T1', 'furo_face', 8, 25, 'face_superior', true, false)
  RETURNING id INTO v_ferr_face;

  INSERT INTO public.ferramentas (user_id, maquina_id, nome, codigo, tipo, diametro, profundidade_maxima, face_permitida, entrada_por_cima, entrada_lateral, descida_antes_entrada_lateral)
  VALUES (NEW.id, v_maquina_id, 'Broca Lateral 8mm', 'T2', 'furo_topo', 8, 35, 'topo_lateral', false, true, 5)
  RETURNING id INTO v_ferr_lateral;

  INSERT INTO public.pecas (user_id, codigo, nome, cliente, ambiente, largura, altura, espessura, material, status)
  VALUES (NEW.id, 'TR19682A', 'Travessa Exemplo', 'Cliente Exemplo', 'Ambiente Exemplo', 639, 90, 15.5, 'MDF', 'rascunho')
  RETURNING id INTO v_peca_id;

  INSERT INTO public.faces (user_id, peca_id, numero_face, nome_face) VALUES (NEW.id, v_peca_id, 0, 'Face Superior') RETURNING id INTO v_face0;
  INSERT INTO public.faces (user_id, peca_id, numero_face, nome_face) VALUES (NEW.id, v_peca_id, 1, 'Topo Frontal') RETURNING id INTO v_face1;
  INSERT INTO public.faces (user_id, peca_id, numero_face, nome_face) VALUES (NEW.id, v_peca_id, 2, 'Topo Direito');
  INSERT INTO public.faces (user_id, peca_id, numero_face, nome_face) VALUES (NEW.id, v_peca_id, 3, 'Topo Traseiro') RETURNING id INTO v_face3;
  INSERT INTO public.faces (user_id, peca_id, numero_face, nome_face) VALUES (NEW.id, v_peca_id, 4, 'Topo Esquerdo');

  INSERT INTO public.operacoes (user_id, peca_id, face_id, numero_face, ferramenta_id, tipo, x, y, z, diametro, profundidade, ordem)
  VALUES
    (NEW.id, v_peca_id, v_face0, 0, v_ferr_face, 'furacao', 32, 45, NULL, 8, 12, 1),
    (NEW.id, v_peca_id, v_face0, 0, v_ferr_face, 'furacao', 607, 45, NULL, 8, 12, 2),
    (NEW.id, v_peca_id, v_face1, 1, v_ferr_lateral, 'furacao', 32, 7.75, NULL, 8, 20, 3),
    (NEW.id, v_peca_id, v_face1, 1, v_ferr_lateral, 'furacao', 607, 7.75, NULL, 8, 20, 4),
    (NEW.id, v_peca_id, v_face3, 3, v_ferr_lateral, 'furacao', 32, 7.75, NULL, 8, 20, 5),
    (NEW.id, v_peca_id, v_face3, 3, v_ferr_lateral, 'furacao', 607, 7.75, NULL, 8, 20, 6);

  -- Seed chapas iniciais
  INSERT INTO public.chapas (user_id, nome, codigo, tipo, cor, espessura, largura, altura) VALUES
    (NEW.id, 'MDP Beige Matt 15mm', 'BEIGE15', 'MDP', '#e8dcc4', 15, 2750, 1850),
    (NEW.id, 'MDP Cerrado Bold 15mm', 'CERRADO15', 'MDP', '#6b4a2e', 15, 2750, 1850),
    (NEW.id, 'MDP Beige Matt 25mm', 'BEIGE25', 'MDP', '#e8dcc4', 25, 2750, 1850);

  RETURN NEW;
END;
$function$;
