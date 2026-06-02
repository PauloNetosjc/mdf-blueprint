import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FACES_PERMITIDAS, TIPOS_FERRAMENTA, type Ferramenta } from "@/lib/db";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ferramentas")({
  head: () => ({ meta: [{ title: "Ferramentas — Visualizador CNC" }] }),
  component: FerramentasPage,
});

const empty = {
  nome: "",
  codigo: "",
  tipo: "furo_face",
  diametro: 8,
  profundidade_maxima: 30,
  rotacao_padrao: 18000,
  avanco_padrao: 800,
  face_permitida: "ambas" as Ferramenta["face_permitida"],
  entrada_por_cima: true,
  entrada_lateral: false,
  descida_antes_entrada_lateral: 0,
  altura_segura: 20,
  ativa: true,
};

function FerramentasPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Ferramenta | null>(null);
  const [form, setForm] = useState({ ...empty });

  const { data: ferramentas } = useQuery({
    queryKey: ["ferramentas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ferramentas").select("*").order("codigo");
      if (error) throw error;
      return data as Ferramenta[];
    },
  });

  const { data: maquina } = useQuery({
    queryKey: ["maquina-ativa"],
    queryFn: async () => {
      const { data } = await supabase.from("maquinas").select("id").eq("ativa", true).limit(1).maybeSingle();
      return data;
    },
  });

  function abrir(f?: Ferramenta) {
    if (f) {
      setEditing(f);
      setForm({
        nome: f.nome,
        codigo: f.codigo,
        tipo: f.tipo,
        diametro: f.diametro,
        profundidade_maxima: f.profundidade_maxima,
        rotacao_padrao: f.rotacao_padrao,
        avanco_padrao: f.avanco_padrao,
        face_permitida: f.face_permitida,
        entrada_por_cima: f.entrada_por_cima,
        entrada_lateral: f.entrada_lateral,
        descida_antes_entrada_lateral: f.descida_antes_entrada_lateral ?? 0,
        altura_segura: f.altura_segura,
        ativa: f.ativa,
      });
    } else {
      setEditing(null);
      setForm({ ...empty });
    }
    setOpen(true);
  }

  const salvar = useMutation({
    mutationFn: async () => {
      const payload = { ...form, maquina_id: maquina?.id ?? null };
      if (editing) {
        const { error } = await supabase.from("ferramentas").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("ferramentas").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ferramentas"] });
      toast.success(editing ? "Ferramenta atualizada" : "Ferramenta criada");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isFace = form.tipo === "furo_face" || form.tipo === "rebaixo" || form.tipo === "canal";

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ferramentas</h1>
          <p className="text-sm text-muted-foreground">Cadastro de ferramentas da furadeira CNC.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => abrir()}><Plus className="mr-2 h-4 w-4" />Nova ferramenta</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} ferramenta</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <F label="Código"><Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="T1" /></F>
              <F label="Nome"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></F>
              <F label="Tipo">
                <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TIPOS_FERRAMENTA.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </F>
              <F label="Face permitida">
                <Select value={form.face_permitida} onValueChange={(v) => setForm({ ...form, face_permitida: v as Ferramenta["face_permitida"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FACES_PERMITIDAS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </F>
              <F label="Diâmetro / largura (mm)"><Input type="number" step="0.1" value={form.diametro} onChange={(e) => setForm({ ...form, diametro: +e.target.value })} /></F>
              <F label="Profundidade máxima (mm)"><Input type="number" value={form.profundidade_maxima} onChange={(e) => setForm({ ...form, profundidade_maxima: +e.target.value })} /></F>
              <F label="Rotação padrão (RPM)"><Input type="number" value={form.rotacao_padrao} onChange={(e) => setForm({ ...form, rotacao_padrao: +e.target.value })} /></F>
              <F label="Avanço padrão (mm/min)"><Input type="number" value={form.avanco_padrao} onChange={(e) => setForm({ ...form, avanco_padrao: +e.target.value })} /></F>
              <F label="Altura segura Z (mm)"><Input type="number" value={form.altura_segura} onChange={(e) => setForm({ ...form, altura_segura: +e.target.value })} /></F>

              {isFace && (
                <>
                  <div className="col-span-2 mt-2 border-t border-border pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Ferramentas de face — entrada
                  </div>
                  <div className="flex items-center gap-2"><Switch checked={form.entrada_por_cima} onCheckedChange={(v) => setForm({ ...form, entrada_por_cima: v })} /><Label className="text-xs">Entrada por cima</Label></div>
                  <div className="flex items-center gap-2"><Switch checked={form.entrada_lateral} onCheckedChange={(v) => setForm({ ...form, entrada_lateral: v })} /><Label className="text-xs">Entrada lateral</Label></div>
                  <F label="Descida antes da entrada lateral (mm)"><Input type="number" value={form.descida_antes_entrada_lateral} onChange={(e) => setForm({ ...form, descida_antes_entrada_lateral: +e.target.value })} /></F>
                </>
              )}

              <div className="col-span-2 flex items-center gap-2 pt-2">
                <Switch checked={form.ativa} onCheckedChange={(v) => setForm({ ...form, ativa: v })} />
                <Label className="text-xs">Ativa</Label>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => salvar.mutate()} disabled={!form.codigo || !form.nome}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      <div className="overflow-hidden rounded border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Código</th>
              <th className="px-3 py-2 text-left">Nome</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-right">Ø (mm)</th>
              <th className="px-3 py-2 text-right">Prof. máx</th>
              <th className="px-3 py-2 text-left">Face</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {ferramentas?.map((f) => (
              <tr key={f.id} className="border-t border-border hover:bg-surface-2">
                <td className="px-3 py-2 font-mono font-semibold">{f.codigo}</td>
                <td className="px-3 py-2">{f.nome}</td>
                <td className="px-3 py-2 text-muted-foreground">{TIPOS_FERRAMENTA.find((t) => t.value === f.tipo)?.label}</td>
                <td className="px-3 py-2 text-right font-mono">{f.diametro}</td>
                <td className="px-3 py-2 text-right font-mono">{f.profundidade_maxima}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{FACES_PERMITIDAS.find((p) => p.value === f.face_permitida)?.label}</td>
                <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${f.ativa ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{f.ativa ? "ativa" : "inativa"}</span></td>
                <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => abrir(f)}><Pencil className="h-3.5 w-3.5" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs">{label}</Label>{children}</div>;
}
