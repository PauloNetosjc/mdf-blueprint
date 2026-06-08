// Fase 3B — Visualizador da peça do projeto.
//
// Desenha a peça nas medidas REAIS do projeto usando as operações já
// recalculadas e salvas em `projeto_pecas.dados_tecnicos_aplicados_json`.
//
// Fontes da verdade:
//   - projeto_pecas.dados_tecnicos_aplicados_json  (operações aplicadas)
//   - projeto_pecas.largura / altura / espessura   (medidas reais)
//
// NÃO lê diretamente `pecas_cadastradas.modelo_tecnico_json` para desenhar a
// peça do projeto — a biblioteca é a receita base; a peça do projeto usa a
// cópia aplicada. O modelo base só é consultado para a opção "Reaplicar".

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, XCircle, Info, RefreshCcw } from "lucide-react";
import {
  aplicarModeloTecnicoNaPecaProjeto,
  type StatusTecnico,
  type ResultadoAplicacao,
} from "@/lib/aplicar-modelo-projeto";
import type { ModeloTecnicoJson, OperacaoModelo } from "@/lib/peca-modelo-tecnico";
import { pontoDentroOuNaBordaDoPoligono } from "@/lib/geometria-poligono";

type DadosAplicados = {
  origem?: string;
  peca_cadastrada_id?: string | null;
  codigo_modelo?: string | null;
  medidas_base?: { largura: number; altura: number; espessura: number } | null;
  medidas_projeto?: { largura: number; altura: number; espessura: number };
  operacoes_recalculadas?: OperacaoModelo[];
  alertas?: { ordem: number; face: string; tipo: string; motivo: string }[];
  erros?: { ordem: number; face: string; tipo: string; motivo: string; ponto?: { x: number; y: number } }[];
  aplicado_em?: string;
};

type PecaProjeto = {
  id: string;
  descricao: string;
  codigo: string | null;
  largura: number;
  altura: number;
  espessura: number;
  status_tecnico: StatusTecnico | null;
  peca_cadastrada_id: string | null;
  dados_tecnicos_aplicados_json: DadosAplicados | null;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  peca: PecaProjeto;
  onPersist?: (resultado: ResultadoAplicacao) => Promise<void> | void;
};

export function VisualizadorPecaProjetoDialog({ open, onOpenChange, peca, onPersist }: Props) {
  const dados = peca.dados_tecnicos_aplicados_json ?? null;
  const operacoes = (dados?.operacoes_recalculadas ?? []) as OperacaoModelo[];
  const erros = dados?.erros ?? [];
  const alertas = dados?.alertas ?? [];

  const facesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const op of operacoes) set.add(String(op.face));
    return Array.from(set).sort();
  }, [operacoes]);

  const [faceSel, setFaceSel] = useState<string>("0");
  const faceAtiva = facesDisponiveis.includes(faceSel)
    ? faceSel
    : facesDisponiveis[0] ?? "0";

  // Modelo base (apenas para "Reaplicar")
  const { data: pecaCad } = useQuery({
    enabled: open && !!peca.peca_cadastrada_id,
    queryKey: ["peca-cad-modelo-base", peca.peca_cadastrada_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pecas_cadastradas")
        .select("id, largura_ref, altura_ref, espessura_ref, dados_brutos_json")
        .eq("id", peca.peca_cadastrada_id!)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const modeloBase = (pecaCad?.dados_brutos_json as any)?.modelo_tecnico_json as ModeloTecnicoJson | undefined;

  const [reaplicando, setReaplicando] = useState(false);
  async function reaplicar() {
    if (!modeloBase || !onPersist) return;
    setReaplicando(true);
    try {
      const res = aplicarModeloTecnicoNaPecaProjeto(modeloBase, {
        largura: peca.largura,
        altura: peca.altura,
        espessura: peca.espessura,
      });
      await onPersist(res);
    } finally {
      setReaplicando(false);
    }
  }

  const requerManual =
    (modeloBase?.geometria as any)?.requer_cadastro_manual === true ||
    (modeloBase?.geometria as any)?.tipo === "poligono_complexo";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Visualizar técnica aplicada
            <BadgeStatus status={peca.status_tecnico ?? "nao_aplicado"} />
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{peca.codigo ?? "—"}</span> · {peca.descricao}
          </DialogDescription>
        </DialogHeader>

        {/* Comparação medidas */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded border border-border bg-surface-2 p-2">
            <div className="mb-1 font-semibold text-muted-foreground">Medidas base (biblioteca)</div>
            <div className="font-mono">
              {dados?.medidas_base
                ? `${dados.medidas_base.largura} × ${dados.medidas_base.altura} × ${dados.medidas_base.espessura}`
                : "—"}
            </div>
          </div>
          <div className="rounded border border-primary/30 bg-primary/5 p-2">
            <div className="mb-1 font-semibold text-primary">Medidas reais (projeto)</div>
            <div className="font-mono">
              {peca.largura} × {peca.altura} × {peca.espessura}
            </div>
          </div>
        </div>

        {requerManual && (
          <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
            <span>Geometria complexa/manual. Visualização técnica aplicada pode exigir conferência.</span>
          </div>
        )}

        {/* Seletor de face */}
        {facesDisponiveis.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="mr-1 text-muted-foreground">Face:</span>
            {facesDisponiveis.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFaceSel(f)}
                className={`rounded border px-2 py-0.5 ${
                  f === faceAtiva
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface hover:bg-surface-2"
                }`}
              >
                F{f}
              </button>
            ))}
          </div>
        )}

        {/* Desenho */}
        <DesenhoPeca
          largura={peca.largura}
          altura={peca.altura}
          operacoes={operacoes.filter((o) => String(o.face) === faceAtiva)}
          erros={erros.filter((e) => e.face === faceAtiva)}
        />

        {/* Alertas e erros */}
        {alertas.length > 0 && (
          <div className="rounded border border-warning/30 bg-warning/5 p-2 text-xs">
            <div className="mb-1 flex items-center gap-1 font-semibold text-warning">
              <AlertTriangle className="h-3.5 w-3.5" /> Alertas ({alertas.length})
            </div>
            <ul className="ml-5 list-disc space-y-0.5 text-warning/90">
              {alertas.map((a, i) => (
                <li key={i}>
                  <span className="font-mono text-[10px]">[F{a.face}] {a.tipo}</span> — {a.motivo}
                </li>
              ))}
            </ul>
          </div>
        )}

        {erros.length > 0 && (
          <div className="rounded border border-destructive/30 bg-destructive/5 p-2 text-xs">
            <div className="mb-1 flex items-center gap-1 font-semibold text-destructive">
              <XCircle className="h-3.5 w-3.5" /> Erros ({erros.length})
            </div>
            <ul className="ml-5 list-disc space-y-0.5 text-destructive/90">
              {erros.map((e, i) => (
                <li key={i}>
                  <span className="font-mono text-[10px]">[F{e.face}] {e.tipo} #{e.ordem}</span> — {e.motivo}
                  {e.ponto && (
                    <span className="ml-1 font-mono text-[10px]">@ ({e.ponto.x}, {e.ponto.y})</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Tabela */}
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left">Op</th>
                <th className="px-2 py-1.5 text-left">Face</th>
                <th className="px-2 py-1.5 text-left">Tipo</th>
                <th className="px-2 py-1.5 text-right">X apl.</th>
                <th className="px-2 py-1.5 text-right">Y apl.</th>
                <th className="px-2 py-1.5 text-right">X1/X2</th>
                <th className="px-2 py-1.5 text-right">Y1/Y2</th>
                <th className="px-2 py-1.5 text-right">Ø</th>
                <th className="px-2 py-1.5 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {operacoes.map((op, idx) => {
                const ordem = op.ordem ?? idx + 1;
                const erro = erros.find((e) => e.ordem === ordem && e.face === String(op.face));
                return (
                  <tr
                    key={idx}
                    className={`border-t border-border ${erro ? "bg-destructive/5" : ""}`}
                  >
                    <td className="px-2 py-1 font-mono">{ordem}</td>
                    <td className="px-2 py-1">F{String(op.face)}</td>
                    <td className="px-2 py-1">{op.tipo}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(op.x)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(op.y)}</td>
                    <td className="px-2 py-1 text-right font-mono">
                      {op.x1 != null || op.x2 != null ? `${fmt(op.x1)} / ${fmt(op.x2)}` : "—"}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {op.y1 != null || op.y2 != null ? `${fmt(op.y1)} / ${fmt(op.y2)}` : "—"}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(op.diametro)}</td>
                    <td className="px-2 py-1">
                      {erro ? (
                        <span className="inline-flex items-center gap-1 text-destructive" title={erro.motivo}>
                          <XCircle className="h-3 w-3" /> erro
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-success">
                          <CheckCircle2 className="h-3 w-3" /> ok
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {operacoes.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2 py-4 text-center text-muted-foreground">
                    Sem operações aplicadas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Fechar</Button>
          {onPersist && peca.peca_cadastrada_id && (
            <Button onClick={reaplicar} disabled={!modeloBase || reaplicando}>
              <RefreshCcw className={`mr-1 h-3.5 w-3.5 ${reaplicando ? "animate-spin" : ""}`} />
              {reaplicando ? "Reaplicando..." : "Reaplicar modelo"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Desenho SVG ----------

function DesenhoPeca({
  largura,
  altura,
  operacoes,
  erros,
}: {
  largura: number;
  altura: number;
  operacoes: OperacaoModelo[];
  erros: { ordem: number; face: string }[];
}) {
  const padding = 40;
  const maxW = 760;
  const maxH = 420;
  const scale = Math.min((maxW - padding * 2) / largura, (maxH - padding * 2) / altura);
  const w = largura * scale + padding * 2;
  const h = altura * scale + padding * 2;

  // helpers (Y invertido — origem CNC em baixo-esquerda)
  const sx = (x: number) => padding + x * scale;
  const sy = (y: number) => padding + (altura - y) * scale;

  const contorno: Array<{ x: number; y: number }> = [
    { x: 0, y: 0 },
    { x: largura, y: 0 },
    { x: largura, y: altura },
    { x: 0, y: altura },
  ];

  function opTemErro(op: OperacaoModelo, idx: number): boolean {
    const ord = op.ordem ?? idx + 1;
    if (erros.some((e) => e.ordem === ord)) return true;
    // double check geométrico
    if (op.x != null && op.y != null) {
      if (!pontoDentroOuNaBordaDoPoligono({ x: op.x, y: op.y }, contorno)) return true;
    }
    return false;
  }

  return (
    <div className="overflow-auto rounded border border-border bg-surface-2/30">
      <svg width={w} height={h} className="block">
        {/* contorno */}
        <rect
          x={padding}
          y={padding}
          width={largura * scale}
          height={altura * scale}
          fill="hsl(var(--surface))"
          stroke="hsl(var(--border))"
          strokeWidth={1.5}
        />
        {/* cotas */}
        <text x={padding + (largura * scale) / 2} y={padding - 10} textAnchor="middle" className="fill-muted-foreground" fontSize={11}>
          {largura} mm
        </text>
        <text
          x={padding - 10}
          y={padding + (altura * scale) / 2}
          textAnchor="middle"
          transform={`rotate(-90 ${padding - 10} ${padding + (altura * scale) / 2})`}
          className="fill-muted-foreground"
          fontSize={11}
        >
          {altura} mm
        </text>
        {/* origem */}
        <circle cx={sx(0)} cy={sy(0)} r={3} className="fill-primary" />
        <text x={sx(0) + 6} y={sy(0) - 4} className="fill-primary" fontSize={9}>0,0</text>

        {/* operações */}
        {operacoes.map((op, idx) => {
          const erro = opTemErro(op, idx);
          const cor = erro ? "hsl(var(--destructive))" : "hsl(var(--primary))";

          // Rasgo horizontal
          if (op.x1 != null && op.x2 != null && op.y != null) {
            const larg = op.largura ?? 5;
            const x1 = sx(Math.min(op.x1, op.x2));
            const x2 = sx(Math.max(op.x1, op.x2));
            const yC = sy(op.y);
            const hPix = Math.max(2, larg * scale);
            return (
              <g key={idx}>
                <rect
                  x={x1}
                  y={yC - hPix / 2}
                  width={x2 - x1}
                  height={hPix}
                  fill={erro ? "hsl(var(--destructive) / 0.3)" : "hsl(var(--primary) / 0.3)"}
                  stroke={cor}
                  strokeWidth={1}
                />
              </g>
            );
          }
          // Rasgo vertical
          if (op.y1 != null && op.y2 != null && op.x != null) {
            const larg = op.largura ?? 5;
            const yT = sy(Math.max(op.y1, op.y2));
            const yB = sy(Math.min(op.y1, op.y2));
            const xC = sx(op.x);
            const wPix = Math.max(2, larg * scale);
            return (
              <g key={idx}>
                <rect
                  x={xC - wPix / 2}
                  y={yT}
                  width={wPix}
                  height={yB - yT}
                  fill={erro ? "hsl(var(--destructive) / 0.3)" : "hsl(var(--primary) / 0.3)"}
                  stroke={cor}
                  strokeWidth={1}
                />
              </g>
            );
          }
          // Furo pontual
          if (op.x != null && op.y != null) {
            const d = op.diametro ?? 8;
            const r = Math.max(2.5, (d / 2) * scale);
            return (
              <g key={idx}>
                <circle
                  cx={sx(op.x)}
                  cy={sy(op.y)}
                  r={r}
                  fill={erro ? "hsl(var(--destructive) / 0.2)" : "hsl(var(--primary) / 0.2)"}
                  stroke={cor}
                  strokeWidth={1.2}
                />
                <text
                  x={sx(op.x) + r + 2}
                  y={sy(op.y) - r - 2}
                  className="fill-muted-foreground"
                  fontSize={9}
                >
                  {op.ordem ?? idx + 1}
                </text>
              </g>
            );
          }
          return null;
        })}
      </svg>
    </div>
  );
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return (Math.round(n * 100) / 100).toString();
}

function BadgeStatus({ status }: { status: StatusTecnico }) {
  const map: Record<StatusTecnico, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
    nao_aplicado: { label: "Não aplicado", cls: "bg-muted text-muted-foreground", Icon: Info },
    aplicado_ok: { label: "Aplicado OK", cls: "bg-success/10 text-success", Icon: CheckCircle2 },
    aplicado_com_alerta: { label: "Aplicado c/ alerta", cls: "bg-warning/10 text-warning", Icon: AlertTriangle },
    aplicado_com_erro: { label: "Aplicado c/ erro", cls: "bg-destructive/10 text-destructive", Icon: XCircle },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${m.cls}`}>
      <m.Icon className="h-3 w-3" /> {m.label}
    </span>
  );
}
