import { useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

type ChapaJson = {
  indice: number;
  chapa: { id: string; nome: string; largura: number; altura: number; espessura: number };
  pecas: Array<{
    id: string;
    projeto_peca_id: string;
    descricao: string;
    codigo?: string | null;
    x: number; y: number;
    largura: number; altura: number;
    rotacionada?: boolean;
    quantidade_index?: number;
  }>;
  aproveitamento: number;
  area_usada: number;
};

type PlanoJson = {
  nome?: string;
  configuracao?: Record<string, unknown>;
  plano?: ChapaJson[];
  pecas_nao_encaixadas?: Array<{ descricao: string; motivo: string; largura: number; altura: number }>;
};

export type PlanoRow = {
  id: string;
  versao: number;
  status: string;
  aproveitamento_medio: number;
  total_chapas: number;
  total_pecas: number;
  observacao: string | null;
};

export function VisualizadorPlanoCorteDialog({
  open, onOpenChange, plano,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plano: PlanoRow | null;
}) {
  const parsed: { json: PlanoJson | null; error: string | null } = useMemo(() => {
    if (!plano) return { json: null, error: null };
    if (!plano.observacao || !plano.observacao.trim().startsWith("{")) {
      return { json: null, error: "Não foi possível visualizar: plano de corte vazio ou inválido." };
    }
    try {
      const j = JSON.parse(plano.observacao) as PlanoJson;
      const chapas = j.plano ?? [];
      if (chapas.length === 0) {
        return { json: null, error: "Não foi possível visualizar: plano de corte vazio ou inválido." };
      }
      const totalPecas = chapas.reduce((s, c) => s + (c.pecas?.length ?? 0), 0);
      if (totalPecas === 0) {
        return { json: null, error: "Não foi possível visualizar: plano de corte vazio ou inválido." };
      }
      return { json: j, error: null };
    } catch {
      return { json: null, error: "Não foi possível visualizar: plano de corte vazio ou inválido." };
    }
  }, [plano]);

  const nome = parsed.json?.nome ?? (plano ? `Plano v${plano.versao}` : "Plano");
  const aprovPct = plano ? Math.round((plano.aproveitamento_medio ?? 0) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{nome}</span>
            {plano && <Badge variant="secondary">{plano.status}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {parsed.error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            {parsed.error}
          </div>
        )}

        {parsed.json && plano && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Metric label="Aproveitamento" value={`${aprovPct}%`} />
              <Metric label="Chapas" value={String(plano.total_chapas)} />
              <Metric label="Peças" value={String(plano.total_pecas)} />
              <Metric
                label="Não encaixadas"
                value={String(parsed.json.pecas_nao_encaixadas?.length ?? 0)}
              />
            </div>

            {parsed.json.pecas_nao_encaixadas && parsed.json.pecas_nao_encaixadas.length > 0 && (
              <div className="rounded border border-warning/40 bg-warning/10 p-3 text-xs">
                <p className="mb-1 font-medium">Peças não encaixadas:</p>
                <ul className="space-y-0.5">
                  {parsed.json.pecas_nao_encaixadas.map((p, i) => (
                    <li key={i} className="text-muted-foreground">
                      • {p.descricao} ({p.largura}×{p.altura}) — {p.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-6">
              {(parsed.json.plano ?? []).map((c) => (
                <ChapaSvg key={c.indice} chapa={c} />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-surface p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

function ChapaSvg({ chapa }: { chapa: ChapaJson }) {
  const { largura, altura } = chapa.chapa;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium">
          Chapa {chapa.indice + 1} · {chapa.chapa.nome} · {largura} × {altura} × {chapa.chapa.espessura} mm
        </span>
        <span className="text-muted-foreground">
          {chapa.pecas.length} peça(s) · {Math.round((chapa.aproveitamento ?? 0) * 100)}% aprov.
        </span>
      </div>
      <div className="overflow-hidden rounded border border-border bg-[hsl(var(--surface))]">
        <svg
          viewBox={`0 0 ${largura} ${altura}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-auto w-full"
          style={{ background: "#f6efe0" }}
        >
          <rect
            x={0} y={0} width={largura} height={altura}
            fill="#f6efe0" stroke="#8a7a55" strokeWidth={4}
          />
          {chapa.pecas.map((p) => {
            const fontSize = Math.max(14, Math.min(p.largura, p.altura) * 0.08);
            const cx = p.x + p.largura / 2;
            const cy = p.y + p.altura / 2;
            const codigo = p.codigo || p.descricao || "—";
            const medida = `${Math.round(p.largura)} × ${Math.round(p.altura)}`;
            const indexLabel = p.quantidade_index != null ? `#${p.quantidade_index}` : "";
            return (
              <g key={p.id}>
                <rect
                  x={p.x} y={p.y} width={p.largura} height={p.altura}
                  fill="#ffffff" stroke="#3b6e8f" strokeWidth={2}
                />
                <text
                  x={cx} y={cy - fontSize}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={fontSize} fontWeight={600} fill="#1f2937"
                  fontFamily="monospace"
                >
                  {codigo}
                </text>
                <text
                  x={cx} y={cy}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={fontSize * 0.9} fill="#374151"
                  fontFamily="monospace"
                >
                  {medida}
                </text>
                {indexLabel && (
                  <text
                    x={cx} y={cy + fontSize}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={fontSize * 0.85} fill="#6b7280"
                    fontFamily="monospace"
                  >
                    {indexLabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
