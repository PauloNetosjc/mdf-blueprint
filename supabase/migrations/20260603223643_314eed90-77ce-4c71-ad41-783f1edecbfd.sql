ALTER TABLE public.pecas_cadastradas
  ADD COLUMN IF NOT EXISTS codigo_completo text,
  ADD COLUMN IF NOT EXISTS prefixo text,
  ADD COLUMN IF NOT EXISTS codigo_principal text,
  ADD COLUMN IF NOT EXISTS sufixo text,
  ADD COLUMN IF NOT EXISTS nome_peca text,
  ADD COLUMN IF NOT EXISTS modulo_origem text,
  ADD COLUMN IF NOT EXISTS material_ref text,
  ADD COLUMN IF NOT EXISTS fita_ref text,
  ADD COLUMN IF NOT EXISTS pdf_nome_arquivo text,
  ADD COLUMN IF NOT EXISTS status_parser text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS erros_parser jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS logs_parser jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dados_brutos_json jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.pecas_cadastradas
SET
  codigo_completo = COALESCE(codigo_completo, codigo),
  nome_peca = COALESCE(nome_peca, nome),
  pdf_nome_arquivo = COALESCE(pdf_nome_arquivo, pdf_nome),
  status_parser = COALESCE(status_parser, 'pendente')
WHERE codigo_completo IS NULL
   OR nome_peca IS NULL
   OR pdf_nome_arquivo IS NULL
   OR status_parser IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pecas_cadastradas_user_codigo_completo_uidx
  ON public.pecas_cadastradas (user_id, codigo_completo);

CREATE INDEX IF NOT EXISTS pecas_cadastradas_user_status_parser_idx
  ON public.pecas_cadastradas (user_id, status_parser);

CREATE INDEX IF NOT EXISTS pecas_cadastradas_user_prefixo_idx
  ON public.pecas_cadastradas (user_id, prefixo);

ALTER TABLE public.peca_cadastrada_operacoes
  ADD COLUMN IF NOT EXISTS tipo_operacao text,
  ADD COLUMN IF NOT EXISTS x1 numeric,
  ADD COLUMN IF NOT EXISTS x2 numeric,
  ADD COLUMN IF NOT EXISTS y1 numeric,
  ADD COLUMN IF NOT EXISTS y2 numeric,
  ADD COLUMN IF NOT EXISTS confianca_parser text DEFAULT 'media',
  ADD COLUMN IF NOT EXISTS dados_brutos_json jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.peca_cadastrada_operacoes
SET
  tipo_operacao = COALESCE(tipo_operacao, tipo),
  confianca_parser = COALESCE(confianca_parser, confianca),
  dados_brutos_json = COALESCE(dados_brutos_json, dados_brutos, '{}'::jsonb)
WHERE tipo_operacao IS NULL
   OR confianca_parser IS NULL
   OR dados_brutos_json IS NULL;

CREATE INDEX IF NOT EXISTS peca_cadastrada_operacoes_peca_face_ordem_idx
  ON public.peca_cadastrada_operacoes (peca_cadastrada_id, face, ordem);

ALTER TABLE public.peca_cadastrada_bordas
  ADD COLUMN IF NOT EXISTS codigo_borda text,
  ADD COLUMN IF NOT EXISTS descricao_borda text,
  ADD COLUMN IF NOT EXISTS largura numeric,
  ADD COLUMN IF NOT EXISTS cor text,
  ADD COLUMN IF NOT EXISTS indicador_desenho text,
  ADD COLUMN IF NOT EXISTS confianca_parser text DEFAULT 'media';

UPDATE public.peca_cadastrada_bordas
SET
  codigo_borda = COALESCE(codigo_borda, fita_codigo),
  descricao_borda = COALESCE(descricao_borda, fita_descricao),
  confianca_parser = COALESCE(confianca_parser, 'media')
WHERE codigo_borda IS NULL
   OR descricao_borda IS NULL
   OR confianca_parser IS NULL;

CREATE INDEX IF NOT EXISTS peca_cadastrada_bordas_peca_lado_idx
  ON public.peca_cadastrada_bordas (peca_cadastrada_id, lado);