// Núcleo paramétrico da biblioteca técnica de peças.
//
// Cada operação (furo, rasgo, usinagem) deixa de ser apenas coordenada
// absoluta X/Y e passa a guardar a sua âncora em relação a um topo da peça
// (esquerda/direita para X, inferior/superior para Y). Quando a peça for
// usada num projeto com outras medidas, recalculamos X/Y mantendo essa
// distância ao topo de referência.
//
// Não tem IO — tudo é pura função para facilitar testes e reaproveitamento
// no visualizador (modo "Simular nova medida").

import type { ModeloTecnicoJson, OperacaoModelo } from "@/lib/peca-modelo-tecnico";

export type AncoraX = "esquerda" | "direita" | "centro" | "percentual" | "absoluto";
export type AncoraY = "inferior" | "superior" | "centro" | "percentual" | "absoluto";
export type Regra = "ancora" | "absoluto";

export type Parametrico = {
  ancora_x: AncoraX;
  distancia_x: number;
  ancora_y: AncoraY;
  distancia_y: number;
  regra_x: Regra;
  regra_y: Regra;
  largura_base: number;
  altura_base: number;
  ancora_x2?: AncoraX;
  distancia_x2?: number;
  ancora_y2?: AncoraY;
  distancia_y2?: number;
  editado_manualmente?: boolean;
};

export type ParametrizacaoModelo = {
  largura_base: number;
  altura_base: number;
  espessura_base: number;
  regra: "ancoras_topos";
};

// ---------- Inferência ----------

function inferirX(x: number, largura: number): { ancora_x: AncoraX; distancia_x: number } {
  const dE = x;
  const dD = largura - x;
  if (dE <= dD) return { ancora_x: "esquerda", distancia_x: round(dE) };
  return { ancora_x: "direita", distancia_x: round(dD) };
}

function inferirY(y: number, altura: number): { ancora_y: AncoraY; distancia_y: number } {
  const dI = y;
  const dS = altura - y;
  if (dI <= dS) return { ancora_y: "inferior", distancia_y: round(dI) };
  return { ancora_y: "superior", distancia_y: round(dS) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Infere âncoras X/Y da operação a partir das medidas-base da peça.
 * Para rasgos com X1/X2 ou Y1/Y2, infere também a segunda âncora.
 */
export function inferirAncoraOperacao(
  op: OperacaoModelo,
  largura_base: number,
  altura_base: number,
): Parametrico | null {
  if (!(largura_base > 0) || !(altura_base > 0)) return null;

  // Operação rasgo com par de extremidades
  if (op.x1 != null && op.x2 != null) {
    const a1 = inferirX(op.x1, largura_base);
    const a2 = inferirX(op.x2, largura_base);
    const yRef = op.y ?? (op.y1 != null && op.y2 != null ? (op.y1 + op.y2) / 2 : op.y1 ?? op.y2 ?? 0);
    const ay = inferirY(yRef, altura_base);
    return {
      ancora_x: a1.ancora_x,
      distancia_x: a1.distancia_x,
      ancora_x2: a2.ancora_x,
      distancia_x2: a2.distancia_x,
      ancora_y: ay.ancora_y,
      distancia_y: ay.distancia_y,
      regra_x: "ancora",
      regra_y: "ancora",
      largura_base,
      altura_base,
    };
  }
  if (op.y1 != null && op.y2 != null) {
    const a1 = inferirY(op.y1, altura_base);
    const a2 = inferirY(op.y2, altura_base);
    const xRef = op.x ?? 0;
    const ax = inferirX(xRef, largura_base);
    return {
      ancora_x: ax.ancora_x,
      distancia_x: ax.distancia_x,
      ancora_y: a1.ancora_y,
      distancia_y: a1.distancia_y,
      ancora_y2: a2.ancora_y,
      distancia_y2: a2.distancia_y,
      regra_x: "ancora",
      regra_y: "ancora",
      largura_base,
      altura_base,
    };
  }

  if (op.x == null || op.y == null) return null;
  const ax = inferirX(op.x, largura_base);
  const ay = inferirY(op.y, altura_base);
  return {
    ...ax,
    ...ay,
    regra_x: "ancora",
    regra_y: "ancora",
    largura_base,
    altura_base,
  };
}

// ---------- Aplicação ----------

function calcX(ancora: AncoraX, distancia: number, largura_atual: number, fallback: number): number {
  switch (ancora) {
    case "esquerda":
      return distancia;
    case "direita":
      return largura_atual - distancia;
    case "centro":
      return largura_atual / 2 + distancia;
    case "percentual":
      return (largura_atual * distancia) / 100;
    case "absoluto":
    default:
      return fallback;
  }
}

function calcY(ancora: AncoraY, distancia: number, altura_atual: number, fallback: number): number {
  switch (ancora) {
    case "inferior":
      return distancia;
    case "superior":
      return altura_atual - distancia;
    case "centro":
      return altura_atual / 2 + distancia;
    case "percentual":
      return (altura_atual * distancia) / 100;
    case "absoluto":
    default:
      return fallback;
  }
}

export type CoordenadasCalculadas = {
  x: number | null;
  y: number | null;
  x1?: number | null;
  x2?: number | null;
  y1?: number | null;
  y2?: number | null;
};

/**
 * Aplica a parametrização para uma medida nova da peça. Se a operação não
 * tiver `parametrico`, retorna as coordenadas absolutas inalteradas.
 */
export function aplicarParametrizacao(
  op: OperacaoModelo,
  largura_atual: number,
  altura_atual: number,
): CoordenadasCalculadas {
  const p = op.parametrico as Parametrico | undefined;
  if (!p) {
    return { x: op.x ?? null, y: op.y ?? null, x1: op.x1, x2: op.x2, y1: op.y1, y2: op.y2 };
  }

  const out: CoordenadasCalculadas = { x: null, y: null };

  // Caso rasgo X1/X2
  if (p.ancora_x2 != null && p.distancia_x2 != null) {
    out.x1 = calcX(p.ancora_x, p.distancia_x, largura_atual, op.x1 ?? 0);
    out.x2 = calcX(p.ancora_x2, p.distancia_x2, largura_atual, op.x2 ?? 0);
    out.y = calcY(p.ancora_y, p.distancia_y, altura_atual, op.y ?? 0);
    return out;
  }
  // Caso rasgo Y1/Y2
  if (p.ancora_y2 != null && p.distancia_y2 != null) {
    out.y1 = calcY(p.ancora_y, p.distancia_y, altura_atual, op.y1 ?? 0);
    out.y2 = calcY(p.ancora_y2, p.distancia_y2, altura_atual, op.y2 ?? 0);
    out.x = calcX(p.ancora_x, p.distancia_x, largura_atual, op.x ?? 0);
    return out;
  }

  out.x = calcX(p.ancora_x, p.distancia_x, largura_atual, op.x ?? 0);
  out.y = calcY(p.ancora_y, p.distancia_y, altura_atual, op.y ?? 0);
  return out;
}

// ---------- Geração no modelo ----------

/**
 * Popula `modelo.parametrizacao` e `op.parametrico` em todas as operações
 * que ainda não foram editadas manualmente. Devolve um novo modelo, sem
 * mutar o original.
 */
export function gerarParametrizacaoModelo(modelo: ModeloTecnicoJson): ModeloTecnicoJson {
  const largura = modelo.medidas?.largura ?? modelo.geometria?.largura ?? 0;
  const altura = modelo.medidas?.altura ?? modelo.geometria?.altura ?? 0;
  const espessura = modelo.medidas?.espessura ?? 0;
  if (!(largura > 0) || !(altura > 0)) return modelo;

  const operacoes = (modelo.operacoes ?? []).map((op) => {
    const existente = op.parametrico as Parametrico | undefined;
    if (existente?.editado_manualmente) return op;
    const novo = inferirAncoraOperacao(op, largura, altura);
    if (!novo) return op;
    return { ...op, parametrico: novo };
  });

  return {
    ...modelo,
    parametrizacao: {
      largura_base: largura,
      altura_base: altura,
      espessura_base: espessura,
      regra: "ancoras_topos",
    },
    operacoes,
  } as ModeloTecnicoJson;
}

// ---------- Recalcular para novas medidas ----------

export type AlertaRecalculo = {
  ordem: number;
  face: string;
  tipo: string;
  motivo: string;
};

export type ResultadoRecalculo = {
  modelo: ModeloTecnicoJson;
  alertas: AlertaRecalculo[];
};

/**
 * Devolve uma cópia do modelo com operações recalculadas para a medida
 * informada. Não persiste nada. Operações sem parametrização ficam com as
 * coordenadas originais e geram um alerta.
 */
export function recalcularModeloParaMedidas(
  modelo: ModeloTecnicoJson,
  medidas: { largura: number; altura: number; espessura?: number | null },
): ResultadoRecalculo {
  const L = medidas.largura;
  const H = medidas.altura;
  const alertas: AlertaRecalculo[] = [];

  const operacoes = (modelo.operacoes ?? []).map((op) => {
    if (!op.parametrico) {
      alertas.push({
        ordem: op.ordem ?? 0,
        face: String(op.face),
        tipo: op.tipo,
        motivo: "Operação sem parametrização — mantida em coordenada absoluta.",
      });
      return op;
    }
    const c = aplicarParametrizacao(op, L, H);
    return {
      ...op,
      x: c.x ?? op.x,
      y: c.y ?? op.y,
      x1: c.x1 ?? op.x1,
      x2: c.x2 ?? op.x2,
      y1: c.y1 ?? op.y1,
      y2: c.y2 ?? op.y2,
    };
  });

  // Recalcula contorno em L mantendo posição relativa do recorte
  let pontos_contorno = modelo.geometria?.pontos_contorno ?? [];
  if (
    pontos_contorno.length === 6 &&
    modelo.geometria?.tipo === "L" &&
    modelo.parametrizacao
  ) {
    const Lb = modelo.parametrizacao.largura_base;
    const Hb = modelo.parametrizacao.altura_base;
    pontos_contorno = pontos_contorno.map((p) => ({
      x: Math.abs(p.x) < 0.01 ? 0 : Math.abs(p.x - Lb) < 0.01 ? L : (p.x / Lb) * L,
      y: Math.abs(p.y) < 0.01 ? 0 : Math.abs(p.y - Hb) < 0.01 ? H : (p.y / Hb) * H,
    }));
  } else if (pontos_contorno.length === 4 && modelo.geometria?.tipo === "retangular") {
    pontos_contorno = [
      { x: 0, y: 0 },
      { x: L, y: 0 },
      { x: L, y: H },
      { x: 0, y: H },
    ];
  }

  const modeloRec: ModeloTecnicoJson = {
    ...modelo,
    medidas: {
      largura: L,
      altura: H,
      espessura: medidas.espessura ?? modelo.medidas?.espessura ?? null,
    },
    geometria: {
      ...modelo.geometria,
      largura: L,
      altura: H,
      pontos_contorno,
    },
    operacoes,
  };

  return { modelo: modeloRec, alertas };
}

/** Conta quantas operações no modelo NÃO têm `parametrico`. */
export function contarOperacoesSemParametrizacao(modelo: ModeloTecnicoJson): number {
  return (modelo.operacoes ?? []).filter((o) => !o.parametrico).length;
}
