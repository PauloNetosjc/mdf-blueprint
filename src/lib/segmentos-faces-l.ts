// Segmentação de faces visuais para peças em L.
//
// Uma mesma vista de perfil (inferior, direita, superior, esquerda) pode
// conter MAIS DE UMA face operacional, separadas por uma linha divisória que
// corresponde ao recorte interno do L.
//
// Para o canto recortado padrão das peças BAS (notch inferior-direito), o
// contorno em 6 pontos é:
//   (0,0) → (RX,0) → (RX,RY) → (W,RY) → (W,H) → (0,H)
//
// Segmentos derivados:
//   - perfil inferior (horizontal): F2 = [0..RX], F4 = [RX..W]
//   - perfil direita  (vertical):   F3 = [0..RY], F5 = [RY..H]
//   - perfil superior (horizontal): F6 = [0..W]
//   - perfil esquerda (vertical):   F1 = [0..H]
//   - face principal em L:          F7

export type Ponto = { x: number; y: number };

export type OrigemMedida =
  | "pdf"
  | "calculada_por_contorno"
  | "aproximada"
  | "manual";

export type SegmentoFace = {
  face: string;
  inicio_mm: number;
  fim_mm: number;
  comprimento_mm: number;
  origem_medida: OrigemMedida;
};

export type PerfilSegmentado = {
  perfil: "inferior" | "direita" | "superior" | "esquerda";
  orientacao: "horizontal" | "vertical";
  comprimento_total: number;
  /** Posição da linha divisória entre segmentos (em mm). Null se o perfil tiver só uma face. */
  divisao_em: number | null;
  faces: SegmentoFace[];
};

export type NotchL = "BR" | "TR" | "BL" | "TL";

export type InfoL = {
  W: number;
  H: number;
  RX: number;
  RY: number;
  /** Quadrante do canto recortado. */
  notch: NotchL;
};

/**
 * Detecta uma peça em L a partir de um polígono de 6 pontos. O canto recortado
 * pode ser qualquer quadrante (BR, TR, BL, TL).
 */
export function detectarOrientacaoL(pontos: Ponto[] | null | undefined): InfoL | null {
  if (!pontos || pontos.length !== 6) return null;
  const W = Math.max(...pontos.map((p) => p.x));
  const H = Math.max(...pontos.map((p) => p.y));
  const minX = Math.min(...pontos.map((p) => p.x));
  const minY = Math.min(...pontos.map((p) => p.y));
  if (!(W > 0) || !(H > 0) || minX !== 0 || minY !== 0) return null;
  // Ponto interno (recorte): único com x ∈ (0,W) e y ∈ (0,H).
  const inner = pontos.find(
    (p) => p.x > 0.5 && p.x < W - 0.5 && p.y > 0.5 && p.y < H - 0.5,
  );
  if (!inner) return null;
  // Cantos: detecta qual canto da bounding box está AUSENTE.
  const has = (x: number, y: number) =>
    pontos.some((p) => Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5);
  const corners: Array<{ name: NotchL; x: number; y: number }> = [
    { name: "BL", x: 0, y: 0 },
    { name: "BR", x: W, y: 0 },
    { name: "TR", x: W, y: H },
    { name: "TL", x: 0, y: H },
  ];
  const missing = corners.filter((c) => !has(c.x, c.y));
  if (missing.length !== 1) return null;
  const notch = missing[0].name;
  // RX/RY = distância do ponto interno ao canto do recorte.
  let RX: number, RY: number;
  switch (notch) {
    case "BR": RX = inner.x; RY = inner.y; break;
    case "TR": RX = inner.x; RY = inner.y; break;
    case "BL": RX = W - inner.x; RY = inner.y; break;
    case "TL": RX = W - inner.x; RY = H - inner.y; break;
  }
  return { W, H, RX, RY, notch };
}

/** Compatibilidade com a API anterior (apenas BR). */
export function detectarLBR(pontos: Ponto[] | null | undefined): InfoL | null {
  const info = detectarOrientacaoL(pontos);
  if (!info || info.notch !== "BR") return null;
  return info;
}


/**
 * Gera os perfis segmentados para um L com notch=BR.
 */
export function gerarSegmentosLBR(info: InfoL): PerfilSegmentado[] {
  const { W, H, RX, RY } = info;
  const fonte: OrigemMedida = "calculada_por_contorno";
  return [
    {
      perfil: "inferior",
      orientacao: "horizontal",
      comprimento_total: W,
      divisao_em: RX,
      faces: [
        { face: "2", inicio_mm: 0, fim_mm: RX, comprimento_mm: RX, origem_medida: fonte },
        { face: "4", inicio_mm: RX, fim_mm: W, comprimento_mm: W - RX, origem_medida: fonte },
      ],
    },
    {
      perfil: "direita",
      orientacao: "vertical",
      comprimento_total: H,
      divisao_em: RY,
      faces: [
        { face: "3", inicio_mm: 0, fim_mm: RY, comprimento_mm: RY, origem_medida: fonte },
        { face: "5", inicio_mm: RY, fim_mm: H, comprimento_mm: H - RY, origem_medida: fonte },
      ],
    },
    {
      perfil: "superior",
      orientacao: "horizontal",
      comprimento_total: W,
      divisao_em: null,
      faces: [
        { face: "6", inicio_mm: 0, fim_mm: W, comprimento_mm: W, origem_medida: fonte },
      ],
    },
    {
      perfil: "esquerda",
      orientacao: "vertical",
      comprimento_total: H,
      divisao_em: null,
      faces: [
        { face: "1", inicio_mm: 0, fim_mm: H, comprimento_mm: H, origem_medida: fonte },
      ],
    },
  ];
}

/**
 * A partir dos segmentos, devolve as dimensões visuais (w × h em mm) de cada
 * face para uso pelo visualizador. F7 (principal L) recebe W × H.
 */
export function dimensoesPorFaceL(
  segmentos: PerfilSegmentado[],
  info: InfoL,
  espessura: number,
): Record<string, { w: number; h: number; origem_medida: OrigemMedida }> {
  const E = Math.max(1, espessura || 18);
  const out: Record<string, { w: number; h: number; origem_medida: OrigemMedida }> = {};
  for (const perfil of segmentos) {
    for (const seg of perfil.faces) {
      if (perfil.orientacao === "horizontal") {
        out[seg.face] = { w: seg.comprimento_mm, h: E, origem_medida: seg.origem_medida };
      } else {
        out[seg.face] = { w: E, h: seg.comprimento_mm, origem_medida: seg.origem_medida };
      }
    }
  }
  out["7"] = { w: info.W, h: info.H, origem_medida: "calculada_por_contorno" };
  return out;
}

/**
 * Layout de tela aproximando o PDF para o modo "Ver todas as faces":
 *   F6 acima      (linha 0)
 *   F1 | F7 | F3+F5   (linha do meio; F3 em cima, F5 embaixo na coluna direita)
 *   F2 + F4       (linha de baixo)
 *
 * Devolve caixas (x,y,w,h) em mm para cada face, prontas para serem
 * gravadas em `faces_layout_json.faces`.
 */
export function gerarFacesLayoutL(
  info: InfoL,
  espessura: number,
  segmentos: PerfilSegmentado[],
): Array<{
  face: string;
  label: string;
  tipo_vista: string;
  largura_visual: number;
  altura_visual: number;
  x_layout: number;
  y_layout: number;
  visivel: boolean;
  origem_medida: OrigemMedida;
  segmento_de_perfil?: PerfilSegmentado["perfil"];
}> {
  const dims = dimensoesPorFaceL(segmentos, info, espessura);
  const E = Math.max(1, espessura || 18);
  const GAP = 40;

  // Linha de baixo: F2 (RX) + GAP + F4 (W-RX)
  // Linha de cima:  F6 = W
  // Coluna esquerda: F1 = E×H
  // Coluna direita: F3 (E×RY) em cima do F5 (E×(H-RY)) com gap
  const f1 = dims["1"];
  const f7 = dims["7"];
  const f3 = dims["3"];
  const f5 = dims["5"];
  const f6 = dims["6"];
  const f2 = dims["2"];
  const f4 = dims["4"];

  const x6 = f1.w + GAP;
  const y6 = 0;
  const yMid = f6.h + GAP;
  const x1 = 0;
  const y1 = yMid;
  const x7 = x6;
  const y7 = yMid;
  const xRight = x7 + f7.w + GAP;
  const y3 = yMid;
  const y5 = yMid + f3.h + GAP;
  const yBot = yMid + f7.h + GAP;
  const x2 = x7;
  const x4 = x7 + f2.w + GAP;

  return [
    { face: "6", label: "F6 — Superior", tipo_vista: "superior", largura_visual: f6.w, altura_visual: f6.h, x_layout: x6, y_layout: y6, visivel: true, origem_medida: f6.origem_medida, segmento_de_perfil: "superior" },
    { face: "1", label: "F1 — Lateral esquerda", tipo_vista: "lateral_esquerda", largura_visual: f1.w, altura_visual: f1.h, x_layout: x1, y_layout: y1, visivel: true, origem_medida: f1.origem_medida, segmento_de_perfil: "esquerda" },
    { face: "7", label: "F7 — Principal L", tipo_vista: "principal_L", largura_visual: f7.w, altura_visual: f7.h, x_layout: x7, y_layout: y7, visivel: true, origem_medida: f7.origem_medida },
    { face: "3", label: "F3 — Direita inferior (segmento)", tipo_vista: "lateral_direita_inferior", largura_visual: f3.w, altura_visual: f3.h, x_layout: xRight, y_layout: y3, visivel: true, origem_medida: f3.origem_medida, segmento_de_perfil: "direita" },
    { face: "5", label: "F5 — Direita superior (segmento)", tipo_vista: "lateral_direita_superior", largura_visual: f5.w, altura_visual: f5.h, x_layout: xRight, y_layout: y5, visivel: true, origem_medida: f5.origem_medida, segmento_de_perfil: "direita" },
    { face: "2", label: "F2 — Inferior esquerda (segmento)", tipo_vista: "inferior_esquerda", largura_visual: f2.w, altura_visual: f2.h, x_layout: x2, y_layout: yBot, visivel: true, origem_medida: f2.origem_medida, segmento_de_perfil: "inferior" },
    { face: "4", label: "F4 — Inferior direita (segmento)", tipo_vista: "inferior_direita", largura_visual: f4.w, altura_visual: f4.h, x_layout: x4, y_layout: yBot, visivel: true, origem_medida: f4.origem_medida, segmento_de_perfil: "inferior" },
  ];
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Geometria visual por face — usada pelo visualizador.
 *
 * Quando o modelo técnico possui `faces_visuais_segmentadas`, ESSA é a fonte
 * de verdade. Cada face F1..F6 é apenas um SEGMENTO (retângulo simples), e
 * apenas F7 / face_principal usa o contorno em L completo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type GeometriaVisualFace = {
  face: string;
  tipo: "principal_l" | "segmento_horizontal" | "segmento_vertical" | "retangular";
  largura_visual: number;
  altura_visual: number;
  perfil?: PerfilSegmentado["perfil"];
  inicio_mm?: number;
  fim_mm?: number;
  comprimento_mm?: number;
  origem_medida: OrigemMedida;
  pontos_contorno?: Ponto[];
};

type ModeloLite = {
  medidas?: { largura?: number | null; espessura?: number | null; altura?: number | null } | null;
  geometria?: {
    tipo?: string | null;
    largura?: number | null;
    altura?: number | null;
    pontos_contorno?: Ponto[] | null;
    face_principal?: string | number | null;
  } | null;
  faces_visuais_segmentadas?: PerfilSegmentado[] | null;
};

export function obterGeometriaVisualDaFace(
  modelo: ModeloLite | null | undefined,
  face: string,
  fallback?: { largura?: number | null; altura?: number | null; espessura?: number | null },
): GeometriaVisualFace | null {
  if (!modelo) return null;
  const faceStr = String(face);
  const geometria = modelo.geometria ?? null;
  const espessura = Math.max(1, modelo.medidas?.espessura ?? fallback?.espessura ?? 18);
  const principalFace = geometria?.face_principal != null ? String(geometria.face_principal) : null;

  // Face principal em L → retorna L completo
  if (
    geometria?.tipo === "L" &&
    (faceStr === principalFace || faceStr === "7")
  ) {
    const W = geometria.largura ?? modelo.medidas?.largura ?? fallback?.largura ?? 0;
    const H = geometria.altura ?? modelo.medidas?.altura ?? fallback?.altura ?? 0;
    return {
      face: faceStr,
      tipo: "principal_l",
      largura_visual: W,
      altura_visual: H,
      origem_medida: "calculada_por_contorno",
      pontos_contorno: geometria.pontos_contorno ?? undefined,
    };
  }

  // Segmento de perfil em L
  const segmentos = modelo.faces_visuais_segmentadas ?? [];
  for (const perfil of segmentos) {
    const seg = perfil.faces.find((s) => String(s.face) === faceStr);
    if (!seg) continue;
    const horizontal = perfil.orientacao === "horizontal";
    return {
      face: faceStr,
      tipo: horizontal ? "segmento_horizontal" : "segmento_vertical",
      largura_visual: horizontal ? seg.comprimento_mm : espessura,
      altura_visual: horizontal ? espessura : seg.comprimento_mm,
      perfil: perfil.perfil,
      inicio_mm: seg.inicio_mm,
      fim_mm: seg.fim_mm,
      comprimento_mm: seg.comprimento_mm,
      origem_medida: seg.origem_medida,
    };
  }

  return null;
}
