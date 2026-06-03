import { supabase } from "@/integrations/supabase/client";

export type AuditoriaInput = {
  acao: string;
  entidade_tipo: string;
  entidade_id?: string | null;
  projeto_id?: string | null;
  peca_id?: string | null;
  chapa_id?: string | null;
  plano_id?: string | null;
  dados_antes?: Record<string, unknown>;
  dados_depois?: Record<string, unknown>;
  operador?: string | null;
  observacao?: string | null;
};

export async function registrarAuditoria(input: AuditoriaInput) {
  try {
    await supabase.from("auditoria_eventos").insert({
      acao: input.acao,
      entidade_tipo: input.entidade_tipo,
      entidade_id: input.entidade_id ?? null,
      projeto_id: input.projeto_id ?? null,
      peca_id: input.peca_id ?? null,
      chapa_id: input.chapa_id ?? null,
      plano_id: input.plano_id ?? null,
      dados_antes_json: (input.dados_antes ?? {}) as never,
      dados_depois_json: (input.dados_depois ?? {}) as never,
      operador: input.operador ?? null,
      observacao: input.observacao ?? null,
    });
  } catch (e) {
    // não bloquear fluxo principal
    console.warn("auditoria falhou", e);
  }
}

export const CHECKLIST_HOMOLOGACAO = [
  { key: "medidas_chapa", label: "Conferi medidas da chapa" },
  { key: "espessura", label: "Conferi espessura" },
  { key: "origem_xyz", label: "Conferi origem X/Y/Z" },
  { key: "ferramentas", label: "Conferi ferramentas" },
  { key: "z_seguro", label: "Conferi Z seguro" },
  { key: "profundidade", label: "Conferi profundidade de corte" },
  { key: "pos_processador", label: "Conferi pós-processador" },
  { key: "comparacao_nc", label: "Conferi comparação com NC original (quando aplicável)" },
  { key: "visual_percurso", label: "Conferi visual do percurso" },
] as const;

export type ChecklistKey = (typeof CHECKLIST_HOMOLOGACAO)[number]["key"];
export type Checklist = Partial<Record<ChecklistKey, boolean>>;

export function checklistCompleto(c: Checklist): boolean {
  return CHECKLIST_HOMOLOGACAO.every((i) => c[i.key]);
}

export const STATUS_HOMOLOGACAO_LABELS: Record<string, string> = {
  rascunho: "Rascunho",
  gerado: "Gerado",
  em_analise: "Em análise",
  comparado: "Comparado",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  precisa_ajuste: "Precisa ajuste",
  exportado: "Exportado",
  enviado_maquina: "Enviado p/ máquina",
  cancelado: "Cancelado",
};
