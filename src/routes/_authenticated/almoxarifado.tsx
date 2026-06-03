import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Plus,
  Search,
  AlertTriangle,
  Check,
  X,
  Printer,
  Upload,
  Package,
  History,
  ClipboardList,
  PackageX,
} from "lucide-react";
import {
  CATEGORIAS_ALMOX,
  UNIDADES_ALMOX,
  STATUS_SEPARACAO,
  TIPOS_MOVIMENTO,
  statusInfo,
} from "@/lib/almoxarifado";

export const Route = createFileRoute("/_authenticated/almoxarifado")({
  head: () => ({ meta: [{ title: "Almoxarifado — Visualizador CNC" }] }),
  component: AlmoxarifadoPage,
});

type ItemCatalogo = {
  id: string;
  referencia: string;
  descricao: string;
  categoria: string;
  unidade: string;
  estoque_atual: number;
  estoque_minimo: number;
  custo_unitario: number;
  ativo: boolean;
};

type ProjetoItem = {
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
  separado_por: string | null;
  separado_em: string | null;
  observacao: string | null;
  origem: string;
};

type Movimento = {
  id: string;
  item_catalogo_id: string | null;
  projeto_id: string | null;
  tipo_movimento: string;
  quantidade: number;
  unidade: string;
  origem: string | null;
  operador: string | null;
  observacao: string | null;
  criado_em: string;
};

function AlmoxarifadoPage() {
  const [tab, setTab] = useState("catalogo");

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="border-b border-border-strong bg-panel px-6 py-4">
        <div className="flex items-center gap-3">
          <Package className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Almoxarifado</h1>
            <p className="text-xs text-muted-foreground">
              Catálogo de itens, separação por projeto e movimentações de estoque.
            </p>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col">
        <TabsList className="mx-6 mt-3 self-start">
          <TabsTrigger value="catalogo">
            <Package className="mr-2 h-4 w-4" /> Catálogo
          </TabsTrigger>
          <TabsTrigger value="separacao">
            <ClipboardList className="mr-2 h-4 w-4" /> Separação por Projeto
          </TabsTrigger>
          <TabsTrigger value="movimentos">
            <History className="mr-2 h-4 w-4" /> Movimentações
          </TabsTrigger>
          <TabsTrigger value="faltas">
            <PackageX className="mr-2 h-4 w-4" /> Faltas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="catalogo" className="flex-1 overflow-auto p-6 pt-3">
          <CatalogoTab />
        </TabsContent>
        <TabsContent value="separacao" className="flex-1 overflow-auto p-6 pt-3">
          <SeparacaoTab />
        </TabsContent>
        <TabsContent value="movimentos" className="flex-1 overflow-auto p-6 pt-3">
          <MovimentosTab />
        </TabsContent>
        <TabsContent value="faltas" className="flex-1 overflow-auto p-6 pt-3">
          <FaltasTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// Catálogo
// ============================================================
const emptyItem = {
  referencia: "",
  descricao: "",
  categoria: "ferragem",
  unidade: "un",
  estoque_atual: 0,
  estoque_minimo: 0,
  custo_unitario: 0,
  ativo: true,
};

function CatalogoTab() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtroCat, setFiltroCat] = useState("todas");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ItemCatalogo | null>(null);
  const [form, setForm] = useState({ ...emptyItem });

  const { data: itens } = useQuery({
    queryKey: ["almox-catalogo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("almoxarifado_itens_catalogo")
        .select("*")
        .order("descricao");
      if (error) throw error;
      return (data ?? []) as ItemCatalogo[];
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.referencia || !form.descricao) throw new Error("Referência e descrição são obrigatórios");
      if (editing) {
        const { error } = await supabase
          .from("almoxarifado_itens_catalogo")
          .update(form)
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("almoxarifado_itens_catalogo").insert(form);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Item atualizado" : "Item cadastrado");
      qc.invalidateQueries({ queryKey: ["almox-catalogo"] });
      setOpen(false);
      setEditing(null);
      setForm({ ...emptyItem });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("almoxarifado_itens_catalogo").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item removido");
      qc.invalidateQueries({ queryKey: ["almox-catalogo"] });
    },
  });

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase();
    return (itens ?? []).filter((i) => {
      const okCat = filtroCat === "todas" || i.categoria === filtroCat;
      const okQ = !q || i.referencia.toLowerCase().includes(q) || i.descricao.toLowerCase().includes(q);
      return okCat && okQ;
    });
  }, [itens, busca, filtroCat]);

  const abaixoMin = (itens ?? []).filter((i) => i.estoque_atual < i.estoque_minimo).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <Label className="text-xs">Buscar</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Referência ou descrição" className="pl-8" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Categoria</Label>
          <Select value={filtroCat} onValueChange={setFiltroCat}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {CATEGORIAS_ALMOX.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {abaixoMin > 0 && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> {abaixoMin} abaixo do mínimo
          </Badge>
        )}
        <Button onClick={() => { setEditing(null); setForm({ ...emptyItem }); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Novo item
        </Button>
      </div>

      <div className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Ref.</th>
              <th className="p-2 text-left">Descrição</th>
              <th className="p-2 text-left">Categoria</th>
              <th className="p-2 text-left">Un.</th>
              <th className="p-2 text-right">Estoque</th>
              <th className="p-2 text-right">Mínimo</th>
              <th className="p-2 text-right">Custo</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((it) => {
              const baixo = it.estoque_atual < it.estoque_minimo;
              return (
                <tr key={it.id} className={`border-t border-border ${baixo ? "bg-destructive/10" : ""}`}>
                  <td className="p-2 font-mono text-xs">{it.referencia}</td>
                  <td className="p-2">{it.descricao}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {CATEGORIAS_ALMOX.find((c) => c.value === it.categoria)?.label ?? it.categoria}
                  </td>
                  <td className="p-2 text-xs">{it.unidade}</td>
                  <td className={`p-2 text-right font-mono ${baixo ? "font-bold text-destructive" : ""}`}>
                    {Number(it.estoque_atual).toFixed(2)}
                  </td>
                  <td className="p-2 text-right font-mono text-muted-foreground">{Number(it.estoque_minimo).toFixed(2)}</td>
                  <td className="p-2 text-right font-mono">R$ {Number(it.custo_unitario).toFixed(2)}</td>
                  <td className="p-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(it); setForm({ ...it }); setOpen(true); }}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm("Excluir item?")) excluir.mutate(it.id); }}>
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {filtrados.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Nenhum item cadastrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar item" : "Novo item"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-1">
              <Label>Referência</Label>
              <Input value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} />
            </div>
            <div className="col-span-1">
              <Label>Categoria</Label>
              <Select value={form.categoria} onValueChange={(v) => setForm({ ...form, categoria: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIAS_ALMOX.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Descrição</Label>
              <Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
            </div>
            <div>
              <Label>Unidade</Label>
              <Select value={form.unidade} onValueChange={(v) => setForm({ ...form, unidade: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNIDADES_ALMOX.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Custo unitário</Label>
              <Input type="number" step="0.01" value={form.custo_unitario}
                onChange={(e) => setForm({ ...form, custo_unitario: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Estoque atual</Label>
              <Input type="number" step="0.01" value={form.estoque_atual}
                onChange={(e) => setForm({ ...form, estoque_atual: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Estoque mínimo</Label>
              <Input type="number" step="0.01" value={form.estoque_minimo}
                onChange={(e) => setForm({ ...form, estoque_minimo: Number(e.target.value) })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// Separação por projeto
// ============================================================
function SeparacaoTab() {
  const qc = useQueryClient();
  const [projetoId, setProjetoId] = useState<string>("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroAmb, setFiltroAmb] = useState("");

  const { data: projetos } = useQuery({
    queryKey: ["projetos-lista-min"],
    queryFn: async () => {
      const { data } = await supabase.from("projetos").select("id, nome, cliente").order("created_at", { ascending: false });
      return (data ?? []) as { id: string; nome: string; cliente: string | null }[];
    },
  });

  const { data: itens, refetch } = useQuery({
    queryKey: ["projeto-almox", projetoId],
    enabled: !!projetoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projeto_almoxarifado_itens")
        .select("*")
        .eq("projeto_id", projetoId)
        .order("ambiente", { nullsFirst: false })
        .order("descricao");
      if (error) throw error;
      return (data ?? []) as ProjetoItem[];
    },
  });

  const marcarStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: Partial<ProjetoItem> = { status };
      if (status === "separado") {
        patch.separado_em = new Date().toISOString();
      }
      const { error } = await supabase.from("projeto_almoxarifado_itens").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projeto-almox", projetoId] });
      qc.invalidateQueries({ queryKey: ["almox-faltas"] });
      refetch();
    },
  });

  const filtrados = useMemo(() => {
    return (itens ?? []).filter((i) => {
      const okSt = filtroStatus === "todos" || i.status === filtroStatus;
      const okA = !filtroAmb || (i.ambiente ?? "").toLowerCase().includes(filtroAmb.toLowerCase());
      return okSt && okA;
    });
  }, [itens, filtroStatus, filtroAmb]);

  const resumo = useMemo(() => {
    const total = (itens ?? []).length;
    const sep = (itens ?? []).filter((i) => i.status === "separado").length;
    const falta = (itens ?? []).filter((i) => i.status === "falta_item").length;
    return { total, sep, falta, pct: total ? Math.round((sep / total) * 100) : 0 };
  }, [itens]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px]">
          <Label className="text-xs">Projeto</Label>
          <Select value={projetoId} onValueChange={setProjetoId}>
            <SelectTrigger><SelectValue placeholder="Selecione um projeto" /></SelectTrigger>
            <SelectContent>
              {(projetos ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nome}{p.cliente ? ` — ${p.cliente}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={filtroStatus} onValueChange={setFiltroStatus}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {STATUS_SEPARACAO.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Ambiente</Label>
          <Input value={filtroAmb} onChange={(e) => setFiltroAmb(e.target.value)} placeholder="Filtrar" className="w-40" />
        </div>
        {projetoId && (
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" /> Imprimir
            </Button>
            <Button variant="outline" disabled title="Em breve">
              <Upload className="mr-2 h-4 w-4" /> Importar relatório
            </Button>
          </>
        )}
      </div>

      {projetoId && (
        <div className="grid grid-cols-4 gap-3">
          <Card label="Total de itens" value={resumo.total} />
          <Card label="Separados" value={resumo.sep} tone="success" />
          <Card label="Em falta" value={resumo.falta} tone="destructive" />
          <Card label="Progresso" value={`${resumo.pct}%`} />
        </div>
      )}

      {projetoId ? (
        <div className="overflow-x-auto rounded border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Ref.</th>
                <th className="p-2 text-left">Descrição</th>
                <th className="p-2 text-left">Ambiente</th>
                <th className="p-2 text-left">Módulo</th>
                <th className="p-2 text-right">Qtd</th>
                <th className="p-2 text-left">Un</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((it) => {
                const info = statusInfo(it.status);
                return (
                  <tr key={it.id} className="border-t border-border">
                    <td className="p-2 font-mono text-xs">{it.referencia ?? "—"}</td>
                    <td className="p-2">{it.descricao}</td>
                    <td className="p-2 text-xs text-muted-foreground">{it.ambiente ?? "—"}</td>
                    <td className="p-2 text-xs text-muted-foreground">{it.modulo ?? "—"}</td>
                    <td className="p-2 text-right font-mono">{Number(it.quantidade).toFixed(2)}</td>
                    <td className="p-2 text-xs">{it.unidade}</td>
                    <td className={`p-2 text-xs font-semibold ${info.color}`}>{info.label}</td>
                    <td className="p-2 text-right">
                      <Select value={it.status} onValueChange={(v) => marcarStatus.mutate({ id: it.id, status: v })}>
                        <SelectTrigger className="h-7 w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS_SEPARACAO.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">
                  Sem itens para este filtro. Gere a Lista de Compras no Editor do Projeto.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded border border-dashed border-border bg-surface p-12 text-center text-muted-foreground">
          Selecione um projeto para ver a lista de separação.
        </div>
      )}
    </div>
  );
}

// ============================================================
// Movimentações
// ============================================================
function MovimentosTab() {
  const [tipo, setTipo] = useState("todos");

  const { data: movs } = useQuery({
    queryKey: ["almox-movimentos", tipo],
    queryFn: async () => {
      let q = supabase
        .from("almoxarifado_movimentos")
        .select("*")
        .order("criado_em", { ascending: false })
        .limit(300);
      if (tipo !== "todos") q = q.eq("tipo_movimento", tipo);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Movimento[];
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div>
          <Label className="text-xs">Tipo</Label>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {TIPOS_MOVIMENTO.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Data</th>
              <th className="p-2 text-left">Tipo</th>
              <th className="p-2 text-right">Qtd</th>
              <th className="p-2 text-left">Un</th>
              <th className="p-2 text-left">Origem</th>
              <th className="p-2 text-left">Operador</th>
              <th className="p-2 text-left">Observação</th>
            </tr>
          </thead>
          <tbody>
            {(movs ?? []).map((m) => (
              <tr key={m.id} className="border-t border-border">
                <td className="p-2 text-xs text-muted-foreground">{new Date(m.criado_em).toLocaleString("pt-BR")}</td>
                <td className="p-2 text-xs">{TIPOS_MOVIMENTO.find((t) => t.value === m.tipo_movimento)?.label ?? m.tipo_movimento}</td>
                <td className="p-2 text-right font-mono">{Number(m.quantidade).toFixed(2)}</td>
                <td className="p-2 text-xs">{m.unidade}</td>
                <td className="p-2 text-xs text-muted-foreground">{m.origem ?? "—"}</td>
                <td className="p-2 text-xs">{m.operador ?? "—"}</td>
                <td className="p-2 text-xs text-muted-foreground">{m.observacao ?? ""}</td>
              </tr>
            ))}
            {(movs ?? []).length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Sem movimentações.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// Faltas
// ============================================================
function FaltasTab() {
  const qc = useQueryClient();
  const { data: faltas } = useQuery({
    queryKey: ["almox-faltas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projeto_almoxarifado_itens")
        .select("*")
        .eq("status", "falta_item")
        .order("criado_em", { ascending: false });
      if (error) throw error;
      const itens = (data ?? []) as ProjetoItem[];
      const ids = Array.from(new Set(itens.map((i) => i.projeto_id)));
      const projMap = new Map<string, { nome: string; cliente: string | null }>();
      if (ids.length) {
        const { data: ps } = await supabase.from("projetos").select("id, nome, cliente").in("id", ids);
        for (const p of ps ?? []) projMap.set(p.id, { nome: p.nome, cliente: p.cliente });
      }
      return itens.map((i) => ({ ...i, projeto: projMap.get(i.projeto_id) ?? null }));
    },
  });

  const resolver = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("projeto_almoxarifado_itens")
        .update({ status: "separado", separado_em: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item marcado como separado");
      qc.invalidateQueries({ queryKey: ["almox-faltas"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Projeto</th>
              <th className="p-2 text-left">Cliente</th>
              <th className="p-2 text-left">Ref.</th>
              <th className="p-2 text-left">Descrição</th>
              <th className="p-2 text-right">Qtd</th>
              <th className="p-2 text-left">Ambiente</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {(faltas ?? []).map((f) => (
              <tr key={f.id} className="border-t border-border bg-destructive/5">
                <td className="p-2">{f.projeto?.nome ?? "—"}</td>
                <td className="p-2 text-xs text-muted-foreground">{f.projeto?.cliente ?? "—"}</td>
                <td className="p-2 font-mono text-xs">{f.referencia ?? "—"}</td>
                <td className="p-2">{f.descricao}</td>
                <td className="p-2 text-right font-mono">{Number(f.quantidade).toFixed(2)} {f.unidade}</td>
                <td className="p-2 text-xs text-muted-foreground">{f.ambiente ?? "—"}</td>
                <td className="p-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => resolver.mutate(f.id)}>
                    <Check className="mr-1 h-3.5 w-3.5" /> Resolver
                  </Button>
                </td>
              </tr>
            ))}
            {(faltas ?? []).length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Nenhum item em falta.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: number | string; tone?: "success" | "destructive" }) {
  const color = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
