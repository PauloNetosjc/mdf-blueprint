import { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";
import {
  reprocessarGeometriaPecas,
  type ReprocessAcao,
  type ReprocessResult,
} from "@/lib/geometria-reprocess";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pecaIds: string[];
  onConcluido?: () => void;
};

const LABEL_ACAO: Record<ReprocessAcao, string> = {
  atualizado_parser: "Contorno detectado (parser)",
  atualizado_fallback: "Fallback 65×40 aplicado",
  atualizado_retangular: "Retangular simples",
  preservado_manual: "Preservado (manual)",
  preservado_misto: "Preservado (misto)",
  sem_dimensoes: "Sem dimensões",
  erro: "Erro",
};

export function ReprocessarGeometriaDialog({ open, onOpenChange, pecaIds, onConcluido }: Props) {
  const [sobrescrever, setSobrescrever] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<ReprocessResult[]>([]);
  const cancelRef = useRef(false);

  const total = pecaIds.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const contagem = useMemo(() => {
    const m: Record<ReprocessAcao, number> = {
      atualizado_parser: 0,
      atualizado_fallback: 0,
      atualizado_retangular: 0,
      preservado_manual: 0,
      preservado_misto: 0,
      sem_dimensoes: 0,
      erro: 0,
    };
    for (const r of results) m[r.acao]++;
    return m;
  }, [results]);

  async function rodar() {
    setRodando(true);
    setDone(0);
    setResults([]);
    cancelRef.current = false;
    try {
      const resultados: ReprocessResult[] = [];
      await reprocessarGeometriaPecas(pecaIds, {
        sobrescreverManual: sobrescrever,
        chunkSize: 5,
        onProgress: (d, _t, last) => {
          if (cancelRef.current) return;
          resultados.push(last);
          setDone(d);
          setResults([...resultados]);
        },
      });
      toast.success(`Geometria reprocessada em ${resultados.length} peças.`);
      onConcluido?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha no reprocessamento: ${msg}`);
    } finally {
      setRodando(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (rodando) return;
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reprocessar geometria das peças cadastradas</DialogTitle>
          <DialogDescription className="text-xs">
            Recalcula o contorno externo (formato real) de cada peça a partir de suas operações.
            Não altera furos, rasgos, usinagens, bordas, faces ou medidas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded border border-border bg-surface-2 p-2">
            <div>
              <div className="font-medium">{total} peças selecionadas</div>
              <div className="text-xs text-muted-foreground">
                Processadas em lotes de 5 — a interface continua respondendo.
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={sobrescrever}
                disabled={rodando}
                onChange={(e) => setSobrescrever(e.target.checked)}
              />
              Sobrescrever contornos manuais
            </label>
          </div>

          {(rodando || results.length > 0) && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                {rodando && <Loader2 className="h-3 w-3 animate-spin" />}
                <span>
                  {done}/{total} ({pct}%)
                </span>
              </div>
              <Progress value={pct} />
              <div className="grid grid-cols-2 gap-1 text-[11px] sm:grid-cols-4">
                {(Object.keys(LABEL_ACAO) as ReprocessAcao[]).map((k) => (
                  <div
                    key={k}
                    className="flex items-center justify-between rounded border border-border bg-surface-2 px-2 py-1"
                  >
                    <span className="text-muted-foreground">{LABEL_ACAO[k]}</span>
                    <span className="font-mono font-semibold">{contagem[k]}</span>
                  </div>
                ))}
              </div>

              <div className="max-h-48 overflow-auto rounded border border-border bg-surface-2 p-2 font-mono text-[10px]">
                {results
                  .slice(-100)
                  .reverse()
                  .map((r) => (
                    <div key={r.pecaId} className="border-b border-border/40 py-0.5">
                      <span className="text-foreground">{r.codigo}</span>{" "}
                      <span className="text-muted-foreground">→ {LABEL_ACAO[r.acao]}</span>
                      {r.msg && <span className="text-destructive"> · {r.msg}</span>}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={rodando}
          >
            Fechar
          </Button>
          <Button onClick={rodar} disabled={rodando || total === 0}>
            {rodando ? "Reprocessando..." : "Iniciar reprocessamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
