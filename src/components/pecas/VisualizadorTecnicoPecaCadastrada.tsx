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
  onAddOperacao?: (payload: NovaOperacaoPayload) => void | Promise<void>;
  onEditOperacao?: (payload: EditarOperacaoPayload) => void | Promise<void>;
  onDeleteOperacao?: (id: string) => void | Promise<void>;
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

function ehContornoExterno(op: VisualizadorOperacao, W: number, H: number): boolean {
  if (!ehUsinagem(op.tipo_operacao)) return false;
  const nome = (op.nome_operacao ?? "").toLowerCase();
  const pts = pontosValidosDaOp(op);
  if (pts.length < 2) return false;
  const tocaBorda = pts.some((p) => edgeOf(p, W, H) !== null);
  const nomeIndica = nome.includes("contorno") || nome.includes("recorte") || nome.includes("rebaixo");
  return tocaBorda || nomeIndica;
}

/**
 * Constrói o contorno real da peça a partir do retângulo base + entalhes (notches)
 * cujos pontos inicial e final tocam a mesma borda da peça.
 * Retorna pontos em coordenadas REAIS (Y para cima).
 */
function buildPiecePolygon(W: number, H: number, notches: Pt[][]): Pt[] {
  const byEdge: Record<"bottom" | "right" | "top" | "left", { order: number; pts: Pt[] }[]> = {
    bottom: [], right: [], top: [], left: [],
  };
  for (const raw of notches) {
    if (raw.length < 2) continue;
    const a = raw[0];
    const b = raw[raw.length - 1];
    const ea = edgeOf(a, W, H);
    const eb = edgeOf(b, W, H);
    if (!ea || ea !== eb) continue;
    let pts = raw.slice();
    if (ea === "bottom") {
      if (a.x > b.x) pts = pts.reverse();
      byEdge.bottom.push({ order: pts[0].x, pts });
    } else if (ea === "right") {
      if (a.y > b.y) pts = pts.reverse();
      byEdge.right.push({ order: pts[0].y, pts });
    } else if (ea === "top") {
      if (a.x < b.x) pts = pts.reverse();
      byEdge.top.push({ order: -pts[0].x, pts });
    } else {
      if (a.y < b.y) pts = pts.reverse();
      byEdge.left.push({ order: -pts[0].y, pts });
    }
  }
  (Object.keys(byEdge) as Array<keyof typeof byEdge>).forEach((k) =>
    byEdge[k].sort((x, y) => x.order - y.order),
  );
  const out: Pt[] = [];
  out.push({ x: 0, y: 0 });
  byEdge.bottom.forEach((n) => out.push(...n.pts));
  out.push({ x: W, y: 0 });
  byEdge.right.forEach((n) => out.push(...n.pts));
  out.push({ x: W, y: H });
  byEdge.top.forEach((n) => out.push(...n.pts));
  out.push({ x: 0, y: H });
  byEdge.left.forEach((n) => out.push(...n.pts));
  return out;
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
  onAddOperacao,
  onEditOperacao,
  onDeleteOperacao,
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
  const fontCota = px(14);
  const fontGrid = px(10);
  const fontOp = px(11);

  const alertasOp = (o: VisualizadorOperacao) => {
    const a: string[] = [];
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
              {/* Grade */}
              <g stroke="var(--color-grid-strong)" strokeWidth={px(0.5)}>
                {Array.from({ length: Math.floor(partW / 50) + 1 }, (_, i) => i * 50).map((x) => (
                  <g key={`gx${x}`}>
                    <line x1={margin + x} y1={margin} x2={margin + x} y2={margin + partH} />
                    <text
                      x={margin + x}
                      y={margin - px(6)}
                      fontSize={fontGrid}
                      fill="var(--color-muted-foreground)"
                      textAnchor="middle"
                    >
                      {x}
                    </text>
                  </g>
                ))}
                {Array.from({ length: Math.floor(partH / 50) + 1 }, (_, i) => i * 50).map((y) => (
                  <g key={`gy${y}`}>
                    <line x1={margin} y1={margin + y} x2={margin + partW} y2={margin + y} />
                    <text
                      x={margin - px(6)}
                      y={margin + y + px(3)}
                      fontSize={fontGrid}
                      fill="var(--color-muted-foreground)"
                      textAnchor="end"
                    >
                      {y}
                    </text>
                  </g>
                ))}
              </g>

              {/* Peça */}
              <rect
                x={margin}
                y={margin}
                width={partW}
                height={partH}
                fill="var(--color-surface)"
                stroke="var(--color-foreground)"
                strokeWidth={px(1.5)}
              />

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
                  const d = pts
                    .map((p, i) => `${i === 0 ? "M" : "L"} ${margin + p.x!} ${margin + partH - p.y!}`)
                    .join(" ");
                  return (
                    <g key={op.id} onClick={(e) => { e.stopPropagation(); setOpSel(op.id); }} style={{ cursor: "pointer" }}>
                      <path
                        d={d + (pts.length > 2 ? " Z" : "")}
                        fill={sel ? "color-mix(in oklab, var(--color-primary) 15%, transparent)" : "none"}
                        stroke={sel ? "var(--color-primary)" : "var(--color-accent)"}
                        strokeWidth={sel ? px(2.5) : px(1.8)}
                      />
                      {pts.map((p, i) => (
                        <circle
                          key={i}
                          cx={margin + p.x!}
                          cy={margin + partH - p.y!}
                          r={px(3)}
                          fill={sel ? "var(--color-primary)" : "var(--color-foreground)"}
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
            <GrupoOperacoesFace titulo="Usinagens" ops={usinagensFace} opSel={opSel} setOpSel={setOpSel} />
            <GrupoOperacoesFace titulo="Outras" ops={outrasFace} opSel={opSel} setOpSel={setOpSel} />
          </div>
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
                    <Linha k="Tipo" v={opSelObj.tipo_operacao} />
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
}: {
  titulo: string;
  ops: VisualizadorOperacao[];
  opSel: string | null;
  setOpSel: (id: string) => void;
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
            <div className="mt-0.5 space-y-0.5 font-mono text-[10px] text-muted-foreground">
              {o.tipo_operacao === "furo" && (
                <div>X {fmt(o.x)} | Y {fmt(o.y)} | Ø{fmt(o.diametro)} | Prof {fmt(o.profundidade)}</div>
              )}
              {o.tipo_operacao === "rasgo" && (
                <div>Y {fmt(o.y)} | X1 {fmt(o.x1)} | X2 {fmt(o.x2)} | Larg {fmt(o.largura)} | Prof {fmt(o.profundidade)}</div>
              )}
              {ehUsinagem(o.tipo_operacao) && (
                <div>
                  {pontos.length > 0 ? `${pontos.length} pontos` : `X ${fmt(o.x)} | Y ${fmt(o.y)}`}
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
    }
  }, [open, face, op]);

  const num = (s: string) => (s.trim() === "" ? null : Number(s));

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
