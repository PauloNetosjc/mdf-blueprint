// Modelo técnico canônico interno da peça cadastrada.
//
// A verdade operacional do sistema é este objeto, gravado em
// `pecas_cadastradas.dados_brutos_json.modelo_tecnico_json`.
//
// O PDF original é apenas fonte de leitura/conferência. Visualizador interno e
// (futura) geração de G-code devem ler deste modelo, NÃO do PDF.

import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { validarModeloTecnico, type ModeloTecnicoLite } from "@/lib/validar-modelo-tecnico";
import { gerarParametrizacaoModelo } from "@/lib/parametrizacao-pecas";
import { classificarGeometriaPeca as classificarGeometriaPecaCentral } from "@/lib/classificar-geometria";
import type {
  BordaExtraida,
  OperacaoExtraida,
  ResultadoParserPDF,
} from "@/lib/pecas-cadastradas-parser";


// ---------- Schema (Zod) ----------

const PontoSchema = z.object({ x: z.number(), y: z.number() });

export const GeometriaTipoSchema = z.enum([
  "retangular",
  "recortada",
  "L",
  "poligono_complexo",
]);
export type GeometriaTipo = z.infer<typeof GeometriaTipoSchema>;

export const GeometriaOrigemSchema = z.enum([
  "pdf_texto",
  "pdf_medidas",
  "pdf_vetor",
  "pdf_visual",
  "pdf_visual_calibrado",
  "pdf_raster_calibrado",
  "contorno_tecnico_pdf",
  "regra_parametrica",
  "regra_base_l_inferior",
  "regra_base_l_inferior_validada_por_operacoes",
  "manual",
]);
export type GeometriaOrigem = z.infer<typeof GeometriaOrigemSchema>;

export const GeometriaSchema = z.object({
  tipo: GeometriaTipoSchema,
  origem: GeometriaOrigemSchema,
  largura: z.number().nullable().optional().default(null),
  altura: z.number().nullable().optional().default(null),
  pontos_contorno: z.array(PontoSchema).default([]),
  confianca: z.enum(["alta", "media", "baixa"]).default("media"),
  pendente: z.boolean().default(false),
  face_principal: z.union([z.string(), z.number()]).nullable().optional(),
});

const AncoraXSchema = z.enum(["esquerda", "direita", "centro", "percentual", "absoluto"]);
const AncoraYSchema = z.enum(["inferior", "superior", "centro", "percentual", "absoluto"]);
const RegraSchema = z.enum(["ancora", "absoluto"]);

export const ParametricoSchema = z.object({
  ancora_x: AncoraXSchema,
  distancia_x: z.number(),
  ancora_y: AncoraYSchema,
  distancia_y: z.number(),
  regra_x: RegraSchema.default("ancora"),
  regra_y: RegraSchema.default("ancora"),
  largura_base: z.number(),
  altura_base: z.number(),
  ancora_x2: AncoraXSchema.optional(),
  distancia_x2: z.number().optional(),
  ancora_y2: AncoraYSchema.optional(),
  distancia_y2: z.number().optional(),
  editado_manualmente: z.boolean().optional(),
});

export const OperacaoModeloSchema = z.object({
  face: z.union([z.string(), z.number()]).transform((v) => String(v)),
  tipo: z.string(),
  subtipo: z.string().nullable().optional(),
  nome: z.string().nullable().optional(),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
  z: z.number().nullable().optional(),
  x1: z.number().nullable().optional(),
  x2: z.number().nullable().optional(),
  y1: z.number().nullable().optional(),
  y2: z.number().nullable().optional(),
  diametro: z.number().nullable().optional(),
  profundidade: z.number().nullable().optional(),
  largura: z.number().nullable().optional(),
  comprimento: z.number().nullable().optional(),
  pontos: z.array(z.object({
    x: z.number().nullable(),
    y: z.number().nullable(),
    profundidade: z.number().nullable().optional(),
    tipo: z.string().nullable().optional(),
  })).optional().default([]),
  ordem: z.number().optional().default(0),
  confianca: z.enum(["alta", "media", "baixa"]).optional().default("media"),
  parametrico: ParametricoSchema.optional(),
});
export type OperacaoModelo = z.infer<typeof OperacaoModeloSchema>;
export type Parametrico = z.infer<typeof ParametricoSchema>;


export const BordaModeloSchema = z.object({
  lado: z.string(),
  codigo_borda: z.string().nullable().optional(),
  descricao_borda: z.string().nullable().optional(),
  espessura: z.number().nullable().optional(),
  largura: z.number().nullable().optional(),
  cor: z.string().nullable().optional(),
  indicador_desenho: z.string().nullable().optional(),
  quantidade_m: z.number().nullable().optional(),
  confianca: z.enum(["alta", "media", "baixa"]).optional().default("media"),
});
export type BordaModelo = z.infer<typeof BordaModeloSchema>;

const FaceOperacionalSchema = z.object({ face: z.string() });
const OrigemMedidaSchema = z.enum(["pdf", "calculada_por_contorno", "aproximada", "manual"]);
const FaceVisualSchema = z.object({
  face: z.string(),
  tipo_vista: z.string().optional(),
  largura_visual: z.number().nullable().optional(),
  altura_visual: z.number().nullable().optional(),
  geometria: z.string().nullable().optional(),
  origem_medida: OrigemMedidaSchema.optional(),
  segmento_de_perfil: z.enum(["inferior", "direita", "superior", "esquerda"]).optional(),
});

const SegmentoFaceSchema = z.object({
  face: z.string(),
  inicio_mm: z.number(),
  fim_mm: z.number(),
  comprimento_mm: z.number(),
  origem_medida: OrigemMedidaSchema.default("calculada_por_contorno"),
});
const PerfilSegmentadoSchema = z.object({
  perfil: z.enum(["inferior", "direita", "superior", "esquerda"]),
  orientacao: z.enum(["horizontal", "vertical"]),
  comprimento_total: z.number(),
  divisao_em: z.number().nullable().default(null),
  faces: z.array(SegmentoFaceSchema),
});

export const ParametrizacaoSchema = z.object({
  largura_base: z.number(),
  altura_base: z.number(),
  espessura_base: z.number().default(0),
  regra: z.literal("ancoras_topos").default("ancoras_topos"),
});

export const ModeloTecnicoSchema = z.object({
  versao: z.literal(1).default(1),
  codigo: z.string(),
  nome: z.string().nullable().optional(),
  tipo: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  fita: z.string().nullable().optional(),
  medidas: z.object({
    largura: z.number().nullable().default(null),
    espessura: z.number().nullable().default(null),
    altura: z.number().nullable().default(null),
  }),
  face_alinhamento: z.string().nullable().optional().default(null),
  geometria: GeometriaSchema,
  faces: z.array(z.object({ face: z.string() })).default([]),
  faces_operacionais: z.array(FaceOperacionalSchema).default([]),
  faces_visuais: z.array(FaceVisualSchema).default([]),
  operacoes: z.array(OperacaoModeloSchema).default([]),
  bordas: z.array(BordaModeloSchema).default([]),
  avisos: z.array(z.string()).default([]),
  erros: z.array(z.string()).default([]),
  metadados: z.record(z.unknown()).optional().default({}),
  parametrizacao: ParametrizacaoSchema.optional(),
});

export type ModeloTecnicoJson = z.infer<typeof ModeloTecnicoSchema>;


// ---------- Regras paramétricas de geometria ----------

/**
 * Detecta se uma peça é "Base L" pelos sinais textuais do parser.
 * Aceita "Base L", "L Inferior", "L Superior".
 */
export function ehBaseL(nome: string | null | undefined, prefixo: string | null | undefined): boolean {
  const n = (nome ?? "").toLowerCase();
  if (/\bbase\s*l\b|l\s*inferior|l\s*superior/i.test(n)) return true;
  if ((prefixo ?? "").toUpperCase() === "BAS" && /\bl\b/i.test(n)) return true;
  return false;
}

/**
 * Gera contorno paramétrico em L com recorte no quadrante superior-direito.
 * Aproximação visual padrão: recorte de 50% da largura por 50% da altura.
 * Para BAS0485A (939.5×939.5) isso produz uma peça em L genérica visível,
 * que pode ser refinada via Importar modelo técnico JSON.
 */
export function gerarContornoL(largura: number, altura: number): { x: number; y: number }[] {
  const cutW = Math.round(largura * 0.5 * 100) / 100;
  const cutH = Math.round(altura * 0.5 * 100) / 100;
  const xCorte = largura - cutW;
  const yCorte = altura - cutH;
  // Sentido anti-horário (coord. técnicas, Y para cima):
  return [
    { x: 0, y: 0 },
    { x: largura, y: 0 },
    { x: largura, y: yCorte },
    { x: xCorte, y: yCorte },
    { x: xCorte, y: altura },
    { x: 0, y: altura },
  ];
}

/**
 * Contorno técnico específico da peça "Base L Inferior" (padrão BAS).
 * Padrão geométrico extraído do desenho do PDF (ex.: BAS0485A 939.5×939.5):
 *   - perna inferior horizontal indo até 543 mm (x ≈ 0.578·L)
 *   - sobe até 470 mm (y ≈ 0.500·H)
 *   - avança para a direita até a largura total
 *   - sobe até o topo
 *   - retorna pela esquerda
 * Aplica as mesmas proporções para outras Base L de tamanho diferente,
 * preservando os números exatos para BAS0485A (939.5×939.5).
 */
export function gerarContornoBaseLInferior(
  largura: number,
  altura: number,
): { x: number; y: number }[] {
  const ehBAS0485 = Math.abs(largura - 939.5) < 0.5 && Math.abs(altura - 939.5) < 0.5;
  const xCorte = ehBAS0485 ? 543 : Math.round(largura * 0.578 * 100) / 100;
  const yCorte = ehBAS0485 ? 470 : Math.round(altura * 0.5 * 100) / 100;
  return [
    { x: 0, y: 0 },
    { x: xCorte, y: 0 },
    { x: xCorte, y: yCorte },
    { x: largura, y: yCorte },
    { x: largura, y: altura },
    { x: 0, y: altura },
  ];
}

/**
 * Gera vários candidatos de contorno em L (4 cantos × 2 orientações de cut)
 * e retorna o que deixar mais operações dentro. A escolha é puramente
 * geométrica — não muda nenhuma operação extraída pelo parser.
 */
export type CandidatoContornoL = {
  nome: string;
  pontos: { x: number; y: number }[];
  fora: number;
};

function areaPoligonoAbs(pontos: Pt[]): number {
  if (pontos.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
    area += pontos[j].x * pontos[i].y - pontos[i].x * pontos[j].y;
  }
  return Math.abs(area) / 2;
}

function ehContornoLValido(pontos: Pt[], largura: number, altura: number): boolean {
  if (pontos.length < 6) return false;
  const area = areaPoligonoAbs(pontos);
  if (!(area > 0 && area < largura * altura - 0.01)) return false;
  const internos = pontos.filter(
    (p) => p.x > 0.01 && p.x < largura - 0.01 && p.y > 0.01 && p.y < altura - 0.01,
  );
  const temArestaInternaVertical = pontos.some((p, i) => {
    const q = pontos[(i + 1) % pontos.length];
    return Math.abs(p.x - q.x) < 0.01 && p.x > 0.01 && p.x < largura - 0.01;
  });
  const temArestaInternaHorizontal = pontos.some((p, i) => {
    const q = pontos[(i + 1) % pontos.length];
    return Math.abs(p.y - q.y) < 0.01 && p.y > 0.01 && p.y < altura - 0.01;
  });
  return internos.length >= 1 && temArestaInternaVertical && temArestaInternaHorizontal;
}

export function gerarContornoBaseLInferiorPorValidacao(
  largura: number,
  altura: number,
  operacoes: OperacaoModelo[],
): { escolhido: CandidatoContornoL | null; candidatos: CandidatoContornoL[]; motivo: string } {
  const ehBAS0485 =
    Math.abs(largura - 939.5) < 0.5 && Math.abs(altura - 939.5) < 0.5;
  const cwBase = ehBAS0485 ? largura - 543 : Math.round(largura * 0.422 * 100) / 100;
  const chBase = ehBAS0485 ? 470 : Math.round(altura * 0.5 * 100) / 100;

  const cutDims: Array<[number, number]> = [
    [cwBase, chBase],
    [chBase, cwBase],
  ];
  const cantos = ["BR", "BL", "TR", "TL"] as const;
  const candidatos: CandidatoContornoL[] = [];

  const polyDoCanto = (
    canto: (typeof cantos)[number],
    cw: number,
    ch: number,
  ): { x: number; y: number }[] => {
    const L = largura, H = altura;
    switch (canto) {
      case "BR":
        return [
          { x: 0, y: 0 },
          { x: L - cw, y: 0 },
          { x: L - cw, y: ch },
          { x: L, y: ch },
          { x: L, y: H },
          { x: 0, y: H },
        ];
      case "BL":
        return [
          { x: cw, y: 0 },
          { x: L, y: 0 },
          { x: L, y: H },
          { x: 0, y: H },
          { x: 0, y: ch },
          { x: cw, y: ch },
        ];
      case "TR":
        return [
          { x: 0, y: 0 },
          { x: L, y: 0 },
          { x: L, y: H - ch },
          { x: L - cw, y: H - ch },
          { x: L - cw, y: H },
          { x: 0, y: H },
        ];
      case "TL":
        return [
          { x: 0, y: 0 },
          { x: L, y: 0 },
          { x: L, y: H },
          { x: cw, y: H },
          { x: cw, y: H - ch },
          { x: 0, y: H - ch },
        ];
    }
  };

  const contarFora = (poly: { x: number; y: number }[]): number => {
    let fora = 0;
    for (const op of operacoes) {
      const pts = pontosDeOperacao(op);
      if (!pts.length) continue;
      for (const p of pts) {
        if (!pontoDentroDoPoligono(p, poly, 0.75)) {
          fora++;
          break;
        }
      }
    }
    return fora;
  };

  for (const [cw, ch] of cutDims) {
    for (const canto of cantos) {
      const pts = polyDoCanto(canto, cw, ch);
      candidatos.push({
        nome: `${canto}_${Math.round(cw)}x${Math.round(ch)}`,
        pontos: pts,
        fora: contarFora(pts),
      });
    }
  }

  const candidatosL = candidatos.filter((c) => ehContornoLValido(c.pontos, largura, altura));
  candidatosL.sort((a, b) => a.fora - b.fora);
  const melhor = candidatosL[0] ?? null;
  if (!melhor) {
    return { escolhido: null, candidatos: candidatosL, motivo: "Nenhum candidato L válido gerado." };
  }
  if (melhor.fora === 0) {
    return {
      escolhido: melhor,
      candidatos: candidatosL,
      motivo: `Candidato ${melhor.nome} mantém todas as operações dentro do contorno.`,
    };
  }
  return {
    escolhido: melhor,
    candidatos: candidatosL,
    motivo:
      `Nenhum contorno L candidato contém todas as operações. Mantido melhor L (${melhor.nome}) com ${melhor.fora} operação(ões) fora para diagnóstico.`,
  };
}

export function classificarGeometria(args: {
  largura: number | null;
  altura: number | null;
  nome: string | null;
  prefixo: string | null;
  facesAcimaDe5: number[];
  temRasgoLinha: boolean;
}): {
  tipo: GeometriaTipo;
  origem: GeometriaOrigem;
  pontos_contorno: { x: number; y: number }[];
  confianca: "alta" | "media" | "baixa";
  pendente: boolean;
  relatorio: import("@/lib/classificar-geometria").ResultadoClassificacao["relatorio"];
} {
  // Delega ao classificador central — único lugar autorizado a decidir L.
  // Aqui não há contorno técnico nem diagnóstico visual; estes só são
  // aplicados na camada de reprocessamento (peca-cadastrada-reprocessar.ts).
  const r = classificarGeometriaPecaCentral({
    largura: args.largura,
    altura: args.altura,
    espessura: null,
    nome: args.nome,
    prefixo: args.prefixo,
    facesComOperacao: args.facesAcimaDe5,
    temRasgoVerticalLinha: args.temRasgoLinha,
    contornoTecnicoPdf: null,
    diagnosticoVisualPontos: null,
    diagnosticoVisualTipo: null,
    diagnosticoVisualConfianca: null,
    recorteExplicito: null,
  });
  // Mapeia o tipo central → schema do modelo técnico (sem "pendente").
  const tipo: GeometriaTipo =
    r.tipo === "pendente" ? "poligono_complexo" : (r.tipo as GeometriaTipo);
  return {
    tipo,
    origem: r.origem as GeometriaOrigem,
    pontos_contorno: r.pontos_contorno,
    confianca: r.confianca,
    pendente: r.tipo === "pendente" ? true : r.pendente,
    relatorio: r.relatorio,
  };
}

// ---------- Construtor a partir do resultado do parser ----------

function mapOperacao(o: OperacaoExtraida, idx: number): OperacaoModelo {
  const subtipo =
    o.tipo_operacao === "rasgo" && o.y1 != null && o.y2 != null
      ? "rasgo_linha"
      : o.tipo_operacao === "rasgo" && o.x1 != null && o.x2 != null
        ? "rasgo_horizontal"
        : null;
  return {
    face: o.face != null ? String(o.face) : "0",
    tipo: o.tipo_operacao,
    subtipo,
    nome: o.nome_operacao,
    x: o.x,
    y: o.y,
    z: o.z,
    x1: o.x1,
    x2: o.x2,
    y1: o.y1,
    y2: o.y2,
    diametro: o.diametro,
    profundidade: o.profundidade,
    largura: o.largura,
    comprimento: o.comprimento,
    pontos: (o.pontos ?? []).map((p) => ({
      x: p.x,
      y: p.y,
      profundidade: p.profundidade ?? null,
      tipo: p.tipo ?? null,
    })),
    ordem: idx + 1,
    confianca: o.confianca_parser,
  };
}

function mapBorda(b: BordaExtraida): BordaModelo {
  return {
    lado: b.lado,
    codigo_borda: b.codigo_borda,
    descricao_borda: b.descricao_borda,
    espessura: b.espessura,
    largura: b.largura,
    cor: b.cor,
    indicador_desenho: b.indicador_desenho,
    quantidade_m: b.quantidade_m ?? null,
    confianca: b.confianca_parser,
  };
}

/**
 * Constrói o modelo técnico canônico a partir do resultado do parser do PDF.
 * Este é o objeto que o visualizador e (futura) geração de G-code devem usar.
 */
export function construirModeloTecnico(
  result: ResultadoParserPDF,
  faceAlinhamento: string | null,
): ModeloTecnicoJson {
  const facesAcimaDe5 = Array.from(
    new Set(
      result.operacoes
        .map((o) => Number(o.face))
        .filter((n) => Number.isFinite(n) && n > 5),
    ),
  );
  const temRasgoLinha = result.operacoes.some(
    (o) => o.tipo_operacao === "rasgo" && o.y1 != null && o.y2 != null,
  );

  const geometria = classificarGeometria({
    largura: result.largura_ref,
    altura: result.altura_ref,
    nome: result.nome_peca,
    prefixo: result.codigo?.prefixo ?? null,
    facesAcimaDe5,
    temRasgoLinha,
  });

  // Faces presentes = apenas as que têm operação.
  const facesPresentes = Array.from(
    new Set(
      result.operacoes
        .map((o) => o.face)
        .filter((f): f is string => f != null && f !== ""),
    ),
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const baseLVisual =
    ehBaseL(result.nome_peca, result.codigo?.prefixo ?? null) ||
    ((result.codigo?.prefixo ?? "").toUpperCase() === "BAS" &&
      facesPresentes.includes("7") &&
      temRasgoLinha &&
      facesAcimaDe5.length > 0);
  const facesOperacionais = facesPresentes.map((f) => ({ face: f }));
  const facesVisuais = baseLVisual
    ? [
        { face: "1", tipo_vista: "lateral_esquerda" },
        { face: "2", tipo_vista: "inferior_esquerda" },
        { face: "3", tipo_vista: "lateral_direita_inferior" },
        { face: "4", tipo_vista: "inferior_direita" },
        { face: "5", tipo_vista: "lateral_direita_superior" },
        { face: "6", tipo_vista: "superior" },
        { face: "7", tipo_vista: "principal_L" },
      ]
    : facesOperacionais;

  const avisos: string[] = [];
  if (geometria.pendente) {
    avisos.push(
      "Contorno visual complexo não convertido para geometria interna. Importe um modelo técnico JSON para calibrar.",
    );
  }
  if (facesAcimaDe5.length > 0) {
    avisos.push(`Faces acima de F5 detectadas: ${facesAcimaDe5.join(", ")}`);
  }

  const modelo = ModeloTecnicoSchema.parse({
    versao: 1,
    codigo: result.codigo?.codigo_completo ?? "",
    nome: result.nome_peca,
    tipo: result.codigo?.tipo_peca ?? null,
    material: result.material_ref,
    fita: result.fita_ref,
    medidas: {
      largura: result.largura_ref,
      espessura: result.espessura_ref,
      altura: result.altura_ref,
    },
    face_alinhamento: faceAlinhamento,
    geometria: {
      tipo: geometria.tipo,
      origem: geometria.origem,
      largura: result.largura_ref,
      altura: result.altura_ref,
      pontos_contorno: geometria.pontos_contorno,
      confianca: geometria.confianca,
      pendente: geometria.pendente,
    },
    faces: facesOperacionais,
    faces_operacionais: facesOperacionais,
    faces_visuais: facesVisuais,
    operacoes: result.operacoes.map(mapOperacao),
    bordas: result.bordas.map(mapBorda),
    avisos,
    erros: result.erros,
    metadados: {
      classificacao_pdf: result.classificacao.classificacao,
      gerado_em: new Date().toISOString(),
      classificacao_geometria: geometria.relatorio,
    },
  });

  // Gera parametrização automática (âncoras aos topos) a partir das
  // medidas-base. Operações sem coordenadas válidas ficam sem `parametrico`.
  return gerarParametrizacaoModelo(modelo);
}


/**
 * Quando o modelo técnico tem `pontos_contorno` válidos (>=3 pts), monta um
 * `contorno_externo_json` compatível com o visualizador atual para que ele
 * desenhe a peça pelo polígono real em vez de cair no retângulo padrão.
 */
export function contornoExternoDoModelo(modelo: ModeloTecnicoJson) {
  const pts = modelo.geometria.pontos_contorno;
  if (!pts || pts.length < 3) return null;
  const largura = modelo.geometria.largura ?? modelo.medidas.largura ?? 0;
  const altura = modelo.geometria.altura ?? modelo.medidas.altura ?? 0;
  if (largura <= 0 || altura <= 0) return null;
  return {
    origem:
      modelo.geometria.tipo === "retangular"
        ? ("retangular" as const)
        : ("parser_pdf" as const),
    largura,
    altura,
    pontos: pts.map((p) => ({ x: p.x, y: p.y })),
    recuos: [],
    presets_aplicados: [`modelo_tecnico_${modelo.geometria.tipo}`],
    observacao: `Contorno gerado a partir do modelo técnico (${modelo.geometria.origem}).`,
  };
}

// ---------- Validação geométrica das operações ----------

type Pt = { x: number; y: number };

function pontoDentroDoPoligono(p: Pt, poly: Pt[], tol = 0.5): boolean {
  // Ray casting + tolerância para a borda.
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) dentro = !dentro;
    // Borda: distância do ponto ao segmento <= tol → considera dentro.
    const dx = xj - xi, dy = yj - yi;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - xi) * dx + (p.y - yi) * dy) / len2));
    const px = xi + t * dx, py = yi + t * dy;
    const d2 = (p.x - px) ** 2 + (p.y - py) ** 2;
    if (d2 <= tol * tol) return true;
  }
  return dentro;
}

function pontosDeOperacao(op: OperacaoModelo): Pt[] {
  const pts: Pt[] = [];
  if (op.x != null && op.y != null) pts.push({ x: op.x, y: op.y });
  if (op.x1 != null && op.y1 != null) pts.push({ x: op.x1, y: op.y1 });
  if (op.x2 != null && op.y2 != null) pts.push({ x: op.x2, y: op.y2 });
  // Midpoint de rasgo, se houver dois extremos
  if (op.x1 != null && op.x2 != null && op.y1 != null && op.y2 != null) {
    pts.push({ x: (op.x1 + op.x2) / 2, y: (op.y1 + op.y2) / 2 });
  } else if (op.x1 != null && op.x2 != null && op.y != null) {
    pts.push({ x: (op.x1 + op.x2) / 2, y: op.y });
  } else if (op.y1 != null && op.y2 != null && op.x != null) {
    pts.push({ x: op.x, y: (op.y1 + op.y2) / 2 });
  }
  for (const pp of op.pontos ?? []) {
    if (pp.x != null && pp.y != null) pts.push({ x: pp.x, y: pp.y });
  }
  return pts;
}

export type ValidacaoGeometrica = {
  ok: boolean;
  forasDoContorno: Array<{
    face: string;
    tipo: string;
    nome: string | null | undefined;
    ordem: number;
    x?: number;
    y?: number;
    motivo: string;
  }>;
};

function modeloEhBaseLObrigatoria(modelo: ModeloTecnicoJson): boolean {
  const nome = modelo.nome ?? "";
  const codigo = modelo.codigo.toUpperCase();
  const faces = modelo.faces ?? [];
  const operacoes = modelo.operacoes ?? [];
  const facesVisuais = modelo.faces_visuais ?? [];
  const temFace7 = faces.some((f) => f.face === "7") || operacoes.some((o) => String(o.face) === "7");
  const temRasgoLinha = operacoes.some((o) => o.tipo === "rasgo" && o.y1 != null && o.y2 != null);
  const temFaceAcima5 = operacoes.some((o) => Number(o.face) > 5) || facesVisuais.some((f) => Number(f.face) > 5);
  return ehBaseL(nome, codigo.slice(0, 3)) || (codigo.startsWith("BAS") && temFace7 && temRasgoLinha && temFaceAcima5);
}

/**
 * Valida que toda operação cai dentro (ou na borda) do polígono de contorno.
 * Se a geometria for retangular sem pontos explícitos, deriva o retângulo de
 * largura×altura. Usa face de alinhamento (Face 7 em Base L) como referência
 * apenas para verificar operações dessa face; demais faces (laterais/topo)
 * ficam fora do escopo desta validação plana.
 */
export function validarGeometriaModelo(
  modelo: ModeloTecnicoJson,
): ValidacaoGeometrica {
  const L = modelo.geometria.largura ?? modelo.medidas.largura ?? 0;
  const H = modelo.geometria.altura ?? modelo.medidas.altura ?? 0;
  let poly = modelo.geometria.pontos_contorno ?? [];
  if (modelo.geometria.tipo !== "L" && poly.length < 3 && L > 0 && H > 0) {
    poly = [
      { x: 0, y: 0 },
      { x: L, y: 0 },
      { x: L, y: H },
      { x: 0, y: H },
    ];
  }
  if (poly.length < 3) {
    return { ok: false, forasDoContorno: [] };
  }
  // Determina face alvo numérica. `face_alinhamento` pode vir como letra
  // ("A") herdada do parser — nesse caso usamos a face com mais operações
  // (plano da peça, ex.: Face 7 em Base L). Operações em outras faces
  // (laterais/topo) também são validadas porque suas coordenadas X/Y vivem
  // no mesmo plano da peça e devem cair sobre a borda do polígono.
  const contagemPorFace = new Map<string, number>();
  for (const op of modelo.operacoes) {
    const k = String(op.face);
    contagemPorFace.set(k, (contagemPorFace.get(k) ?? 0) + 1);
  }
  const faceAlinhRaw = modelo.face_alinhamento ?? "";
  const faceAlinhNum = /^\d+$/.test(faceAlinhRaw) ? faceAlinhRaw : null;
  const facePlano =
    faceAlinhNum ??
    Array.from(contagemPorFace.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] ??
    null;

  const foras: ValidacaoGeometrica["forasDoContorno"] = [];
  for (const op of modelo.operacoes) {
    const pts = pontosDeOperacao(op);
    if (pts.length === 0) continue;
    // Tolerância maior para operações em faces de borda (laterais), pois
    // tipicamente apoiam-se sobre o contorno externo.
    const tol = String(op.face) === facePlano ? 0.75 : 1.5;
    for (const p of pts) {
      if (!pontoDentroDoPoligono(p, poly, tol)) {
        foras.push({
          face: String(op.face),
          tipo: op.tipo,
          nome: op.nome,
          ordem: op.ordem ?? 0,
          x: p.x,
          y: p.y,
          motivo: `Ponto (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) fora do contorno`,
        });
        break;
      }
    }
  }
  return { ok: foras.length === 0, forasDoContorno: foras };
}

// ---------- Bloqueio de geração de G-code ----------

export function podeGerarGcode(modelo: ModeloTecnicoJson | null | undefined): {
  permitido: boolean;
  motivo: string;
  validacao?: ValidacaoGeometrica;
} {
  if (!modelo) {
    return {
      permitido: false,
      motivo: "Modelo técnico ainda não foi construído. Reprocesse o parser.",
    };
  }
  if (modelo.geometria.pendente) {
    return {
      permitido: false,
      motivo:
        "Geometria da peça ainda não foi convertida para dados internos. Não é seguro gerar CNC.",
    };
  }
  if ((modelo.medidas.largura ?? 0) <= 0 || (modelo.medidas.altura ?? 0) <= 0) {
    return { permitido: false, motivo: "Medidas mínimas da peça não definidas." };
  }
  if (modeloEhBaseLObrigatoria(modelo) && modelo.geometria.tipo !== "L") {
    return { permitido: false, motivo: "Base L não pode gerar CNC com contorno retangular." };
  }
  if (modelo.geometria.tipo === "L" && (modelo.geometria.pontos_contorno?.length ?? 0) < 6) {
    return { permitido: false, motivo: "Contorno L incompleto (mín. 6 pontos)." };
  }
  if ((modelo.geometria.pontos_contorno?.length ?? 0) < 4) {
    return { permitido: false, motivo: "Contorno da peça incompleto (mín. 4 pontos)." };
  }
  if ((modelo.erros ?? []).length > 0) {
    return { permitido: false, motivo: `Erros críticos no modelo: ${modelo.erros[0]}` };
  }
  const validacao = validarGeometriaModelo(modelo);
  if (!validacao.ok) {
    return {
      permitido: false,
      motivo: `Operações fora do contorno (${validacao.forasDoContorno.length}). Corrigir antes de gerar CNC.`,
      validacao,
    };
  }
  const editadoManualmente =
    (modelo.metadados as Record<string, unknown> | undefined)?.editado_manualmente === true;
  if (modelo.geometria.tipo === "L") {
    return {
      permitido: true,
      motivo: editadoManualmente
        ? "Geometria editada manualmente. Conferir antes de enviar à máquina."
        : "Geometria em L gerada por regra técnica Base L Inferior. Conferir antes de enviar à máquina.",
      validacao,
    };
  }
  return {
    permitido: true,
    motivo: editadoManualmente
      ? "Geometria editada manualmente. Conferir antes de enviar à máquina."
      : "Geometria validada para CNC.",
    validacao,
  };
}

// ---------- Exportar ----------

export function exportarModeloTecnicoJson(modelo: ModeloTecnicoJson, codigo: string) {
  const blob = new Blob([JSON.stringify(modelo, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${codigo || "peca"}.modelo-tecnico.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Importar ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * Importa um modelo técnico JSON previamente exportado (ou calibrado à mão)
 * e reespelha em:
 *   - pecas_cadastradas.dados_brutos_json.modelo_tecnico_json
 *   - pecas_cadastradas.dados_brutos_json.contorno_externo_json
 *   - peca_cadastrada_operacoes (substitui todas)
 *   - peca_cadastrada_bordas    (substitui todas)
 *
 * Marca cada registro como origem="manual_import" para que reprocessos futuros
 * preservem (a menos que sobrescreverManual=true).
 */
export async function importarModeloTecnicoJson(
  pecaId: string,
  jsonText: string,
): Promise<{ operacoes: number; bordas: number; modelo: ModeloTecnicoJson }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`JSON inválido: ${(e as Error).message}`);
  }
  const modelo = ModeloTecnicoSchema.parse(parsed);

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error("Não autenticado.");

  // Lê dados_brutos_json atual para preservar o resto
  const { data: peca, error: ePeca } = await db
    .from("pecas_cadastradas")
    .select("dados_brutos_json")
    .eq("id", pecaId)
    .single();
  if (ePeca) throw ePeca;

  const dadosAtuais = (peca?.dados_brutos_json ?? {}) as Record<string, unknown>;
  const contornoExt = contornoExternoDoModelo(modelo);
  const dadosNovos: Record<string, unknown> = {
    ...dadosAtuais,
    modelo_tecnico_json: modelo,
    geometria_complexa:
      modelo.geometria.tipo !== "retangular" || modelo.geometria.pendente,
    geometria_complexa_motivos: modelo.avisos,
  };
  if (contornoExt) dadosNovos.contorno_externo_json = contornoExt;

  // Atualiza peça
  const { error: eUp } = await db
    .from("pecas_cadastradas")
    .update({
      nome_peca: modelo.nome ?? null,
      largura_ref: modelo.medidas.largura,
      altura_ref: modelo.medidas.altura,
      espessura_ref: modelo.medidas.espessura,
      material_ref: modelo.material ?? null,
      fita_ref: modelo.fita ?? null,
      dados_brutos_json: dadosNovos,
    })
    .eq("id", pecaId);
  if (eUp) throw eUp;

  // Limpa operações e bordas existentes
  await db.from("peca_cadastrada_operacoes").delete().eq("peca_cadastrada_id", pecaId);
  await db.from("peca_cadastrada_bordas").delete().eq("peca_cadastrada_id", pecaId);

  // Insere operações
  if (modelo.operacoes.length > 0) {
    const rows = modelo.operacoes.map((o, idx) => ({
      user_id: userId,
      peca_cadastrada_id: pecaId,
      tipo: o.tipo,
      tipo_operacao: o.tipo,
      nome_operacao: o.nome ?? o.subtipo ?? null,
      face: Number(o.face) || 0,
      x: o.x ?? null,
      y: o.y ?? null,
      z: o.z ?? null,
      diametro: o.diametro ?? null,
      profundidade: o.profundidade ?? null,
      largura: o.largura ?? null,
      comprimento: o.comprimento ?? null,
      x1: o.x1 ?? null,
      x2: o.x2 ?? null,
      y1: o.y1 ?? null,
      y2: o.y2 ?? null,
      pontos_json: o.pontos ?? [],
      confianca_parser: o.confianca ?? "media",
      dados_brutos_json: {
        origem: "manual_import",
        subtipo: o.subtipo ?? null,
        importado_em: new Date().toISOString(),
      },
      ordem: o.ordem ?? idx + 1,
    }));
    const { error: eOps } = await db.from("peca_cadastrada_operacoes").insert(rows);
    if (eOps) throw eOps;
  }

  // Insere bordas
  if (modelo.bordas.length > 0) {
    const rows = modelo.bordas.map((b) => ({
      user_id: userId,
      peca_cadastrada_id: pecaId,
      lado: b.lado,
      codigo_borda: b.codigo_borda ?? null,
      descricao_borda: b.descricao_borda ?? null,
      espessura: b.espessura ?? null,
      largura: b.largura ?? null,
      cor: b.cor ?? null,
      indicador_desenho: b.indicador_desenho ?? null,
      confianca_parser: b.confianca ?? "media",
      tem_fita: true,
    }));
    const { error: eB } = await db.from("peca_cadastrada_bordas").insert(rows);
    if (eB) throw eB;
  }

  return {
    operacoes: modelo.operacoes.length,
    bordas: modelo.bordas.length,
    modelo,
  };
}

// ---------- Edição manual de cotas (MVP) ----------




export type FaceVisualInput = {
  face: string;
  tipo_vista?: string | null;
  largura_visual?: number | null;
  altura_visual?: number | null;
  geometria?: string | null;
};

export type EdicaoManualCotasInput = {
  medidas: { largura: number; altura: number; espessura: number };
  material?: string | null;
  fita?: string | null;
  face_principal?: string | null;
  face_alinhamento?: string | null;
  geometria: {
    tipo: GeometriaTipo;
    pontos_contorno: { x: number; y: number }[];
  };
  faces_visuais?: FaceVisualInput[];
};

export async function salvarEdicaoManualCotas(
  pecaId: string,
  input: EdicaoManualCotasInput,
): Promise<{
  modelo: ModeloTecnicoJson;
  validacao: ReturnType<typeof validarModeloTecnico>;
  contornoExterno: ReturnType<typeof contornoExternoDoModelo>;
}> {
  // Validação básica antes de tocar no banco
  if (input.geometria.pontos_contorno.length < 4) {
    throw new Error("O contorno precisa ter pelo menos 4 pontos.");
  }
  if (input.geometria.tipo === "L" && input.geometria.pontos_contorno.length < 6) {
    throw new Error("Geometria em L precisa ter pelo menos 6 pontos.");
  }
  if (!(input.medidas.largura > 0) || !(input.medidas.altura > 0)) {
    throw new Error("Largura e altura devem ser maiores que zero.");
  }

  const { data: peca, error } = await db
    .from("pecas_cadastradas")
    .select("dados_brutos_json, logs_parser, codigo_completo, codigo")
    .eq("id", pecaId)
    .single();
  if (error) throw error;

  const dados = (peca.dados_brutos_json ?? {}) as Record<string, unknown>;
  const modeloAnterior = (dados.modelo_tecnico_json ?? null) as ModeloTecnicoJson | null;

  const base: Partial<ModeloTecnicoJson> = modeloAnterior ?? {
    versao: 1,
    codigo: (peca.codigo_completo as string) ?? (peca.codigo as string) ?? "",
    medidas: { largura: null, altura: null, espessura: null },
    geometria: {
      tipo: "retangular",
      origem: "manual",
      largura: null,
      altura: null,
      pontos_contorno: [],
      confianca: "media",
      pendente: false,
    },
    faces: [],
    faces_operacionais: [],
    faces_visuais: [],
    operacoes: [],
    bordas: [],
    avisos: [],
    erros: [],
    metadados: {},
  };

  const origemAnterior = modeloAnterior?.geometria?.origem;
  const novaOrigem: GeometriaOrigem =
    origemAnterior === "contorno_tecnico_pdf" ? "contorno_tecnico_pdf" : "manual";

  const novoModeloRaw: unknown = {
    ...base,
    codigo: base.codigo ?? (peca.codigo_completo as string) ?? "",
    medidas: {
      largura: input.medidas.largura,
      altura: input.medidas.altura,
      espessura: input.medidas.espessura,
    },
    material: input.material ?? base.material ?? null,
    fita: input.fita ?? base.fita ?? null,
    face_alinhamento: input.face_alinhamento ?? base.face_alinhamento ?? null,
    geometria: {
      tipo: input.geometria.tipo,
      origem: novaOrigem,
      largura: input.medidas.largura,
      altura: input.medidas.altura,
      pontos_contorno: input.geometria.pontos_contorno,
      face_principal:
        input.face_principal ?? base.geometria?.face_principal ?? null,
      confianca: "alta" as const,
      pendente: false,
    },
    faces_visuais:
      input.faces_visuais && input.faces_visuais.length > 0
        ? input.faces_visuais.map((f) => ({
            face: String(f.face),
            tipo_vista: f.tipo_vista ?? undefined,
            largura_visual: f.largura_visual ?? null,
            altura_visual: f.altura_visual ?? null,
            geometria: f.geometria ?? null,
          }))
        : base.faces_visuais ?? [],
    metadados: {
      ...((base.metadados as Record<string, unknown> | undefined) ?? {}),
      editado_manualmente: true,
      ultima_edicao_manual_em: new Date().toISOString(),
    },
    avisos: base.avisos ?? [],
    erros: [],
  };

  let modelo = ModeloTecnicoSchema.parse(novoModeloRaw);

  // Regenera parametrização com as novas medidas-base. Operações marcadas
  // como `editado_manualmente=true` mantêm sua âncora original.
  modelo = gerarParametrizacaoModelo(modelo);

  // Validação determinística (avisos/erros) sobre o modelo recém-editado
  const validacao = validarModeloTecnico(modelo as unknown as ModeloTecnicoLite);
  modelo.erros = validacao.erros;
  modelo.avisos = Array.from(new Set([...(modelo.avisos ?? []), ...validacao.avisos]));


  const contornoExt = contornoExternoDoModelo(modelo);
  const diagnostico = {
    origem: novaOrigem === "contorno_tecnico_pdf" ? "contorno_tecnico_pdf_editado" : "manual_usuario",
    editado_em: new Date().toISOString(),
    pontos: modelo.geometria.pontos_contorno.length,
    tipo: modelo.geometria.tipo,
    editado_manualmente: true,
  };

  const novosDados: Record<string, unknown> = {
    ...dados,
    modelo_tecnico_json: modelo,
    diagnostico_geometria: diagnostico,
  };
  if (contornoExt) novosDados.contorno_externo_json = contornoExt;

  const logsAtuais = Array.isArray(peca.logs_parser) ? (peca.logs_parser as unknown[]) : [];
  const antes = modeloAnterior
    ? {
        medidas: modeloAnterior.medidas,
        geometria: {
          tipo: modeloAnterior.geometria?.tipo,
          pontos: modeloAnterior.geometria?.pontos_contorno?.length ?? 0,
        },
      }
    : null;
  const depois = {
    medidas: modelo.medidas,
    geometria: {
      tipo: modelo.geometria.tipo,
      pontos: modelo.geometria.pontos_contorno.length,
    },
  };
  const log = `[manual] Cotas editadas pelo usuário em ${new Date().toISOString()} — antes: ${JSON.stringify(antes)} depois: ${JSON.stringify(depois)}`;

  const { error: eUp } = await db
    .from("pecas_cadastradas")
    .update({
      dados_brutos_json: novosDados,
      largura_ref: input.medidas.largura,
      altura_ref: input.medidas.altura,
      espessura_ref: input.medidas.espessura,
      material_ref: input.material ?? null,
      fita_ref: input.fita ?? null,
      logs_parser: [...logsAtuais, log],
    })
    .eq("id", pecaId);
  if (eUp) throw eUp;

  return { modelo, validacao, contornoExterno: contornoExt };
}
