import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TIPOS_OPERACAO, type Ferramenta, type Operacao } from "@/lib/db";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onClose: () => void;
  pecaId: string;
  face: number;
  ferramentas: Ferramenta[];
  nextOrdem: number;
  edit?: Operacao | null;
};

export function OperationDialog({ open, onClose, pecaId, face, ferramentas, nextOrdem, edit }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    tipo: edit?.tipo ?? "furacao",
    x: edit?.x ?? 0,
    y: edit?.y ?? 0,
    z: edit?.z ?? 0,
    diametro: edit?.diametro ?? 8,
    largura: edit?.largura ?? 0,
    comprimento: edit?.comprimento ?? 0,
    profundidade: edit?.profundidade ?? 13,
    ferramenta_id: edit?.ferramenta_id ?? "",
    observacao: edit?.observacao ?? "",
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.ferramenta_id) throw new Error("Selecione uma ferramenta para a operação.");
      const payload = {
        peca_id: pecaId,
        numero_face: face,
        ferramenta_id: form.ferramenta_id,
        tipo: form.tipo,
        x: form.x,
        y: form.y,
        z: form.z || null,
        diametro: form.diametro || null,
        largura: form.largura || null,
        comprimento: form.comprimento || null,
        profundidade: form.profundidade,
        ordem: edit?.ordem ?? nextOrdem,
        observacao: form.observacao || null,
      };
      if (edit) {
        const { error } = await supabase.from("operacoes").update(payload).eq("id", edit.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("operacoes").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["peca", pecaId] });
      toast.success(edit ? "Operação atualizada" : "Operação adicionada");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{edit ? "Editar operação" : "Nova operação"} — Face {face}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">Tipo</Label>
            <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS_OPERACAO.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Ferramenta (obrigatório)</Label>
            <Select value={form.ferramenta_id} onValueChange={(v) => setForm({ ...form, ferramenta_id: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione uma ferramenta..." /></SelectTrigger>
              <SelectContent>
                {ferramentas.filter((f) => f.ativa).map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.codigo} — {f.nome} (Ø{f.diametro})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <F label="X (mm)"><Input type="number" step="0.1" value={form.x} onChange={(e) => setForm({ ...form, x: +e.target.value })} /></F>
          <F label="Y (mm)"><Input type="number" step="0.1" value={form.y} onChange={(e) => setForm({ ...form, y: +e.target.value })} /></F>
          <F label="Diâmetro (mm)"><Input type="number" step="0.1" value={form.diametro} onChange={(e) => setForm({ ...form, diametro: +e.target.value })} /></F>
          <F label="Profundidade (mm)"><Input type="number" step="0.1" value={form.profundidade} onChange={(e) => setForm({ ...form, profundidade: +e.target.value })} /></F>
          <F label="Largura (mm, opcional)"><Input type="number" value={form.largura} onChange={(e) => setForm({ ...form, largura: +e.target.value })} /></F>
          <F label="Comprimento (mm, opcional)"><Input type="number" value={form.comprimento} onChange={(e) => setForm({ ...form, comprimento: +e.target.value })} /></F>
          <div className="col-span-2">
            <Label className="text-xs">Observação</Label>
            <Textarea rows={2} value={form.observacao ?? ""} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()}>{edit ? "Salvar" : "Adicionar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
