// Fase 3A — Painel de aplicação técnica de uma peça do projeto.
//
// Mostra:
//   - peça cadastrada vinculada
//   - medidas base (cadastro)
//   - medidas reais (projeto)
//   - status_tecnico
//   - alertas e erros
//   - tabela de operações (base → aplicado) por âncora
//   - botão "Reaplicar modelo" (persiste no projeto_pecas)
//
// A persistência é feita pelo componente pai (recebe `onPersist`). Aqui
// fazemos o cálculo em memória sempre que as medidas reais mudarem.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, XCircle, RefreshCcw, Info } from "lucide-react";
import {
  aplicarModeloTecnicoNaPecaProjeto,
  montarDiagnostico,
  type ResultadoAplicacao,
  type StatusTecnico,
} from "@/lib/aplicar-modelo-projeto";
import type { ModeloTecnicoJson } from "@/lib/peca-modelo-tecnico";

type Props = {
  pecaCadastradaId: string;
  medidasProjeto: { largura: number; altura: number; espessura: number };
  statusAtual?: StatusTecnico | null;
  onPersist: (resultado: ResultadoAplicacao) => Promise<void> | void;
};

export function PainelAplicacaoTecnica({ pecaCadastradaId, medidasProjeto, statusAtual, onPersist }: Props) {
  const { data: peca, isLoading } = useQuery({
    queryKey: ["peca-cadastrada-modelo", pecaCadastradaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pecas_cadastradas")
        .select("id, codigo, nome, nome_peca, largura_ref, altura_ref, espessura_ref, dados_brutos_json")
        .eq("id", pecaCadastradaId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const modeloBase = (peca?.dados_brutos_json as any)?.modelo_tecnico_json as ModeloTecnicoJson | undefined;

  const resultado = useMemo<ResultadoAplicacao | null>(() => {
    if (!modeloBase) return null;
    if (!medidasProjeto.largura || !medidasProjeto.altura) return null;
    return aplicarModeloTecnicoNaPecaProjeto(modeloBase, medidasProjeto);
  }, [modeloBase, medidasProjeto.largura, medidasProjeto.altura, medidasProjeto.espessura]);

  const [salvando, setSalvando] = useState(false);

  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Carregando modelo técnico…</div>;
  }
  if (!peca) {
    return <div className="p-4 text-sm text-destructive">Peça da biblioteca não encontrada.</div>;
  }
  if (!modeloBase) {
    return (
      <div className="rounded border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
        Esta peça da biblioteca ainda não tem modelo técnico processado.
      </div>
    );
  }
  if (!resultado) {
    return <div className="p-4 text-sm text-muted-foreground">Informe medidas reais para aplicar o modelo.</div>;
  }

  const diag = montarDiagnostico(modeloBase, resultado);

  async function reaplicar() {
    if (!resultado) return;
    setSalvando(true);
    try {
      await onPersist(resultado);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-4 rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono text-xs text-muted-foreground">{peca.codigo}</span>
            <span className="font-medium">{peca.nome_peca ?? peca.nome ?? "—"}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Base: {peca.largura_ref} × {peca.altura_ref} × {peca.espessura_ref}
            <span className="mx-2">→</span>
            Projeto: {medidasProjeto.largura} × {medidasProjeto.altura} × {medidasProjeto.espessura}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <BadgeStatus status={resultado.status_tecnico} />
          <Button size="sm" onClick={reaplicar} disabled={salvando}>
            <RefreshCcw className={`mr-1 h-3.5 w-3.5 ${salvando ? "animate-spin" : ""}`} />
            {salvando ? "Salvando..." : "Salvar aplicação"}
          </Button>
        </div>
      </div>

      {statusAtual && statusAtual !== resultado.status_tecnico && (
        <div className="flex items-center gap-2 rounded border border-border bg-surface-2 p-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5" />
          Prévia em memória — status salvo: <BadgeStatus status={statusAtual} compact />
        </div>
      )}

      {resultado.alertas.length > 0 && (
        <div className="rounded border border-warning/30 bg-warning/5 p-2 text-xs">
          <div className="mb-1 flex items-center gap-1 font-semibold text-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> Alertas ({resultado.alertas.length})
          </div>
          <ul className="ml-5 list-disc space-y-0.5 text-warning/90">
            {resultado.alertas.map((a, i) => (
              <li key={i}>
                <span className="font-mono text-[10px]">[{a.face}] {a.tipo}</span> — {a.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      {resultado.erros.length > 0 && (
        <div className="rounded border border-destructive/30 bg-destructive/5 p-2 text-xs">
          <div className="mb-1 flex items-center gap-1 font-semibold text-destructive">
            <XCircle className="h-3.5 w-3.5" /> Erros ({resultado.erros.length})
          </div>
          <ul className="ml-5 list-disc space-y-0.5 text-destructive/90">
            {resultado.erros.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-[10px]">[{e.face}] {e.tipo} #{e.ordem}</span> — {e.motivo}
                {e.ponto && (
                  <span className="ml-1 font-mono text-[10px]">
                    @ ({e.ponto.x}, {e.ponto.y})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Op</th>
              <th className="px-2 py-1.5 text-left">Face</th>
              <th className="px-2 py-1.5 text-left">Tipo</th>
              <th className="px-2 py-1.5 text-right">X base</th>
              <th className="px-2 py-1.5 text-right">Y base</th>
              <th className="px-2 py-1.5 text-left">Âncora X</th>
              <th className="px-2 py-1.5 text-right">Dist X</th>
              <th className="px-2 py-1.5 text-right">X apl.</th>
              <th className="px-2 py-1.5 text-left">Âncora Y</th>
              <th className="px-2 py-1.5 text-right">Dist Y</th>
              <th className="px-2 py-1.5 text-right">Y apl.</th>
              <th className="px-2 py-1.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {diag.map((l) => (
              <tr key={l.ordem} className="border-t border-border">
                <td className="px-2 py-1 font-mono">{l.ordem}</td>
                <td className="px-2 py-1">{l.face}</td>
                <td className="px-2 py-1">{l.tipo}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(l.x_base)}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(l.y_base)}</td>
                <td className="px-2 py-1 text-[11px]">{l.ancora_x}</td>
                <td className="px-2 py-1 text-right font-mono">{l.dist_x}</td>
                <td className="px-2 py-1 text-right font-mono font-semibold">{fmt(l.x_aplicado)}</td>
                <td className="px-2 py-1 text-[11px]">{l.ancora_y}</td>
                <td className="px-2 py-1 text-right font-mono">{l.dist_y}</td>
                <td className="px-2 py-1 text-right font-mono font-semibold">{fmt(l.y_aplicado)}</td>
                <td className="px-2 py-1">
                  <StatusCell status={l.status} detalhe={l.detalhe} />
                </td>
              </tr>
            ))}
            {diag.length === 0 && (
              <tr>
                <td colSpan={12} className="px-2 py-4 text-center text-muted-foreground">
                  Sem operações no modelo técnico.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return (Math.round(n * 100) / 100).toString();
}

function BadgeStatus({ status, compact }: { status: StatusTecnico; compact?: boolean }) {
  const map: Record<StatusTecnico, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
    nao_aplicado: { label: "Não aplicado", cls: "bg-muted text-muted-foreground", Icon: Info },
    aplicado_ok: { label: "Aplicado OK", cls: "bg-success/10 text-success", Icon: CheckCircle2 },
    aplicado_com_alerta: { label: "Aplicado c/ alerta", cls: "bg-warning/10 text-warning", Icon: AlertTriangle },
    aplicado_com_erro: { label: "Aplicado c/ erro", cls: "bg-destructive/10 text-destructive", Icon: XCircle },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${compact ? "text-[10px]" : "text-xs"} ${m.cls}`}>
      <m.Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}

function StatusCell({ status, detalhe }: { status: "ok" | "alerta" | "erro"; detalhe?: string }) {
  if (status === "ok") return <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3 w-3" />ok</span>;
  if (status === "alerta")
    return (
      <span className="inline-flex items-center gap-1 text-warning" title={detalhe}>
        <AlertTriangle className="h-3 w-3" />alerta
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-destructive" title={detalhe}>
      <XCircle className="h-3 w-3" />erro
    </span>
  );
}
