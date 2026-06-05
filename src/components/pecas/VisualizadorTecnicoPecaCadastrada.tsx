import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Copy, Pencil, Plus, Trash2 } from "lucide-react";

const FACES_PADRAO = ["0", "1", "2", "3", "4", "5"];

export type NovaOperacaoPayload = {
  face: string;
  tipo_operacao: string;
  nome_operacao?: string | null;
  x: number | null;
  y: number | null;
  diametro: number | null;
  profundidade: number | null;
  x1: number | null;
  x2: number | null;
  largura: number | null;
  comprimento: number | null;
  pontos_json?: Array<{ x: number | null; y: number | null; profundidade: number | null; tipo?: string | null }> | null;
  observacao?: string | null;
};

export type EditarOperacaoPayload = NovaOperacaoPayload & { id: string };

export type VisualizadorOperacao = {
  id: string;
  tipo_operacao: string;
  nome_operacao?: string | null;
  face: string | number | null;
  x: number | null;
  y: number | null;
  diametro: number | null;
  profundidade: number | null;
  largura: number | null;
  comprimento: number | null;
  x1: number | null;
  x2: number | null;
  y1: number | null;
  y2: number | null;
  ancora_x: string | null;
  ancora_y: string | null;
  offset_x: number | null;
  offset_y: number | null;
  pontos_json: Array<{ x: number | null; y: number | null; profundidade: number | null; tipo?: string | null }> | null;
  confianca_parser: string;
  ordem: number;
  dados_brutos_json?: Record<string, unknown> | null;
};

export type VisualizadorBorda = {
  id: string;
  lado: string;
  codigo_borda: string | null;
  descricao_borda: string | null;
  espessura: number | null;
  largura: number | null;
  cor: string | null;
};

export type ContornoOrigem = "parser_pdf" | "manual" | "fallback" | "misto";
export type PosicaoRecuo =
  | "superior"
  | "superior_direito"
  | "superior_esquerdo"
  | "inferior"
  | "direita"
  | "esquerda";

export type ContornoRecuo = {
  id?: string;
  posicao: PosicaoRecuo;
  largura: number;
  profundidade: number;
  origem: ContornoOrigem;
  preset?: string;
  x_inicio?: number;
  x_fim?: number;
  y_inicio?: number;
  y_fim?: number;
};

export type ContornoExterno = {
  origem: ContornoOrigem;
  largura: number;
  altura: number;
  pontos: Pt[];
  recuos?: ContornoRecuo[];
  presets_aplicados?: string[];
  observacao?: string;
};

type Props = {
  codigo: string;
  nome?: string | null;
  tipo?: string | null;
  largura: number | null;
  altura: number | null;
  espessura: number | null;
  operacoes: VisualizadorOperacao[];
  bordas: VisualizadorBorda[];
  faceAlinhamento?: string | null;
  indicadoresBorda?: string[];
  facesDetectadas?: string[];
  contornoExterno?: ContornoExterno | null;
  onAddOperacao?: (payload: NovaOperacaoPayload) => void | Promise<void>;
  onEditOperacao?: (payload: EditarOperacaoPayload) => void | Promise<void>;
  onDeleteOperacao?: (id: string) => void | Promise<void>;
  onSaveContorno?: (contorno: ContornoExterno) => void | Promise<void>;
};

const TIPO_USINAGEM = ["usinagem_parametrica", "contorno", "usinagem", "recorte", "rebaixo", "cava"];

function ehUsinagem(t: string) {
  return TIPO_USINAGEM.includes(t);
}

type Pt = { x: number; y: number };

const EDGE_EPS = 0.5;

function edgeOf(p: Pt, W: number, H: number): "bottom" | "right" | "top" | "left" | null {
  if (Math.abs(p.y) < EDGE_EPS) return "bottom";
  if (Math.abs(p.x - W) < EDGE_EPS) return "right";
  if (Math.abs(p.y - H) < EDGE_EPS) return "top";
  if (Math.abs(p.x) < EDGE_EPS) return "left";
  return null;
}

function pontosValidosDaOp(op: VisualizadorOperacao): Pt[] {
  return (op.pontos_json ?? [])
    .filter((p): p is { x: number; y: number; profundidade: number | null; tipo?: string | null } =>
      p.x != null && p.y != null,
    )
    .map((p) => ({ x: p.x, y: p.y }));
}

function ehTipoOuNomeDeContorno(op: VisualizadorOperacao): boolean {
  const nome = (op.nome_operacao ?? "").toLowerCase();
  return op.tipo_operacao === "contorno" || op.tipo_operacao === "usinagem_parametrica" || nome.includes("contorno");
}

function ehContornoExterno(op: VisualizadorOperacao, W: number, H: number): boolean {
  if (!ehTipoOuNomeDeContorno(op)) return false;
  const nome = (op.nome_operacao ?? "").toLowerCase();
  const pts = pontosValidosDaOp(op);
  if (pts.length < 2) return op.tipo_operacao === "contorno" || nome.includes("contorno");
  return pts.some((p) => edgeOf(p, W, H) !== null) || nome.includes("contorno");
}

function samePoint(a: Pt | undefined, b: Pt) {
  return !!a && Math.abs(a.x - b.x) < EDGE_EPS && Math.abs(a.y - b.y) < EDGE_EPS;
}

function pushPt(out: Pt[], p: Pt) {
  if (!samePoint(out[out.length - 1], p)) out.push({ x: p.x, y: p.y });
}

function touchesSameEdge(raw: Pt[], W: number, H: number) {
  const first = raw[0];
  const last = raw[raw.length - 1];
  if (!first || !last) return null;
  const edge = edgeOf(first, W, H);
  if (!edge || edgeOf(last, W, H) !== edge) return null;
  const hasInwardPoint = raw.some((p) => {
    if (edge === "top") return p.y < H - EDGE_EPS;
    if (edge === "bottom") return p.y > EDGE_EPS;
    if (edge === "left") return p.x > EDGE_EPS;
    return p.x < W - EDGE_EPS;
  });
  return hasInwardPoint ? edge : null;
}

/** Largura/profundidade padrão de um recuo visual sem cota explícita (mm). */
const RECUO_PADRAO = { largura: 65, profundidade: 40 } as const;

export type RecuoInfo = {
  opId: string;
  lado: "top" | "bottom" | "left" | "right";
  origem: "pdf" | "padrao_65x40";
  largura: number;
  profundidade: number;
  ini: number;
  fim: number;
};

function ladoInferidoPorPontos(pts: Pt[], W: number, H: number): "top" | "bottom" | "left" | "right" {
  if (pts.length === 0) return "top";
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const distTop = Math.abs(H - cy);
  const distBot = Math.abs(cy);
  const distLeft = Math.abs(cx);
  const distRight = Math.abs(W - cx);
  const m = Math.min(distTop, distBot, distLeft, distRight);
  if (m === distTop) return "top";
  if (m === distBot) return "bottom";
  if (m === distLeft) return "left";
  return "right";
}

type Edge = "bottom" | "right" | "top" | "left";

type ContornoAplicado = RecuoInfo & {
  tipo_contorno: "recuo_superior" | "recuo_inferior" | "recuo_esquerdo" | "recuo_direito";
  pontos: Pt[];
  operacao: string;
};

const TIPO_CONTORNO_POR_LADO: Record<Edge, ContornoAplicado["tipo_contorno"]> = {
  top: "recuo_superior",
  bottom: "recuo_inferior",
  left: "recuo_esquerdo",
  right: "recuo_direito",
};

function pathTecnicoParaSvg(pontos: Pt[], altura: number) {
  return pontos.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${altura - p.y}`).join(" ") + " Z";
}

function ordenarPontosParaBorda(edge: Edge, pts: Pt[]) {
  const p = pts.slice();
  const first = p[0];
  const last = p[p.length - 1];
  if (!first || !last) return p;
  if (edge === "bottom" && first.x > last.x) return p.reverse();
  if (edge === "right" && first.y > last.y) return p.reverse();
  if (edge === "top" && first.x < last.x) return p.reverse();
  if (edge === "left" && first.y < last.y) return p.reverse();
  return p;
}

function orderDaBorda(edge: Edge, pts: Pt[]) {
  const first = pts[0];
  if (!first) return 0;
  if (edge === "bottom") return first.x;
  if (edge === "right") return first.y;
  if (edge === "top") return -first.x;
  return -first.y;
}

/**
 * Gera a geometria externa real da peça em coordenadas técnicas (Y para cima)
 * e o path SVG correspondente (Y para baixo, sem margem).
 */
function gerarPathExternoPeca({
  largura,
  altura,
  operacoes,
}: {
  largura: number;
  altura: number;
  operacoes: VisualizadorOperacao[];
}) {
  const byEdge: Record<Edge, { order: number; pts: Pt[]; op: VisualizadorOperacao; origem: RecuoInfo["origem"] }[]> = {
    bottom: [], right: [], top: [], left: [],
  };
  const contornoFalhouIds: string[] = [];

  function aplicarRecuoPadrao(op: VisualizadorOperacao, lado: Edge, refPts: Pt[]) {
    const lar = RECUO_PADRAO.largura;
    const prof = RECUO_PADRAO.profundidade;
    let pts: Pt[];
    if (lado === "top" || lado === "bottom") {
      const centro = refPts.length > 0 ? refPts.reduce((s, p) => s + p.x, 0) / refPts.length : largura / 2;
      let ini = centro - lar / 2;
      let fim = centro + lar / 2;
      if (ini < 0) { fim -= ini; ini = 0; }
      if (fim > largura) { ini -= (fim - largura); fim = largura; }
      ini = Math.max(0, ini); fim = Math.min(largura, fim);
      const yBorda = lado === "top" ? altura : 0;
      const yFundo = lado === "top" ? altura - prof : prof;
      pts = lado === "top"
        ? [{ x: fim, y: yBorda }, { x: fim, y: yFundo }, { x: ini, y: yFundo }, { x: ini, y: yBorda }]
        : [{ x: ini, y: yBorda }, { x: ini, y: yFundo }, { x: fim, y: yFundo }, { x: fim, y: yBorda }];
    } else {
      const centro = refPts.length > 0 ? refPts.reduce((s, p) => s + p.y, 0) / refPts.length : altura / 2;
      let ini = centro - lar / 2;
      let fim = centro + lar / 2;
      if (ini < 0) { fim -= ini; ini = 0; }
      if (fim > altura) { ini -= (fim - altura); fim = altura; }
      ini = Math.max(0, ini); fim = Math.min(altura, fim);
      const xBorda = lado === "right" ? largura : 0;
      const xFundo = lado === "right" ? largura - prof : prof;
      pts = lado === "right"
        ? [{ x: xBorda, y: ini }, { x: xFundo, y: ini }, { x: xFundo, y: fim }, { x: xBorda, y: fim }]
        : [{ x: xBorda, y: fim }, { x: xFundo, y: fim }, { x: xFundo, y: ini }, { x: xBorda, y: ini }];
    }
    byEdge[lado].push({ order: orderDaBorda(lado, pts), pts, op, origem: "padrao_65x40" });
  }

  for (const op of operacoes) {
    if (!ehTipoOuNomeDeContorno(op)) continue;
    const raw = pontosValidosDaOp(op);
    const edge = raw.length >= 3 ? touchesSameEdge(raw, largura, altura) : null;
    if (!edge) {
      if (raw.length > 0 || (op.nome_operacao ?? "").toLowerCase().includes("contorno")) {
        aplicarRecuoPadrao(op, ladoInferidoPorPontos(raw, largura, altura), raw);
      } else {
        contornoFalhouIds.push(op.id);
      }
      continue;
    }
    const pts = ordenarPontosParaBorda(edge, raw);
    byEdge[edge].push({ order: orderDaBorda(edge, pts), pts, op, origem: "pdf" });
  }

  (Object.keys(byEdge) as Edge[]).forEach((k) => byEdge[k].sort((a, b) => a.order - b.order));

  const pontosTecnicos: Pt[] = [];
  pushPt(pontosTecnicos, { x: 0, y: 0 });
  byEdge.bottom.forEach((n) => n.pts.forEach((p) => pushPt(pontosTecnicos, p)));
  pushPt(pontosTecnicos, { x: largura, y: 0 });
  byEdge.right.forEach((n) => n.pts.forEach((p) => pushPt(pontosTecnicos, p)));
  pushPt(pontosTecnicos, { x: largura, y: altura });
  byEdge.top.forEach((n) => n.pts.forEach((p) => pushPt(pontosTecnicos, p)));
  pushPt(pontosTecnicos, { x: 0, y: altura });
  byEdge.left.forEach((n) => n.pts.forEach((p) => pushPt(pontosTecnicos, p)));

  const aplicados = (Object.keys(byEdge) as Edge[]).flatMap((lado) => byEdge[lado].map((n) => {
    const xs = n.pts.map((p) => p.x);
    const ys = n.pts.map((p) => p.y);
    const info: ContornoAplicado = {
      opId: n.op.id,
      lado,
      tipo_contorno: TIPO_CONTORNO_POR_LADO[lado],
      origem: n.origem,
      largura: lado === "top" || lado === "bottom" ? Math.max(...xs) - Math.min(...xs) : Math.max(...ys) - Math.min(...ys),
      profundidade: lado === "top" ? altura - Math.min(...ys) : lado === "bottom" ? Math.max(...ys) : lado === "left" ? Math.max(...xs) : largura - Math.min(...xs),
      ini: lado === "top" || lado === "bottom" ? Math.min(...xs) : Math.min(...ys),
      fim: lado === "top" || lado === "bottom" ? Math.max(...xs) : Math.max(...ys),
      pontos: n.pts,
      operacao: n.op.nome_operacao ?? n.op.tipo_operacao,
    };
    return info;
  }));
  const contornoAplicadoIds = aplicados.map((c) => c.opId);
  const temContornoExterno = operacoes.length > 0;
  const pathSvg = pathTecnicoParaSvg(pontosTecnicos, altura);

  return {
    pathSvg,
    pontosTecnicos,
    temContornoExterno,
    contornosAplicados: aplicados,
    contornoAplicadoIds,
    contornoFalhouIds,
    recuos: aplicados,
    path: pathSvg,
    polygon: pontosTecnicos,
    temContornoAplicado: contornoAplicadoIds.length > 0,
  };
}

function contornoExternoValido(contorno: ContornoExterno | null | undefined): ContornoExterno | null {
  if (!contorno || !Array.isArray(contorno.pontos) || contorno.pontos.length < 3) return null;
  const pontos = contorno.pontos
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: Number(p.x), y: Number(p.y) }));
  if (pontos.length < 3) return null;
  return { ...contorno, pontos };
}

function gerarContornoExternoDeOperacoes(largura: number, altura: number, operacoes: VisualizadorOperacao[]): ContornoExterno | null {
  const contornos = operacoes.filter((o) => ehContornoExterno(o, largura, altura));
  const outline = gerarPathExternoPeca({ largura, altura, operacoes: contornos });
  if (!outline.temContornoAplicado) return null;
  return {
    origem: "parser_pdf",
    largura,
    altura,
    pontos: outline.pontosTecnicos,
    recuos: outline.contornosAplicados.map((c) => ({
      posicao: c.lado === "top" ? "superior" : c.lado === "bottom" ? "inferior" : c.lado === "right" ? "direita" : "esquerda",
      largura: c.largura,
      profundidade: c.profundidade,
      origem: c.origem === "pdf" ? "parser_pdf" : "fallback",
      preset: c.origem === "pdf" ? "operação de contorno" : "recuo 65x40",
      x_inicio: c.lado === "top" || c.lado === "bottom" ? c.ini : undefined,
      x_fim: c.lado === "top" || c.lado === "bottom" ? c.fim : undefined,
      y_inicio: c.lado === "left" || c.lado === "right" ? c.ini : undefined,
      y_fim: c.lado === "left" || c.lado === "right" ? c.fim : undefined,
    })),
    presets_aplicados: ["gerado_a_partir_das_operacoes"],
    observacao: "Contorno externo usado para desenhar a geometria real da peça.",
  };
}

type CorteBorda = { edge: Edge; ini: number; fim: number; profundidade: number };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function cortePorRecuo(recuo: ContornoRecuo, largura: number, altura: number): CorteBorda {
  const lar = Math.max(1, recuo.largura || RECUO_PADRAO.largura);
  const prof = Math.max(1, recuo.profundidade || RECUO_PADRAO.profundidade);
  if (recuo.posicao === "superior") {
    const ini = clamp(recuo.x_inicio ?? (largura - lar) / 2, 0, largura);
    return { edge: "top", ini, fim: clamp(recuo.x_fim ?? ini + lar, ini, largura), profundidade: clamp(prof, 1, altura) };
  }
  if (recuo.posicao === "superior_direito") {
    return { edge: "right", ini: clamp(altura - prof, 0, altura), fim: altura, profundidade: clamp(lar, 1, largura) };
  }
  if (recuo.posicao === "superior_esquerdo") {
    return { edge: "left", ini: clamp(altura - prof, 0, altura), fim: altura, profundidade: clamp(lar, 1, largura) };
  }
  if (recuo.posicao === "inferior") {
    const ini = clamp(recuo.x_inicio ?? (largura - lar) / 2, 0, largura);
    return { edge: "bottom", ini, fim: clamp(recuo.x_fim ?? ini + lar, ini, largura), profundidade: clamp(prof, 1, altura) };
  }
  if (recuo.posicao === "direita") {
    const ini = clamp(recuo.y_inicio ?? (altura - lar) / 2, 0, altura);
    return { edge: "right", ini, fim: clamp(recuo.y_fim ?? ini + lar, ini, altura), profundidade: clamp(prof, 1, largura) };
  }
  const ini = clamp(recuo.y_inicio ?? (altura - lar) / 2, 0, altura);
  return { edge: "left", ini, fim: clamp(recuo.y_fim ?? ini + lar, ini, altura), profundidade: clamp(prof, 1, largura) };
}

function pontosPorRecuos(largura: number, altura: number, recuos: ContornoRecuo[]) {
  const cortes: Record<Edge, CorteBorda[]> = { bottom: [], right: [], top: [], left: [] };
  recuos.forEach((r) => {
    const c = cortePorRecuo(r, largura, altura);
    if (c.fim - c.ini > EDGE_EPS) cortes[c.edge].push(c);
  });
  cortes.bottom.sort((a, b) => a.ini - b.ini);
  cortes.right.sort((a, b) => a.ini - b.ini);
  cortes.top.sort((a, b) => b.fim - a.fim);
  cortes.left.sort((a, b) => b.fim - a.fim);

  const out: Pt[] = [];
  pushPt(out, { x: 0, y: 0 });
  cortes.bottom.forEach((c) => {
    if (c.ini > 0) pushPt(out, { x: c.ini, y: 0 });
    pushPt(out, { x: c.ini, y: c.profundidade });
    pushPt(out, { x: c.fim, y: c.profundidade });
    if (c.fim < largura) pushPt(out, { x: c.fim, y: 0 });
  });
  pushPt(out, { x: largura, y: 0 });
  cortes.right.forEach((c) => {
    if (c.ini > 0) pushPt(out, { x: largura, y: c.ini });
    pushPt(out, { x: largura - c.profundidade, y: c.ini });
    pushPt(out, { x: largura - c.profundidade, y: c.fim });
    if (c.fim < altura) pushPt(out, { x: largura, y: c.fim });
  });
  if (!samePoint(out[out.length - 1], { x: largura - (cortes.right.at(-1)?.fim === altura ? cortes.right.at(-1)!.profundidade : 0), y: altura })) {
    pushPt(out, { x: largura, y: altura });
  }
  cortes.top.forEach((c) => {
    if (c.fim < largura) pushPt(out, { x: c.fim, y: altura });
    pushPt(out, { x: c.fim, y: altura - c.profundidade });
    pushPt(out, { x: c.ini, y: altura - c.profundidade });
    if (c.ini > 0) pushPt(out, { x: c.ini, y: altura });
  });
  if (!(cortes.top.at(-1)?.ini === 0 || cortes.left[0]?.fim === altura)) pushPt(out, { x: 0, y: altura });
  cortes.left.forEach((c) => {
    if (c.fim < altura) pushPt(out, { x: 0, y: c.fim });
    pushPt(out, { x: c.profundidade, y: c.fim });
    pushPt(out, { x: c.profundidade, y: c.ini });
    if (c.ini > 0) pushPt(out, { x: 0, y: c.ini });
  });
  return out;
}

function aplicarRecuoPadraoAoContorno(base: ContornoExterno | null | undefined, largura: number, altura: number, posicao: PosicaoRecuo): ContornoExterno {
  const recuos = [...(base?.recuos ?? [])];
  recuos.push({
    id: crypto.randomUUID?.() ?? String(Date.now()),
    posicao,
    largura: RECUO_PADRAO.largura,
    profundidade: RECUO_PADRAO.profundidade,
    origem: "manual",
    preset: "recuo_65x40",
  });
  return {
    origem: base?.origem && base.origem !== "manual" ? "misto" : "manual",
    largura,
    altura,
    pontos: pontosPorRecuos(largura, altura, recuos),
    recuos,
    presets_aplicados: [...(base?.presets_aplicados ?? []), `recuo_65x40_${posicao}`],
    observacao: "Contorno externo usado para desenhar a geometria real da peça.",
  };
}

function fmt(v: number | string | null | undefined) {
  return v == null || v === "" ? "?" : String(v);
}

const AVISO_EDICAO =
  "Esta alteração será salva no cadastro técnico desta peça e poderá afetar futuros projetos vinculados a este código.";

export function VisualizadorTecnicoPecaCadastrada({
  codigo,
  nome,
  tipo,
  largura,
  altura,
  espessura,
  operacoes,
  bordas,
  faceAlinhamento,
  indicadoresBorda = [],
  facesDetectadas = [],
  contornoExterno,
  onAddOperacao,
  onEditOperacao,
  onDeleteOperacao,
  onSaveContorno,
}: Props) {
  const opsPorFace = useMemo(() => {
    const m = new Map<string, VisualizadorOperacao[]>();
    for (const o of operacoes) {
      const k = o.face == null ? "—" : String(o.face);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(o);
    }
    return m;
  }, [operacoes]);

  const faces = useMemo(() => {
    const s = new Set<string>([
      ...FACES_PADRAO,
      ...opsPorFace.keys(),
      ...facesDetectadas.map(String),
    ]);
    s.delete("—");
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [opsPorFace, facesDetectadas]);

  const [faceSel, setFaceSel] = useState<string>(faces[0] ?? "0");
  const [opSel, setOpSel] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editOp, setEditOp] = useState<VisualizadorOperacao | null>(null);
  const [delOp, setDelOp] = useState<VisualizadorOperacao | null>(null);
  const [contornoOpen, setContornoOpen] = useState(false);

  const opsFace = opsPorFace.get(faceSel) ?? [];
  const opSelObj = opsFace.find((o) => o.id === opSel) ?? null;

  const { partW, partH } = useMemo(() => {
    const L = largura ?? 600;
    const A = altura ?? 400;
    const E = espessura ?? 18;
    if (faceSel === "0" || faceSel === "5") return { partW: L, partH: A };
    if (faceSel === "1" || faceSel === "2") return { partW: A, partH: E };
    return { partW: L, partH: E };
  }, [faceSel, largura, altura, espessura]);

  // Margem de segurança ao redor da peça (mm)
  const margin = Math.max(80, Math.round(Math.max(partW, partH) * 0.1));
  const viewW = partW + margin * 2;
  const viewH = partH + margin * 2;

  // ─── Zoom / Pan livres ───
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 }); // px na tela
  const [mostrarRegua, setMostrarRegua] = useState(false);
  const panState = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  function fitToView() {
    const el = containerRef.current;
    if (!el) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const z = Math.min(cw / viewW, ch / viewH) * 0.95;
    const newZoom = Math.max(z, 0.05);
    setZoom(newZoom);
    setPan({
      x: (cw - viewW * newZoom) / 2,
      y: (ch - viewH * newZoom) / 2,
    });
  }

  // Ajusta na primeira renderização e quando troca face
  useEffect(() => {
    fitToView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceSel, partW, partH]);

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(0.05, Math.min(40, zoom * factor));
    // mantém ponto do mouse fixo
    const nx = mx - ((mx - pan.x) * newZoom) / zoom;
    const ny = my - ((my - pan.y) * newZoom) / zoom;
    setZoom(newZoom);
    setPan({ x: nx, y: ny });
  }

  function handlePanStart(e: React.MouseEvent) {
    panState.current = { x: e.clientX, y: e.clientY, ox: pan.x, oy: pan.y };
  }
  function handlePanMove(e: React.MouseEvent) {
    if (!panState.current) return;
    const dx = e.clientX - panState.current.x;
    const dy = e.clientY - panState.current.y;
    setPan({ x: panState.current.ox + dx, y: panState.current.oy + dy });
  }
  function handlePanEnd() {
    panState.current = null;
  }

  function zoomBy(factor: number) {
    const el = containerRef.current;
    const cw = el?.clientWidth ?? 600;
    const ch = el?.clientHeight ?? 400;
    const mx = cw / 2;
    const my = ch / 2;
    const newZoom = Math.max(0.05, Math.min(40, zoom * factor));
    const nx = mx - ((mx - pan.x) * newZoom) / zoom;
    const ny = my - ((my - pan.y) * newZoom) / zoom;
    setZoom(newZoom);
    setPan({ x: nx, y: ny });
  }

  // Tamanhos visuais (compensados pelo zoom para manter px na tela)
  const px = (v: number) => v / zoom; // converte px de tela → unidades do SVG (mm)
  const minHoleR = px(4); // 4px de tela mínimo
  const fontCota = px(16);
  const fontGrid = px(10);
  const fontOp = px(11);

  const alertasOp = (o: VisualizadorOperacao) => {
    const a: string[] = [];
    const pontos = pontosValidosDaOp(o);
    if (ehTipoOuNomeDeContorno(o)) {
      if ((o.pontos_json ?? []).length === 0) a.push("Contorno sem pontos");
      if (pontos.some((p) => p.x < 0 || p.x > partW || p.y < 0 || p.y > partH)) a.push("Pontos fora da peça");
    }
    if (o.tipo_operacao === "rasgo") {
      if (o.x1 != null && o.x1 < 0) a.push("X1 fora da peça");
      if (o.x2 != null && o.x2 > partW) a.push("X2 fora da peça");
      if (o.x1 != null && o.x2 != null && o.x2 <= o.x1) a.push("X2 deve ser maior que X1");
      if (o.y != null && (o.y < 0 || o.y > partH)) a.push("Y fora da peça");
      if (o.largura != null && o.largura <= 0) a.push("Largura inválida");
      if (espessura != null && o.profundidade != null && o.profundidade > espessura)
        a.push("Profundidade > espessura");
    } else {
      if (o.x != null && (o.x < 0 || o.x > partW)) a.push("X fora da peça");
      if (o.y != null && (o.y < 0 || o.y > partH)) a.push("Y fora da peça");
      if (espessura != null && o.profundidade != null && o.profundidade > espessura)
        a.push("Profundidade > espessura");
      if (o.tipo_operacao === "furo" && o.diametro == null) a.push("Sem diâmetro");
    }
    if (o.confianca_parser === "baixa") a.push("Baixa confiança");
    return a;
  };

  const contagem = (face: string) => {
    const arr = opsPorFace.get(face) ?? [];
    return {
      furos: arr.filter((o) => o.tipo_operacao === "furo").length,
      rasgos: arr.filter((o) => o.tipo_operacao === "rasgo").length,
      usin: arr.filter((o) => ehUsinagem(o.tipo_operacao)).length,
      total: arr.length,
    };
  };

  const furosFace = opsFace.filter((o) => o.tipo_operacao === "furo");
  const rasgosFace = opsFace.filter((o) => o.tipo_operacao === "rasgo");
  const usinagensFace = opsFace.filter((o) => ehUsinagem(o.tipo_operacao));
  const outrasFace = opsFace.filter((o) => !["furo", "rasgo", ...TIPO_USINAGEM].includes(o.tipo_operacao));

  // Contornos externos que alteram o formato da peça
  const contornosExternos = usinagensFace.filter((o) => ehContornoExterno(o, partW, partH));
  const contornosExternosIds = new Set(contornosExternos.map((o) => o.id));
  const outlineOperacoes = useMemo(
    () => gerarPathExternoPeca({ largura: partW, altura: partH, operacoes: contornosExternos }),
    [contornosExternos, partW, partH],
  );
  const podeUsarContornoSalvo = faceSel === "0" || faceSel === "5";
  const contornoSalvo = useMemo(
    () => podeUsarContornoSalvo ? contornoExternoValido(contornoExterno) : null,
    [contornoExterno, podeUsarContornoSalvo],
  );
  const outline = useMemo(() => {
    if (contornoSalvo) {
      const pontosTecnicos = contornoSalvo.pontos;
      const pathSvg = pathTecnicoParaSvg(pontosTecnicos, partH);
      return {
        pathSvg,
        pontosTecnicos,
        temContornoExterno: true,
        contornosAplicados: outlineOperacoes.contornosAplicados,
        contornoAplicadoIds: outlineOperacoes.contornoAplicadoIds,
        contornoFalhouIds: outlineOperacoes.contornoFalhouIds,
        recuos: contornoSalvo.recuos ?? outlineOperacoes.recuos,
        path: pathSvg,
        polygon: pontosTecnicos,
        temContornoAplicado: true,
      };
    }
    return { ...outlineOperacoes, temContornoExterno: false, temContornoAplicado: false };
  }, [contornoSalvo, outlineOperacoes, partH]);
  const contornosAplicadosIds = new Set(outline.contornoAplicadoIds);
  const recuoPorOpId = useMemo(() => {
    const m = new Map<string, ContornoAplicado>();
    outlineOperacoes.recuos.forEach((r) => m.set(r.opId, r));
    return m;
  }, [outlineOperacoes.recuos]);
  const temRecuoFallback = outlineOperacoes.recuos.some((r) => r.origem === "padrao_65x40");
  const contornosComFalha = outline.contornoFalhouIds.length > 0;
  const isLat3854A = codigo.trim().toUpperCase() === "LAT3854A";
  const lat3854AInvalida = isLat3854A && contornosExternos.some((o) => (o.nome_operacao ?? "").includes("UsinagemParametrica01")) && (
    !outline.temContornoExterno ||
    !outline.temContornoAplicado ||
    !outline.pathSvg.includes("371.5 0") ||
    !outline.pathSvg.includes("371.5 40") ||
    !outline.pathSvg.includes("291.5 40") ||
    !outline.pathSvg.includes("291.5 0")
  );
  const temOperacaoContornoSemContornoSalvo = contornosExternos.length > 0 && !contornoSalvo;
  const erroPathReal = (outlineOperacoes.temContornoExterno && !outlineOperacoes.temContornoAplicado) || lat3854AInvalida;
  const rectFallbackAtivo = !contornoSalvo;

  async function salvarContorno(contorno: ContornoExterno) {
    if (!onSaveContorno) return;
    await onSaveContorno(contorno);
  }

  async function gerarContornoDasOperacoes() {
    const gerado = gerarContornoExternoDeOperacoes(partW, partH, contornosExternos);
    if (gerado) await salvarContorno(gerado);
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!isLat3854A) return;
    console.info("[GEOMETRIA PECA]", {
      codigo,
      largura: partW,
      altura: partH,
      temContornoExterno: outline.temContornoExterno,
      pathSvg: outline.pathSvg,
      pontosTecnicos: outline.pontosTecnicos,
      contornosAplicados: outline.contornosAplicados,
    });
  }, [codigo, isLat3854A, outline.pathSvg, outline.temContornoExterno, partW, partH, outline.pontosTecnicos, outline.contornosAplicados]);

  return (
    <div className="grid gap-3 lg:grid-cols-[200px_1fr_300px]">
      {/* Painel esquerdo: faces */}
      <aside className="rounded border border-border bg-surface p-2">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Faces</h3>
        <div className="space-y-1">
          {faces.map((f) => {
            const c = contagem(f);
            const ativo = f === faceSel;
            return (
              <button
                key={f}
                onClick={() => {
                  setFaceSel(f);
                  setOpSel(null);
                }}
                className={`w-full rounded border px-2 py-1.5 text-left text-xs transition ${
                  ativo
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-surface-2 hover:bg-surface-2/80"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold">F{f}</span>
                  <span className="text-[10px] text-muted-foreground">{c.total} op.</span>
                </div>
                <div className="mt-0.5 flex gap-1 text-[10px] text-muted-foreground">
                  {c.furos > 0 && <span>● {c.furos}</span>}
                  {c.rasgos > 0 && <span>▭ {c.rasgos}</span>}
                  {c.usin > 0 && <span>✦ {c.usin}</span>}
                </div>
              </button>
            );
          })}
        </div>

        {bordas.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Bordas / Fitas</h3>
            <div className="space-y-1">
              {bordas.map((b) => (
                <div key={b.id} className="rounded bg-surface-2 px-2 py-1 text-[10px]">
                  <div className="font-mono font-semibold">{b.codigo_borda ?? "—"}</div>
                  <div className="text-muted-foreground">{b.lado}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Canvas central */}
      <div className="flex min-h-[560px] flex-col rounded border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2 text-xs">
          <span className="font-mono text-foreground">
            {codigo} — Face {faceSel}
          </span>
          <span className="text-muted-foreground">
            {partW} × {partH} {espessura != null ? `× ${espessura}` : ""} mm
            {tipo ? ` • ${tipo}` : ""}
            {nome ? ` • ${nome}` : ""}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-7" onClick={() => zoomBy(1.25)}>+</Button>
            <span className="w-14 text-center font-mono text-[11px]">{(zoom * 100).toFixed(0)}%</span>
            <Button size="sm" variant="outline" className="h-7" onClick={() => zoomBy(1 / 1.25)}>−</Button>
            <Button size="sm" variant="outline" className="h-7" onClick={fitToView}>Ajustar</Button>
            <Button
              size="sm"
              variant={mostrarRegua ? "default" : "outline"}
              className="h-7"
              onClick={() => setMostrarRegua((v) => !v)}
              title="Mostrar/ocultar régua e escala numérica"
            >
              Régua
            </Button>
          </div>
        </div>

        <div
          ref={containerRef}
          className="cad-grid relative h-[560px] flex-1 overflow-hidden bg-surface-2"
          onWheel={handleWheel}
          onMouseDown={handlePanStart}
          onMouseMove={handlePanMove}
          onMouseUp={handlePanEnd}
          onMouseLeave={handlePanEnd}
          style={{ cursor: panState.current ? "grabbing" : "grab" }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
              width: viewW,
              height: viewH,
            }}
          >
            <svg
              width={viewW}
              height={viewH}
              viewBox={`0 0 ${viewW} ${viewH}`}
              style={{ display: "block", overflow: "visible" }}
            >
              <defs>
                <pattern id="hatch-fora" width={px(8)} height={px(8)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width={px(8)} height={px(8)} fill="var(--color-surface-2)" />
                  <line x1="0" y1="0" x2="0" y2={px(8)} stroke="var(--color-muted-foreground)" strokeWidth={px(0.6)} opacity="0.35" />
                </pattern>
              </defs>

              {/* Grade / régua (opcional) */}
              {mostrarRegua && (
                <g stroke="var(--color-grid-strong)" strokeWidth={px(0.5)}>
                  {Array.from({ length: Math.floor(partW / 50) + 1 }, (_, i) => i * 50).map((x) => (
                    <g key={`gx${x}`}>
                      <line x1={margin + x} y1={margin} x2={margin + x} y2={margin + partH} />
                      <text x={margin + x} y={margin - px(6)} fontSize={fontGrid} fill="var(--color-muted-foreground)" textAnchor="middle">{x}</text>
                    </g>
                  ))}
                  {Array.from({ length: Math.floor(partH / 50) + 1 }, (_, i) => i * 50).map((y) => (
                    <g key={`gy${y}`}>
                      <line x1={margin} y1={margin + y} x2={margin + partW} y2={margin + y} />
                      <text x={margin - px(6)} y={margin + y + px(3)} fontSize={fontGrid} fill="var(--color-muted-foreground)" textAnchor="end">{y}</text>
                    </g>
                  ))}
                </g>
              )}

              {/* Fundo hachurado fora da peça (mostra o vazio do recuo) */}
              <rect x={0} y={0} width={viewW} height={viewH} fill="url(#hatch-fora)" />

              {/* Peça (com contornos externos integrados ao formato) */}
              {outline.temContornoExterno ? (
                <path
                  d={outline.pathSvg}
                  transform={`translate(${margin} ${margin})`}
                  fill="var(--color-surface)"
                  stroke="var(--color-foreground)"
                  strokeWidth={px(1.5)}
                  strokeLinejoin="miter"
                />
              ) : (
                <rect
                  x={margin}
                  y={margin}
                  width={partW}
                  height={partH}
                  fill="var(--color-surface)"
                  stroke="var(--color-foreground)"
                  strokeWidth={px(1.5)}
                />
              )}


              {(erroPathReal || contornosComFalha || temRecuoFallback) && (
                <g>
                  <rect
                    x={margin + px(10)}
                    y={margin + px(10)}
                    width={Math.min(px(520), partW - px(20))}
                    height={px(34)}
                    fill="var(--color-surface)"
                    stroke="var(--color-warning)"
                    strokeWidth={px(1)}
                  />
                  <text x={margin + px(20)} y={margin + px(31)} fontSize={px(11)} fill="var(--color-warning)" fontFamily="monospace">
                    {erroPathReal
                      ? "Contorno externo detectado, mas o path real da peça não foi aplicado."
                      : temRecuoFallback
                      ? "Recuo sem medida explícita. Aplicada medida padrão 65 × 40 mm."
                      : "Contorno externo detectado, mas não foi possível aplicar ao formato da peça."}
                  </text>
                </g>
              )}

              {/* Face de alinhamento */}
              {faceSel === "0" && faceAlinhamento && (
                <g>
                  <circle cx={margin - px(20)} cy={margin + partH + px(20)} r={px(12)} fill="var(--color-primary)" />
                  <text
                    x={margin - px(20)}
                    y={margin + partH + px(24)}
                    fontSize={px(14)}
                    fill="var(--color-primary-foreground)"
                    textAnchor="middle"
                    fontWeight="700"
                  >
                    {faceAlinhamento}
                  </text>
                </g>
              )}

              {/* Cotas */}
              <g
                stroke="var(--color-foreground)"
                strokeWidth={px(0.6)}
                fill="var(--color-foreground)"
                fontFamily="monospace"
              >
                <line
                  x1={margin}
                  y1={margin + partH + px(40)}
                  x2={margin + partW}
                  y2={margin + partH + px(40)}
                />
                <text
                  x={margin + partW / 2}
                  y={margin + partH + px(56)}
                  fontSize={fontCota}
                  textAnchor="middle"
                >
                  {partW} mm
                </text>
                <line
                  x1={margin + partW + px(40)}
                  y1={margin}
                  x2={margin + partW + px(40)}
                  y2={margin + partH}
                />
                <text
                  x={margin + partW + px(56)}
                  y={margin + partH / 2}
                  fontSize={fontCota}
                  textAnchor="middle"
                  transform={`rotate(90 ${margin + partW + px(56)} ${margin + partH / 2})`}
                >
                  {partH} mm
                </text>
              </g>

              {/* Operações */}
              {opsFace.map((op) => {
                const sel = op.id === opSel;
                if (op.tipo_operacao === "furo") {
                  if (op.x == null || op.y == null) return null;
                  const cx = margin + op.x;
                  const cy = margin + partH - op.y;
                  const realR = (op.diametro ?? 4) / 2;
                  const r = Math.max(realR, minHoleR);
                  return (
                    <g key={op.id} onClick={(e) => { e.stopPropagation(); setOpSel(op.id); }} style={{ cursor: "pointer" }}>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r}
                        fill={sel ? "var(--color-primary)" : "var(--color-surface)"}
                        stroke={sel ? "var(--color-primary)" : "var(--color-foreground)"}
                        strokeWidth={sel ? px(2) : px(1)}
                      />
                      <circle cx={cx} cy={cy} r={px(1)} fill="var(--color-foreground)" />
                      <text
                        x={cx + r + px(3)}
                        y={cy - r - px(2)}
                        fontSize={fontOp}
                        fontFamily="monospace"
                        fill={sel ? "var(--color-primary)" : "var(--color-muted-foreground)"}
                      >
                        Ø{op.diametro ?? "?"}
                      </text>
                    </g>
                  );
                }
                if (op.tipo_operacao === "rasgo") {
                  const y = op.y ?? 0;
                  const x1 = op.x1 ?? op.x ?? 0;
                  const x2 = op.x2 ?? (op.x ?? 0) + (op.comprimento ?? 30);
                  const larg = Math.max(op.largura ?? 6, minHoleR * 1.5);
                  const cy = margin + partH - y;
                  return (
                    <g key={op.id} onClick={(e) => { e.stopPropagation(); setOpSel(op.id); }} style={{ cursor: "pointer" }}>
                      <rect
                        x={margin + Math.min(x1, x2)}
                        y={cy - larg / 2}
                        width={Math.abs(x2 - x1)}
                        height={larg}
                        fill={sel ? "var(--color-primary)" : "var(--color-accent)"}
                        stroke={sel ? "var(--color-primary)" : "var(--color-foreground)"}
                        strokeWidth={sel ? px(2) : px(1)}
                        opacity={0.8}
                        rx={larg / 2}
                      />
                    </g>
                  );
                }
                if (ehUsinagem(op.tipo_operacao)) {
                  const pts = (op.pontos_json ?? []).filter(
                    (p): p is { x: number; y: number; profundidade: number | null; tipo?: string | null } =>
                      p.x != null && p.y != null,
                  );
                  if (pts.length === 0) {
                    if (op.x != null && op.y != null) {
                      const cx = margin + op.x;
                      const cy = margin + partH - op.y;
                      return (
                        <g key={op.id} onClick={(e) => { e.stopPropagation(); setOpSel(op.id); }} style={{ cursor: "pointer" }}>
                          <rect
                            x={cx - px(8)}
                            y={cy - px(8)}
                            width={px(16)}
                            height={px(16)}
                            fill={sel ? "var(--color-primary)" : "transparent"}
                            stroke="var(--color-foreground)"
                            strokeWidth={px(1)}
                            strokeDasharray={`${px(3)},${px(2)}`}
                          />
                        </g>
                      );
                    }
                    return null;
                  }
                  const isContornoExt = contornosAplicadosIds.has(op.id);
                  const d = pts
                    .map((p, i) => `${i === 0 ? "M" : "L"} ${margin + p.x!} ${margin + partH - p.y!}`)
                    .join(" ");
                  return (
                    <g key={op.id} onClick={(e) => { e.stopPropagation(); setOpSel(op.id); }} style={{ cursor: "pointer" }}>
                      {isContornoExt ? (
                        // Contorno já integrado ao formato da peça — apenas realce/pontos editáveis
                        <path
                          d={d}
                          fill="none"
                          stroke={sel ? "var(--color-primary)" : "transparent"}
                          strokeWidth={sel ? px(2.5) : px(8)}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          opacity={sel ? 1 : 0.001}
                        />
                      ) : (
                        <path
                          d={d + (pts.length > 2 ? " Z" : "")}
                          fill={sel ? "color-mix(in oklab, var(--color-primary) 15%, transparent)" : "none"}
                          stroke={sel ? "var(--color-primary)" : "var(--color-accent)"}
                          strokeWidth={sel ? px(2.5) : px(1.8)}
                        />
                      )}
                      {pts.map((p, i) => (
                        <circle
                          key={i}
                          cx={margin + p.x!}
                          cy={margin + partH - p.y!}
                          r={px(isContornoExt && !sel ? 2.5 : 3)}
                          fill={sel ? "var(--color-primary)" : isContornoExt ? "var(--color-muted-foreground)" : "var(--color-foreground)"}
                        />
                      ))}
                    </g>
                  );
                }
                return null;
              })}
            </svg>
          </div>

          {/* Indicador de eixos X/Y fixo no canto inferior esquerdo */}
          <div className="pointer-events-none absolute bottom-3 left-3 select-none">
            <svg width="78" height="78" viewBox="0 0 78 78">
              <defs>
                <marker id="arrX" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                </marker>
                <marker id="arrY" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
                </marker>
              </defs>
              <circle cx="14" cy="64" r="4" fill="hsl(var(--foreground) / 0.6)" />
              <line x1="14" y1="64" x2="62" y2="64" stroke="#ef4444" strokeWidth="2.5" markerEnd="url(#arrX)" />
              <text x="68" y="68" fontSize="13" fill="#ef4444" fontFamily="monospace" fontWeight="700">X</text>
              <line x1="14" y1="64" x2="14" y2="16" stroke="#3b82f6" strokeWidth="2.5" markerEnd="url(#arrY)" />
              <text x="6" y="14" fontSize="13" fill="#3b82f6" fontFamily="monospace" fontWeight="700">Y</text>
              <text x="18" y="76" fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="monospace">0,0</text>
            </svg>
          </div>

          {opsFace.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <span>Nenhuma operação cadastrada nesta face.</span>
              {onAddOperacao && (
                <Button
                  size="sm"
                  variant="outline"
                  className="pointer-events-auto"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus className="mr-1 h-3 w-3" /> Adicionar operação nesta face
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Painel direito: detalhes / lista */}
      <aside className="rounded border border-border bg-surface p-2">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Operações da Face {faceSel}
          </h3>
          {onAddOperacao && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setAddOpen(true)}>
              <Plus className="mr-1 h-3 w-3" /> Adicionar
            </Button>
          )}
        </div>
        {opsFace.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma operação cadastrada nesta face.</p>
        ) : (
          <div className="mb-3 max-h-72 space-y-3 overflow-auto pr-1">
            <GrupoOperacoesFace titulo="Furações" ops={furosFace} opSel={opSel} setOpSel={setOpSel} />
            <GrupoOperacoesFace titulo="Rasgos" ops={rasgosFace} opSel={opSel} setOpSel={setOpSel} />
            <GrupoOperacoesFace titulo="Usinagens / Contornos" ops={usinagensFace} opSel={opSel} setOpSel={setOpSel} contornosExternosIds={contornosExternosIds} />
            <GrupoOperacoesFace titulo="Outras" ops={outrasFace} opSel={opSel} setOpSel={setOpSel} />
          </div>
        )}

        {import.meta.env.DEV && (
          <details className="mb-2 rounded border border-border bg-surface-2 p-2 text-[10px]">
            <summary className="cursor-pointer font-semibold uppercase tracking-wider text-muted-foreground">
              Debug geometria
            </summary>
            <div className="mt-2 space-y-1 font-mono">
              <Linha k="temContornoExterno" v={String(outline.temContornoExterno)} />
              <Linha k="pathSvg" v={outline.pathSvg} />
              <div className="break-all text-muted-foreground">
                pontos: {JSON.stringify(outline.pontosTecnicos)}
              </div>
              <div className="break-all text-muted-foreground">
                contornos: {JSON.stringify(outline.contornosAplicados.map((c) => ({ opId: c.opId, operacao: c.operacao, tipo_contorno: c.tipo_contorno, origem: c.origem, pontos: c.pontos })))}
              </div>
            </div>
          </details>
        )}

        <div className="mt-2 border-t border-border pt-2">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Detalhes</h3>
          {!opSelObj ? (
            <p className="text-xs text-muted-foreground">Clique em uma operação para ver os detalhes.</p>
          ) : (
            <div className="space-y-1 text-[11px]">
              {(() => {
                const isRasgo = opSelObj.tipo_operacao === "rasgo";
                const ancoras = (opSelObj.dados_brutos_json as {
                  ancoras_extras?: {
                    x1?: { ancora: string; offset: number };
                    x2?: { ancora: string; offset: number };
                  };
                } | null | undefined)?.ancoras_extras;
                return (
                  <>
                    <Linha k="Tipo" v={contornosExternosIds.has(opSelObj.id) ? "Contorno externo" : opSelObj.tipo_operacao} />
                    {contornosExternosIds.has(opSelObj.id) && (
                      <div className="my-1 inline-flex items-center rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        Contorno externo
                      </div>
                    )}
                    {contornosExternosIds.has(opSelObj.id) && <Linha k="Afeta geometria" v="Sim" />}
                    {(() => {
                      const r = recuoPorOpId.get(opSelObj.id);
                      if (!r) return null;
                      const ladoLabel: Record<Edge, string> = { top: "Recuo superior", bottom: "Recuo inferior", left: "Recuo esquerdo", right: "Recuo direito" };
                      return (
                        <>
                          <Linha k="Tipo do recuo" v={ladoLabel[r.lado]} />
                          <Linha k="tipo_contorno" v={r.tipo_contorno} />
                          <Linha k="Largura do recuo" v={`${r.largura.toFixed(1)} mm`} />
                          <Linha k="Profundidade do recuo" v={`${r.profundidade.toFixed(1)} mm`} />
                          <Linha k="Origem da medida" v={r.origem === "padrao_65x40" ? "padrão 65×40" : "PDF"} />
                          {r.origem === "padrao_65x40" && (
                            <div className="my-1 rounded border border-warning/40 bg-warning/10 px-1.5 py-1 text-[10px] text-warning-foreground">
                              Este recuo altera a geometria real da peça cadastrada. Medida padrão aplicada (65 × 40 mm) — edite os pontos para ajustar.
                            </div>
                          )}
                        </>
                      );
                    })()}
                    {Array.isArray(opSelObj.pontos_json) && opSelObj.pontos_json.length > 0 && (
                      <Linha k="Pontos" v={String(opSelObj.pontos_json.length)} />
                    )}
                    {opSelObj.nome_operacao && <Linha k="Nome" v={opSelObj.nome_operacao} />}
                    <Linha k="Face" v={String(opSelObj.face ?? "—")} />
                    {!isRasgo && opSelObj.x != null && <Linha k="X" v={String(opSelObj.x)} />}
                    {opSelObj.y != null && <Linha k="Y" v={String(opSelObj.y)} />}
                    {opSelObj.x1 != null && <Linha k="X1" v={String(opSelObj.x1)} />}
                    {opSelObj.x2 != null && <Linha k="X2" v={String(opSelObj.x2)} />}
                    {!isRasgo && opSelObj.diametro != null && <Linha k="Diâmetro" v={`Ø ${opSelObj.diametro}`} />}
                    {opSelObj.largura != null && <Linha k="Largura" v={String(opSelObj.largura)} />}
                    {!isRasgo && opSelObj.comprimento != null && (
                      <Linha k="Comprimento" v={String(opSelObj.comprimento)} />
                    )}
                    {opSelObj.profundidade != null && <Linha k="Profundidade" v={String(opSelObj.profundidade)} />}
                    {isRasgo && ancoras?.x1 && (
                      <Linha k="X1 âncora" v={`${ancoras.x1.ancora}, offset ${ancoras.x1.offset}`} />
                    )}
                    {isRasgo && ancoras?.x2 && (
                      <Linha k="X2 âncora" v={`${ancoras.x2.ancora}, offset ${ancoras.x2.offset}`} />
                    )}
                    {!isRasgo && opSelObj.ancora_x && (
                      <Linha k="Âncora X" v={`${opSelObj.ancora_x}${opSelObj.offset_x != null ? ` (${opSelObj.offset_x})` : ""}`} />
                    )}
                    {opSelObj.ancora_y && (
                      <Linha k="Âncora Y" v={`${opSelObj.ancora_y}${opSelObj.offset_y != null ? ` (${opSelObj.offset_y})` : ""}`} />
                    )}
                    <Linha k="Confiança" v={opSelObj.confianca_parser} />
                    <Linha k="Origem" v="biblioteca de peças cadastradas" />
                  </>
                );
              })()}

              {(() => {
                const al = alertasOp(opSelObj);
                if (al.length === 0) return null;
                return (
                  <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 p-1.5">
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" /> Alertas
                    </div>
                    <ul className="ml-4 list-disc text-[10px] text-muted-foreground">
                      {al.map((a) => <li key={a}>{a}</li>)}
                    </ul>
                  </div>
                );
              })()}

              {Array.isArray(opSelObj.pontos_json) && opSelObj.pontos_json.length > 0 && (
                <details className="mt-2 rounded bg-surface-2 p-1.5">
                  <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Pontos ({opSelObj.pontos_json.length})
                  </summary>
                  <table className="mt-1 w-full text-[10px]">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="text-left">#</th>
                        <th className="text-right">X</th>
                        <th className="text-right">Y</th>
                        <th className="text-right">P</th>
                        <th className="text-left">Tipo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {opSelObj.pontos_json.map((p, i) => (
                        <tr key={i} className="border-t border-border/40">
                          <td>{i + 1}</td>
                          <td className="text-right font-mono">{p.x ?? "—"}</td>
                          <td className="text-right font-mono">{p.y ?? "—"}</td>
                          <td className="text-right font-mono">{p.profundidade ?? "—"}</td>
                          <td>{p.tipo ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {onEditOperacao && (
                  <Button size="sm" variant="outline" onClick={() => setEditOp(opSelObj)}>
                    <Pencil className="mr-1 h-3 w-3" /> Editar
                  </Button>
                )}
                {onAddOperacao && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onAddOperacao({
                        face: String(opSelObj.face ?? faceSel),
                        tipo_operacao: opSelObj.tipo_operacao,
                        nome_operacao: opSelObj.nome_operacao ?? null,
                        x: opSelObj.x,
                        y: opSelObj.y,
                        diametro: opSelObj.diametro,
                        profundidade: opSelObj.profundidade,
                        x1: opSelObj.x1,
                        x2: opSelObj.x2,
                        largura: opSelObj.largura,
                        comprimento: opSelObj.comprimento,
                        pontos_json: opSelObj.pontos_json,
                      })
                    }
                  >
                    <Copy className="mr-1 h-3 w-3" /> Duplicar
                  </Button>
                )}
                {onDeleteOperacao && (
                  <Button size="sm" variant="destructive" onClick={() => setDelOp(opSelObj)}>
                    <Trash2 className="mr-1 h-3 w-3" /> Excluir
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Modal adicionar */}
      {onAddOperacao && (
        <OperacaoDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          modo="add"
          face={faceSel}
          faces={faces}
          onSubmit={async (payload) => {
            await onAddOperacao(payload);
            setAddOpen(false);
          }}
        />
      )}

      {/* Modal editar */}
      {onEditOperacao && editOp && (
        <OperacaoDialog
          open={!!editOp}
          onOpenChange={(v) => !v && setEditOp(null)}
          modo="edit"
          face={String(editOp.face ?? faceSel)}
          faces={faces}
          op={editOp}
          onSubmit={async (payload) => {
            await onEditOperacao({ ...payload, id: editOp.id });
            setEditOp(null);
          }}
        />
      )}

      {/* Modal excluir */}
      <Dialog open={!!delOp} onOpenChange={(v) => !v && setDelOp(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir operação</DialogTitle>
            <DialogDescription>
              Deseja excluir esta operação da engenharia fixa da peça cadastrada?
              <br />
              <span className="mt-2 block text-xs">{AVISO_EDICAO}</span>
            </DialogDescription>
          </DialogHeader>
          {delOp && (
            <div className="rounded border border-border bg-surface-2 p-2 text-xs font-mono">
              {delOp.tipo_operacao} · Face {String(delOp.face ?? "—")}
              {delOp.tipo_operacao === "furo" && ` · X${fmt(delOp.x)} Y${fmt(delOp.y)} Ø${fmt(delOp.diametro)}`}
              {delOp.tipo_operacao === "rasgo" && ` · Y${fmt(delOp.y)} X1${fmt(delOp.x1)}→X2${fmt(delOp.x2)}`}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelOp(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (delOp && onDeleteOperacao) {
                  await onDeleteOperacao(delOp.id);
                  if (opSel === delOp.id) setOpSel(null);
                }
                setDelOp(null);
              }}
            >
              <Trash2 className="mr-1 h-3 w-3" /> Excluir definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GrupoOperacoesFace({
  titulo,
  ops,
  opSel,
  setOpSel,
  contornosExternosIds,
}: {
  titulo: string;
  ops: VisualizadorOperacao[];
  opSel: string | null;
  setOpSel: (id: string) => void;
  contornosExternosIds?: Set<string>;
}) {
  if (ops.length === 0) return null;
  return (
    <section className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo} ({ops.length})
      </div>
      {ops.map((o, i) => {
        const ativo = o.id === opSel;
        const pontos = o.pontos_json ?? [];
        return (
          <button
            key={o.id}
            onClick={() => setOpSel(o.id)}
            className={`w-full rounded border px-2 py-1 text-left text-[11px] transition ${
              ativo ? "border-primary bg-primary/10" : "border-border bg-surface-2 hover:bg-surface-2/80"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono">
                {o.tipo_operacao === "furo"
                  ? `Furo #${i + 1}`
                  : o.tipo_operacao === "rasgo"
                  ? `Rasgo #${i + 1}`
                  : (o.nome_operacao ?? `Usinagem #${i + 1}`)}
              </span>
              <Badge variant="outline" className="h-4 px-1 text-[9px]">#{o.ordem}</Badge>
            </div>
            {contornosExternosIds?.has(o.id) && (
              <div className="mt-1 inline-flex rounded border border-primary/40 bg-primary/10 px-1 py-0.5 text-[9px] font-semibold text-primary">
                Contorno externo
              </div>
            )}
            <div className="mt-0.5 space-y-0.5 font-mono text-[10px] text-muted-foreground">
              {o.tipo_operacao === "furo" && (
                <div>X {fmt(o.x)} | Y {fmt(o.y)} | Ø{fmt(o.diametro)} | Prof {fmt(o.profundidade)}</div>
              )}
              {o.tipo_operacao === "rasgo" && (
                <div>Y {fmt(o.y)} | X1 {fmt(o.x1)} | X2 {fmt(o.x2)} | Larg {fmt(o.largura)} | Prof {fmt(o.profundidade)}</div>
              )}
              {ehUsinagem(o.tipo_operacao) && (
                <div>
                  {contornosExternosIds?.has(o.id) ? "Tipo: Contorno externo | " : ""}
                  {pontos.length > 0 ? `Pontos: ${pontos.length}` : `X ${fmt(o.x)} | Y ${fmt(o.y)}`}
                  {contornosExternosIds?.has(o.id) ? " | Afeta geometria: Sim" : ""}
                  {o.profundidade != null ? ` | Prof ${o.profundidade}` : ""}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </section>
  );
}

function OperacaoDialog({
  open,
  onOpenChange,
  modo,
  face,
  faces,
  op,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  modo: "add" | "edit";
  face: string;
  faces: string[];
  op?: VisualizadorOperacao;
  onSubmit: (payload: NovaOperacaoPayload) => void | Promise<void>;
}) {
  const [faceSel, setFaceSel] = useState(face);
  const [tipo, setTipo] = useState<string>(op?.tipo_operacao ?? "furo");
  const [nome, setNome] = useState<string>(op?.nome_operacao ?? "");
  const [x, setX] = useState<string>(op?.x?.toString() ?? "");
  const [y, setY] = useState<string>(op?.y?.toString() ?? "");
  const [diametro, setDiametro] = useState<string>(op?.diametro?.toString() ?? "");
  const [profundidade, setProfundidade] = useState<string>(op?.profundidade?.toString() ?? "");
  const [x1, setX1] = useState<string>(op?.x1?.toString() ?? "");
  const [x2, setX2] = useState<string>(op?.x2?.toString() ?? "");
  const [largura, setLargura] = useState<string>(op?.largura?.toString() ?? "");
  const [comprimento, setComprimento] = useState<string>(op?.comprimento?.toString() ?? "");
  const [pontos, setPontos] = useState<Array<{ x: string; y: string; profundidade: string; tipo: string }>>([]);

  useEffect(() => {
    if (open) {
      setFaceSel(face);
      setTipo(op?.tipo_operacao ?? "furo");
      setNome(op?.nome_operacao ?? "");
      setX(op?.x?.toString() ?? "");
      setY(op?.y?.toString() ?? "");
      setDiametro(op?.diametro?.toString() ?? "");
      setProfundidade(op?.profundidade?.toString() ?? "");
      setX1(op?.x1?.toString() ?? "");
      setX2(op?.x2?.toString() ?? "");
      setLargura(op?.largura?.toString() ?? "");
      setComprimento(op?.comprimento?.toString() ?? "");
      setPontos(
        (op?.pontos_json ?? []).map((p) => ({
          x: p.x?.toString() ?? "",
          y: p.y?.toString() ?? "",
          profundidade: p.profundidade?.toString() ?? "",
          tipo: p.tipo ?? "",
        })),
      );
    }
  }, [open, face, op]);

  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const setPonto = (idx: number, key: "x" | "y" | "profundidade" | "tipo", value: string) => {
    setPontos((atuais) => atuais.map((p, i) => (i === idx ? { ...p, [key]: value } : p)));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {modo === "add" ? "Adicionar operação" : "Editar operação"} — Face {faceSel}
          </DialogTitle>
          <DialogDescription className="text-xs">{AVISO_EDICAO}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <Label className="mb-1 block text-xs">Face</Label>
            <Select value={faceSel} onValueChange={setFaceSel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {faces.map((f) => <SelectItem key={f} value={f}>Face {f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1 block text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="furo">Furação</SelectItem>
                <SelectItem value="rasgo">Rasgo</SelectItem>
                <SelectItem value="usinagem_parametrica">Usinagem</SelectItem>
                <SelectItem value="contorno">Contorno</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(ehUsinagem(tipo) || tipo === "outro") && (
            <div className="col-span-2">
              <Label className="mb-1 block text-xs">Nome da operação</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
          )}

          {tipo === "rasgo" ? (
            <>
              <div><Label className="mb-1 block text-xs">Y</Label><Input value={y} onChange={(e) => setY(e.target.value)} /></div>
              <div><Label className="mb-1 block text-xs">Largura</Label><Input value={largura} onChange={(e) => setLargura(e.target.value)} /></div>
              <div><Label className="mb-1 block text-xs">X1</Label><Input value={x1} onChange={(e) => setX1(e.target.value)} /></div>
              <div><Label className="mb-1 block text-xs">X2</Label><Input value={x2} onChange={(e) => setX2(e.target.value)} /></div>
              <div className="col-span-2"><Label className="mb-1 block text-xs">Profundidade</Label><Input value={profundidade} onChange={(e) => setProfundidade(e.target.value)} /></div>
            </>
          ) : (
            <>
              <div><Label className="mb-1 block text-xs">X</Label><Input value={x} onChange={(e) => setX(e.target.value)} /></div>
              <div><Label className="mb-1 block text-xs">Y</Label><Input value={y} onChange={(e) => setY(e.target.value)} /></div>
              {tipo === "furo" && (
                <div><Label className="mb-1 block text-xs">Diâmetro</Label><Input value={diametro} onChange={(e) => setDiametro(e.target.value)} /></div>
              )}
              <div><Label className="mb-1 block text-xs">Profundidade</Label><Input value={profundidade} onChange={(e) => setProfundidade(e.target.value)} /></div>
              {tipo !== "furo" && (
                <>
                  <div><Label className="mb-1 block text-xs">Largura</Label><Input value={largura} onChange={(e) => setLargura(e.target.value)} /></div>
                  <div><Label className="mb-1 block text-xs">Comprimento</Label><Input value={comprimento} onChange={(e) => setComprimento(e.target.value)} /></div>
                </>
              )}
              {ehUsinagem(tipo) && pontos.length > 0 && (
                <div className="col-span-2 rounded border border-border bg-surface-2 p-2">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Pontos do contorno
                  </div>
                  <div className="space-y-2">
                    {pontos.map((p, i) => (
                      <div key={i} className="grid grid-cols-[48px_1fr_1fr_1fr_1.5fr] items-end gap-2">
                        <div className="pb-2 text-[10px] font-mono text-muted-foreground">P{i + 1}</div>
                        <div><Label className="mb-1 block text-[10px]">X</Label><Input value={p.x} onChange={(e) => setPonto(i, "x", e.target.value)} /></div>
                        <div><Label className="mb-1 block text-[10px]">Y</Label><Input value={p.y} onChange={(e) => setPonto(i, "y", e.target.value)} /></div>
                        <div><Label className="mb-1 block text-[10px]">Prof</Label><Input value={p.profundidade} onChange={(e) => setPonto(i, "profundidade", e.target.value)} /></div>
                        <div><Label className="mb-1 block text-[10px]">Tipo</Label><Input value={p.tipo} onChange={(e) => setPonto(i, "tipo", e.target.value)} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() =>
              onSubmit({
                face: faceSel,
                tipo_operacao: tipo,
                nome_operacao: nome.trim() === "" ? null : nome,
                x: num(x),
                y: num(y),
                diametro: num(diametro),
                profundidade: num(profundidade),
                x1: num(x1),
                x2: num(x2),
                largura: num(largura),
                comprimento: num(comprimento),
                pontos_json: pontos.length > 0
                  ? pontos.map((p) => ({
                    x: num(p.x),
                    y: num(p.y),
                    profundidade: num(p.profundidade),
                    tipo: p.tipo.trim() === "" ? null : p.tipo,
                  }))
                  : op?.pontos_json ?? null,
              })
            }
          >
            {modo === "add" ? "Salvar operação" : "Salvar alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Linha({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}
