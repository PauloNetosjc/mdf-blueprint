// Fase 3A — Aplicação paramétrica de um modelo técnico da biblioteca
// (`pecas_cadastradas.dados_brutos_json.modelo_tecnico_json`) nas medidas
// reais da peça de um projeto.
//
// A biblioteca original NÃO é alterada. Geramos uma cópia recalculada com:
//   - operacoes_recalculadas
//   - alertas    (sem parametrização, geometria manual etc.)
//   - erros      (operação caiu fora do contorno)
//   - status_tecnico  ("aplicado_ok" | "aplicado_com_alerta" | "aplicado_com_erro")
//
// Reutiliza `recalcularModeloParaMedidas` (parametrização por âncoras) e
// valida os pontos resultantes contra o contorno técnico via
// `pontoDentroOuNaBordaDoPoligono`.

import { recalcularModeloParaMedidas } from "@/lib/parametrizacao-pecas";
import { pontoDentroOuNaBordaDoPoligono } from "@/lib/geometria-poligono";
import type { ModeloTecnicoJson, OperacaoModelo } from "@/lib/peca-modelo-tecnico";

export type StatusTecnico =
  | "nao_aplicado"
  | "aplicado_ok"
  | "aplicado_com_alerta"
  | "aplicado_com_erro";

export type AlertaAplicacao = {
  ordem: number;
  face: string;
  tipo: string;
  motivo: string;
};

export type ErroAplicacao = {
  ordem: number;
  face: string;
  tipo: string;
  motivo: string;
  ponto?: { x: number; y: number };
};

export type MedidasProjeto = {
  largura: number;
  altura: number;
  espessura?: number | null;
};

export type ResultadoAplicacao = {
  operacoes_recalculadas: OperacaoModelo[];
  alertas: AlertaAplicacao[];
  erros: ErroAplicacao[];
  modelo_aplicado: ModeloTecnicoJson;
  status_tecnico: StatusTecnico;
};

function contornoRetangular(largura: number, altura: number): Array<{ x: number; y: number }> {
  return [
    { x: 0, y: 0 },
    { x: largura, y: 0 },
    { x: largura, y: altura },
    { x: 0, y: altura },
  ];
}

function pontosContornoRecalculados(
  modelo: ModeloTecnicoJson,
  medidas: MedidasProjeto,
): Array<{ x: number; y: number }> {
  const pontos = modelo.geometria?.pontos_contorno;
  if (Array.isArray(pontos) && pontos.length >= 3) {
    return pontos.map((p) => ({ x: p.x, y: p.y }));
  }
  return contornoRetangular(medidas.largura, medidas.altura);
}

function pontosOperacao(op: OperacaoModelo): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  if (op.x1 != null && op.x2 != null) {
    const y = op.y ?? 0;
    out.push({ x: op.x1, y });
    out.push({ x: op.x2, y });
    out.push({ x: (op.x1 + op.x2) / 2, y });
    return out;
  }
  if (op.y1 != null && op.y2 != null) {
    const x = op.x ?? 0;
    out.push({ x, y: op.y1 });
    out.push({ x, y: op.y2 });
    out.push({ x, y: (op.y1 + op.y2) / 2 });
    return out;
  }
  if (op.x != null && op.y != null) {
    out.push({ x: op.x, y: op.y });
  }
  return out;
}

/**
 * Aplica o modelo técnico paramétrico nas medidas reais da peça do projeto.
 * Devolve uma cópia recalculada — NÃO altera o modelo original.
 */
export function aplicarModeloTecnicoNaPecaProjeto(
  modelo: ModeloTecnicoJson,
  medidasProjeto: MedidasProjeto,
): ResultadoAplicacao {
  // 1) Recalcula via âncoras
  const { modelo: modeloRec, alertas: alertasRec } = recalcularModeloParaMedidas(modelo, {
    largura: medidasProjeto.largura,
    altura: medidasProjeto.altura,
    espessura: medidasProjeto.espessura ?? null,
  });

  // 2) Aplica novas medidas no header do modelo
  const modeloAplicado: ModeloTecnicoJson = {
    ...modeloRec,
    medidas: {
      ...(modeloRec.medidas ?? {}),
      largura: medidasProjeto.largura,
      altura: medidasProjeto.altura,
      espessura: medidasProjeto.espessura ?? modeloRec.medidas?.espessura ?? 0,
    } as ModeloTecnicoJson["medidas"],
  } as ModeloTecnicoJson;

  // 3) Alerta de geometria manual (não bloqueia)
  const alertas: AlertaAplicacao[] = alertasRec.map((a) => ({
    ordem: a.ordem,
    face: a.face,
    tipo: a.tipo,
    motivo: a.motivo,
  }));
  const requerManual = (modelo.geometria as any)?.requer_cadastro_manual === true;
  if (requerManual) {
    alertas.push({
      ordem: 0,
      face: "—",
      tipo: "geometria",
      motivo: "Peça de geometria complexa/manual. Conferir antes de produção.",
    });
  }

  // 4) Validação geométrica das operações recalculadas
  const contorno = pontosContornoRecalculados(modeloAplicado, medidasProjeto);
  const erros: ErroAplicacao[] = [];

  for (const op of modeloAplicado.operacoes ?? []) {
    const pts = pontosOperacao(op);
    if (!pts.length) continue;
    for (const p of pts) {
      const dentro = pontoDentroOuNaBordaDoPoligono(p, contorno);
      if (!dentro) {
        erros.push({
          ordem: op.ordem ?? 0,
          face: String(op.face),
          tipo: op.tipo,
          motivo: "Operação fora do contorno após recalcular.",
          ponto: { x: round(p.x), y: round(p.y) },
        });
        break;
      }
    }
  }

  const status_tecnico: StatusTecnico =
    erros.length > 0
      ? "aplicado_com_erro"
      : alertas.length > 0
      ? "aplicado_com_alerta"
      : "aplicado_ok";

  return {
    operacoes_recalculadas: (modeloAplicado.operacoes ?? []) as OperacaoModelo[],
    alertas,
    erros,
    modelo_aplicado: modeloAplicado,
    status_tecnico,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------- Tabela de diagnóstico (para a UI) ----------

export type LinhaDiagnostico = {
  ordem: number;
  face: string;
  tipo: string;
  x_base: number | null;
  y_base: number | null;
  ancora_x: string;
  dist_x: number;
  x_aplicado: number | null;
  ancora_y: string;
  dist_y: number;
  y_aplicado: number | null;
  status: "ok" | "alerta" | "erro";
  detalhe?: string;
};

export function montarDiagnostico(
  modeloBase: ModeloTecnicoJson,
  resultado: ResultadoAplicacao,
): LinhaDiagnostico[] {
  const opsBase = modeloBase.operacoes ?? [];
  const opsRec = resultado.operacoes_recalculadas ?? [];
  const errosPorOrdem = new Map<number, ErroAplicacao>();
  for (const e of resultado.erros) errosPorOrdem.set(e.ordem, e);
  const alertasPorOrdem = new Map<number, AlertaAplicacao>();
  for (const a of resultado.alertas) if (a.ordem > 0) alertasPorOrdem.set(a.ordem, a);

  return opsBase.map((opB, i) => {
    const opR = opsRec[i] ?? opB;
    const p = (opB.parametrico ?? null) as any;
    const erro = errosPorOrdem.get(opB.ordem ?? 0);
    const al = alertasPorOrdem.get(opB.ordem ?? 0);
    const status: LinhaDiagnostico["status"] = erro ? "erro" : al ? "alerta" : "ok";
    return {
      ordem: opB.ordem ?? i + 1,
      face: String(opB.face),
      tipo: opB.tipo,
      x_base: opB.x ?? opB.x1 ?? null,
      y_base: opB.y ?? opB.y1 ?? null,
      ancora_x: p?.ancora_x ?? "—",
      dist_x: p?.distancia_x ?? 0,
      x_aplicado: opR.x ?? opR.x1 ?? null,
      ancora_y: p?.ancora_y ?? "—",
      dist_y: p?.distancia_y ?? 0,
      y_aplicado: opR.y ?? opR.y1 ?? null,
      status,
      detalhe: erro?.motivo ?? al?.motivo,
    };
  });
}
