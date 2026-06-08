// Fase 3C — Geração de modelo técnico básico para peça MANUAL do projeto.
//
// Toda peça do projeto deve ter `dados_tecnicos_aplicados_json`. Quando a peça
// foi criada manualmente (sem PDF / sem biblioteca), gera-se aqui um modelo
// técnico mínimo, retangular, a partir das medidas reais.
//
// NUNCA cria registro em `pecas_cadastradas`. A peça manual pertence apenas
// ao projeto.

import { pontoDentroOuNaBordaDoPoligono } from "@/lib/geometria-poligono";
import type { OperacaoModelo } from "@/lib/peca-modelo-tecnico";
import type { StatusTecnico } from "@/lib/aplicar-modelo-projeto";

export type DadosPecaManualInput = {
  largura: number;
  altura: number;
  espessura: number;
  codigo?: string | null;
  descricao?: string | null;
  material_chapa?: string | null;
  fita_codigo?: string | null;
  modulo?: string | null;
  quantidade?: number | null;
  veio?: boolean | null;
  /** Operações já existentes (mantidas e revalidadas no novo contorno). */
  operacoesExistentes?: OperacaoModelo[];
};

export type DadosTecnicosManualJson = {
  origem: "peca_manual";
  codigo: string | null;
  descricao: string | null;
  medidas_projeto: { largura: number; altura: number; espessura: number };
  material_chapa: string | null;
  fita_codigo: string | null;
  modulo: string | null;
  quantidade: number | null;
  veio: boolean | null;
  geometria: {
    tipo: "retangular";
    origem: "manual";
    largura: number;
    altura: number;
    espessura: number;
    pontos_contorno: { x: number; y: number }[];
    pendente: boolean;
    confianca: "manual";
  };
  faces: { face: string; tipo: string; largura_visual: number; altura_visual: number }[];
  operacoes_recalculadas: OperacaoModelo[];
  bordas: unknown[];
  alertas: { ordem: number; face: string; tipo: string; motivo: string }[];
  erros: { ordem: number; face: string; tipo: string; motivo: string; ponto?: { x: number; y: number } }[];
  criado_em: string;
};

export type ResultadoManual = {
  json: DadosTecnicosManualJson;
  status_tecnico: StatusTecnico;
};

function contornoRetangular(largura: number, altura: number) {
  return [
    { x: 0, y: 0 },
    { x: largura, y: 0 },
    { x: largura, y: altura },
    { x: 0, y: altura },
  ];
}

function pontosOperacao(op: OperacaoModelo): { x: number; y: number }[] {
  if (op.x1 != null && op.x2 != null) {
    const y = op.y ?? 0;
    return [
      { x: op.x1, y },
      { x: op.x2, y },
    ];
  }
  if (op.y1 != null && op.y2 != null) {
    const x = op.x ?? 0;
    return [
      { x, y: op.y1 },
      { x, y: op.y2 },
    ];
  }
  if (op.x != null && op.y != null) return [{ x: op.x, y: op.y }];
  return [];
}

export function gerarDadosTecnicosManuais(input: DadosPecaManualInput): ResultadoManual {
  const { largura, altura, espessura } = input;
  const contorno = contornoRetangular(largura, altura);

  const ops = input.operacoesExistentes ?? [];
  const erros: DadosTecnicosManualJson["erros"] = [];

  for (const op of ops) {
    const pts = pontosOperacao(op);
    for (const p of pts) {
      if (!pontoDentroOuNaBordaDoPoligono(p, contorno)) {
        erros.push({
          ordem: op.ordem ?? 0,
          face: String(op.face),
          tipo: op.tipo,
          motivo: "Operação fora do contorno após edição de medidas.",
          ponto: { x: round(p.x), y: round(p.y) },
        });
        break;
      }
    }
  }

  const status: StatusTecnico = erros.length > 0 ? "aplicado_com_erro" : "aplicado_ok";

  const json: DadosTecnicosManualJson = {
    origem: "peca_manual",
    codigo: input.codigo ?? null,
    descricao: input.descricao ?? null,
    medidas_projeto: { largura, altura, espessura },
    material_chapa: input.material_chapa ?? null,
    fita_codigo: input.fita_codigo ?? null,
    modulo: input.modulo ?? null,
    quantidade: input.quantidade ?? null,
    veio: input.veio ?? null,
    geometria: {
      tipo: "retangular",
      origem: "manual",
      largura,
      altura,
      espessura,
      pontos_contorno: contorno,
      pendente: false,
      confianca: "manual",
    },
    faces: [
      { face: "0", tipo: "principal", largura_visual: largura, altura_visual: altura },
    ],
    operacoes_recalculadas: ops,
    bordas: [],
    alertas: [],
    erros,
    criado_em: new Date().toISOString(),
  };

  return { json, status_tecnico: status };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
