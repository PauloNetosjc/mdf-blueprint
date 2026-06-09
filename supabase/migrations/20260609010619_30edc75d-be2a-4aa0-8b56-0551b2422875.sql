
ALTER TABLE public.planos_corte
  ADD COLUMN IF NOT EXISTS plano_corte_json jsonb,
  ADD COLUMN IF NOT EXISTS aproveitamento_percentual numeric NOT NULL DEFAULT 0;

-- Backfill plano_corte_json a partir da observacao quando for JSON válido
UPDATE public.planos_corte
SET plano_corte_json = observacao::jsonb
WHERE plano_corte_json IS NULL
  AND observacao IS NOT NULL
  AND btrim(observacao) LIKE '{%';

-- Backfill aproveitamento_percentual a partir do aproveitamento_medio (fração 0..1)
UPDATE public.planos_corte
SET aproveitamento_percentual = ROUND((COALESCE(aproveitamento_medio, 0) * 100)::numeric, 2)
WHERE aproveitamento_percentual = 0
  AND aproveitamento_medio IS NOT NULL
  AND aproveitamento_medio > 0;

-- Limpa observacao quando ela era apenas o JSON (passa a ser texto livre)
UPDATE public.planos_corte
SET observacao = NULL
WHERE observacao IS NOT NULL
  AND btrim(observacao) LIKE '{%'
  AND plano_corte_json IS NOT NULL;
