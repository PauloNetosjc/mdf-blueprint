// Modelo técnico canônico interno da peça cadastrada.
//
// A verdade operacional do sistema é este objeto, gravado em
// `pecas_cadastradas.dados_brutos_json.modelo_tecnico_json`.
//
// O PDF original é apenas fonte de leitura/conferência. Visualizador interno e
// (futura) geração de G-code devem ler deste modelo, NÃO do PDF.

import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
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
  "pdf_vetor",
  "pdf_visual",
  "regra_parametrica",
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
});
export type OperacaoModelo = z.infer<typeof OperacaoModeloSchema>;

export const BordaModeloSchema = z.object({
  lado: z.string(),
  codigo_borda: z.string().nullable().optional(),
  descricao_borda: z.string().nullable().optional(),
  espessura: z.number().nullable().optional(),
  largura: z.number().nullable().optional(),
  cor: z.string().nullable().optional(),
  indicador_desenho: z.string().nullable().optional(),
  confianca: z.enum(["alta", "media", "baixa"]).optional().default("media"),
});
export type BordaModelo = z.infer<typeof BordaModeloSchema>;

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
  operacoes: z.array(OperacaoModeloSchema).default([]),
  bordas: z.array(BordaModeloSchema).default([]),
  avisos: z.array(z.string()).default([]),
  erros: z.array(z.string()).default([]),
  metadados: z.record(z.unknown()).optional().default({}),
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
} {
  const { largura, altura, nome, prefixo, facesAcimaDe5, temRasgoLinha } = args;
  const baseL = ehBaseL(nome, prefixo);

  if (baseL && largura && altura) {
    return {
      tipo: "L",
      origem: "regra_parametrica",
      pontos_contorno: gerarContornoL(largura, altura),
      confianca: "media",
      pendente: false,
    };
  }

  const complexa = facesAcimaDe5.length > 0 || temRasgoLinha || baseL;
  if (complexa) {
    return {
      tipo: "poligono_complexo",
      origem: "pdf_visual",
      pontos_contorno: [],
      confianca: "baixa",
      pendente: true,
    };
  }

  // Padrão seguro: retangular (contorno gerado pelo próprio largura×altura).
  return {
    tipo: "retangular",
    origem: "pdf_texto",
    pontos_contorno:
      largura && altura
        ? [
            { x: 0, y: 0 },
            { x: largura, y: 0 },
            { x: largura, y: altura },
            { x: 0, y: altura },
          ]
        : [],
    confianca: "alta",
    pendente: false,
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

  const avisos: string[] = [];
  if (geometria.pendente) {
    avisos.push(
      "Contorno visual complexo não convertido para geometria interna. Importe um modelo técnico JSON para calibrar.",
    );
  }
  if (facesAcimaDe5.length > 0) {
    avisos.push(`Faces acima de F5 detectadas: ${facesAcimaDe5.join(", ")}`);
  }

  return ModeloTecnicoSchema.parse({
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
    faces: facesPresentes.map((f) => ({ face: f })),
    operacoes: result.operacoes.map(mapOperacao),
    bordas: result.bordas.map(mapBorda),
    avisos,
    erros: result.erros,
    metadados: {
      classificacao_pdf: result.classificacao.classificacao,
      gerado_em: new Date().toISOString(),
    },
  });
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

// ---------- Bloqueio de geração de G-code ----------

export function podeGerarGcode(modelo: ModeloTecnicoJson | null | undefined): {
  permitido: boolean;
  motivo: string;
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
  return { permitido: true, motivo: "Modelo técnico completo." };
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
