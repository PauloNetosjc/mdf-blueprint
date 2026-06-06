// Reprocessamento do parser de uma Peça Cadastrada a partir do PDF já
// armazenado no bucket. Substitui apenas operações e bordas geradas pelo
// parser, preservando registros marcados como manuais por padrão.
//
// Fluxo:
//   1) Baixa o PDF de storage.pecas-cadastradas via signed URL.
//   2) Roda parseTechnicalDrawingPdf (parser atual).
//   3) Atualiza colunas de status/metadados da peça e regenera
//      faces_layout_json + contorno_externo_json automáticos quando aplicável.
//   4) Deleta operações antigas com origem === "parser" (ou todas, se
//      sobrescreverManual=true) e insere as novas extraídas.
//   5) Faz o mesmo com bordas.

import { supabase } from "@/integrations/supabase/client";
import {
  classificarStatusParser,
  parseTechnicalDrawingPdf,
  type ResultadoParserPDF,
} from "@/lib/pecas-cadastradas-parser";
import { gerarFacesLayoutAutomatico } from "@/lib/faces-layout-gerador";
import {
  gerarContornoExternoDeOperacoes,
  gerarContornoRetangular,
  type VisualizadorOperacao,
} from "@/components/pecas/VisualizadorTecnicoPecaCadastrada";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type ReprocessParserOpts = {
  /** Sobrescreve operações/bordas marcadas como origem="manual". Padrão: false. */
  sobrescreverManual?: boolean;
};

export type ReprocessParserResult = {
  pecaId: string;
  codigo: string;
  status: string;
  anterior: { furos: number; rasgos: number; usinagens: number; bordas: number };
  novo: { furos: number; rasgos: number; usinagens: number; bordas: number };
  erros: string[];
  alertas: string[];
};

type PecaMin = {
  id: string;
  codigo_completo: string;
  pdf_url: string | null;
  pdf_nome_arquivo: string | null;
  dados_brutos_json: Record<string, unknown> | null;
  logs_parser: string[] | null;
};

function ehOperacaoManual(op: { dados_brutos_json?: Record<string, unknown> | null }): boolean {
  const d = op.dados_brutos_json;
  if (!d || typeof d !== "object") return true; // sem rastro de parser → tratado como manual
  if ((d as Record<string, unknown>).origem === "manual") return true;
  if ((d as Record<string, unknown>).origem === "parser") return false;
  // Legado do importador: operações geradas pelo parser tinham linha/valores,
  // mas ainda não recebiam origem="parser". Devem ser limpas no reprocessamento.
  return !("linha" in d || "valores" in d || "valores_interpretados" in d || "sectionAtual" in d);
}

async function baixarPdf(pdfPath: string, nome: string): Promise<File> {
  const { data: signed, error } = await supabase.storage
    .from("pecas-cadastradas")
    .createSignedUrl(pdfPath, 600);
  if (error || !signed?.signedUrl) {
    throw new Error(error?.message ?? "Falha ao gerar URL assinada do PDF");
  }
  const resp = await fetch(signed.signedUrl);
  if (!resp.ok) throw new Error(`Falha ao baixar PDF (HTTP ${resp.status})`);
  const blob = await resp.blob();
  return new File([blob], nome, { type: "application/pdf" });
}

export async function reprocessarParserDePeca(
  pecaId: string,
  opts: ReprocessParserOpts = {},
): Promise<ReprocessParserResult> {
  const sobrescreverManual = opts.sobrescreverManual === true;

  const { data: peca, error: errPeca } = await db
    .from("pecas_cadastradas")
    .select("id,codigo_completo,pdf_url,pdf_nome_arquivo,dados_brutos_json,logs_parser")
    .eq("id", pecaId)
    .single();
  if (errPeca || !peca) throw new Error(errPeca?.message ?? "Peça não encontrada");

  const p = peca as PecaMin;
  if (!p.pdf_url) {
    throw new Error("Esta peça não tem PDF armazenado para reprocessar.");
  }

  const nomeArquivo = p.pdf_nome_arquivo || `${p.codigo_completo}.pdf`;
  const file = await baixarPdf(p.pdf_url, nomeArquivo);

  // Contagens anteriores
  const [{ data: opsAnt }, { data: brdAnt }] = await Promise.all([
    db.from("peca_cadastrada_operacoes").select("id,tipo,dados_brutos_json").eq("peca_cadastrada_id", pecaId),
    db.from("peca_cadastrada_bordas").select("id").eq("peca_cadastrada_id", pecaId),
  ]);
  const anterior = {
    furos: ((opsAnt ?? []) as { tipo: string }[]).filter((o) => o.tipo === "furo").length,
    rasgos: ((opsAnt ?? []) as { tipo: string }[]).filter((o) => o.tipo === "rasgo").length,
    usinagens: ((opsAnt ?? []) as { tipo: string }[]).filter((o) =>
      ["usinagem_parametrica", "contorno", "usinagem"].includes(o.tipo),
    ).length,
    bordas: (brdAnt ?? []).length,
  };

  // Roda parser
  const result: ResultadoParserPDF = await parseTechnicalDrawingPdf(file, nomeArquivo);
  if (!result.codigo) {
    throw new Error(
      `Parser não conseguiu identificar o código no PDF (${nomeArquivo}). Verifique o nome do arquivo.`,
    );
  }
  const { status, motivo } = classificarStatusParser(result);

  // Reaproveita contorno manual existente, se for o caso.
  const dbAtual = p.dados_brutos_json ?? {};
  const contornoAtual = dbAtual.contorno_externo_json as
    | { origem?: string; pontos?: unknown[] }
    | undefined;
  const contornoEhManual =
    !sobrescreverManual && contornoAtual && contornoAtual.origem === "manual";

  // Auto-gera faces_layout_json e contorno_externo_json quando peça individual.
  let dadosBrutosFinal: Record<string, unknown> = { ...result.dados_brutos };
  const ehPecaIndividual = result.classificacao.classificacao === "peca_individual";
  if (ehPecaIndividual && result.largura_ref && result.altura_ref) {
    const facesPresentes = Array.from(
      new Set(
        result.operacoes
          .map((o) => o.face)
          .filter((f): f is string => f != null && f !== ""),
      ),
    );
    const facesLayout = gerarFacesLayoutAutomatico({
      largura: result.largura_ref,
      altura: result.altura_ref,
      espessura: result.espessura_ref,
      prefixo: result.codigo.prefixo,
      tipo: result.codigo.tipo_peca,
      facesPresentes,
    });
    const opsParaContorno: VisualizadorOperacao[] = result.operacoes.map((o) => ({
      id: "",
      tipo_operacao: o.tipo_operacao,
      nome_operacao: o.nome_operacao,
      face: o.face != null ? Number(o.face) : 0,
      x: o.x,
      y: o.y,
      diametro: o.diametro,
      profundidade: o.profundidade,
      largura: o.largura,
      comprimento: o.comprimento,
      x1: o.x1,
      x2: o.x2,
      y1: o.y1,
      y2: o.y2,
      ancora_x: o.ancora_x,
      ancora_y: o.ancora_y,
      offset_x: o.offset_x,
      offset_y: o.offset_y,
      pontos_json: o.pontos as unknown as VisualizadorOperacao["pontos_json"],
      confianca_parser: o.confianca_parser,
      ordem: o.ordem,
    }));
    const contornoGerado =
      gerarContornoExternoDeOperacoes(result.largura_ref, result.altura_ref, opsParaContorno) ??
      gerarContornoRetangular(result.largura_ref, result.altura_ref);
    const usouFallback = (contornoGerado.recuos ?? []).some((r) => r.origem === "fallback");

    dadosBrutosFinal = {
      ...dadosBrutosFinal,
      faces_layout_json:
        !sobrescreverManual && (dbAtual.faces_layout_json as { origem?: string } | undefined)?.origem === "manual"
          ? dbAtual.faces_layout_json
          : facesLayout,
      contorno_externo_json: contornoEhManual ? contornoAtual : contornoGerado,
      diagnostico_geometria: {
        origem: contornoEhManual ? "manual" : contornoGerado.origem,
        pontos: contornoEhManual ? contornoAtual?.pontos?.length ?? 0 : contornoGerado.pontos.length,
        recuos: contornoEhManual ? 0 : contornoGerado.recuos?.length ?? 0,
        presets: contornoEhManual ? [] : contornoGerado.presets_aplicados ?? [],
        acao: contornoEhManual
          ? "preservado_manual"
          : usouFallback
            ? "atualizado_fallback"
            : "atualizado_parser",
        atualizado_em: new Date().toISOString(),
      },
    };
  }

  // Acrescenta log de reprocessamento (preserva histórico)
  const logsAnteriores = Array.isArray(p.logs_parser) ? p.logs_parser : [];
  const cabecalhoLog = `--- reprocessar_parser @ ${new Date().toISOString()} ---`;
  const logsCombinados = [
    ...logsAnteriores.slice(-200),
    cabecalhoLog,
    `arquivo: ${nomeArquivo}`,
    `anterior: ${anterior.furos} furos, ${anterior.rasgos} rasgos, ${anterior.usinagens} usinagens, ${anterior.bordas} bordas`,
    ...result.logs.map((l) => `· ${l}`),
  ].slice(-400);

  // Atualiza peça
  const { error: errUp } = await db
    .from("pecas_cadastradas")
    .update({
      nome_peca: result.nome_peca,
      largura_ref: result.largura_ref,
      altura_ref: result.altura_ref,
      espessura_ref: result.espessura_ref,
      material_ref: result.material_ref,
      fita_ref: result.fita_ref,
      status_parser: status,
      motivo_status: motivo,
      erros_parser: result.erros,
      parser_alertas_json: result.alertas,
      resumo_parser_json: {
        ...result.resumo,
        classificacao: result.classificacao.classificacao,
        classificacao_motivo: result.classificacao.motivo,
        classificacao_confianca: result.classificacao.confianca,
        classificacao_sinais: result.classificacao.sinais,
        ultimo_reprocesso: {
          em: new Date().toISOString(),
          anterior,
        },
      },
      logs_parser: logsCombinados,
      dados_brutos_json: dadosBrutosFinal,
    })
    .eq("id", pecaId);
  if (errUp) throw errUp;

  // Deleta ops/bordas geradas pelo parser (ou tudo, se sobrescreverManual=true)
  const opsParaApagar = ((opsAnt ?? []) as { id: string; dados_brutos_json: Record<string, unknown> | null }[])
    .filter((o) => sobrescreverManual || !ehOperacaoManual(o))
    .map((o) => o.id);
  if (opsParaApagar.length) {
    const { error: errDel } = await db
      .from("peca_cadastrada_operacoes")
      .delete()
      .in("id", opsParaApagar);
    if (errDel) throw errDel;
  }
  const bordasParaApagar = ((brdAnt ?? []) as { id: string }[]).map((b) => b.id);
  if (bordasParaApagar.length) {
    const { error: errDelB } = await db
      .from("peca_cadastrada_bordas")
      .delete()
      .in("id", bordasParaApagar);
    if (errDelB) throw errDelB;
  }

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error("Não autenticado");

  // Insere ops novas marcadas com origem=parser
  if (result.operacoes.length) {
    const opsRows = result.operacoes.map((o, idx) => ({
      user_id: userId,
      peca_cadastrada_id: pecaId,
      tipo: o.tipo_operacao,
      tipo_operacao: o.tipo_operacao,
      nome_operacao: o.nome_operacao,
      face: o.face != null ? Number(o.face) : 0,
      x: o.x,
      y: o.y,
      z: o.z,
      diametro: o.diametro,
      profundidade: o.profundidade,
      largura: o.largura,
      comprimento: o.comprimento,
      x1: o.x1,
      x2: o.x2,
      y1: o.y1,
      y2: o.y2,
      ancora_x: o.ancora_x,
      ancora_y: o.ancora_y,
      offset_x: o.offset_x,
      offset_y: o.offset_y,
      pontos_json: o.pontos ?? [],
      confianca_parser: o.confianca_parser,
      dados_brutos_json: { ...(o.dados_brutos ?? {}), origem: "parser" },
      ordem: idx + 1,
    }));
    const { error: errOps } = await db.from("peca_cadastrada_operacoes").insert(opsRows);
    if (errOps) throw errOps;
  }

  // Insere bordas novas
  if (result.bordas.length) {
    const bordasRows = result.bordas.map((b) => ({
      user_id: userId,
      peca_cadastrada_id: pecaId,
      lado: b.lado,
      codigo_borda: b.codigo_borda,
      descricao_borda: b.descricao_borda,
      espessura: b.espessura,
      largura: b.largura,
      cor: b.cor,
      indicador_desenho: b.indicador_desenho,
      confianca_parser: b.confianca_parser,
      tem_fita: true,
    }));
    const { error: errB } = await db.from("peca_cadastrada_bordas").insert(bordasRows);
    if (errB) throw errB;
  }

  const novo = {
    furos: result.operacoes.filter((o) => o.tipo_operacao === "furo").length,
    rasgos: result.operacoes.filter((o) => o.tipo_operacao === "rasgo").length,
    usinagens: result.operacoes.filter((o) =>
      ["usinagem_parametrica", "contorno", "usinagem"].includes(o.tipo_operacao),
    ).length,
    bordas: result.bordas.length,
  };

  return {
    pecaId,
    codigo: p.codigo_completo,
    status,
    anterior,
    novo,
    erros: result.erros,
    alertas: result.alertas,
  };
}

export type LoteProgress = {
  total: number;
  feitas: number;
  corrigidas: number;
  ainda_com_erro: number;
  ignoradas: number;
  ultimo?: ReprocessParserResult | { pecaId: string; codigo: string; erro: string };
};

export async function reprocessarParserEmLote(
  pecaIds: string[],
  opts: ReprocessParserOpts & {
    onProgress?: (p: LoteProgress) => void;
    cancelado?: () => boolean;
  } = {},
): Promise<ReprocessParserResult[]> {
  const resultados: ReprocessParserResult[] = [];
  let feitas = 0;
  let corrigidas = 0;
  let aindaComErro = 0;
  let ignoradas = 0;

  for (const id of pecaIds) {
    if (opts.cancelado?.()) break;
    try {
      const r = await reprocessarParserDePeca(id, opts);
      resultados.push(r);
      feitas++;
      if (r.status === "ok") corrigidas++;
      else aindaComErro++;
      opts.onProgress?.({
        total: pecaIds.length,
        feitas,
        corrigidas,
        ainda_com_erro: aindaComErro,
        ignoradas,
        ultimo: r,
      });
    } catch (e) {
      feitas++;
      ignoradas++;
      const erro = e instanceof Error ? e.message : String(e);
      opts.onProgress?.({
        total: pecaIds.length,
        feitas,
        corrigidas,
        ainda_com_erro: aindaComErro,
        ignoradas,
        ultimo: { pecaId: id, codigo: id, erro },
      });
    }
    // ceder ao browser entre peças
    await new Promise((r) => setTimeout(r, 0));
  }
  return resultados;
}
