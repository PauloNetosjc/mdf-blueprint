import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Printer, Sparkles, Trash2, Upload, X } from "lucide-react";
import {
  CATEGORIAS_ALMOX, STATUS_SEPARACAO, UNIDADES_ALMOX,
  calcularConsumoFita, statusInfo,
} from "@/lib/almoxarifado";

type Peca = {
  id: string;
  descricao: string;
  largura: number;
  altura: number;
  quantidade: number;
  fita_codigo: string | null;
  ambiente?: string | null;
  modulo: string | null;
};

type Item = {
  id: string;
  projeto_id: string;
  item_catalogo_id: string | null;
  referencia: string | null;
  descricao: string;
  categoria: string;
  quantidade: number;
  unidade: string;
  ambiente: string | null;
  modulo: string | null;
  status: string;
  origem: string;
};

type Catalogo = {
  id: string;
  referencia: string;
  descricao: string;
  categoria: string;
  unidade: string;
};

export function ListaComprasTab({ projetoId }: { projetoId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [catalogoId, setCatalogoId] = useState<string>("");
  const [novoQtd, setNovoQtd] = useState(1);
  const [novoAmb, setNovoAmb] = useState("");

  const { data: pecas } = useQuery({
    queryKey: ["projeto-pecas-fita", projetoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projeto_pecas")
        .select("id, descricao, largura, altura, quantidade, fita_codigo, modulo")
        .eq("projeto_id", projetoId);
      if (error) throw error;
      return (data ?? []) as Peca[];
    },
  });

  const { data: itens } = useQuery({
    queryKey: ["projeto-almox", projetoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projeto_almoxarifado_itens")
        .select("*")
        .eq("projeto_id", projetoId)
        .order("categoria")
        .order("descricao");
      if (error) throw error;
      return (data ?? []) as Item[];
    },
  });

  const { data: catalogo } = useQuery({
    queryKey: ["almox-catalogo-min"],
    queryFn: async () => {
      const { data } = await supabase
        .from("almoxarifado_itens_catalogo")
        .select("id, referencia, descricao, categoria, unidade")
        .eq("ativo", true)
        .order("descricao");
      return (data ?? []) as Catalogo[];
    },
  });

  const consumoFita = useMemo(
    () => calcularConsumoFita(pecas ?? []),
    [pecas],
  );

  const gerarFitas = useMutation({
    mutationFn: async () => {
      const existentes = (itens ?? []).filter((i) => i.origem === "auto_fita").map((i) => i.id);
      if (existentes.length) {
        await supabase.from("projeto_almoxarifado_itens").delete().in("id", existentes);
      }
      if (!consumoFita.length) return;
      const inserts = consumoFita.map((c) => ({
        projeto_id: projetoId,
        referencia: c.fita_codigo,
        descricao: `Fita de borda ${c.fita_codigo} (${c.detalhe})`,
        categoria: "fita_borda",
        quantidade: c.metros,
        unidade: "m",
        status: "pendente",
        origem: "auto_fita",
        observacao: `${c.pecas} peça(s)`,
      }));
      const { error } = await supabase.from("projeto_almoxarifado_itens").insert(inserts);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Consumo de fita gerado");
      qc.invalidateQueries({ queryKey: ["projeto-almox", projetoId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addManual = useMutation({
    mutationFn: async () => {
      const cat = (catalogo ?? []).find((c) => c.id === catalogoId);
      if (!cat) throw new Error("Selecione um item do catálogo");
      const { error } = await supabase.from("projeto_almoxarifado_itens").insert({
        projeto_id: projetoId,
        item_catalogo_id: cat.id,
        referencia: cat.referencia,
        descricao: cat.descricao,
        categoria: cat.categoria,
        quantidade: novoQtd,
        unidade: cat.unidade,
        ambiente: novoAmb || null,
        status: "pendente",
        origem: "manual",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item adicionado");
      qc.invalidateQueries({ queryKey: ["projeto-almox", projetoId] });
      setAddOpen(false);
      setCatalogoId("");
      setNovoQtd(1);
      setNovoAmb("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("projeto_almoxarifado_itens").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projeto-almox", projetoId] }),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: { status: string; separado_em?: string } = { status };
      if (status === "separado") patch.separado_em = new Date().toISOString();
      const { error } = await supabase.from("projeto_almoxarifado_itens").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projeto-almox", projetoId] }),
  });

  const total = (itens ?? []).length;
  const separados = (itens ?? []).filter((i) => i.status === "separado").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => gerarFitas.mutate()} disabled={gerarFitas.isPending}>
          <Sparkles className="mr-2 h-4 w-4" />
          Gerar consumo de fita ({consumoFita.length})
        </Button>
        <Button variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Adicionar item
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" /> Imprimir lista
        </Button>
        <Button variant="outline" disabled title="Em breve">
          <Upload className="mr-2 h-4 w-4" /> Importar relatório de almoxarifado
        </Button>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{total} itens</Badge>
          <Badge variant="outline">{separados} separados</Badge>
        </div>
      </div>

      {consumoFita.length > 0 && (
        <div className="rounded border border-border bg-surface-2 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Previsão de fita (calculada das peças)
          </div>
          <div className="flex flex-wrap gap-2">
            {consumoFita.map((c) => (
              <Badge key={c.fita_codigo} variant="secondary" className="font-mono">
                {c.fita_codigo} · {c.metros.toFixed(2)} m · {c.pecas} pç
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Ref.</th>
              <th className="p-2 text-left">Descrição</th>
              <th className="p-2 text-left">Categoria</th>
              <th className="p-2 text-right">Qtd</th>
              <th className="p-2 text-left">Un</th>
              <th className="p-2 text-left">Ambiente</th>
              <th className="p-2 text-left">Origem</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {(itens ?? []).map((it) => {
              const info = statusInfo(it.status);
              return (
                <tr key={it.id} className="border-t border-border">
                  <td className="p-2 font-mono text-xs">{it.referencia ?? "—"}</td>
                  <td className="p-2">{it.descricao}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {CATEGORIAS_ALMOX.find((c) => c.value === it.categoria)?.label ?? it.categoria}
                  </td>
                  <td className="p-2 text-right font-mono">{Number(it.quantidade).toFixed(2)}</td>
                  <td className="p-2 text-xs">{it.unidade}</td>
                  <td className="p-2 text-xs text-muted-foreground">{it.ambiente ?? "—"}</td>
                  <td className="p-2 text-xs text-muted-foreground">{it.origem}</td>
                  <td className={`p-2 text-xs font-semibold ${info.color}`}>
                    <Select value={it.status} onValueChange={(v) => setStatus.mutate({ id: it.id, status: v })}>
                      <SelectTrigger className="h-7 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_SEPARACAO.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => remover.mutate(it.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {(itens ?? []).length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">
                Sem itens. Gere o consumo de fita ou adicione itens manualmente.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adicionar item ao projeto</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Item do catálogo</Label>
              <Select value={catalogoId} onValueChange={setCatalogoId}>
                <SelectTrigger><SelectValue placeholder="Selecione um item" /></SelectTrigger>
                <SelectContent>
                  {(catalogo ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.referencia} — {c.descricao}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(catalogo ?? []).length === 0 && (
                <p className="mt-1 text-xs text-warning">Cadastre itens em Almoxarifado &gt; Catálogo primeiro.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantidade</Label>
                <Input type="number" min={0.01} step="0.01" value={novoQtd}
                  onChange={(e) => setNovoQtd(Number(e.target.value))} />
              </div>
              <div>
                <Label>Ambiente (opcional)</Label>
                <Input value={novoAmb} onChange={(e) => setNovoAmb(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button onClick={() => addManual.mutate()} disabled={addManual.isPending || !catalogoId}>
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
