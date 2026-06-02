
-- Remove seed data sem dono (antes era acessível por qualquer um, agora deve ser recriado por usuário)
TRUNCATE TABLE public.operacoes, public.faces, public.previews_cnc, public.arquivos_importados, public.pecas, public.ferramentas, public.maquinas RESTART IDENTITY;

ALTER TABLE public.maquinas ADD COLUMN user_id uuid NOT NULL DEFAULT auth.uid();
ALTER TABLE public.ferramentas ADD COLUMN user_id uuid NOT NULL DEFAULT auth.uid();
ALTER TABLE public.pecas ADD COLUMN user_id uuid NOT NULL DEFAULT auth.uid();
ALTER TABLE public.faces ADD COLUMN user_id uuid NOT NULL DEFAULT auth.uid();
ALTER TABLE public.operacoes ADD COLUMN user_id uuid NOT NULL DEFAULT auth.uid();
ALTER TABLE public.previews_cnc ADD COLUMN user_id uuid NOT NULL DEFAULT auth.uid();
ALTER TABLE public.arquivos_importados ADD COLUMN user_id uuid NOT NULL DEFAULT auth.uid();

DROP POLICY IF EXISTS acesso_total ON public.maquinas;
DROP POLICY IF EXISTS acesso_total ON public.ferramentas;
DROP POLICY IF EXISTS acesso_total ON public.pecas;
DROP POLICY IF EXISTS acesso_total ON public.faces;
DROP POLICY IF EXISTS acesso_total ON public.operacoes;
DROP POLICY IF EXISTS acesso_total ON public.previews_cnc;
DROP POLICY IF EXISTS acesso_total ON public.arquivos_importados;

REVOKE ALL ON public.maquinas, public.ferramentas, public.pecas, public.faces,
              public.operacoes, public.previews_cnc, public.arquivos_importados FROM anon, public;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.maquinas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ferramentas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pecas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.faces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operacoes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.previews_cnc TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.arquivos_importados TO authenticated;

GRANT ALL ON public.maquinas, public.ferramentas, public.pecas, public.faces,
             public.operacoes, public.previews_cnc, public.arquivos_importados TO service_role;

CREATE POLICY "owner_all" ON public.maquinas FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_all" ON public.ferramentas FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_all" ON public.pecas FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_all" ON public.faces FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_all" ON public.operacoes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_all" ON public.previews_cnc FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_all" ON public.arquivos_importados FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.handle_new_user_seed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_seed ON auth.users;
CREATE TRIGGER on_auth_user_created_seed
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_seed();
