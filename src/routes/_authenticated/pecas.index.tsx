import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Upload, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pecas/")({
  head: () => ({ meta: [{ title: "Peças — Visualizador CNC" }] }),
  component: PecasList,
});

function PecasList() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    codigo: "",
    nome: "",
    cliente: "",
    ambiente: "",
    largura: 600,
    altura: 90,
    espessura: 15.5,
  });

  const { data: pecas } = useQuery({
    queryKey: ["pecas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pecas")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const criar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("pecas")
        .insert({
          codigo: form.codigo,
          nome: form.nome,
          cliente: form.cliente || null,
          ambiente: form.ambiente || null,
          largura: form.largura,
          altura: form.altura,
          espessura: form.espessura,
          face_alinhamento: "A",
          status: "rascunho",
        })
        .select()
        .single();
      if (error) throw error;
      // cria faces padrão
      await supabase.from("faces").insert(
        [0, 1, 2, 3, 4].map((n) => ({
          peca_id: data.id,
          numero_face: n,
          nome_face: n === 0 ? "Face Superior" : `Face ${n}`,
        })),
      );
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["pecas"] });
      setOpen(false);
      toast.success("Peça criada");
      navigate({ to: "/pecas/$id", params: { id: data.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Peças</h1>
          <p className="text-sm text-muted-foreground">Fichas técnicas cadastradas.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/pecas/importar">
              <Upload className="mr-2 h-4 w-4" />
              Importar PDF / imagem
            </Link>
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Nova peça
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova peça</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Código">
                  <Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
                </Field>
                <Field label="Nome">
                  <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
                </Field>
                <Field label="Cliente">
                  <Input value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} />
                </Field>
                <Field label="Ambiente">
                  <Input value={form.ambiente} onChange={(e) => setForm({ ...form, ambiente: e.target.value })} />
                </Field>
                <Field label="Largura (mm)">
                  <Input type="number" value={form.largura} onChange={(e) => setForm({ ...form, largura: +e.target.value })} />
                </Field>
                <Field label="Altura/Profundidade (mm)">
                  <Input type="number" value={form.altura} onChange={(e) => setForm({ ...form, altura: +e.target.value })} />
                </Field>
                <Field label="Espessura (mm)">
                  <Input type="number" step="0.1" value={form.espessura} onChange={(e) => setForm({ ...form, espessura: +e.target.value })} />
                </Field>
              </div>
              <DialogFooter>
                <Button onClick={() => criar.mutate()} disabled={!form.codigo || !form.nome}>
                  Criar peça
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <div className="overflow-hidden rounded border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Código</th>
              <th className="px-3 py-2 text-left">Nome</th>
              <th className="px-3 py-2 text-left">Cliente</th>
              <th className="px-3 py-2 text-left">Ambiente</th>
              <th className="px-3 py-2 text-right">L × A × E</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {pecas?.map((p) => (
              <tr key={p.id} className="border-t border-border hover:bg-surface-2">
                <td className="px-3 py-2 font-mono font-semibold">
                  <Link to="/pecas/$id" params={{ id: p.id }} className="hover:underline">
                    {p.codigo}
                  </Link>
                </td>
                <td className="px-3 py-2">{p.nome}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.cliente}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.ambiente}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {p.largura} × {p.altura} × {p.espessura}
                </td>
                <td className="px-3 py-2">
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">{p.status}</span>
                </td>
              </tr>
            ))}
            {!pecas?.length && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  <FileText className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  Nenhuma peça cadastrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
