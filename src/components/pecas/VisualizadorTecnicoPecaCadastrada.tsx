import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Plus } from "lucide-react";

const FACES_PADRAO = ["0", "1", "2", "3", "4", "5"];

export type NovaOperacaoPayload = {
  face: string;
  tipo_operacao: string;
  x: number | null;
  y: number | null;
  diametro: number | null;
  profundidade: number | null;
  x1: number | null;
  x2: number | null;
  largura: number | null;
  comprimento: number | null;
};

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
};

const TIPO_USINAGEM = ["usinagem_parametrica", "contorno", "usinagem"];

function ehUsinagem(t: string) {
  return TIPO_USINAGEM.includes(t);
}

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
}: Props) {
  // Agrupa por face
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
    // Sempre mostrar as 6 faces padrão + qualquer outra detectada/com operações.
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
  const [zoom, setZoom] = useState(1);
  const [addOpen, setAddOpen] = useState(false);

  const opsFace = opsPorFace.get(faceSel) ?? [];
  const opSelObj = opsFace.find((o) => o.id === opSel) ?? null;

  // Dimensões da face. Sem mapeamento físico — usa L×A para face 0, e cai para L×Esp/A×Esp aproximado para faces topo.
  const { partW, partH } = useMemo(() => {
    const L = largura ?? 600;
    const A = altura ?? 400;
    const E = espessura ?? 18;
    if (faceSel === "0" || faceSel === "5") return { partW: L, partH: A };
    if (faceSel === "1" || faceSel === "2") return { partW: A, partH: E };
    return { partW: L, partH: E };
  }, [faceSel, largura, altura, espessura]);

  const margin = 60;
  const viewW = partW + margin * 2;
  const viewH = partH + margin * 2;

  // Alertas básicos
  const alertasOp = (o: VisualizadorOperacao) => {
    const a: string[] = [];
    if (o.x != null && (o.x < 0 || o.x > partW)) a.push("X fora da peça");
    if (o.y != null && (o.y < 0 || o.y > partH)) a.push("Y fora da peça");
    if (espessura != null && o.profundidade != null && o.profundidade > espessura)
      a.push("Profundidade > espessura");
    if (o.tipo_operacao === "furo" && o.diametro == null) a.push("Sem diâmetro");
    if (o.profundidade == null) a.push("Sem profundidade");
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

  return (
    <div className="grid gap-3 lg:grid-cols-[200px_1fr_280px]">
      {/* Painel esquerdo: faces */}
      <aside className="rounded border border-border bg-surface p-2">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Faces
        </h3>
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
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Bordas / Fitas
            </h3>
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
      <div className="flex min-h-[520px] flex-col rounded border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-2 text-xs">
          <span className="font-mono text-muted-foreground">
            {codigo} — Face {faceSel} — {partW} × {partH} mm
          </span>
          <span className="text-muted-foreground">
            {tipo ?? ""} {nome ? `• ${nome}` : ""}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-7" onClick={() => setZoom((z) => z * 1.25)}>
              +
            </Button>
            <span className="w-12 text-center font-mono text-[10px]">{(zoom * 100).toFixed(0)}%</span>
            <Button size="sm" variant="outline" className="h-7" onClick={() => setZoom((z) => z / 1.25)}>
              −
            </Button>
            <Button size="sm" variant="outline" className="h-7" onClick={() => setZoom(1)}>
              Ajustar
            </Button>
          </div>
        </div>

        <div className="cad-grid relative flex-1 overflow-auto bg-surface-2">
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${viewW} ${viewH}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
          >
            {/* Grade */}
            <g stroke="var(--color-grid-strong)" strokeWidth={0.3}>
              {Array.from({ length: Math.floor(partW / 50) + 1 }, (_, i) => i * 50).map((x) => (
                <g key={`gx${x}`}>
                  <line x1={margin + x} y1={margin} x2={margin + x} y2={margin + partH} />
                  <text
                    x={margin + x}
                    y={margin - 6}
                    fontSize={5}
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
                    x={margin - 6}
                    y={margin + y + 2}
                    fontSize={5}
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
              strokeWidth={0.8}
            />

            {/* Indicador A de face de alinhamento */}
            {faceSel === "0" && faceAlinhamento && (
              <g>
                <circle
                  cx={margin - 18}
                  cy={margin + partH + 18}
                  r={9}
                  fill="var(--color-primary)"
                />
                <text
                  x={margin - 18}
                  y={margin + partH + 21}
                  fontSize={9}
                  fill="var(--color-primary-foreground)"
                  textAnchor="middle"
                  fontWeight="700"
                >
                  {faceAlinhamento}
                </text>
              </g>
            )}

            {/* Indicadores B1/B2 */}
            {faceSel === "0" &&
              indicadoresBorda.map((m, i) => (
                <g key={m + i}>
                  <rect
                    x={margin + partW + 8}
                    y={margin + i * 16}
                    width={22}
                    height={12}
                    fill="var(--color-accent)"
                    rx={2}
                  />
                  <text
                    x={margin + partW + 19}
                    y={margin + i * 16 + 9}
                    fontSize={7}
                    fill="var(--color-accent-foreground)"
                    textAnchor="middle"
                    fontWeight="700"
                  >
                    {m}
                  </text>
                </g>
              ))}

            {/* Cotas */}
            <g
              stroke="var(--color-muted-foreground)"
              strokeWidth={0.3}
              fill="var(--color-muted-foreground)"
              fontSize={7}
              fontFamily="monospace"
            >
              <line
                x1={margin}
                y1={margin + partH + 28}
                x2={margin + partW}
                y2={margin + partH + 28}
              />
              <text x={margin + partW / 2} y={margin + partH + 38} textAnchor="middle">
                {partW} mm
              </text>
              <line
                x1={margin + partW + 28}
                y1={margin}
                x2={margin + partW + 28}
                y2={margin + partH}
              />
              <text
                x={margin + partW + 34}
                y={margin + partH / 2}
                textAnchor="start"
                transform={`rotate(90 ${margin + partW + 34} ${margin + partH / 2})`}
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
                const r = (op.diametro ?? 4) / 2;
                return (
                  <g key={op.id} onClick={() => setOpSel(op.id)} style={{ cursor: "pointer" }}>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={Math.max(r, 1.5)}
                      fill={sel ? "var(--color-primary)" : "var(--color-surface)"}
                      stroke={sel ? "var(--color-primary)" : "var(--color-foreground)"}
                      strokeWidth={sel ? 1.2 : 0.6}
                    />
                    <circle cx={cx} cy={cy} r={0.6} fill="var(--color-foreground)" />
                    <text
                      x={cx + r + 1.5}
                      y={cy - r - 1}
                      fontSize={4.5}
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
                const larg = op.largura ?? 6;
                const cy = margin + partH - y;
                return (
                  <g key={op.id} onClick={() => setOpSel(op.id)} style={{ cursor: "pointer" }}>
                    <rect
                      x={margin + Math.min(x1, x2)}
                      y={cy - larg / 2}
                      width={Math.abs(x2 - x1)}
                      height={larg}
                      fill={sel ? "var(--color-primary)" : "var(--color-accent)"}
                      stroke={sel ? "var(--color-primary)" : "var(--color-foreground)"}
                      strokeWidth={sel ? 1 : 0.5}
                      opacity={0.7}
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
                      <g key={op.id} onClick={() => setOpSel(op.id)} style={{ cursor: "pointer" }}>
                        <rect
                          x={cx - 4}
                          y={cy - 4}
                          width={8}
                          height={8}
                          fill={sel ? "var(--color-primary)" : "transparent"}
                          stroke="var(--color-foreground)"
                          strokeWidth={0.6}
                          strokeDasharray="2,1"
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
                  <g key={op.id} onClick={() => setOpSel(op.id)} style={{ cursor: "pointer" }}>
                    <path
                      d={d}
                      fill="none"
                      stroke={sel ? "var(--color-primary)" : "var(--color-accent)"}
                      strokeWidth={sel ? 1.2 : 0.8}
                      strokeDasharray={sel ? undefined : "3,1"}
                    />
                    {pts.map((p, i) => (
                      <circle
                        key={i}
                        cx={margin + p.x!}
                        cy={margin + partH - p.y!}
                        r={0.8}
                        fill="var(--color-foreground)"
                      />
                    ))}
                  </g>
                );
              }
              return null;
            })}
          </svg>

          {opsFace.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
              Nenhuma furação, rasgo ou usinagem nesta face.
            </div>
          )}
        </div>
      </div>

      {/* Painel direito: detalhes / lista */}
      <aside className="rounded border border-border bg-surface p-2">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Operações da Face {faceSel}
        </h3>
        {opsFace.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma operação.</p>
        ) : (
          <div className="mb-3 max-h-48 space-y-1 overflow-auto">
            {opsFace.map((o) => {
              const ativo = o.id === opSel;
              return (
                <button
                  key={o.id}
                  onClick={() => setOpSel(o.id)}
                  className={`w-full rounded border px-2 py-1 text-left text-[11px] transition ${
                    ativo
                      ? "border-primary bg-primary/10"
                      : "border-border bg-surface-2 hover:bg-surface-2/80"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono">#{o.ordem}</span>
                    <Badge variant="outline" className="h-4 px-1 text-[9px]">
                      {o.tipo_operacao}
                    </Badge>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {o.tipo_operacao === "rasgo"
                      ? `Y${o.y ?? "?"} X[${o.x1 ?? "?"}→${o.x2 ?? "?"}]`
                      : `X${o.x ?? "?"} Y${o.y ?? "?"}${o.diametro ? ` Ø${o.diametro}` : ""}`}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-2 border-t border-border pt-2">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Detalhes
          </h3>
          {!opSelObj ? (
            <p className="text-xs text-muted-foreground">
              Clique em uma operação para ver os detalhes.
            </p>
          ) : (
            <div className="space-y-1 text-[11px]">
              <Linha k="Tipo" v={opSelObj.tipo_operacao} />
              {opSelObj.nome_operacao && <Linha k="Nome" v={opSelObj.nome_operacao} />}
              <Linha k="Face" v={String(opSelObj.face ?? "—")} />
              {opSelObj.x != null && <Linha k="X" v={String(opSelObj.x)} />}
              {opSelObj.y != null && <Linha k="Y" v={String(opSelObj.y)} />}
              {opSelObj.x1 != null && <Linha k="X1" v={String(opSelObj.x1)} />}
              {opSelObj.x2 != null && <Linha k="X2" v={String(opSelObj.x2)} />}
              {opSelObj.diametro != null && <Linha k="Diâmetro" v={`Ø ${opSelObj.diametro}`} />}
              {opSelObj.largura != null && <Linha k="Largura" v={String(opSelObj.largura)} />}
              {opSelObj.comprimento != null && <Linha k="Comprimento" v={String(opSelObj.comprimento)} />}
              {opSelObj.profundidade != null && <Linha k="Profundidade" v={String(opSelObj.profundidade)} />}
              {opSelObj.ancora_x && (
                <Linha k="Âncora X" v={`${opSelObj.ancora_x}${opSelObj.offset_x != null ? ` (${opSelObj.offset_x})` : ""}`} />
              )}
              {opSelObj.ancora_y && (
                <Linha k="Âncora Y" v={`${opSelObj.ancora_y}${opSelObj.offset_y != null ? ` (${opSelObj.offset_y})` : ""}`} />
              )}
              <Linha k="Confiança" v={opSelObj.confianca_parser} />
              <Linha k="Origem" v="biblioteca de peças cadastradas" />

              {(() => {
                const al = alertasOp(opSelObj);
                if (al.length === 0) return null;
                return (
                  <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 p-1.5">
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" /> Alertas
                    </div>
                    <ul className="ml-4 list-disc text-[10px] text-muted-foreground">
                      {al.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
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
                      </tr>
                    </thead>
                    <tbody>
                      {opSelObj.pontos_json.map((p, i) => (
                        <tr key={i} className="border-t border-border/40">
                          <td>{i + 1}</td>
                          <td className="text-right font-mono">{p.x ?? "—"}</td>
                          <td className="text-right font-mono">{p.y ?? "—"}</td>
                          <td className="text-right font-mono">{p.profundidade ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
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
