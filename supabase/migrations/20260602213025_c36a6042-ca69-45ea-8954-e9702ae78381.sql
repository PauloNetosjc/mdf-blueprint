
-- Tabelas principais (MVP sem auth — uso interno)

CREATE TABLE public.maquinas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  area_x NUMERIC NOT NULL DEFAULT 2800,
  area_y NUMERIC NOT NULL DEFAULT 120,
  area_z NUMERIC NOT NULL DEFAULT 50,
  altura_segura_z NUMERIC NOT NULL DEFAULT 20,
  unidade TEXT NOT NULL DEFAULT 'mm',
  origem_padrao TEXT NOT NULL DEFAULT 'canto-inferior-esquerdo',
  template_inicio TEXT NOT NULL DEFAULT 'G21\nG90\nG0 Z{ALTURA_SEGURA}',
  template_fim TEXT NOT NULL DEFAULT 'G0 Z{ALTURA_SEGURA}\nM5\nM30',
  template_troca_ferramenta TEXT NOT NULL DEFAULT '; Troca ferramenta {TOOL_CODE} - {TOOL_NAME}\nM5\nM6 T{TOOL_NUM}\nM3 S{RPM}',
  template_spindle_on TEXT NOT NULL DEFAULT 'M3 S{RPM}',
  template_spindle_off TEXT NOT NULL DEFAULT 'M5',
  template_furacao_face TEXT NOT NULL DEFAULT 'G0 X{X} Y{Y}\nG0 Z{ALTURA_SEGURA}\nG1 Z-{DEPTH} F{FEED}\nG0 Z{ALTURA_SEGURA}',
  template_furacao_lateral TEXT NOT NULL DEFAULT '; Furo lateral face {FACE}\nG0 X{X} Y{Y} Z{Z}\nG1 Z{Z_FINAL} F{FEED}\nG0 Z{ALTURA_SEGURA}',
  mapeamento_faces JSONB NOT NULL DEFAULT '{"0":{"eixo_x":"X","eixo_y":"Y","eixo_z":"Z"},"1":{"eixo_x":"X","eixo_y":"Z","eixo_z":"Y"},"2":{"eixo_x":"Y","eixo_y":"Z","eixo_z":"X"},"3":{"eixo_x":"X","eixo_y":"Z","eixo_z":"Y"},"4":{"eixo_x":"Y","eixo_y":"Z","eixo_z":"X"}}'::jsonb,
  ativa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.ferramentas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maquina_id UUID REFERENCES public.maquinas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  codigo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  diametro NUMERIC NOT NULL,
  area_util NUMERIC,
  profundidade_maxima NUMERIC NOT NULL DEFAULT 30,
  rotacao_padrao INTEGER NOT NULL DEFAULT 18000,
  avanco_padrao INTEGER NOT NULL DEFAULT 800,
  face_permitida TEXT NOT NULL DEFAULT 'ambas',
  entrada_por_cima BOOLEAN NOT NULL DEFAULT true,
  entrada_lateral BOOLEAN NOT NULL DEFAULT false,
  descida_antes_entrada_lateral NUMERIC,
  altura_segura NUMERIC NOT NULL DEFAULT 20,
  ativa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.pecas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  cliente TEXT,
  ambiente TEXT,
  largura NUMERIC NOT NULL,
  altura NUMERIC NOT NULL,
  espessura NUMERIC NOT NULL,
  material TEXT DEFAULT 'MDF',
  face_alinhamento TEXT NOT NULL DEFAULT 'A',
  status TEXT NOT NULL DEFAULT 'rascunho',
  arquivo_origem TEXT,
  data_ficha DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.faces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id UUID NOT NULL REFERENCES public.pecas(id) ON DELETE CASCADE,
  numero_face INTEGER NOT NULL,
  nome_face TEXT,
  orientacao TEXT,
  eixo_x_mapeado TEXT DEFAULT 'X',
  eixo_y_mapeado TEXT DEFAULT 'Y',
  eixo_z_mapeado TEXT DEFAULT 'Z',
  UNIQUE(peca_id, numero_face)
);

CREATE TABLE public.operacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id UUID NOT NULL REFERENCES public.pecas(id) ON DELETE CASCADE,
  face_id UUID REFERENCES public.faces(id) ON DELETE SET NULL,
  numero_face INTEGER NOT NULL DEFAULT 0,
  ferramenta_id UUID REFERENCES public.ferramentas(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  x NUMERIC NOT NULL,
  y NUMERIC NOT NULL,
  z NUMERIC,
  diametro NUMERIC,
  largura NUMERIC,
  comprimento NUMERIC,
  profundidade NUMERIC NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.arquivos_importados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id UUID REFERENCES public.pecas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  nome_arquivo TEXT NOT NULL,
  url_arquivo TEXT,
  dados_extraidos_json JSONB,
  status_leitura TEXT DEFAULT 'pendente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.previews_cnc (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id UUID NOT NULL REFERENCES public.pecas(id) ON DELETE CASCADE,
  maquina_id UUID NOT NULL REFERENCES public.maquinas(id) ON DELETE RESTRICT,
  versao INTEGER NOT NULL DEFAULT 1,
  conteudo TEXT NOT NULL,
  nome_arquivo TEXT NOT NULL,
  validado BOOLEAN NOT NULL DEFAULT false,
  aprovado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grants (MVP interno: anon e authenticated têm acesso total)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maquinas TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ferramentas TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pecas TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.faces TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operacoes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.arquivos_importados TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.previews_cnc TO anon, authenticated;
GRANT ALL ON public.maquinas, public.ferramentas, public.pecas, public.faces, public.operacoes, public.arquivos_importados, public.previews_cnc TO service_role;

-- RLS aberta (MVP)
ALTER TABLE public.maquinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ferramentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pecas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arquivos_importados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.previews_cnc ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acesso_total" ON public.maquinas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total" ON public.ferramentas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total" ON public.pecas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total" ON public.faces FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total" ON public.operacoes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total" ON public.arquivos_importados FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total" ON public.previews_cnc FOR ALL USING (true) WITH CHECK (true);
