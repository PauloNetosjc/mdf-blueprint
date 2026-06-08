// Função ÚNICA usada por validador, visualizador e diagnóstico para obter
// a geometria renderizável de uma face.
//
// Regra principal:
//   Se a face for igual a `modelo.geometria.face_principal`, retorna o
//   polígono completo da peça (CONTORNO_TECNICO). Para peças em L, isso é o L
//   inteiro — nunca um retângulo de fallback nem um segmento.
//
// Para faces NÃO principais em uma peça em L, usa o segmento correspondente
// (faces_visuais_segmentadas), tratado como retângulo de espessura × comprimento.
//
// Para faces de peças retangulares, usa o retângulo W × H.

import type { ModeloTecnicoJson } from "@/lib/peca-modelo-tecnico";
import { obterGeometriaVisualDaFace } from "@/lib/segmentos-faces-l";

export type PontoG = { x: number; y: number };

export type GeometriaRenderizavel = {
  face: string;
  ehFacePrincipal: boolean;
  tipo: "principal_l" | "principal_retangular" | "segmento_horizontal" | "segmento_vertical" | "retangulo_fallback";
  largura_visual: number;
  altura_visual: number;
  origem: "contorno_tecnico_pdf" | "segmento_l" | "retangulo_medidas" | "fallback";
  pontos_contorno: PontoG[];
};

function retanguloPolygon(w: number, h: number): PontoG[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

export function obterGeometriaRenderizavelDaFace(
  modelo: ModeloTecnicoJson | null | undefined,
  face: string | number | null | undefined,
): GeometriaRenderizavel | null {
  if (!modelo) return null;
  const faceStr = String(face ?? "");
  const geometria = modelo.geometria;
  const principal = geometria?.face_principal != null ? String(geometria.face_principal) : null;
  const ehPrincipal = principal != null && faceStr === principal;

  // 1) Face principal — SEMPRE usa o polígono técnico completo se disponível.
  if (ehPrincipal) {
    const pts = (geometria?.pontos_contorno ?? []) as PontoG[];
    const W = geometria?.largura ?? modelo.medidas?.largura ?? 0;
    const H = geometria?.altura ?? modelo.medidas?.altura ?? 0;
    if (pts.length >= 3) {
      const tipo = (geometria?.tipo ?? "").toUpperCase() === "L" ? "principal_l" : "principal_retangular";
      return {
        face: faceStr,
        ehFacePrincipal: true,
        tipo,
        largura_visual: W,
        altura_visual: H,
        origem: "contorno_tecnico_pdf",
        pontos_contorno: pts,
      };
    }
    // Sem pontos técnicos — usa retângulo das medidas.
    if (W > 0 && H > 0) {
      return {
        face: faceStr,
        ehFacePrincipal: true,
        tipo: "principal_retangular",
        largura_visual: W,
        altura_visual: H,
        origem: "retangulo_medidas",
        pontos_contorno: retanguloPolygon(W, H),
      };
    }
    return null;
  }

  // 2) Faces não-principais em L — usa segmento.
  const gv = obterGeometriaVisualDaFace(modelo, faceStr);
  if (gv && gv.largura_visual > 0 && gv.altura_visual > 0) {
    return {
      face: faceStr,
      ehFacePrincipal: false,
      tipo: gv.tipo === "segmento_horizontal" ? "segmento_horizontal" : gv.tipo === "segmento_vertical" ? "segmento_vertical" : "principal_retangular",
      largura_visual: gv.largura_visual,
      altura_visual: gv.altura_visual,
      origem: "segmento_l",
      pontos_contorno: retanguloPolygon(gv.largura_visual, gv.altura_visual),
    };
  }

  // 3) Fallback retângulo das medidas.
  const W = modelo.medidas?.largura ?? 0;
  const H = modelo.medidas?.altura ?? 0;
  if (W > 0 && H > 0) {
    return {
      face: faceStr,
      ehFacePrincipal: false,
      tipo: "retangulo_fallback",
      largura_visual: W,
      altura_visual: H,
      origem: "fallback",
      pontos_contorno: retanguloPolygon(W, H),
    };
  }
  return null;
}

/** Pontos amostrais para validar uma operação dentro da geometria da face. */
export function amostrarPontosDeOperacao(op: {
  tipo?: string | null;
  x?: number | null; y?: number | null;
  x1?: number | null; x2?: number | null;
  y1?: number | null; y2?: number | null;
  pontos?: Array<{ x?: number | null; y?: number | null }> | null;
}): Array<{ label: string; x: number; y: number }> {
  const out: Array<{ label: string; x: number; y: number }> = [];
  if ((op.tipo ?? "").toLowerCase() === "rasgo") {
    if (op.x1 != null && op.x2 != null && op.y != null) {
      out.push({ label: "p1", x: op.x1, y: op.y });
      out.push({ label: "p2", x: op.x2, y: op.y });
      out.push({ label: "pm", x: (op.x1 + op.x2) / 2, y: op.y });
    } else if (op.x1 != null && op.x2 != null && op.y1 != null && op.y2 != null) {
      out.push({ label: "p1", x: op.x1, y: op.y1 });
      out.push({ label: "p2", x: op.x2, y: op.y2 });
      out.push({ label: "pm", x: (op.x1 + op.x2) / 2, y: (op.y1 + op.y2) / 2 });
    } else if (op.y1 != null && op.y2 != null && op.x != null) {
      out.push({ label: "p1", x: op.x, y: op.y1 });
      out.push({ label: "p2", x: op.x, y: op.y2 });
      out.push({ label: "pm", x: op.x, y: (op.y1 + op.y2) / 2 });
    }
  }
  if (out.length === 0 && op.x != null && op.y != null) {
    out.push({ label: "p", x: op.x, y: op.y });
  }
  for (const pp of op.pontos ?? []) {
    if (pp?.x != null && pp?.y != null) out.push({ label: `pp${out.length}`, x: pp.x, y: pp.y });
  }
  return out;
}
