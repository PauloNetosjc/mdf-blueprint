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
import {
  construirModeloTecnico,
  contornoExternoDoModelo,
  ehBaseL,
  gerarContornoBaseLInferior,
  gerarContornoBaseLInferiorPorValidacao,
} from "@/lib/peca-modelo-tecnico";
import { extrairContornoVisualCalibrado } from "@/lib/contorno-visual-calibrado";
import { extrairContornoRasterCalibrado } from "@/lib/contorno-raster-calibrado";
import { classificarGeometriaPeca } from "@/lib/classificar-geometria";
import {
  detectarLBR,
  gerarSegmentosLBR,
  gerarFacesLayoutL,
} from "@/lib/segmentos-faces-l";

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

function gerarFacesLayoutBaseL(
  largura: number,
  altura: number,
  espessura: number | null,
  pontosContorno?: { x: number; y: number }[] | null,
) {
  const E = espessura ?? 18;
  // Caminho preferencial: temos um contorno em L com 6 pontos. Usa as
  // medidas reais dos segmentos (F2/F4 no perfil inferior, F3/F5 no direito).
  const infoL = detectarLBR(pontosContorno ?? null);
  if (infoL) {
    const segs = gerarSegmentosLBR(infoL);
    return {
      origem: "automatico",
      atualizado_em: new Date().toISOString(),
      observacao:
        "Layout visual automático para Base L com segmentos por perfil derivados do contorno técnico.",
      faces: gerarFacesLayoutL(infoL, E, segs),
    };
  }
  // Fallback antigo (proporções aproximadas) quando não há contorno técnico.
  const L = largura;
  const A = altura;
  const GAP = 40;
  const f7 = { w: L, h: A };
  const f1 = { w: E, h: A };
  const f5 = { w: E, h: A * 0.52 };
  const f3 = { w: E, h: A * 0.48 };
  const f2 = { w: L * 0.58, h: E };
  const f4 = { w: L * 0.42, h: E };
  const f6 = { w: L, h: E };
  const x7 = f1.w + GAP;
  const y7 = f6.h + GAP;
  return {
    origem: "automatico",
    atualizado_em: new Date().toISOString(),
    observacao:
      "Layout visual aproximado para Base L (sem contorno técnico explícito). Medidas marcadas como aproximadas.",
    faces: [
      { face: "6", label: "F6 — Superior", tipo_vista: "superior", largura_visual: f6.w, altura_visual: f6.h, x_layout: x7, y_layout: 0, visivel: true, origem_medida: "aproximada" },
      { face: "1", label: "F1 — Lateral esquerda", tipo_vista: "lateral_esquerda", largura_visual: f1.w, altura_visual: f1.h, x_layout: 0, y_layout: y7, visivel: true, origem_medida: "aproximada" },
      { face: "7", label: "F7 — Principal L", tipo_vista: "principal_L", largura_visual: f7.w, altura_visual: f7.h, x_layout: x7, y_layout: y7, visivel: true, origem_medida: "aproximada" },
      { face: "5", label: "F5 — Lateral direita superior", tipo_vista: "lateral_direita_superior", largura_visual: f5.w, altura_visual: f5.h, x_layout: x7 + f7.w + GAP, y_layout: y7, visivel: true, origem_medida: "aproximada" },
      { face: "3", label: "F3 — Lateral direita inferior", tipo_vista: "lateral_direita_inferior", largura_visual: f3.w, altura_visual: f3.h, x_layout: x7 + f7.w + GAP, y_layout: y7 + f5.h + GAP, visivel: true, origem_medida: "aproximada" },
      { face: "2", label: "F2 — Inferior esquerda", tipo_vista: "inferior_esquerda", largura_visual: f2.w, altura_visual: f2.h, x_layout: x7, y_layout: y7 + f7.h + GAP, visivel: true, origem_medida: "aproximada" },
      { face: "4", label: "F4 — Inferior direita", tipo_vista: "inferior_direita", largura_visual: f4.w, altura_visual: f4.h, x_layout: x7 + f2.w + GAP, y_layout: y7 + f7.h + GAP, visivel: true, origem_medida: "aproximada" },
    ],
  };
}

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
    const baseLDetectadaLayout =
      ehBaseL(result.nome_peca, result.codigo.prefixo) ||
      ((result.codigo.prefixo ?? "").toUpperCase() === "BAS" &&
        facesPresentes.includes("7") &&
        facesPresentes.some((f) => Number(f) > 5) &&
        result.operacoes.some((u) => u.tipo_operacao === "rasgo" && u.y1 != null && u.y2 != null));
    const pontosContornoL = baseLDetectadaLayout
      ? gerarContornoBaseLInferior(result.largura_ref, result.altura_ref)
      : null;
    const facesLayout = baseLDetectadaLayout
      ? gerarFacesLayoutBaseL(result.largura_ref, result.altura_ref, result.espessura_ref, pontosContornoL)
      : gerarFacesLayoutAutomatico({
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
    const contornoGerado = baseLDetectadaLayout
      ? {
          origem: "parser_pdf" as const,
          largura: result.largura_ref,
          altura: result.altura_ref,
          pontos: gerarContornoBaseLInferior(result.largura_ref, result.altura_ref),
          recuos: [],
          presets_aplicados: ["regra_base_l_inferior"],
          observacao: "Contorno L técnico para Base L Inferior.",
        }
      : gerarContornoExternoDeOperacoes(result.largura_ref, result.altura_ref, opsParaContorno) ??
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

  // ---------- Modelo Técnico Canônico ----------
  // Este é o objeto operacional do sistema. Visualizador interno e geração de
  // G-code devem ler dele, NÃO do PDF original.
  const faceAlinhamento =
    (dadosBrutosFinal.face_alinhamento as string | null) ?? null;
  const modeloTecnico = construirModeloTecnico(result, faceAlinhamento);

  // ---------- CONTORNO_TECNICO embutido no PDF (prioridade máxima) ----------
  // Se o PDF traz o bloco CONTORNO_TECNICO ... FIM_CONTORNO_TECNICO, a
  // geometria vem PRONTA do desenho técnico. Esta é a fonte mais confiável e
  // sobrescreve qualquer regra paramétrica ou extração visual posterior.
  const contornoTecnicoPdf = (dadosBrutosFinal.contorno_tecnico_pdf ?? null) as
    | {
        codigo: string | null;
        face_principal: string | null;
        tipo: string | null;
        pontos: { x: number; y: number }[];
      }
    | null;
  let geometriaResolvidaPorContornoTecnico = false;
  if (
    contornoTecnicoPdf &&
    Array.isArray(contornoTecnicoPdf.pontos) &&
    contornoTecnicoPdf.pontos.length >= 3 &&
    result.largura_ref &&
    result.altura_ref
  ) {
    const tipoCt = (contornoTecnicoPdf.tipo ?? "").toLowerCase();
    const tipoGeometria: "L" | "poligono_complexo" | "retangular" =
      tipoCt === "l"
        ? "L"
        : tipoCt === "retangular"
          ? "retangular"
          : "poligono_complexo";
    modeloTecnico.geometria = {
      ...modeloTecnico.geometria,
      tipo: tipoGeometria,
      origem: "contorno_tecnico_pdf",
      largura: result.largura_ref,
      altura: result.altura_ref,
      pontos_contorno: contornoTecnicoPdf.pontos,
      confianca: "alta",
      pendente: false,
    };
    modeloTecnico.avisos = modeloTecnico.avisos.filter(
      (a) => !a.includes("Importe um modelo técnico JSON"),
    );
    geometriaResolvidaPorContornoTecnico = true;
  }

  // ---------- Extração de contorno visual calibrado ----------
  // 1) Tenta o caminho vetorial (rápido, ideal para PDFs com paths nativos).
  // 2) Para peças complexas, tenta também o RASTER calibrado (renderiza a
  //    página em canvas, detecta o polígono real por análise de imagem e
  //    calibra pela cota geral). O raster prevalece sobre a paramétrica.
  if (!geometriaResolvidaPorContornoTecnico && result.largura_ref && result.altura_ref) {
    const pdfBytes = await file.arrayBuffer();

    try {
      const visual = await extrairContornoVisualCalibrado(pdfBytes.slice(0), {
        largura: result.largura_ref,
        altura: result.altura_ref,
      });
      dadosBrutosFinal.contorno_visual_diagnostico = {
        em: new Date().toISOString(),
        tipo: visual.tipo,
        confianca: visual.confianca,
        pendente: visual.pendente,
        escala_mm_por_unidade: visual.escala_mm_por_unidade,
        origem_pagina: visual.origem_pagina,
        pontos: visual.pontos.length,
        diagnostico: visual.diagnostico,
      };
      if (!visual.pendente && visual.pontos.length >= 3) {
        modeloTecnico.geometria = {
          ...modeloTecnico.geometria,
          tipo: visual.tipo,
          origem: "pdf_visual_calibrado",
          largura: result.largura_ref,
          altura: result.altura_ref,
          pontos_contorno: visual.pontos,
          confianca: visual.confianca,
          pendente: false,
        };
        modeloTecnico.avisos = modeloTecnico.avisos.filter(
          (a) => !a.includes("Importe um modelo técnico JSON"),
        );
      }
    } catch (e) {
      dadosBrutosFinal.contorno_visual_diagnostico = {
        em: new Date().toISOString(),
        erro: (e as Error).message,
      };
    }

    // Heurística: a peça é complexa? Se ainda estiver pendente ou marcada
    // como não-retangular sem pontos reais, vale tentar o raster.
    const geom = modeloTecnico.geometria;
    const nomeUpper = (result.codigo?.codigo_completo ?? result.nome_peca ?? "").toUpperCase();
    const facesAcimaDe5Count = (result.operacoes ?? [])
      .map((o) => Number(o.face))
      .filter((n) => Number.isFinite(n) && n > 5).length;
    const temRasgoVerticalLinha = (result.operacoes ?? []).some(
      (u) => u.tipo_operacao === "rasgo" && u.y1 != null && u.y2 != null,
    );
    // Indícios de geometria não-retangular: evidência EXPLÍCITA, não prefixo BAS.
    const indiciosComplexos =
      geom.pendente ||
      geom.origem === "regra_parametrica" ||
      (geom.tipo !== "retangular" && (!geom.pontos_contorno || geom.pontos_contorno.length < 3)) ||
      nomeUpper.includes("BASE L") ||
      (facesAcimaDe5Count > 0 && temRasgoVerticalLinha);

    if (indiciosComplexos && typeof document !== "undefined") {
      try {
        const raster = await extrairContornoRasterCalibrado(pdfBytes.slice(0), {
          largura: result.largura_ref,
          altura: result.altura_ref,
        }, { debug: true });
        dadosBrutosFinal.contorno_raster_diagnostico = {
          em: new Date().toISOString(),
          tipo: raster.tipo,
          confianca: raster.confianca,
          pendente: raster.pendente,
          escala_mm_por_pixel: raster.escala_mm_por_pixel,
          origem_pagina: raster.origem_pagina,
          pontos: raster.pontos.length,
          diagnostico: raster.diagnostico,
          debug_imagem_base64: raster.debug_imagem_base64,
        };
        if (!raster.pendente && raster.pontos.length >= 3) {
          modeloTecnico.geometria = {
            ...modeloTecnico.geometria,
            tipo: raster.tipo,
            origem: "pdf_raster_calibrado",
            largura: result.largura_ref,
            altura: result.altura_ref,
            pontos_contorno: raster.pontos,
            confianca: raster.confianca,
            pendente: false,
          };
          modeloTecnico.avisos = modeloTecnico.avisos.filter(
            (a) => !a.includes("Importe um modelo técnico JSON"),
          );
        } else if (geom.origem === "regra_parametrica") {
          // Raster falhou e a geometria atual é apenas paramétrica. Marca
          // pendente para bloquear G-code — não confiável para CNC.
          modeloTecnico.geometria = {
            ...modeloTecnico.geometria,
            pendente: true,
            confianca: "baixa",
          };
        }
      } catch (e) {
        dadosBrutosFinal.contorno_raster_diagnostico = {
          em: new Date().toISOString(),
          erro: (e as Error).message,
        };
      }
    }
  }

  // ---------- Classificação final de geometria (evidência-baseada) ----------
  // Roda o classificador central com TODAS as evidências disponíveis para
  // decidir o tipo final da peça. Só transforma em L quando o classificador
  // confirmar evidência explícita (CONTORNO_TECNICO, diagnóstico visual,
  // recorte cotado, ou nome "Base L" + estrutura). Caso contrário, mantém
  // retangular — sem fallback genérico "BAS = L".
  const tipoAnteriorReprocesso = modeloTecnico.geometria.tipo;
  {
    const geom = modeloTecnico.geometria;
    const facesComOperacao = (result.operacoes ?? [])
      .map((o) => Number(o.face))
      .filter((n) => Number.isFinite(n));
    const temRasgoVerticalLinha = (result.operacoes ?? []).some(
      (u) => u.tipo_operacao === "rasgo" && u.y1 != null && u.y2 != null,
    );
    const diagVisual = dadosBrutosFinal.contorno_visual_diagnostico as
      | { tipo?: string; confianca?: "alta" | "media" | "baixa"; pendente?: boolean; pontos?: number }
      | undefined;
    const diagRaster = dadosBrutosFinal.contorno_raster_diagnostico as
      | { tipo?: string; confianca?: "alta" | "media" | "baixa"; pendente?: boolean; pontos?: number }
      | undefined;
    const diagPontos = geom.pontos_contorno ?? [];

    const decisao = classificarGeometriaPeca({
      largura: result.largura_ref,
      altura: result.altura_ref,
      espessura: result.espessura_ref,
      nome: result.nome_peca,
      prefixo: result.codigo?.prefixo ?? null,
      facesComOperacao,
      temRasgoVerticalLinha,
      contornoTecnicoPdf: contornoTecnicoPdf
        ? { tipo: contornoTecnicoPdf.tipo, pontos: contornoTecnicoPdf.pontos }
        : null,
      diagnosticoVisualPontos:
        geom.origem === "pdf_visual_calibrado" || geom.origem === "pdf_raster_calibrado"
          ? diagPontos
          : null,
      diagnosticoVisualTipo:
        (diagVisual?.tipo as string | undefined) ??
        (diagRaster?.tipo as string | undefined) ??
        null,
      diagnosticoVisualConfianca:
        diagVisual?.confianca ?? diagRaster?.confianca ?? null,
      recorteExplicito: null,
    });

    // Salva relatório no importador (sempre).
    const relatorioAtual = (dadosBrutosFinal.relatorio_importacao ?? {}) as Record<
      string,
      unknown
    >;
    dadosBrutosFinal.relatorio_importacao = {
      ...relatorioAtual,
      classificacao_geometria: decisao.relatorio,
    };

    const L = result.largura_ref;
    const H = result.altura_ref;

    // Aplica a decisão SOMENTE quando o pipeline anterior não trouxe
    // contorno técnico próprio ou diagnóstico visual confiável.
    const jaResolvidoComFonteForte =
      geometriaResolvidaPorContornoTecnico ||
      geom.origem === "pdf_visual_calibrado" ||
      geom.origem === "pdf_raster_calibrado" ||
      geom.origem === "manual";

    if (!jaResolvidoComFonteForte && L && H) {
      if (decisao.tipo === "L") {
        // L confirmado por evidência — usa pontos do classificador.
        const opsModelo = modeloTecnico.operacoes;
        const resultado = gerarContornoBaseLInferiorPorValidacao(L, H, opsModelo);
        const candidato = resultado.candidatos.find(
          (c) => JSON.stringify(c.pontos) === JSON.stringify(decisao.pontos_contorno),
        );
        modeloTecnico.geometria = {
          ...geom,
          tipo: "L",
          origem: decisao.origem as typeof geom.origem,
          largura: L,
          altura: H,
          pontos_contorno: decisao.pontos_contorno,
          confianca: decisao.confianca,
          pendente: false,
        };
        modeloTecnico.avisos = [
          ...modeloTecnico.avisos.filter(
            (a) => !a.includes("Importe um modelo técnico JSON"),
          ),
          `Geometria L: ${decisao.relatorio.motivo}${candidato ? ` (${candidato.nome})` : ""}`,
        ];
        dadosBrutosFinal.contorno_base_l_diagnostico = {
          em: new Date().toISOString(),
          largura: L,
          altura: H,
          escolhido: candidato?.nome ?? "classificador_central",
          escolhido_por: "classificador_geometria",
          motivo: decisao.relatorio.motivo,
          evidencias_usadas: decisao.relatorio.evidencias_usadas,
        };
      } else if (decisao.tipo === "retangular") {
        // Sem evidência de L → garante retangular. Se antes estava L sem
        // evidência, registra a correção como aviso/log.
        const corrigidoDeL = tipoAnteriorReprocesso === "L";
        modeloTecnico.geometria = {
          ...geom,
          tipo: "retangular",
          origem: "pdf_medidas",
          largura: L,
          altura: H,
          pontos_contorno: decisao.pontos_contorno,
          confianca: "alta",
          pendente: false,
        };
        modeloTecnico.avisos = modeloTecnico.avisos.filter(
          (a) => !a.includes("Importe um modelo técnico JSON"),
        );
        if (corrigidoDeL) {
          modeloTecnico.avisos.push(
            "Geometria corrigida de L para retangular por ausência de evidência explícita.",
          );
        }
      } else if (decisao.tipo === "pendente") {
        modeloTecnico.geometria = {
          ...geom,
          pendente: true,
          confianca: "baixa",
        };
      }
    }
  }

  dadosBrutosFinal.modelo_tecnico_json = modeloTecnico;
  dadosBrutosFinal.geometria_complexa =
    modeloTecnico.geometria.tipo !== "retangular" || modeloTecnico.geometria.pendente;
  dadosBrutosFinal.geometria_complexa_motivos = modeloTecnico.avisos;

  // Se o modelo tem contorno paramétrico/válido (ex.: Base L), publica também
  // como contorno_externo_json para o visualizador desenhar o polígono real.
  if (
    (!contornoEhManual || modeloTecnico.geometria.tipo === "L") &&
    !modeloTecnico.geometria.pendente &&
    modeloTecnico.geometria.tipo !== "retangular"
  ) {
    const contornoDoModelo = contornoExternoDoModelo(modeloTecnico);
    if (contornoDoModelo) {
      dadosBrutosFinal.contorno_externo_json = contornoDoModelo;
    }
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
