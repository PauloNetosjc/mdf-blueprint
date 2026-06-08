// Fase 3A — Diálogo para selecionar uma peça da biblioteca (`pecas_cadastradas`)
// que tenha `modelo_tecnico_json` em `dados_brutos_json`. Retorna a peça
// escolhida via onSelect.

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, BookOpen, AlertTriangle } from "lucide-react";

export type PecaCadastradaResumo = {
  id: string;
  codigo: string | null;
  nome: string | null;
  nome_peca: string | null;
  largura_ref: number | null;
  altura_ref: number | null;
  espessura_ref: number | null;
  material_ref: string | null;
  fita_ref: string | null;
  tem_modelo: boolean;
  requer_manual: boolean;
};

export function SelecionarPecaBibliotecaDialog({
  trigger,
  onSelect,
}: {
  trigger: React.ReactNode;
  onSelect: (peca: PecaCadastradaResumo) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["pecas-cadastradas-com-modelo"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pecas_cadastradas")
        .select("id, codigo, nome, nome_peca, largura_ref, altura_ref, espessura_ref, material_ref, fita_ref, dados_brutos_json")
        .order("codigo", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return (data ?? []).map((r: any) => {
        const modelo = r.dados_brutos_json?.modelo_tecnico_json ?? null;
        return {
          id: r.id,
          codigo: r.codigo,
          nome: r.nome,
          nome_peca: r.nome_peca,
          largura_ref: r.largura_ref,
          altura_ref: r.altura_ref,
          espessura_ref: r.espessura_ref,
          material_ref: r.material_ref,
          fita_ref: r.fita_ref,
          tem_modelo: !!modelo,
          requer_manual: modelo?.geometria?.requer_cadastro_manual === true,
        } as PecaCadastradaResumo;
      });
    },
  });

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const todas = (data ?? []).filter((p) => p.tem_modelo);
    if (!q) return todas;
    return todas.filter(
      (p) =>
        (p.codigo ?? "").toLowerCase().includes(q) ||
        (p.nome ?? "").toLowerCase().includes(q) ||
        (p.nome_peca ?? "").toLowerCase().includes(q),
    );
  }, [data, busca]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Selecionar peça da biblioteca
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código ou nome…"
            className="h-9 pl-8"
          />
        </div>

        <div className="max-h-[60vh] overflow-auto rounded border border-border">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Carregando biblioteca…</div>
          ) : filtradas.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma peça com modelo técnico encontrada.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left">Código</th>
                  <th className="px-2 py-2 text-left">Nome</th>
                  <th className="px-2 py-2 text-right">L × A × E</th>
                  <th className="px-2 py-2 text-left">Material</th>
                  <th className="px-2 py-2 text-left">Flags</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((p) => (
                  <tr key={p.id} className="border-t border-border hover:bg-surface-2">
                    <td className="px-2 py-1 font-mono text-xs">{p.codigo ?? "—"}</td>
                    <td className="px-2 py-1">{p.nome_peca ?? p.nome ?? "—"}</td>
                    <td className="px-2 py-1 text-right font-mono text-xs">
                      {p.largura_ref ?? "?"} × {p.altura_ref ?? "?"} × {p.espessura_ref ?? "?"}
                    </td>
                    <td className="px-2 py-1 text-xs text-muted-foreground">{p.material_ref ?? "—"}</td>
                    <td className="px-2 py-1">
                      {p.requer_manual && (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning"
                          title="Geometria complexa/manual — vai gerar alerta"
                        >
                          <AlertTriangle className="h-3 w-3" /> manual
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Button
                        size="sm"
                        onClick={() => {
                          onSelect(p);
                          setOpen(false);
                        }}
                      >
                        Usar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
