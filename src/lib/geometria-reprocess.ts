import { supabase } from "@/integrations/supabase/client";
import {
  contornoExternoValido,
  gerarContornoExternoDeOperacoes,
  gerarContornoRetangular,
  type ContornoExterno,
  type ContornoOrigem,
  type VisualizadorOperacao,
} from "@/components/pecas/VisualizadorTecnicoPecaCadastrada";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type ReprocessAcao =
  | "atualizado_parser"
  | "atualizado_retangular"
  | "atualizado_fallback"
  | "preservado_manual"
  | "preservado_misto"
  | "sem_dimensoes"
  | "erro";

export type ReprocessResult = {
  pecaId: string;
  codigo: string;
  acao: ReprocessAcao;
  origemAnterior?: ContornoOrigem | null;
  origemNova?: ContornoOrigem;
  pontos?: number;
  recuos?: number;
  msg?: string;
};

export type GeometriaSnapshot = {
  origem: ContornoOrigem;
  pontos: number;
  recuos: number;
  presets: string[];
  acao: ReprocessAcao;
  atualizado_em: string;
};

export type ReprocessOpts = {
  sobrescreverManual: boolean;
  onProgress?: (done: number, total: number, last: ReprocessResult) => void;
  chunkSize?: number;
};

type PecaMin = {
  id: string;
  codigo_completo: string;
  largura_ref: number | null;
  altura_ref: number | null;
  dados_brutos_json: Record<string, unknown> | null;
  logs_parser: unknown;
};

function adaptOp(o: Record<string, unknown>): VisualizadorOperacao {
  const g = (k: string) => (o as Record<string, unknown>)[k];
  return {
    id: String(g("id") ?? ""),
    tipo_operacao: String(g("tipo_operacao") ?? g("tipo") ?? ""),
    nome_operacao: (g("nome_operacao") as string | null) ?? null,
    face: (g("face") as number | string | null) ?? 0,
    x: (g("x") as number | null) ?? null,
    y: (g("y") as number | null) ?? null,
    diametro: (g("diametro") as number | null) ?? null,
    profundidade: (g("profundidade") as number | null) ?? null,
    largura: (g("largura") as number | null) ?? null,
    comprimento: (g("comprimento") as number | null) ?? null,
    x1: (g("x1") as number | null) ?? null,
    x2: (g("x2") as number | null) ?? null,
    y1: (g("y1") as number | null) ?? null,
    y2: (g("y2") as number | null) ?? null,
    ancora_x: (g("ancora_x") as string | null) ?? null,
    ancora_y: (g("ancora_y") as string | null) ?? null,
    offset_x: (g("offset_x") as number | null) ?? null,
    offset_y: (g("offset_y") as number | null) ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pontos_json: ((g("pontos_json") as any) ?? []) as VisualizadorOperacao["pontos_json"],
    confianca_parser: String(g("confianca_parser") ?? "media"),
    ordem: Number(g("ordem") ?? 0),
  };
}

async function processarPeca(pecaId: string, sobrescrever: boolean): Promise<ReprocessResult> {
  try {
    const { data: peca, error } = await db
      .from("pecas_cadastradas")
      .select("id, codigo_completo, largura_ref, altura_ref, dados_brutos_json, logs_parser")
      .eq("id", pecaId)
      .single();
    if (error) throw error;
    const p = peca as PecaMin;
    const codigo = p.codigo_completo;

    if (!p.largura_ref || !p.altura_ref) {
      return { pecaId, codigo, acao: "sem_dimensoes" };
    }

    const dadosBrutos = (p.dados_brutos_json ?? {}) as Record<string, unknown>;
    const contornoAtualRaw = dadosBrutos.contorno_externo_json as ContornoExterno | undefined;
    const contornoAtual = contornoExternoValido(contornoAtualRaw ?? null);
    const origemAtual = contornoAtual?.origem ?? null;

    if (!sobrescrever && (origemAtual === "manual" || origemAtual === "misto")) {
      return {
        pecaId,
        codigo,
        acao: origemAtual === "manual" ? "preservado_manual" : "preservado_misto",
        origemAnterior: origemAtual,
        origemNova: origemAtual,
        pontos: contornoAtual?.pontos.length,
        recuos: contornoAtual?.recuos?.length ?? 0,
      };
    }

    const { data: opsRaw, error: e2 } = await db
      .from("peca_cadastrada_operacoes")
      .select("*")
      .eq("peca_cadastrada_id", pecaId);
    if (e2) throw e2;
    const operacoes = ((opsRaw ?? []) as Record<string, unknown>[]).map(adaptOp);

    const gerado = gerarContornoExternoDeOperacoes(p.largura_ref, p.altura_ref, operacoes);
    let novo: ContornoExterno;
    let acao: ReprocessAcao;
    if (gerado) {
      novo = gerado;
      const usouFallback = (gerado.recuos ?? []).some((r) => r.origem === "fallback");
      acao = usouFallback ? "atualizado_fallback" : "atualizado_parser";
    } else {
      novo = gerarContornoRetangular(p.largura_ref, p.altura_ref);
      acao = "atualizado_retangular";
    }

    const snapshot: GeometriaSnapshot = {
      origem: novo.origem,
      pontos: novo.pontos.length,
      recuos: novo.recuos?.length ?? 0,
      presets: novo.presets_aplicados ?? [],
      acao,
      atualizado_em: new Date().toISOString(),
    };

    const novosDados = {
      ...dadosBrutos,
      contorno_externo_json: novo,
      diagnostico_geometria: snapshot,
    };

    const logsAntigos = Array.isArray(p.logs_parser) ? (p.logs_parser as string[]) : [];
    const linha = `[geometria ${snapshot.atualizado_em}] ${acao} origem=${novo.origem} pontos=${snapshot.pontos} recuos=${snapshot.recuos}`;
    const novosLogs = [...logsAntigos, linha].slice(-300);

    const { error: e3 } = await db
      .from("pecas_cadastradas")
      .update({ dados_brutos_json: novosDados, logs_parser: novosLogs })
      .eq("id", pecaId);
    if (e3) throw e3;

    return {
      pecaId,
      codigo,
      acao,
      origemAnterior: origemAtual,
      origemNova: novo.origem,
      pontos: snapshot.pontos,
      recuos: snapshot.recuos,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { pecaId, codigo: pecaId, acao: "erro", msg };
  }
}

export async function reprocessarGeometriaPecas(
  pecaIds: string[],
  opts: ReprocessOpts,
): Promise<ReprocessResult[]> {
  const total = pecaIds.length;
  const results: ReprocessResult[] = [];
  const chunkSize = Math.max(1, opts.chunkSize ?? 5);
  for (let i = 0; i < pecaIds.length; i += chunkSize) {
    const chunk = pecaIds.slice(i, i + chunkSize);
    const r = await Promise.all(chunk.map((id) => processarPeca(id, opts.sobrescreverManual)));
    for (const res of r) {
      results.push(res);
      opts.onProgress?.(results.length, total, res);
    }
    // Yield to UI between chunks
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return results;
}

export type GeometriaStatus =
  | "manual"
  | "misto"
  | "contorno_pdf"
  | "fallback"
  | "retangular"
  | "pendente";

/** Classifica a peça pelo conteúdo de dados_brutos_json.contorno_externo_json. */
export function statusGeometria(dadosBrutos: Record<string, unknown> | null | undefined): GeometriaStatus {
  const c = contornoExternoValido((dadosBrutos?.contorno_externo_json as ContornoExterno | undefined) ?? null);
  if (!c) return "pendente";
  if (c.origem === "manual") return "manual";
  if (c.origem === "misto") return "misto";
  if (c.origem === "retangular") return "retangular";
  if ((c.recuos ?? []).some((r) => r.origem === "fallback")) return "fallback";
  return "contorno_pdf";
}
