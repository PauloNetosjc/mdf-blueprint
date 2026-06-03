import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chapas")({
  head: () => ({ meta: [{ title: "Chapas — Visualizador CNC" }] }),
  component: ChapasPage,
});

type Chapa = {
  id: string;
  nome: string;
  codigo: string;
  tipo: string;
  cor: string;
  espessura: number;
  largura: number;
  altura: number;
  veio: string;
  permite_rotacao: boolean;
  estoque: number;
  custo: number;
  ativa: boolean;
};

const empty = {
  nome: "",
  codigo: "",
  tipo: "MDP",
  cor: "#d6c6a8",
  espessura: 15,
  largura: 2750,
  altura: 1850,
  veio: "nenhum",
  permite_rotacao: true,
  estoque: 0,
  custo: 0,
  ativa: true,
};

function ChapasPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Chapa | null>(null);
  const [form, setForm] = useState({ ...empty });

  const { data: chapas } = useQuery({
    queryKey: ["chapas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("chapas").select("*").order("nome");
      if (error) throw error;
      return data as Chapa[];
    },
  });

  function abrir(c?: Chapa) {
    if (c) {
      setEditing(c);
      setForm({
        nome: c.nome, codigo: c.codigo, tipo: c.tipo, cor: c.cor,
        espessura: c.espessura, largura: c.largura, altura: c.altura,
        veio: c.veio, permite_rotacao: c.permite_rotacao,
        estoque: c.estoque, custo: c.custo, ativa: c.ativa,
      });
    } else {
      setEditing(null);
      setForm({ ...empty });
    }
    setOpen(true);
  }

  const salvar = useMutation({
    mutationFn: async () => {
      if (editing) {
        const { error } = await supabase.from("chapas").update(form).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("chapas").insert(form);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chapas"] });
      toast.success(editing ? "Chapa atualizada" : "Chapa criada");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("chapas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chapas"] });
      toast.success("Chapa excluída");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Chapas</h1>
          <p className="text-sm text-muted-foreground">Materiais disponíveis para o plano de corte.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => abrir()}><Plus className="mr-2 h-4 w-4" />Nova chapa</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} chapa</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <F label="Nome"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></F>
              <F label="Código"><Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} /></F>
              <F label="Tipo">
                <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MDP">MDP</SelectItem>
                    <SelectItem value="MDF">MDF</SelectItem>
                    <SelectItem value="Compensado">Compensado</SelectItem>
                    <SelectItem value="OSB">OSB</SelectItem>
                    <SelectItem value="Outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </F>
              <F label="Cor (preview)">
                <div className="flex items-center gap-2">
                  <Input type="color" value={form.cor} onChange={(e) => setForm({ ...form, cor: e.target.value })} className="h-10 w-16 cursor-pointer p-1" />
                  <Input value={form.cor} onChange={(e) => setForm({ ...form, cor: e.target.value })} className="font-mono" />
                </div>
              </F>
              <F label="Espessura (mm)"><Input type="number" step="0.1" value={form.espessura} onChange={(e) => setForm({ ...form, espessura: +e.target.value })} /></F>
              <F label="Estoque"><Input type="number" value={form.estoque} onChange={(e) => setForm({ ...form, estoque: +e.target.value })} /></F>
              <F label="Largura (mm)"><Input type="number" value={form.largura} onChange={(e) => setForm({ ...form, largura: +e.target.value })} /></F>
              <F label="Altura (mm)"><Input type="number" value={form.altura} onChange={(e) => setForm({ ...form, altura: +e.target.value })} /></F>
              <F label="Veio">
                <Select value={form.veio} onValueChange={(v) => setForm({ ...form, veio: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">Sem veio</SelectItem>
                    <SelectItem value="horizontal">Horizontal</SelectItem>
                    <SelectItem value="vertical">Vertical</SelectItem>
                  </SelectContent>
                </Select>
              </F>
              <F label="Custo (R$/chapa)"><Input type="number" step="0.01" value={form.custo} onChange={(e) => setForm({ ...form, custo: +e.target.value })} /></F>
              <div className="flex items-center gap-2"><Switch checked={form.permite_rotacao} onCheckedChange={(v) => setForm({ ...form, permite_rotacao: v })} /><Label className="text-xs">Permite rotação de peças</Label></div>
              <div className="flex items-center gap-2"><Switch checked={form.ativa} onCheckedChange={(v) => setForm({ ...form, ativa: v })} /><Label className="text-xs">Ativa</Label></div>
            </div>
            <DialogFooter>
              <Button onClick={() => salvar.mutate()} disabled={!form.nome || !form.codigo}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {chapas?.map((c) => (
          <div key={c.id} className="overflow-hidden rounded border border-border bg-surface">
            <div className="h-24 w-full" style={{ background: `linear-gradient(135deg, ${c.cor} 0%, ${c.cor}dd 100%)` }} />
            <div className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{c.nome}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{c.codigo}</div>
                </div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${c.ativa ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                  {c.ativa ? "ativa" : "inativa"}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-muted-foreground">
                <div>{c.tipo}</div>
                <div className="font-mono">{c.espessura}mm</div>
                <div className="font-mono">{c.largura}×{c.altura}</div>
              </div>
              <div className="mt-2 flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => abrir(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Excluir ${c.nome}?`)) excluir.mutate(c.id); }}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          </div>
        ))}
        {chapas?.length === 0 && (
          <div className="col-span-full rounded border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhuma chapa cadastrada. Clique em "Nova chapa" para começar.
          </div>
        )}
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs">{label}</Label>{children}</div>;
}
