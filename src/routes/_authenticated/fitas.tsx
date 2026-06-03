import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/fitas")({
  head: () => ({ meta: [{ title: "Fitas — Visualizador CNC" }] }),
  component: FitasPage,
});

type Fita = {
  id: string;
  codigo: string;
  descricao: string;
  cor: string;
  espessura: number;
  largura: number;
  chapa_id: string | null;
  estoque_m: number;
  custo: number;
};

export const LEGENDA_FITA = [
  { codigo: "@1", desc: "2 curtos" },
  { codigo: "@2", desc: "2 longos" },
  { codigo: "@3", desc: "4 lados" },
  { codigo: "@4", desc: "1 curto + 1 longo" },
  { codigo: "@5", desc: "2 longos + 1 curto" },
  { codigo: "@6", desc: "2 curtos + 1 longo" },
  { codigo: "@7", desc: "1 curto" },
  { codigo: "@8", desc: "1 longo" },
];

const empty = {
  codigo: "", descricao: "", cor: "#cccccc",
  espessura: 0.45, largura: 22, chapa_id: null as string | null,
  estoque_m: 0, custo: 0,
};

function FitasPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Fita | null>(null);
  const [form, setForm] = useState({ ...empty });

  const { data: fitas } = useQuery({
    queryKey: ["fitas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fitas").select("*").order("codigo");
      if (error) throw error;
      return data as Fita[];
    },
  });

  const { data: chapas } = useQuery({
    queryKey: ["chapas"],
    queryFn: async () => {
      const { data } = await supabase.from("chapas").select("id, nome");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  function abrir(f?: Fita) {
    if (f) {
      setEditing(f);
      setForm({
        codigo: f.codigo, descricao: f.descricao, cor: f.cor,
        espessura: f.espessura, largura: f.largura, chapa_id: f.chapa_id,
        estoque_m: f.estoque_m, custo: f.custo,
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
        const { error } = await supabase.from("fitas").update(form).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("fitas").insert(form);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fitas"] });
      toast.success("Salvo");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fitas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fitas"] }); toast.success("Excluída"); },
  });

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fitas de Borda</h1>
          <p className="text-sm text-muted-foreground">Fitas disponíveis para colagem nas peças.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => abrir()}><Plus className="mr-2 h-4 w-4" />Nova fita</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} fita</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <F label="Código"><Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} /></F>
              <F label="Descrição"><Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></F>
              <F label="Cor">
                <div className="flex items-center gap-2">
                  <Input type="color" value={form.cor} onChange={(e) => setForm({ ...form, cor: e.target.value })} className="h-10 w-16 cursor-pointer p-1" />
                  <Input value={form.cor} onChange={(e) => setForm({ ...form, cor: e.target.value })} className="font-mono" />
                </div>
              </F>
              <F label="Chapa relacionada">
                <Select value={form.chapa_id ?? "_none"} onValueChange={(v) => setForm({ ...form, chapa_id: v === "_none" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— sem vínculo —</SelectItem>
                    {chapas?.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </F>
              <F label="Espessura (mm)"><Input type="number" step="0.01" value={form.espessura} onChange={(e) => setForm({ ...form, espessura: +e.target.value })} /></F>
              <F label="Largura (mm)"><Input type="number" value={form.largura} onChange={(e) => setForm({ ...form, largura: +e.target.value })} /></F>
              <F label="Estoque (m)"><Input type="number" value={form.estoque_m} onChange={(e) => setForm({ ...form, estoque_m: +e.target.value })} /></F>
              <F label="Custo (R$/m)"><Input type="number" step="0.01" value={form.custo} onChange={(e) => setForm({ ...form, custo: +e.target.value })} /></F>
            </div>
            <DialogFooter>
              <Button onClick={() => salvar.mutate()} disabled={!form.codigo || !form.descricao}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      <div className="grid grid-cols-[1fr_320px] gap-4">
        <div className="overflow-hidden rounded border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Cor</th>
                <th className="px-3 py-2 text-left">Código</th>
                <th className="px-3 py-2 text-left">Descrição</th>
                <th className="px-3 py-2 text-right">Espess.</th>
                <th className="px-3 py-2 text-right">Larg.</th>
                <th className="px-3 py-2 text-right">Estoque (m)</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {fitas?.map((f) => (
                <tr key={f.id} className="border-t border-border hover:bg-surface-2">
                  <td className="px-3 py-2"><div className="h-5 w-10 rounded border border-border" style={{ background: f.cor }} /></td>
                  <td className="px-3 py-2 font-mono font-semibold">{f.codigo}</td>
                  <td className="px-3 py-2">{f.descricao}</td>
                  <td className="px-3 py-2 text-right font-mono">{f.espessura}</td>
                  <td className="px-3 py-2 text-right font-mono">{f.largura}</td>
                  <td className="px-3 py-2 text-right font-mono">{f.estoque_m}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => abrir(f)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Excluir ${f.codigo}?`)) excluir.mutate(f.id); }}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
              {fitas?.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Nenhuma fita cadastrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <aside className="rounded border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Legenda de aplicação</h3>
          <ul className="space-y-1.5 text-sm">
            {LEGENDA_FITA.map((l) => (
              <li key={l.codigo} className="flex items-baseline gap-3">
                <span className="w-8 font-mono font-bold text-primary">{l.codigo}</span>
                <span className="text-muted-foreground">{l.desc}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Use estes códigos na coluna "Fita" da tabela de peças do projeto.
          </p>
        </aside>
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs">{label}</Label>{children}</div>;
}
