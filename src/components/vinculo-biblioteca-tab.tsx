import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Wand2, Link2, Search, CheckCircle2, XCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  processarVinculosProjeto, vincularManual, type ModoReprocesso,
} from "@/lib/vinculo-pecas-cadastradas";

type Vinc = {
  id: string;
  projeto_peca_id: string;
  peca_cadastrada_id: string | null;
  tipo_vinculo: string;
  confianca: string;
  status: string;
  motivo: string | null;
};

type Peca = {
  id: string;
  descricao: string;
  codigo_peca: string | null;
  largura: number;
  altura: number;
  espessura: number;
  fita_codigo: string | null;
};

type PecaCad = {
  id: string;
  codigo_completo: string | null;
  nome: string | null;
  tipo_peca: string | null;
};

function tomBadge(c: string): "default" | "secondary" | "outline" | "destructive" {
  if (c === "alta") return "default";
  if (c === "media") return "secondary";
  if (c === "baixa") return "outline";
  return "outline";
}

export function VinculoBibliotecaTab({ projetoId }: { projetoId: string }) {
  const qc = useQueryClient();
  const [modo, setModo] = useState<ModoReprocesso>("ausentes");
  const [busca, setBusca] = useState("");
  const [modal, setModal] = useState<{ pecaId: string } | null>(null);

  const pecas = useQuery({
    queryKey: ["projeto-pecas", projetoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projeto_pecas")
        .select("id, descricao, codigo_peca, largura, altura, espessura, fita_codigo")
        .eq("projeto_id", projetoId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as Peca[];
    },
  });

  const vincs = useQuery({
    queryKey: ["vincs-biblio", projetoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vinculos_peca_cadastrada")
        .select("*")
        .eq("projeto_id", projetoId);
      if (error) throw error;
      return (data ?? []) as Vinc[];
    },
  });

  const cadIds = [...new Set((vincs.data ?? []).map((v) => v.peca_cadastrada_id).filter(Boolean))] as string[];
  const cads = useQuery({
    queryKey: ["cad-detalhes", cadIds.sort().join(",")],
    enabled: cadIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pecas_cadastradas")
        .select("id, codigo_completo, nome, tipo_peca")
        .in("id", cadIds);
      if (error) throw error;
      return (data ?? []) as PecaCad[];
    },
  });

  const contagens = useQuery({
    queryKey: ["vinc-contagens", projetoId],
    queryFn: async () => {
      const [op, bd] = await Promise.all([
        supabase.from("peca_operacoes_importadas").select("projeto_peca_id", { count: "exact", head: false })
          .eq("projeto_id", projetoId).eq("origem", "biblioteca_pecas_cadastradas"),
        supabase.from("peca_bordas_importadas").select("projeto_peca_id", { count: "exact", head: false })
          .eq("projeto_id", projetoId),
      ]);
      const opCount = new Map<string, number>();
      for (const r of (op.data ?? []) as any[]) opCount.set(r.projeto_peca_id, (opCount.get(r.projeto_peca_id) ?? 0) + 1);
      const bdCount = new Map<string, number>();
      for (const r of (bd.data ?? []) as any[]) bdCount.set(r.projeto_peca_id, (bdCount.get(r.projeto_peca_id) ?? 0) + 1);
      return { opCount, bdCount };
    },
  });

  const reprocessar = useMutation({
    mutationFn: async () => processarVinculosProjeto(projetoId, { modo }),
    onSuccess: (log) => {
      toast.success(`Reprocessado: ${log.operacoes_importadas} ops, ${log.bordas_importadas} bordas, ${log.sem_vinculo} sem vínculo`);
      qc.invalidateQueries({ queryKey: ["vincs-biblio", projetoId] });
      qc.invalidateQueries({ queryKey: ["vinc-contagens", projetoId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const aprovar = useMutation({
    mutationFn: async (vinc: Vinc) => {
      const { error } = await supabase.from("vinculos_peca_cadastrada")
        .update({ status: "vinculado" }).eq("id", vinc.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vincs-biblio", projetoId] }),
  });

  const rejeitar = useMutation({
    mutationFn: async (vinc: Vinc) => {
      await supabase.from("vinculos_peca_cadastrada")
        .update({ status: "rejeitado", peca_cadastrada_id: null }).eq("id", vinc.id);
      await supabase.from("peca_operacoes_importadas").delete()
        .eq("projeto_peca_id", vinc.projeto_peca_id)
        .eq("origem", "biblioteca_pecas_cadastradas")
        .is("convertida_operacao_id", null);
      await supabase.from("peca_bordas_importadas").delete()
        .eq("projeto_peca_id", vinc.projeto_peca_id)
        .neq("status", "revisada");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vincs-biblio", projetoId] });
      qc.invalidateQueries({ queryKey: ["vinc-contagens", projetoId] });
    },
  });

  const cadMap = new Map((cads.data ?? []).map((c) => [c.id, c]));
  const vincMap = new Map((vincs.data ?? []).map((v) => [v.projeto_peca_id, v]));

  const pecasFiltradas = (pecas.data ?? []).filter((p) => {
    if (!busca.trim()) return true;
    const q = busca.toLowerCase();
    return (
      p.descricao.toLowerCase().includes(q) ||
      (p.codigo_peca ?? "").toLowerCase().includes(q)
    );
  });

  // Resumo
  const total = pecas.data?.length ?? 0;
  const semVinc = (vincs.data ?? []).filter((v) => !v.peca_cadastrada_id).length;
  const altaConf = (vincs.data ?? []).filter((v) => v.confianca === "alta" && v.peca_cadastrada_id).length;
  const baixaConf = (vincs.data ?? []).filter((v) => v.confianca === "baixa" && v.peca_cadastrada_id).length;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface p-3">
        <div className="flex items-center gap-3 text-sm">
          <span>{total} peças</span>
          <span className="flex items-center gap-1 text-success"><CheckCircle2 className="h-3 w-3" /> {altaConf} alta confiança</span>
          <span className="flex items-center gap-1 text-warning"><AlertTriangle className="h-3 w-3" /> {baixaConf} baixa confiança</span>
          <span className="flex items-center gap-1 text-destructive"><XCircle className="h-3 w-3" /> {semVinc} sem vínculo</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar peça…" className="h-8 w-44 pl-7 text-xs" />
          </div>
          <Select value={modo} onValueChange={(v) => setModo(v as ModoReprocesso)}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ausentes">Apenas sem vínculo</SelectItem>
              <SelectItem value="baixa_confianca">Apenas baixa confiança</SelectItem>
              <SelectItem value="todos">Todas as peças</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => reprocessar.mutate()} disabled={reprocessar.isPending}>
            <RefreshCw className={`mr-1 h-3 w-3 ${reprocessar.isPending ? "animate-spin" : ""}`} />
            Reprocessar
          </Button>
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Peça do projeto</th>
              <th className="p-2 text-left">Código</th>
              <th className="p-2 text-right">Dimensões</th>
              <th className="p-2 text-left">Peça cadastrada</th>
              <th className="p-2 text-left">Vínculo</th>
              <th className="p-2 text-left">Confiança</th>
              <th className="p-2 text-right">Ops</th>
              <th className="p-2 text-right">Bordas</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {pecasFiltradas.map((p) => {
              const v = vincMap.get(p.id);
              const cad = v?.peca_cadastrada_id ? cadMap.get(v.peca_cadastrada_id) : undefined;
              const op = contagens.data?.opCount.get(p.id) ?? 0;
              const bd = contagens.data?.bdCount.get(p.id) ?? 0;
              return (
                <tr key={p.id} className="border-t border-border hover:bg-surface-2">
                  <td className="p-2">{p.descricao}</td>
                  <td className="p-2 font-mono text-xs">{p.codigo_peca ?? "—"}</td>
                  <td className="p-2 text-right font-mono text-xs">{p.largura}×{p.altura}×{p.espessura}</td>
                  <td className="p-2">
                    {cad ? (
                      <Link to="/pecas/cadastradas/$id" params={{ id: cad.id }} className="text-primary hover:underline">
                        <span className="font-mono">{cad.codigo_completo}</span>
                        <span className="ml-1 text-xs text-muted-foreground">{cad.tipo_peca}</span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-2 text-xs">
                    {v ? <Badge variant="outline">{v.tipo_vinculo}</Badge> : <Badge variant="outline">—</Badge>}
                  </td>
                  <td className="p-2 text-xs">
                    {v ? <Badge variant={tomBadge(v.confianca)}>{v.confianca}</Badge> : "—"}
                  </td>
                  <td className="p-2 text-right font-mono text-xs">{op || "—"}</td>
                  <td className="p-2 text-right font-mono text-xs">{bd || "—"}</td>
                  <td className="p-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setModal({ pecaId: p.id })}>
                        <Link2 className="h-3 w-3" />
                      </Button>
                      {v?.peca_cadastrada_id && v.status !== "vinculado" && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-success" onClick={() => aprovar.mutate(v)}>
                          <CheckCircle2 className="h-3 w-3" />
                        </Button>
                      )}
                      {v?.peca_cadastrada_id && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => rejeitar.mutate(v)}>
                          <XCircle className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {pecasFiltradas.length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Nenhuma peça.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <ModalVincularManual
          projetoId={projetoId}
          projetoPecaId={modal.pecaId}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            qc.invalidateQueries({ queryKey: ["vincs-biblio", projetoId] });
            qc.invalidateQueries({ queryKey: ["vinc-contagens", projetoId] });
          }}
        />
      )}
    </div>
  );
}

function ModalVincularManual({
  projetoId, projetoPecaId, onClose, onDone,
}: { projetoId: string; projetoPecaId: string; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState("");
  const busca = useQuery({
    queryKey: ["cad-busca", q],
    enabled: q.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pecas_cadastradas")
        .select("id, codigo_completo, nome, tipo_peca, largura_ref, altura_ref")
        .or(`codigo_completo.ilike.%${q}%,nome.ilike.%${q}%`)
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const vinc = useMutation({
    mutationFn: async (pecaCadId: string) => vincularManual(projetoId, projetoPecaId, pecaCadId, true),
    onSuccess: (log) => {
      toast.success(`Vinculado: ${log.operacoes_importadas} ops, ${log.bordas_importadas} bordas`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Vincular Peça Cadastrada</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por código ou nome (ex: BAS1101A)" />
          <div className="max-h-80 overflow-auto rounded border border-border">
            {(busca.data ?? []).map((c) => (
              <button
                key={c.id}
                onClick={() => vinc.mutate(c.id)}
                disabled={vinc.isPending}
                className="block w-full border-b border-border px-3 py-2 text-left text-xs hover:bg-surface-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono">{c.codigo_completo}</span>
                  <Badge variant="outline">{c.tipo_peca ?? "—"}</Badge>
                </div>
                <div className="text-muted-foreground">{c.nome ?? "—"} · ref {c.largura_ref}×{c.altura_ref}</div>
              </button>
            ))}
            {q.length >= 2 && (busca.data ?? []).length === 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground">Nenhuma peça encontrada</div>
            )}
            {q.length < 2 && (
              <div className="p-4 text-center text-xs text-muted-foreground">Digite ao menos 2 caracteres</div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Pequeno bloco "Engenharia cadastrada" para o editor da peça
export function EngenhariaCadastradaBox({ projetoPecaId }: { projetoPecaId: string }) {
  const vinc = useQuery({
    queryKey: ["vinc-peca", projetoPecaId],
    queryFn: async () => {
      const { data } = await supabase
        .from("vinculos_peca_cadastrada")
        .select("*")
        .eq("projeto_peca_id", projetoPecaId)
        .maybeSingle();
      return data;
    },
  });
  const cadId = (vinc.data as any)?.peca_cadastrada_id as string | undefined;
  const cad = useQuery({
    queryKey: ["cad-info", cadId],
    enabled: !!cadId,
    queryFn: async () => {
      const { data } = await supabase
        .from("pecas_cadastradas")
        .select("id, codigo_completo, nome, tipo_peca")
        .eq("id", cadId!).maybeSingle();
      return data;
    },
  });

  if (!vinc.data) return null;
  const v: any = vinc.data;
  return (
    <div className="border-t border-border p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">Engenharia cadastrada</span>
        <Badge variant={v.confianca === "alta" ? "default" : v.confianca === "media" ? "secondary" : "outline"}>
          {v.tipo_vinculo} · {v.confianca}
        </Badge>
      </div>
      {cad.data ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-mono">{cad.data.codigo_completo}</span>
            <Link to="/pecas/cadastradas/$id" params={{ id: cad.data.id }}>
              <Button size="sm" variant="ghost" className="h-6"><ExternalLink className="h-3 w-3" /></Button>
            </Link>
          </div>
          <div className="text-muted-foreground">{cad.data.tipo_peca} · {cad.data.nome ?? "—"}</div>
          {v.motivo && <div className="text-[10px] text-muted-foreground">{v.motivo}</div>}
        </div>
      ) : (
        <div className="text-muted-foreground">Sem peça cadastrada vinculada.</div>
      )}
    </div>
  );
}
