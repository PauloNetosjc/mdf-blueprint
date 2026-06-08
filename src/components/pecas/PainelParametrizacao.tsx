// Painel "Parametrização" — Fase 2 da Biblioteca Técnica Paramétrica.
//
// - Toggle "Medida base do cadastro" / "Simular nova medida".
// - Inputs de largura/altura/espessura simuladas (não persiste).
// - SVG simples mostrando o contorno + operações (vermelho = fora).
// - Tabela de operações com X/Y base, âncoras, distâncias e X/Y calculados.
// - Edição manual de âncora/distância por linha → grava no
//   `dados_brutos_json.modelo_tecnico_json` da peça.

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, RotateCcw, AlertTriangle, Sparkles, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ModeloTecnicoJson, OperacaoModelo, Parametrico } from "@/lib/peca-modelo-tecnico";
import {
  aplicarParametrizacao,
  recalcularModeloParaMedidas,
  type AncoraX,
  type AncoraY,
} from "@/lib/parametrizacao-pecas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Props = {
  pecaId: string;
  modelo: ModeloTecnicoJson | null;
};

const ANCORAS_X: AncoraX[] = ["esquerda", "direita", "centro", "percentual", "absoluto"];
const ANCORAS_Y: AncoraY[] = ["inferior", "superior", "centro", "percentual", "absoluto"];

function pontoDentro(p: { x: number; y: number }, poly: { x: number; y: number }[], tol = 0.5): boolean {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) dentro = !dentro;
    const dx = xj - xi, dy = yj - yi;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - xi) * dx + (p.y - yi) * dy) / len2));
    const px = xi + t * dx, py = yi + t * dy;
    if ((p.x - px) ** 2 + (p.y - py) ** 2 <= tol * tol) return true;
  }
  return dentro;
}

export function PainelParametrizacao({ pecaId, modelo }: Props) {
  const qc = useQueryClient();
  const [modo, setModo] = useState<"base" | "simular">("base");
  const [simL, setSimL] = useState<string>("");
  const [simH, setSimH] = useState<string>("");
  const [simE, setSimE] = useState<string>("");
  const [editandoOrdem, setEditandoOrdem] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<Parametrico>>({});

  const baseLargura = modelo?.medidas?.largura ?? 0;
  const baseAltura = modelo?.medidas?.altura ?? 0;
  const baseEspessura = modelo?.medidas?.espessura ?? 0;

  // Inicializa inputs de simulação quando entrar no modo
  function entrarSimular() {
    setSimL(String(baseLargura || ""));
    setSimH(String(baseAltura || ""));
    setSimE(String(baseEspessura || ""));
    setModo("simular");
  }

  const medidasAtuais = useMemo(() => {
    if (modo === "base") {
      return { largura: baseLargura, altura: baseAltura, espessura: baseEspessura };
    }
    return {
      largura: Number(simL) || baseLargura,
      altura: Number(simH) || baseAltura,
      espessura: Number(simE) || baseEspessura,
    };
  }, [modo, simL, simH, simE, baseLargura, baseAltura, baseEspessura]);

  const recalculo = useMemo(() => {
    if (!modelo) return null;
    return recalcularModeloParaMedidas(modelo, medidasAtuais);
  }, [modelo, medidasAtuais]);

  const polyAtual = recalculo?.modelo.geometria?.pontos_contorno ?? [];
  const L = medidasAtuais.largura || 1;
  const H = medidasAtuais.altura || 1;

  const salvarAncora = useMutation({
    mutationFn: async (args: { ordem: number; parametrico: Parametrico }) => {
      if (!modelo) throw new Error("Modelo técnico não disponível.");
      const { data: peca, error } = await db
        .from("pecas_cadastradas")
        .select("dados_brutos_json")
        .eq("id", pecaId)
        .single();
      if (error) throw error;
      const dados = (peca.dados_brutos_json ?? {}) as Record<string, unknown>;
      const m = (dados.modelo_tecnico_json ?? null) as ModeloTecnicoJson | null;
      if (!m) throw new Error("Modelo técnico ausente no banco.");
      const ops = (m.operacoes ?? []).map((o) =>
        (o.ordem ?? 0) === args.ordem
          ? { ...o, parametrico: { ...args.parametrico, editado_manualmente: true } }
          : o,
      );
      const novoModelo = { ...m, operacoes: ops };
      const { error: eUp } = await db
        .from("pecas_cadastradas")
        .update({ dados_brutos_json: { ...dados, modelo_tecnico_json: novoModelo } })
        .eq("id", pecaId);
      if (eUp) throw eUp;
    },
    onSuccess: () => {
      toast.success("Âncora atualizada.");
      setEditandoOrdem(null);
      qc.invalidateQueries({ queryKey: ["peca-cadastrada", pecaId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!modelo) {
    return (
      <div className="rounded border border-border bg-surface p-4 text-sm text-muted-foreground">
        Modelo técnico ainda não foi construído. Reprocesse o parser para gerar a parametrização.
      </div>
    );
  }

  const semParam = (modelo.operacoes ?? []).filter((o) => !o.parametrico).length;
  const operacoesRec = recalculo?.modelo.operacoes ?? modelo.operacoes ?? [];

  // Escala SVG
  const VBW = L;
  const VBH = H;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface p-3">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Parametrização — Âncoras aos topos
          </h3>
          <p className="text-xs text-muted-foreground">
            Cada operação guarda sua distância em relação a um topo. A peça
            mantém o alinhamento mesmo quando muda de tamanho.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {modelo.parametrizacao ? (
            <Badge variant="outline" className="font-mono text-[11px]">
              base {modelo.parametrizacao.largura_base}×{modelo.parametrizacao.altura_base}×{modelo.parametrizacao.espessura_base}
            </Badge>
          ) : (
            <Badge variant="destructive">sem parametrização</Badge>
          )}
          {semParam > 0 && (
            <Badge variant="secondary" className="text-[11px]">
              {semParam} op. sem âncora
            </Badge>
          )}
          {modo === "simular" && (
            <Badge className="bg-amber-500/80 text-amber-50">Simulado</Badge>
          )}
        </div>
      </header>

      {/* Toggle */}
      <div className="flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <Button
            variant={modo === "base" ? "default" : "outline"}
            size="sm"
            onClick={() => setModo("base")}
          >
            Medida base do cadastro
          </Button>
          <Button
            variant={modo === "simular" ? "default" : "outline"}
            size="sm"
            onClick={entrarSimular}
          >
            Simular nova medida
          </Button>
          {modo === "simular" && (
            <Button variant="ghost" size="sm" onClick={() => setModo("base")}>
              <RotateCcw className="mr-1 h-3 w-3" /> Voltar à base
            </Button>
          )}
        </div>
        {modo === "simular" && (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-[10px]">Largura</Label>
              <Input
                type="number"
                step="0.5"
                value={simL}
                onChange={(e) => setSimL(e.target.value)}
                className="h-8 w-24"
              />
            </div>
            <div>
              <Label className="text-[10px]">Altura</Label>
              <Input
                type="number"
                step="0.5"
                value={simH}
                onChange={(e) => setSimH(e.target.value)}
                className="h-8 w-24"
              />
            </div>
            <div>
              <Label className="text-[10px]">Espessura</Label>
              <Input
                type="number"
                step="0.5"
                value={simE}
                onChange={(e) => setSimE(e.target.value)}
                className="h-8 w-24"
              />
            </div>
          </div>
        )}
      </div>

      {/* Prévia SVG */}
      <div className="rounded border border-border bg-surface p-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Prévia ({medidasAtuais.largura} × {medidasAtuais.altura} mm)
        </div>
        <div className="overflow-auto">
          <svg
            viewBox={`-20 -20 ${VBW + 40} ${VBH + 40}`}
            style={{ width: "100%", maxHeight: 460, transform: "scaleY(-1)", transformOrigin: "center" }}
            className="bg-background"
          >
            {polyAtual.length >= 3 && (
              <polygon
                points={polyAtual.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="hsl(var(--muted) / 0.3)"
                stroke="hsl(var(--foreground))"
                strokeWidth={Math.max(1, L / 400)}
              />
            )}
            {operacoesRec.map((op, i) => {
              const pts: { x: number; y: number }[] = [];
              if (op.x != null && op.y != null) pts.push({ x: op.x, y: op.y });
              if (op.x1 != null && op.x2 != null && op.y != null)
                pts.push({ x: op.x1, y: op.y }, { x: op.x2, y: op.y });
              if (op.y1 != null && op.y2 != null && op.x != null)
                pts.push({ x: op.x, y: op.y1 }, { x: op.x, y: op.y2 });
              const fora =
                polyAtual.length >= 3 && pts.some((p) => !pontoDentro(p, polyAtual, 1));
              const cor = fora ? "hsl(var(--destructive))" : "hsl(var(--primary))";
              const r = Math.max(2, L / 200);
              if (op.tipo === "rasgo" && op.x1 != null && op.x2 != null && op.y != null) {
                return (
                  <line
                    key={i}
                    x1={op.x1}
                    y1={op.y}
                    x2={op.x2}
                    y2={op.y}
                    stroke={cor}
                    strokeWidth={Math.max(2, (op.largura ?? 8) / 2)}
                    strokeLinecap="round"
                    opacity={0.85}
                  />
                );
              }
              return pts.map((p, k) => (
                <circle key={`${i}-${k}`} cx={p.x} cy={p.y} r={r} fill={cor} />
              ));
            })}
          </svg>
        </div>
      </div>

      {/* Tabela de operações */}
      <div className="rounded border border-border bg-surface">
        <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Operações ({operacoesRec.length})
        </div>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-2 py-1 text-left">#</th>
                <th className="px-2 py-1 text-left">Face</th>
                <th className="px-2 py-1 text-left">Tipo</th>
                <th className="px-2 py-1 text-right">X base</th>
                <th className="px-2 py-1 text-left">Âncora X</th>
                <th className="px-2 py-1 text-right">Dist X</th>
                <th className="px-2 py-1 text-right">Y base</th>
                <th className="px-2 py-1 text-left">Âncora Y</th>
                <th className="px-2 py-1 text-right">Dist Y</th>
                <th className="px-2 py-1 text-right">X calc</th>
                <th className="px-2 py-1 text-right">Y calc</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {(modelo.operacoes ?? []).map((op) => {
                const ordem = op.ordem ?? 0;
                const p = op.parametrico as Parametrico | undefined;
                const calc = aplicarParametrizacao(op, medidasAtuais.largura, medidasAtuais.altura);
                const emEdicao = editandoOrdem === ordem;
                return (
                  <tr key={ordem} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-2 py-1 font-mono">{ordem}</td>
                    <td className="px-2 py-1">{String(op.face)}</td>
                    <td className="px-2 py-1">
                      {op.tipo}
                      {p?.editado_manualmente && (
                        <Badge variant="outline" className="ml-1 text-[9px]">manual</Badge>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(op.x)}</td>
                    <td className="px-2 py-1">
                      {emEdicao ? (
                        <Select
                          value={editForm.ancora_x ?? p?.ancora_x ?? "esquerda"}
                          onValueChange={(v) =>
                            setEditForm((f) => ({ ...f, ancora_x: v as AncoraX }))
                          }
                        >
                          <SelectTrigger className="h-7 w-28 text-[11px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ANCORAS_X.map((a) => (
                              <SelectItem key={a} value={a}>{a}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">{p?.ancora_x ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {emEdicao ? (
                        <Input
                          type="number"
                          step="0.1"
                          value={editForm.distancia_x ?? p?.distancia_x ?? 0}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, distancia_x: Number(e.target.value) }))
                          }
                          className="h-7 w-20 text-right text-[11px]"
                        />
                      ) : (
                        fmt(p?.distancia_x)
                      )}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(op.y)}</td>
                    <td className="px-2 py-1">
                      {emEdicao ? (
                        <Select
                          value={editForm.ancora_y ?? p?.ancora_y ?? "inferior"}
                          onValueChange={(v) =>
                            setEditForm((f) => ({ ...f, ancora_y: v as AncoraY }))
                          }
                        >
                          <SelectTrigger className="h-7 w-28 text-[11px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ANCORAS_Y.map((a) => (
                              <SelectItem key={a} value={a}>{a}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">{p?.ancora_y ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {emEdicao ? (
                        <Input
                          type="number"
                          step="0.1"
                          value={editForm.distancia_y ?? p?.distancia_y ?? 0}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, distancia_y: Number(e.target.value) }))
                          }
                          className="h-7 w-20 text-right text-[11px]"
                        />
                      ) : (
                        fmt(p?.distancia_y)
                      )}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-primary">{fmt(calc.x)}</td>
                    <td className="px-2 py-1 text-right font-mono text-primary">{fmt(calc.y)}</td>
                    <td className="px-2 py-1 text-right">
                      {emEdicao ? (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="default"
                            className="h-6 px-2 text-[10px]"
                            disabled={salvarAncora.isPending}
                            onClick={() => {
                              if (!p && (!editForm.ancora_x || !editForm.ancora_y)) {
                                toast.error("Defina âncoras e distâncias.");
                                return;
                              }
                              const merged: Parametrico = {
                                ancora_x: editForm.ancora_x ?? p?.ancora_x ?? "esquerda",
                                distancia_x: editForm.distancia_x ?? p?.distancia_x ?? 0,
                                ancora_y: editForm.ancora_y ?? p?.ancora_y ?? "inferior",
                                distancia_y: editForm.distancia_y ?? p?.distancia_y ?? 0,
                                regra_x: p?.regra_x ?? "ancora",
                                regra_y: p?.regra_y ?? "ancora",
                                largura_base:
                                  p?.largura_base ?? modelo.parametrizacao?.largura_base ?? baseLargura,
                                altura_base:
                                  p?.altura_base ?? modelo.parametrizacao?.altura_base ?? baseAltura,
                                ancora_x2: p?.ancora_x2,
                                distancia_x2: p?.distancia_x2,
                                ancora_y2: p?.ancora_y2,
                                distancia_y2: p?.distancia_y2,
                                editado_manualmente: true,
                              };
                              salvarAncora.mutate({ ordem, parametrico: merged });
                            }}
                          >
                            <Save className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => { setEditandoOrdem(null); setEditForm({}); }}
                          >
                            ✕
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => {
                            setEditandoOrdem(ordem);
                            setEditForm({});
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {recalculo && recalculo.alertas.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <div className="mb-1 flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" /> Alertas de recálculo
          </div>
          <ul className="ml-5 list-disc text-muted-foreground">
            {recalculo.alertas.slice(0, 8).map((a, i) => (
              <li key={i}>
                #{a.ordem} face {a.face} {a.tipo} — {a.motivo}
              </li>
            ))}
            {recalculo.alertas.length > 8 && (
              <li>… e mais {recalculo.alertas.length - 8}.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (Math.round(n * 100) / 100).toString();
}
