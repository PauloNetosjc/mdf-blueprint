import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Scissors, Eye, Pencil, Copy, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { ConfigurarPlanoCorteDialog } from "./ConfigurarPlanoCorteDialog";
import { VisualizadorPlanoCorteDialog, type PlanoRow as PlanoRowVis } from "./VisualizadorPlanoCorteDialog";

type PlanoRow = {
  id: string;
  versao: number;
  status: string;
  aproveitamento_medio: number;
  total_chapas: number;
  total_pecas: number;
  created_at: string;
  observacao: string | null;
};

export function PlanoCorteTab({ projetoId }: { projetoId: string }) {
  const qc = useQueryClient();
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [visualizar, setVisualizar] = useState<PlanoRowVis | null>(null);

  const { data: planos, isLoading } = useQuery({
    queryKey: ["planos-corte-list", projetoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("planos_corte")
        .select("id, versao, status, aproveitamento_medio, total_chapas, total_pecas, created_at, observacao")
        .eq("projeto_id", projetoId)
        .order("created_at", { ascending: false });
      return (data ?? []) as PlanoRow[];
    },
  });

  const duplicar = useMutation({
    mutationFn: async (planoId: string) => {
      const { data: orig, error: e1 } = await supabase
        .from("planos_corte").select("*").eq("id", planoId).single();
      if (e1 || !orig) throw e1 ?? new Error("Plano não encontrado");
      const { data: novo, error: e2 } = await supabase.from("planos_corte").insert({
        projeto_id: orig.projeto_id,
        versao: (orig.versao ?? 1) + 1,
        aproveitamento_medio: orig.aproveitamento_medio,
        total_chapas: orig.total_chapas,
        total_pecas: orig.total_pecas,
        status: "gerado",
        observacao: orig.observacao,
      }).select().single();
      if (e2 || !novo) throw e2;
      const { data: chapas } = await supabase
        .from("plano_corte_chapas").select("*").eq("plano_id", planoId);
      for (const c of chapas ?? []) {
        const { data: novaChapa, error: e3 } = await supabase.from("plano_corte_chapas").insert({
          plano_id: novo.id, chapa_id: c.chapa_id, indice: c.indice,
          aproveitamento: c.aproveitamento, area_usada: c.area_usada,
        }).select().single();
        if (e3 || !novaChapa) throw e3;
        const { data: pecas } = await supabase
          .from("plano_corte_pecas").select("*").eq("plano_chapa_id", c.id);
        if (pecas && pecas.length > 0) {
          await supabase.from("plano_corte_pecas").insert(pecas.map((p) => ({
            plano_chapa_id: novaChapa.id, projeto_peca_id: p.projeto_peca_id,
            x: p.x, y: p.y, largura: p.largura, altura: p.altura, rotacionada: p.rotacionada,
          })));
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planos-corte-list", projetoId] });
      toast.success("Plano duplicado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (planoId: string) => {
      const { error } = await supabase.from("planos_corte").delete().eq("id", planoId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planos-corte-list", projetoId] });
      setConfirmDel(null);
      toast.success("Plano excluído");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function nomeDoPlano(p: PlanoRow): string {
    try {
      if (p.observacao && p.observacao.trim().startsWith("{")) {
        const j = JSON.parse(p.observacao);
        if (j && typeof j.nome === "string") return j.nome;
      }
    } catch { /* fallback */ }
    return `Plano v${p.versao}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Plano de Corte</h2>
          <p className="text-xs text-muted-foreground">
            Gere e gerencie planos de corte a partir das peças do projeto.
          </p>
        </div>
        <Button onClick={() => setConfigOpen(true)}>
          <Scissors className="mr-2 h-4 w-4" />Gerar plano de corte
        </Button>
      </div>

      {isLoading ? (
        <div className="rounded border border-border bg-surface p-6 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : (planos?.length ?? 0) === 0 ? (
        <div className="rounded border border-dashed border-border bg-surface p-8 text-center">
          <Scissors className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="mb-1 text-sm font-medium">Nenhum plano de corte ainda</p>
          <p className="mb-4 text-xs text-muted-foreground">
            Clique em "Gerar plano de corte" para criar o primeiro.
          </p>
          <Button onClick={() => setConfigOpen(true)} variant="outline">
            <Plus className="mr-2 h-4 w-4" />Gerar plano de corte
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-panel">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Nome / versão</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Chapas</th>
                <th className="px-3 py-2">Peças</th>
                <th className="px-3 py-2">Aproveitamento</th>
                <th className="px-3 py-2">Criado em</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {planos!.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{nomeDoPlano(p)}</td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary">{p.status}</Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{p.total_chapas}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.total_pecas}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {Math.round((p.aproveitamento_medio ?? 0) * 100)}%
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm" variant="ghost" title="Visualizar plano"
                        onClick={() => setVisualizar(p)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" title="Visualizar (somente leitura)"
                        onClick={() => setVisualizar(p)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Button size="sm" variant="ghost" title="Duplicar" disabled>
                                <Copy className="h-4 w-4" />
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Duplicação em desenvolvimento</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Button
                        size="sm" variant="ghost" title="Excluir"
                        onClick={() => setConfirmDel(p.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfigurarPlanoCorteDialog
        open={configOpen} onOpenChange={setConfigOpen} projetoId={projetoId}
      />

      <VisualizadorPlanoCorteDialog
        open={!!visualizar}
        onOpenChange={(v) => !v && setVisualizar(null)}
        plano={visualizar}
      />

      <AlertDialog open={!!confirmDel} onOpenChange={(v) => !v && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir plano de corte?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação não pode ser desfeita. O plano e suas chapas/peças vinculadas serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDel && excluir.mutate(confirmDel)}
              className="bg-destructive text-destructive-foreground"
            >Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
