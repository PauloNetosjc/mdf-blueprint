import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Maquina } from "@/lib/db";
import { toast } from "sonner";
import { Save } from "lucide-react";

export const Route = createFileRoute("/maquina")({
  head: () => ({ meta: [{ title: "Máquina — Visualizador CNC" }] }),
  component: MaquinaPage,
});

function MaquinaPage() {
  const qc = useQueryClient();
  const { data: maquina } = useQuery({
    queryKey: ["maquina-edit"],
    queryFn: async () => {
      const { data } = await supabase.from("maquinas").select("*").eq("ativa", true).limit(1).maybeSingle();
      return data as Maquina | null;
    },
  });

  const [form, setForm] = useState<Maquina | null>(null);
  useEffect(() => { if (maquina) setForm(maquina); }, [maquina]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const { error } = await supabase.from("maquinas").update(form).eq("id", form.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maquina-edit"] });
      toast.success("Máquina salva");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!form) return <div className="p-6 text-muted-foreground">Carregando...</div>;

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Máquina / Pós-processador</h1>
          <p className="text-sm text-muted-foreground">Configurações da furadeira CNC e templates de geração de G-code.</p>
        </div>
        <Button onClick={() => salvar.mutate()}><Save className="mr-2 h-4 w-4" />Salvar</Button>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Identificação e limites</h2>
          <div className="grid grid-cols-2 gap-3">
            <F label="Nome"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></F>
            <F label="Unidade"><Input value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} /></F>
            <F label="X máximo (mm)"><Input type="number" value={form.area_x} onChange={(e) => setForm({ ...form, area_x: +e.target.value })} /></F>
            <F label="Y máximo (mm)"><Input type="number" value={form.area_y} onChange={(e) => setForm({ ...form, area_y: +e.target.value })} /></F>
            <F label="Z máximo (mm)"><Input type="number" value={form.area_z} onChange={(e) => setForm({ ...form, area_z: +e.target.value })} /></F>
            <F label="Altura segura Z (mm)"><Input type="number" value={form.altura_segura_z} onChange={(e) => setForm({ ...form, altura_segura_z: +e.target.value })} /></F>
            <F label="Origem padrão"><Input value={form.origem_padrao} onChange={(e) => setForm({ ...form, origem_padrao: e.target.value })} /></F>
          </div>
        </section>

        <section className="rounded border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Mapeamento de faces (eixos)</h2>
          <Textarea
            className="font-mono text-xs"
            rows={10}
            value={JSON.stringify(form.mapeamento_faces, null, 2)}
            onChange={(e) => {
              try { setForm({ ...form, mapeamento_faces: JSON.parse(e.target.value) }); } catch { /* noop */ }
            }}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Como cada face da peça é mapeada para os eixos da máquina ao gerar o G-code.
          </p>
        </section>
      </div>

      <section className="mt-6 rounded border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Templates do pós-processador</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Use placeholders: <code className="font-mono">{"{X} {Y} {Z} {Z_FINAL} {DEPTH} {FEED} {RPM} {TOOL_CODE} {TOOL_NAME} {TOOL_NUM} {ALTURA_SEGURA} {FACE}"}</code>
        </p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <T label="Início de programa" v={form.template_inicio} on={(v) => setForm({ ...form, template_inicio: v })} />
          <T label="Fim de programa" v={form.template_fim} on={(v) => setForm({ ...form, template_fim: v })} />
          <T label="Troca de ferramenta" v={form.template_troca_ferramenta} on={(v) => setForm({ ...form, template_troca_ferramenta: v })} />
          <T label="Ligar spindle" v={form.template_spindle_on} on={(v) => setForm({ ...form, template_spindle_on: v })} />
          <T label="Desligar spindle" v={form.template_spindle_off} on={(v) => setForm({ ...form, template_spindle_off: v })} />
          <T label="Furação de face (Face 0)" v={form.template_furacao_face} on={(v) => setForm({ ...form, template_furacao_face: v })} />
          <T label="Furação lateral/topo (Faces 1-4)" v={form.template_furacao_lateral} on={(v) => setForm({ ...form, template_furacao_lateral: v })} />
        </div>
      </section>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs">{label}</Label>{children}</div>;
}
function T({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Textarea className="font-mono text-xs" rows={5} value={v} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
