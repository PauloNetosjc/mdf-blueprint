import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, FolderKanban, Archive, Trash2, ArrowRight, Search, Cpu, GitBranch, Upload, History } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";

export const Route = createFileRoute("/_authenticated/projetos/")({
  head: () => ({ meta: [{ title: "Projetos — Visualizador CNC" }] }),
  component: ProjetosPage,
});

type Projeto = {
  id: string;
  nome: string;
  cliente: string | null;
  ambiente: string | null;
  observacao: string | null;
  status: string;
  created_at: string;
};

const STATUS = [
  { value: "ativo", label: "Ativo", color: "bg-blue-500/10 text-blue-400" },
  { value: "aguardando_plano", label: "Aguardando plano", color: "bg-amber-500/10 text-amber-400" },
  { value: "plano_gerado", label: "Plano gerado", color: "bg-emerald-500/10 text-emerald-400" },
  { value: "em_producao", label: "Em produção", color: "bg-violet-500/10 text-violet-400" },
  { value: "concluido", label: "Concluído", color: "bg-success/10 text-success" },
  { value: "arquivado", label: "Arquivado", color: "bg-muted text-muted-foreground" },
];

function statusInfo(s: string) { return STATUS.find((x) => x.value === s) ?? STATUS[0]; }

function ProjetosPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filtro, setFiltro] = useState<string>("todos");
  const [busca, setBusca] = useState<string>("");
  const [form, setForm] = useState({ nome: "", cliente: "", ambiente: "", observacao: "" });

  const { data: projetos } = useQuery({
    queryKey: ["projetos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projetos").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Projeto[];
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["projetos-stats"],
    queryFn: async () => {
      const [{ data: pp }, { data: pc }] = await Promise.all([
        supabase.from("projeto_pecas").select("projeto_id, quantidade"),
        supabase.from("planos_corte").select("projeto_id, total_chapas, aproveitamento_medio").order("created_at", { ascending: false }),
      ]);
      const map = new Map<string, { pecas: number; chapas: number; aprov: number }>();
      (pp ?? []).forEach((r: any) => {
        const cur = map.get(r.projeto_id) ?? { pecas: 0, chapas: 0, aprov: 0 };
        cur.pecas += r.quantidade ?? 1;
        map.set(r.projeto_id, cur);
      });
      const seen = new Set<string>();
      (pc ?? []).forEach((r: any) => {
        if (seen.has(r.projeto_id)) return;
        seen.add(r.projeto_id);
        const cur = map.get(r.projeto_id) ?? { pecas: 0, chapas: 0, aprov: 0 };
        cur.chapas = r.total_chapas ?? 0;
        cur.aprov = r.aproveitamento_medio ?? 0;
        map.set(r.projeto_id, cur);
      });
      return map;
    },
  });

  const criar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("projetos").insert({
        nome: form.nome,
        cliente: form.cliente || null,
        ambiente: form.ambiente || null,
        observacao: form.observacao || null,
        status: "ativo",
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projetos"] });
      toast.success("Projeto criado");
      setOpen(false);
      setForm({ nome: "", cliente: "", ambiente: "", observacao: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const arquivar = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("projetos").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projetos"] }),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("projetos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projetos"] }); toast.success("Excluído"); },
  });

  const buscaLower = busca.trim().toLowerCase();
  const lista = (projetos ?? [])
    .filter((p) => filtro === "todos" ? true : p.status === filtro)
    .filter((p) => !buscaLower ? true : (
      p.nome.toLowerCase().includes(buscaLower) ||
      (p.cliente ?? "").toLowerCase().includes(buscaLower) ||
      (p.ambiente ?? "").toLowerCase().includes(buscaLower)
    ));

  return (
    <div className="p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projetos</h1>
          <p className="text-sm text-muted-foreground">Painel de produção de ambientes e peças.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por projeto, cliente, ambiente…"
              className="h-9 w-64 pl-8"
            />
          </div>
          <Select value={filtro} onValueChange={setFiltro}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              {STATUS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Link to="/projetos/importacoes">
            <Button variant="outline"><History className="mr-2 h-4 w-4" />Importações</Button>
          </Link>
          <Link to="/projetos/importacoes">
            <Button variant="outline"><Upload className="mr-2 h-4 w-4" />Importar Projeto</Button>
          </Link>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" />Novo Projeto Manual</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo Projeto Manual</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <F label="Nome do projeto *"><Input autoFocus value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></F>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Cliente"><Input value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} /></F>
                  <F label="Ambiente"><Input value={form.ambiente} onChange={(e) => setForm({ ...form, ambiente: e.target.value })} /></F>
                </div>
                <F label="Observação"><Textarea rows={3} value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} /></F>
              </div>
              <DialogFooter>
                <Button onClick={() => criar.mutate()} disabled={!form.nome}>Criar projeto</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {lista.map((p) => {
          const st = stats?.get(p.id) ?? { pecas: 0, chapas: 0, aprov: 0 };
          return (
            <div key={p.id} className="flex flex-col rounded border border-border bg-surface p-4 transition-colors hover:border-border-strong">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FolderKanban className="h-4 w-4 shrink-0 text-primary" />
                    <h3 className="truncate font-semibold">{p.nome}</h3>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[p.cliente, p.ambiente].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <StatusBadge status={p.status} />
              </div>


              <div className="mb-3 grid grid-cols-3 gap-2 rounded bg-surface-2 p-2 text-center">
                <Stat label="Peças" value={st.pecas} />
                <Stat label="Chapas" value={st.chapas} />
                <Stat label="Aprov." value={st.aprov ? `${Math.round(st.aprov * 100)}%` : "—"} />
              </div>

              {p.observacao && <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{p.observacao}</p>}

              <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                <div className="text-[11px] text-muted-foreground">
                  {new Date(p.created_at).toLocaleDateString("pt-BR")}
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => arquivar.mutate({ id: p.id, status: p.status === "arquivado" ? "ativo" : "arquivado" })}>
                    <Archive className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Excluir "${p.nome}"? Esta ação remove todas as peças do projeto.`)) excluir.mutate(p.id); }}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                  <Link to="/projetos/$id/fluxo" params={{ id: p.id }}>
                    <Button size="sm" variant="outline" title="Fluxo do projeto">
                      <GitBranch className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                  <Link to="/projetos/$id/plano" params={{ id: p.id }}>
                    <Button size="sm" variant="outline" title="Abrir plano de corte">
                      <Cpu className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                  <Link to="/projetos/$id" params={{ id: p.id }}>
                    <Button size="sm">Abrir<ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
        {lista.length === 0 && (
          <div className="col-span-full rounded border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
            Nenhum projeto {filtro !== "todos" || busca ? "no filtro/busca atual" : "ainda"}. Clique em "Novo Projeto" para começar.
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs">{label}</Label>{children}</div>;
}
