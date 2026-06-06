import { useEffect, useRef, useState } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import {
  reprocessarParserEmLote,
  type LoteProgress,
  type ReprocessParserResult,
} from "@/lib/peca-cadastrada-reprocessar";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConcluido?: () => void;
};

export function ReprocessarParserErrosDialog({ open, onOpenChange, onConcluido }: Props) {
  const [sobrescreverManual, setSobrescreverManual] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [progress, setProgress] = useState<LoteProgress | null>(null);
  const [pendentes, setPendentes] = useState<{ id: string; codigo: string }[]>([]);
  const [resultados, setResultados] = useState<
    Array<ReprocessParserResult | { pecaId: string; codigo: string; erro: string }>
  >([]);
  const cancelRef = useRef(false);

  async function carregarPendentes() {
    const { data, error } = await db
      .from("pecas_cadastradas")
      .select("id,codigo_completo,status_parser,erros_parser,pdf_url")
      .not("pdf_url", "is", null)
      .order("codigo_completo", { ascending: true });
    if (error) {
      toast.error(`Falha ao listar peças: ${error.message}`);
      return [];
    }
    type Row = {
      id: string;
      codigo_completo: string;
      status_parser: string;
      erros_parser: unknown[] | null;
    };
    const rows = (data ?? []) as Row[];
    const alvos = rows.filter((r) => {
      const temErroFlag = r.status_parser === "com_erros";
      const temErros = Array.isArray(r.erros_parser) && r.erros_parser.length > 0;
      return temErroFlag || temErros;
    });
    return alvos.map((r) => ({ id: r.id, codigo: r.codigo_completo }));
  }

  async function abrir() {
    const lista = await carregarPendentes();
    setPendentes(lista);
    setProgress({
      total: lista.length,
      feitas: 0,
      corrigidas: 0,
      ainda_com_erro: 0,
      ignoradas: 0,
    });
  }

  // Carrega quando abrir
  useEffect(() => {
    if (open && !rodando) {
      void abrir();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const total = pendentes.length;
  const pct = progress && progress.total > 0 ? Math.round((progress.feitas / progress.total) * 100) : 0;

  async function rodar() {
    if (!pendentes.length) return;
    setRodando(true);
    cancelRef.current = false;
    setResultados([]);
    try {
      const ids = pendentes.map((p) => p.id);
      await reprocessarParserEmLote(ids, {
        sobrescreverManual,
        cancelado: () => cancelRef.current,
        onProgress: (p) => {
          setProgress(p);
          if (p.ultimo) setResultados((prev) => [...prev, p.ultimo!]);
        },
      });
      toast.success("Reprocessamento em lote concluído.");
      onConcluido?.();
    } catch (e) {
      toast.error(`Erro no lote: ${e instanceof Error ? e.message : String(e)}`);
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
          <DialogTitle>Reprocessar erros do parser</DialogTitle>
          <DialogDescription className="text-xs">
            Roda o parser atual nos PDFs já armazenados das peças com erro ou com
            mensagens em erros_parser. Substitui apenas operações e bordas geradas
            pelo parser; ajustes manuais são preservados por padrão.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded border border-border bg-surface-2 p-2">
            <div>
              <div className="font-medium">{total} peças com erro de parser</div>
              <div className="text-xs text-muted-foreground">
                Processadas sequencialmente, baixando cada PDF do storage.
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={sobrescreverManual}
                disabled={rodando}
                onChange={(e) => setSobrescreverManual(e.target.checked)}
              />
              Sobrescrever ajustes manuais
            </label>
          </div>

          {progress && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                {rodando && <Loader2 className="h-3 w-3 animate-spin" />}
                <span>
                  {progress.feitas}/{progress.total} ({pct}%)
                </span>
              </div>
              <Progress value={pct} />
              <div className="grid grid-cols-2 gap-1 text-[11px] sm:grid-cols-4">
                <Contador rotulo="Corrigidas" valor={progress.corrigidas} />
                <Contador rotulo="Ainda c/ erro" valor={progress.ainda_com_erro} />
                <Contador rotulo="Falhas" valor={progress.ignoradas} />
                <Contador rotulo="Total" valor={progress.total} />
              </div>

              {resultados.length > 0 && (
                <div className="max-h-48 overflow-auto rounded border border-border bg-surface-2 p-2 font-mono text-[10px]">
                  {resultados
                    .slice(-100)
                    .reverse()
                    .map((r, i) => {
                      if ("erro" in r) {
                        return (
                          <div key={`${r.pecaId}-${i}`} className="border-b border-border/40 py-0.5">
                            <span className="text-foreground">{r.codigo}</span>{" "}
                            <span className="text-destructive">✗ {r.erro}</span>
                          </div>
                        );
                      }
                      const ok = r.status === "ok";
                      return (
                        <div key={`${r.pecaId}-${i}`} className="border-b border-border/40 py-0.5">
                          <span className="text-foreground">{r.codigo}</span>{" "}
                          <span className={ok ? "text-emerald-500" : "text-amber-500"}>
                            {ok ? "✓" : "·"} {r.status}
                          </span>{" "}
                          <span className="text-muted-foreground">
                            {r.novo.furos}f / {r.novo.rasgos}r / {r.novo.usinagens}u / {r.novo.bordas}b
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {rodando ? (
            <Button variant="outline" onClick={() => (cancelRef.current = true)}>
              Cancelar
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          )}
          <Button onClick={rodar} disabled={rodando || total === 0}>
            {rodando ? "Reprocessando..." : `Iniciar (${total})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Contador({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex items-center justify-between rounded border border-border bg-surface-2 px-2 py-1">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="font-mono font-semibold">{valor}</span>
    </div>
  );
}
