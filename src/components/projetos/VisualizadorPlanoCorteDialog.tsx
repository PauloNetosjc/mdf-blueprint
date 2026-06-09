import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, X } from "lucide-react";

type PecaJson = {
  id: string;
  projeto_peca_id?: string;
  descricao?: string;
  codigo?: string | null;
  x: number; y: number;
  largura: number; altura: number;
  espessura?: number;
  rotacionada?: boolean;
  quantidade_index?: number;
  modulo?: string | null;
  fita?: string | null;
};

type ChapaJson = {
  indice: number;
  chapa: { id: string; nome: string; largura: number; altura: number; espessura: number };
  pecas: PecaJson[];
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

function abreviar(txt: string, limite: number): string {
  if (!txt) return "";
  if (txt.length <= limite) return txt;
  return txt.slice(0, Math.max(1, limite - 1)) + "…";
}

export function VisualizadorPlanoCorteDialog({
  open, onOpenChange, plano,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plano: PlanoRow | null;
}) {
  const [pecaSel, setPecaSel] = useState<{ p: PecaJson; chapaNum: number; chapaNome: string } | null>(null);

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
    <Dialog open={open} onOpenChange={(v) => { if (!v) setPecaSel(null); onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
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

            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <div className="space-y-6">
                {(parsed.json.plano ?? []).map((c, idx) => {
                  const numero = idx + 1;
                  const areaChapa = c.chapa.largura * c.chapa.altura;
                  const areaPecas = c.pecas.reduce((s, p) => s + p.largura * p.altura, 0);
                  const aprov = areaChapa > 0 ? areaPecas / areaChapa : 0;
                  return (
                    <ChapaSvg
                      key={`${c.chapa.id}-${idx}`}
                      chapa={c}
                      numero={numero}
                      aprovChapa={aprov}
                      onSelectPeca={(p) => setPecaSel({ p, chapaNum: numero, chapaNome: c.chapa.nome })}
                      selecionadaId={pecaSel?.p.id ?? null}
                    />
                  );
                })}
              </div>

              {pecaSel && (
                <aside className="h-fit space-y-2 rounded border border-border bg-surface p-3 text-xs lg:sticky lg:top-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Detalhe da peça</span>
                    <button
                      onClick={() => setPecaSel(null)}
                      className="rounded p-1 hover:bg-muted"
                      aria-label="Fechar"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <Linha k="Código" v={pecaSel.p.codigo ?? "—"} />
                  <Linha k="Descrição" v={pecaSel.p.descricao ?? "—"} />
                  <Linha k="Largura" v={`${Math.round(pecaSel.p.largura)} mm`} />
                  <Linha k="Altura" v={`${Math.round(pecaSel.p.altura)} mm`} />
                  {pecaSel.p.espessura != null && <Linha k="Espessura" v={`${pecaSel.p.espessura} mm`} />}
                  {pecaSel.p.modulo && <Linha k="Módulo" v={pecaSel.p.modulo} />}
                  {pecaSel.p.fita && <Linha k="Fita" v={pecaSel.p.fita} />}
                  {pecaSel.p.quantidade_index != null && <Linha k="Índice" v={`#${pecaSel.p.quantidade_index}`} />}
                  <Linha k="Chapa" v={`${pecaSel.chapaNum} · ${pecaSel.chapaNome}`} />
                  <Linha k="Posição" v={`X ${Math.round(pecaSel.p.x)} · Y ${Math.round(pecaSel.p.y)}`} />
                  <Linha k="Rotacionada" v={pecaSel.p.rotacionada ? "Sim" : "Não"} />
                </aside>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Linha({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-border/40 py-1">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
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

function ChapaSvg({
  chapa, numero, aprovChapa, onSelectPeca, selecionadaId,
}: {
  chapa: ChapaJson;
  numero: number;
  aprovChapa: number;
  onSelectPeca: (p: PecaJson) => void;
  selecionadaId: string | null;
}) {
  const { largura, altura, espessura, nome } = chapa.chapa;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium">
          Chapa {numero} · {nome} · {largura} × {altura} × {espessura} mm
        </span>
        <span className="text-muted-foreground">
          {chapa.pecas.length} peça(s) · {Math.round(aprovChapa * 100)}% aprov.
        </span>
      </div>
      <div className="overflow-hidden rounded border-2 border-[#8a7a55] bg-[#f6efe0]">
        <svg
          viewBox={`0 0 ${largura} ${altura}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-auto w-full"
        >
          <rect x={0} y={0} width={largura} height={altura} fill="#f6efe0" />
          {chapa.pecas.map((p) => {
            const menorDim = Math.min(p.largura, p.altura);
            const fontCentro = Math.max(18, Math.min(menorDim * 0.12, 80));
            const fontLado = Math.max(14, Math.min(menorDim * 0.08, 56));
            const cx = p.x + p.largura / 2;
            const cy = p.y + p.altura / 2;

            const codigoRaw = p.codigo || p.descricao || "—";
            // limite de caracteres pela largura disponível
            const limiteCaracteres = Math.max(6, Math.floor(p.largura / (fontCentro * 0.6)));
            const codigo = abreviar(codigoRaw, limiteCaracteres);

            const labelLargura = `L: ${Math.round(p.largura)} mm`;
            const labelAltura = `A: ${Math.round(p.altura)} mm`;
            const indexLabel = p.quantidade_index != null ? `#${p.quantidade_index}` : "";
            const selecionada = selecionadaId === p.id;

            return (
              <g
                key={p.id}
                onClick={() => onSelectPeca(p)}
                style={{ cursor: "pointer" }}
              >
                <title>
                  {`${codigoRaw}\n${Math.round(p.largura)} × ${Math.round(p.altura)} mm${p.espessura ? ` × ${p.espessura}` : ""}`}
                </title>
                <rect
                  x={p.x} y={p.y} width={p.largura} height={p.altura}
                  fill="#ffffff"
                  stroke={selecionada ? "#dc2626" : "#3b6e8f"}
                  strokeWidth={selecionada ? 4 : 2}
                />
                {/* índice canto superior esquerdo */}
                {indexLabel && (
                  <text
                    x={p.x + fontLado * 0.4}
                    y={p.y + fontLado * 1.1}
                    fontSize={fontLado * 0.85}
                    fill="#6b7280"
                    fontFamily="monospace"
                  >
                    {indexLabel}
                  </text>
                )}
                {/* código centralizado */}
                <text
                  x={cx} y={cy}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={fontCentro} fontWeight={700} fill="#1f2937"
                  fontFamily="monospace"
                >
                  {codigo}
                </text>
                {/* largura na base interna */}
                <text
                  x={cx}
                  y={p.y + p.altura - fontLado * 0.6}
                  textAnchor="middle"
                  fontSize={fontLado}
                  fill="#374151"
                  fontFamily="monospace"
                >
                  {labelLargura}
                </text>
                {/* altura na lateral direita interna (rotacionada 90º) */}
                <text
                  x={p.x + p.largura - fontLado * 0.6}
                  y={cy}
                  textAnchor="middle"
                  fontSize={fontLado}
                  fill="#374151"
                  fontFamily="monospace"
                  transform={`rotate(90 ${p.x + p.largura - fontLado * 0.6} ${cy})`}
                >
                  {labelAltura}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
