// Geração e tipagem do faces_layout_json.
// Não toca em operações/bordas — apenas em dados_brutos_json.faces_layout_json.

export type TipoVistaFace =
  | "principal"
  | "lateral"
  | "superior"
  | "inferior"
  | "topo"
  | "fundo"
  | "estreita"
  | "livre";

export type PosicaoPdfFace =
  | "principal_esquerda"
  | "principal_direita"
  | "lateral_esquerda"
  | "lateral_direita"
  | "superior"
  | "inferior"
  | "centro"
  | "livre";

export type FaceLayoutEntry = {
  face: string;
  label?: string;
  tipo_vista?: TipoVistaFace | string;
  largura_visual: number;
  altura_visual: number;
  posicao_pdf?: PosicaoPdfFace | string;
  ordem_visual?: number;
  x_layout?: number;
  y_layout?: number;
  rotacionada?: boolean;
  visivel?: boolean;
  /** Origem da medida do segmento/face. */
  origem_medida?: "pdf" | "calculada_por_contorno" | "aproximada" | "manual";
  /** Quando a face é segmento de um perfil compartilhado (peças em L). */
  segmento_de_perfil?: "inferior" | "direita" | "superior" | "esquerda";
};

export type OrigemLayoutFaces = "automatico" | "manual" | "fallback";

export type FacesLayoutJson = {
  faces: FaceLayoutEntry[];
  origem?: OrigemLayoutFaces;
  atualizado_em?: string;
  observacao?: string;
};

export const TIPOS_VISTA: TipoVistaFace[] = [
  "principal",
  "lateral",
  "superior",
  "inferior",
  "topo",
  "fundo",
  "estreita",
  "livre",
];

export const POSICOES_PDF: PosicaoPdfFace[] = [
  "principal_esquerda",
  "principal_direita",
  "lateral_esquerda",
  "lateral_direita",
  "superior",
  "inferior",
  "centro",
  "livre",
];

export function ehTipoDivisoria(prefixo?: string | null, tipo?: string | null) {
  const p = (prefixo ?? "").toUpperCase();
  const t = (tipo ?? "").toLowerCase();
  return p === "DIV" || p.startsWith("DIV") || t.includes("divis");
}

/**
 * Gera um faces_layout_json automático com base em medidas/tipo.
 * Não altera operações/bordas.
 */
export function gerarFacesLayoutAutomatico(opts: {
  largura: number | null;
  altura: number | null;
  espessura: number | null;
  prefixo?: string | null;
  tipo?: string | null;
  facesPresentes?: string[];
}): FacesLayoutJson {
  const L = opts.largura ?? 600;
  const A = opts.altura ?? 400;
  const E = opts.espessura ?? 18;
  const GAP = 40;

  const isDiv = ehTipoDivisoria(opts.prefixo, opts.tipo);

  // Em ambos os casos as dimensões por face seguem a regra L×A / E×A / L×E,
  // o que difere é o layout visual no modo "Ver todas as faces".
  const f0 = { w: L, h: A };
  const f5 = { w: L, h: A };
  const f1 = { w: E, h: A };
  const f3 = { w: E, h: A };
  const f2 = { w: L, h: E };
  const f4 = { w: L, h: E };

  // Posições: F4 (topo) em cima; F0, F1, F5, F3 na linha do meio; F2 (inferior) embaixo.
  const middleH = Math.max(f0.h, f1.h, f5.h, f3.h);
  const yTop = 0;
  const yMid = f4.h + GAP;
  const yBot = yMid + middleH + GAP;
  const x0 = 0;
  const x1 = x0 + f0.w + GAP;
  const x5 = x1 + f1.w + GAP;
  const x3 = x5 + f5.w + GAP;

  const presentes = new Set((opts.facesPresentes ?? ["0", "1", "2", "3", "4", "5"]).map(String));

  const faces: FaceLayoutEntry[] = [
    {
      face: "0",
      label: "F0 — Fundo",
      tipo_vista: "fundo",
      largura_visual: f0.w,
      altura_visual: f0.h,
      posicao_pdf: "principal_esquerda",
      ordem_visual: 1,
      x_layout: x0,
      y_layout: yMid,
      visivel: presentes.has("0"),
    },
    {
      face: "1",
      label: "F1 — Lateral esquerda",
      tipo_vista: "lateral",
      largura_visual: f1.w,
      altura_visual: f1.h,
      posicao_pdf: "lateral_esquerda",
      ordem_visual: 2,
      x_layout: x1,
      y_layout: yMid + (middleH - f1.h) / 2,
      visivel: presentes.has("1"),
    },
    {
      face: "5",
      label: "F5 — Face principal",
      tipo_vista: "principal",
      largura_visual: f5.w,
      altura_visual: f5.h,
      posicao_pdf: "principal_direita",
      ordem_visual: 3,
      x_layout: x5,
      y_layout: yMid,
      visivel: presentes.has("5") || isDiv,
    },
    {
      face: "3",
      label: "F3 — Lateral direita",
      tipo_vista: "lateral",
      largura_visual: f3.w,
      altura_visual: f3.h,
      posicao_pdf: "lateral_direita",
      ordem_visual: 4,
      x_layout: x3,
      y_layout: yMid + (middleH - f3.h) / 2,
      visivel: presentes.has("3"),
    },
    {
      face: "4",
      label: "F4 — Topo superior",
      tipo_vista: "superior",
      largura_visual: f4.w,
      altura_visual: f4.h,
      posicao_pdf: "superior",
      ordem_visual: 0,
      x_layout: x0,
      y_layout: yTop,
      visivel: presentes.has("4"),
    },
    {
      face: "2",
      label: "F2 — Topo inferior",
      tipo_vista: "inferior",
      largura_visual: f2.w,
      altura_visual: f2.h,
      posicao_pdf: "inferior",
      ordem_visual: 5,
      x_layout: x0,
      y_layout: yBot,
      visivel: presentes.has("2"),
    },
  ];

  return {
    faces,
    origem: "automatico",
    atualizado_em: new Date().toISOString(),
    observacao: isDiv
      ? "Layout gerado automaticamente para peça tipo Divisória."
      : "Layout gerado automaticamente.",
  };
}
