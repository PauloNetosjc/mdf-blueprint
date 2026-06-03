import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Copy, Trash2, Cpu, Save, AlertTriangle, Clipboard, ClipboardPaste, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { LEGENDA_FITA } from "./fitas";
import { ListaComprasTab } from "@/components/lista-compras-tab";
import { ProjetoNav } from "@/components/projeto-nav";
import { StatusBadge } from "@/components/status-badge";

export const Route = createFileRoute("/_authenticated/projetos/$id")({
  head: () => ({ meta: [{ title: "Editor de Projeto — Visualizador CNC" }] }),
  component: ProjetoEditor,
});

type ProjetoPeca = {
  id: string;
  projeto_id: string;
  peca_id: string | null;
  descricao: string;
  quantidade: number;
  altura: number;
  largura: number;
  espessura: number;
  chapa_id: string | null;
  fita_codigo: string | null;
  modulo: string | null;
  observacao: string | null;
  ordem: number;
};

function ProjetoEditor() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState("pecas");

  const { data: projeto } = useQuery({
    queryKey: ["projeto", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("projetos").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: pecas } = useQuery({
    queryKey: ["projeto-pecas", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("projeto_pecas").select("*").eq("projeto_id", id).order("ordem");
      if (error) throw error;
      return data as ProjetoPeca[];
    },
  });

  const { data: chapas } = useQuery({
    queryKey: ["chapas"],
    queryFn: async () => {
      const { data } = await supabase.from("chapas").select("id, nome, cor, espessura").order("nome");
      return (data ?? []) as { id: string; nome: string; cor: string; espessura: number }[];
    },
  });

  const adicionar = useMutation({
    mutationFn: async () => {
      const ordem = (pecas?.length ?? 0) + 1;
      const { error } = await supabase.from("projeto_pecas").insert({
        projeto_id: id,
        descricao: "Nova peça",
        quantidade: 1,
        altura: 600,
        largura: 400,
        espessura: 15,
        ordem,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projeto-pecas", id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const atualizar = useMutation({
    mutationFn: async (p: Partial<ProjetoPeca> & { id: string }) => {
      const { id: pid, ...rest } = p;
      const { error } = await supabase.from("projeto_pecas").update(rest).eq("id", pid);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projeto-pecas", id] }),
  });

  const duplicar = useMutation({
    mutationFn: async (p: ProjetoPeca) => {
      const { id: _drop, ...rest } = p as any;
      const { error } = await supabase.from("projeto_pecas").insert({ ...rest, descricao: rest.descricao + " (cópia)" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projeto-pecas", id] }),
  });

  const excluir = useMutation({
    mutationFn: async (pid: string) => {
      const { error } = await supabase.from("projeto_pecas").delete().eq("id", pid);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projeto-pecas", id] }),
  });

  const abrirEngenharia = useMutation({
    mutationFn: async (p: ProjetoPeca) => {
      if (p.peca_id) return p.peca_id;
      // Cria peça no editor CNC e vincula
      const codigo = `PRJ-${id.slice(0, 6)}-${p.ordem}`;
      const { data: novaPeca, error } = await supabase.from("pecas").insert({
        codigo,
        nome: p.descricao,
        cliente: projeto?.cliente ?? null,
        ambiente: projeto?.ambiente ?? null,
        largura: p.largura,
        altura: p.altura,
        espessura: p.espessura,
        material: "MDP",
        status: "rascunho",
      }).select().single();
      if (error) throw error;
      // 5 faces padrão
      const faces = [0, 1, 2, 3, 4].map((n) => ({
        peca_id: novaPeca.id, numero_face: n,
        nome_face: ["Face Superior", "Topo Frontal", "Topo Direito", "Topo Traseiro", "Topo Esquerdo"][n],
      }));
      await supabase.from("faces").insert(faces);
      await supabase.from("projeto_pecas").update({ peca_id: novaPeca.id }).eq("id", p.id);
      return novaPeca.id;
    },
    onSuccess: (pecaId) => {
      qc.invalidateQueries({ queryKey: ["projeto-pecas", id] });
      navigate({ to: "/pecas/$id", params: { id: pecaId as string } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border bg-panel px-6 py-3">
        <div className="flex items-center gap-3">
          <Link to="/projetos"><Button size="sm" variant="ghost"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-lg font-semibold leading-tight">{projeto?.nome ?? "Carregando..."}</h1>
            <p className="text-xs text-muted-foreground">{[projeto?.cliente, projeto?.ambiente].filter(Boolean).join(" · ") || "—"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/projetos/$id/plano" params={{ id }}>
            <Button><Cpu className="mr-2 h-4 w-4" />Abrir Plano de Corte</Button>
          </Link>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-6 mt-3 w-fit">
          <TabsTrigger value="pecas">Peças</TabsTrigger>
          <TabsTrigger value="identificacao">Identificação</TabsTrigger>
          <TabsTrigger value="engenharia">Engenharia</TabsTrigger>
          <TabsTrigger value="compras">Lista de Compras</TabsTrigger>
          <TabsTrigger value="plano">Plano de Corte</TabsTrigger>
        </TabsList>

        <TabsContent value="pecas" className="flex-1 overflow-auto p-6 pt-3">
          <PecasTab
            pecas={pecas ?? []}
            chapas={chapas ?? []}
            onAdd={() => adicionar.mutate()}
            onUpdate={(p) => atualizar.mutate(p)}
            onDuplicate={(p) => duplicar.mutate(p)}
            onDelete={(pid) => excluir.mutate(pid)}
            onAbrirEngenharia={(p) => abrirEngenharia.mutate(p)}
            projetoId={id}
          />
        </TabsContent>

        <TabsContent value="identificacao" className="flex-1 overflow-auto p-6 pt-3">
          <IdentForm projeto={projeto} />
        </TabsContent>

        <TabsContent value="engenharia" className="flex-1 overflow-auto p-6 pt-3">
          <Placeholder titulo="Engenharia do projeto" desc="Visão consolidada das operações de todas as peças. Disponível na próxima etapa." />
        </TabsContent>

        <TabsContent value="compras" className="flex-1 overflow-auto p-6 pt-3">
          <ListaComprasTab projetoId={id} />
        </TabsContent>

        <TabsContent value="plano" className="flex-1 overflow-auto p-6 pt-3">
          <div className="rounded border border-border bg-surface p-8 text-center">
            <p className="mb-4 text-muted-foreground">Abra o Plano de Corte visual em tela cheia.</p>
            <Link to="/projetos/$id/plano" params={{ id }}>
              <Button size="lg"><Cpu className="mr-2 h-5 w-5" />Abrir Plano de Corte</Button>
            </Link>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

type ChapaInfo = { id: string; nome: string; cor: string; espessura: number };

function PecasTab({
  pecas, chapas, onAdd, onUpdate, onDuplicate, onDelete, onAbrirEngenharia, projetoId,
}: {
  pecas: ProjetoPeca[];
  chapas: ChapaInfo[];
  onAdd: () => void;
  onUpdate: (p: Partial<ProjetoPeca> & { id: string }) => void;
  onDuplicate: (p: ProjetoPeca) => void;
  onDelete: (pid: string) => void;
  onAbrirEngenharia: (p: ProjetoPeca) => void;
  projetoId: string;
}) {
  const qc = useQueryClient();
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  const totalPecas = pecas.reduce((s, p) => s + (p.quantidade > 0 ? p.quantidade : 0), 0);
  const areaTotalM2 = pecas.reduce((s, p) => s + (p.altura * p.largura * Math.max(p.quantidade, 0)) / 1_000_000, 0);
  const semChapa = pecas.filter((p) => !p.chapa_id).length;
  const qtdInvalida = pecas.filter((p) => !p.quantidade || p.quantidade < 1).length;
  const dimsInvalidas = pecas.filter((p) => !p.altura || !p.largura).length;

  function toggleRow(id: string) {
    setSelectedRows((s) => {
      const ns = new Set(s);
      if (ns.has(id)) ns.delete(id); else ns.add(id);
      return ns;
    });
  }

  async function copiarSelecionadas() {
    const sel = pecas.filter((p) => selectedRows.has(p.id));
    if (sel.length === 0) return;
    const tsv = sel
      .map((p) => [p.descricao, p.quantidade, p.altura, p.largura, p.espessura, p.modulo ?? "", p.observacao ?? ""].join("\t"))
      .join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      toast.success(`${sel.length} linha(s) copiada(s)`);
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  async function colarLinhas() {
    try {
      const txt = await navigator.clipboard.readText();
      if (!txt.trim()) { toast.error("Área de transferência vazia"); return; }
      const linhas = txt.split(/\r?\n/).filter((l) => l.trim());
      const ordemBase = (pecas.at(-1)?.ordem ?? 0) + 1;
      const rows = linhas.map((l, i) => {
        const cols = l.split("\t");
        return {
          projeto_id: projetoId,
          descricao: cols[0]?.trim() || "Nova peça",
          quantidade: parseInt(cols[1] ?? "1") || 1,
          altura: parseFloat(cols[2] ?? "600") || 600,
          largura: parseFloat(cols[3] ?? "400") || 400,
          espessura: parseFloat(cols[4] ?? "15") || 15,
          modulo: cols[5]?.trim() || null,
          observacao: cols[6]?.trim() || null,
          ordem: ordemBase + i,
        };
      });
      const { error } = await supabase.from("projeto_pecas").insert(rows);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["projeto-pecas", projetoId] });
      toast.success(`${rows.length} linha(s) colada(s)`);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao colar");
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{pecas.length} peças · {totalPecas} unidades · {areaTotalM2.toFixed(2)} m²</span>
          {semChapa > 0 && (
            <span className="flex items-center gap-1 rounded bg-warning/10 px-2 py-0.5 text-xs text-warning">
              <AlertTriangle className="h-3 w-3" />{semChapa} sem chapa
            </span>
          )}
          {qtdInvalida > 0 && (
            <span className="flex items-center gap-1 rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3" />{qtdInvalida} qtd inválida
            </span>
          )}
          {dimsInvalidas > 0 && (
            <span className="flex items-center gap-1 rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3" />{dimsInvalidas} sem dimensões
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={copiarSelecionadas} disabled={selectedRows.size === 0}>
            <Clipboard className="mr-1 h-4 w-4" />Copiar ({selectedRows.size})
          </Button>
          <Button size="sm" variant="outline" onClick={colarLinhas}>
            <ClipboardPaste className="mr-1 h-4 w-4" />Colar
          </Button>
          <Button size="sm" onClick={onAdd}><Plus className="mr-1 h-4 w-4" />Adicionar peça</Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2"></th>
              <th className="px-2 py-2 text-left">Descrição</th>
              <th className="w-16 px-2 py-2 text-right">Qtd</th>
              <th className="w-20 px-2 py-2 text-right">Altura</th>
              <th className="w-20 px-2 py-2 text-right">Largura</th>
              <th className="w-16 px-2 py-2 text-right">Esp.</th>
              <th className="w-40 px-2 py-2 text-left">Chapa</th>
              <th className="w-20 px-2 py-2 text-left">Fita</th>
              <th className="w-28 px-2 py-2 text-left">Módulo</th>
              <th className="px-2 py-2 text-left">Observação</th>
              <th className="w-32 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pecas.map((p) => {
              const chapaSel = chapas.find((c) => c.id === p.chapa_id);
              const semChapa = !p.chapa_id;
              const qtdInval = !p.quantidade || p.quantidade < 1;
              const espessuraMostrar = chapaSel ? chapaSel.espessura : null;
              return (
                <tr key={p.id} className={`border-t border-border hover:bg-surface-2 ${selectedRows.has(p.id) ? "bg-primary/5" : ""}`}>
                  <td className="px-2 py-1 text-center">
                    <input type="checkbox" checked={selectedRows.has(p.id)} onChange={() => toggleRow(p.id)} />
                  </td>
                  <td className="p-1"><Inp value={p.descricao} onSave={(v) => onUpdate({ id: p.id, descricao: v })} /></td>
                  <td className="p-1">
                    <InpInt
                      value={p.quantidade}
                      min={1}
                      onSave={(v) => onUpdate({ id: p.id, quantidade: v })}
                      invalid={qtdInval}
                    />
                  </td>
                  <td className="p-1"><InpNum value={p.altura} onSave={(v) => onUpdate({ id: p.id, altura: v })} /></td>
                  <td className="p-1"><InpNum value={p.largura} onSave={(v) => onUpdate({ id: p.id, largura: v })} /></td>
                  <td className="p-1">
                    {espessuraMostrar != null ? (
                      <span className="inline-flex h-8 w-full items-center justify-end rounded bg-surface-2 px-2 font-mono text-xs text-foreground" title="Espessura puxada da chapa selecionada">
                        {espessuraMostrar} mm
                      </span>
                    ) : (
                      <span
                        className="inline-flex h-8 w-full items-center justify-end rounded border border-dashed border-warning/60 px-2 font-mono text-xs text-warning"
                        title="Selecione uma chapa para definir a espessura"
                      >
                        —
                      </span>
                    )}
                  </td>
                  <td className="p-1">
                    <Select
                      value={p.chapa_id ?? "_none"}
                      onValueChange={(v) => {
                        const novaChapa = v === "_none" ? null : v;
                        const c = chapas.find((x) => x.id === novaChapa);
                        onUpdate({
                          id: p.id,
                          chapa_id: novaChapa,
                          ...(c ? { espessura: c.espessura } : {}),
                        });
                      }}
                    >
                      <SelectTrigger className={`h-8 text-xs ${semChapa ? "border-warning" : ""}`}><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">—</SelectItem>
                        {chapas.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            <div className="flex items-center gap-2">
                              <div className="h-3 w-3 rounded border border-border" style={{ background: c.cor }} />
                              <span>{c.nome} · {c.espessura}mm</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-1">
                    <Select value={p.fita_codigo ?? "_none"} onValueChange={(v) => onUpdate({ id: p.id, fita_codigo: v === "_none" ? null : v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">—</SelectItem>
                        {LEGENDA_FITA.map((l) => (
                          <SelectItem key={l.codigo} value={l.codigo}>
                            <span className="font-mono">{l.codigo}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{l.desc}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-1"><Inp value={p.modulo ?? ""} onSave={(v) => onUpdate({ id: p.id, modulo: v || null })} /></td>
                  <td className="p-1"><Inp value={p.observacao ?? ""} onSave={(v) => onUpdate({ id: p.id, observacao: v || null })} /></td>
                  <td className="p-1 text-right">
                    <Button size="sm" variant="ghost" title="Abrir engenharia CNC" onClick={() => onAbrirEngenharia(p)}>
                      <Cpu className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" title="Duplicar" onClick={() => onDuplicate(p)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" title="Excluir" onClick={() => { if (confirm(`Excluir "${p.descricao}"?`)) onDelete(p.id); }}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {pecas.length === 0 && (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">Nenhuma peça. Clique em "Adicionar peça" ou cole linhas do Excel.</td></tr>
            )}
          </tbody>
          {pecas.length > 0 && (
            <tfoot className="bg-surface-2 text-xs font-semibold">
              <tr className="border-t-2 border-border">
                <td colSpan={2} className="px-2 py-2 text-right">Totais</td>
                <td className="px-2 py-2 text-right font-mono">{totalPecas}</td>
                <td colSpan={2} className="px-2 py-2 text-right text-muted-foreground">Área total</td>
                <td colSpan={2} className="px-2 py-2 text-right font-mono">{areaTotalM2.toFixed(2)} m²</td>
                <td colSpan={4}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

function InpInt({ value, onSave, min, invalid }: { value: number; onSave: (v: number) => void; min?: number; invalid?: boolean }) {
  const [v, setV] = useState(String(value));
  return (
    <Input
      type="number"
      inputMode="numeric"
      step={1}
      min={min ?? 0}
      className={`h-8 w-full text-right font-mono text-xs ${invalid ? "border-destructive" : ""}`}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < (min ?? 0)) { setV(String(value)); return; }
        if (n !== value) onSave(n);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function Inp({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <Input
      className="h-8 text-xs"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}
function InpNum({ value, onSave, step }: { value: number; onSave: (v: number) => void; step?: string }) {
  const [v, setV] = useState(String(value));
  return (
    <Input
      type="number"
      step={step ?? "1"}
      className="h-8 text-right font-mono text-xs"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { const n = parseFloat(v); if (!isNaN(n) && n !== value) onSave(n); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function IdentForm({ projeto }: { projeto: any }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    nome: projeto?.nome ?? "",
    cliente: projeto?.cliente ?? "",
    ambiente: projeto?.ambiente ?? "",
    observacao: projeto?.observacao ?? "",
    status: projeto?.status ?? "ativo",
  });
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("projetos").update(form).eq("id", projeto.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projeto", projeto.id] }); qc.invalidateQueries({ queryKey: ["projetos"] }); toast.success("Salvo"); },
  });

  if (!projeto) return null;
  return (
    <div className="max-w-2xl space-y-3">
      <div><Label className="text-xs">Nome</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Cliente</Label><Input value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} /></div>
        <div><Label className="text-xs">Ambiente</Label><Input value={form.ambiente} onChange={(e) => setForm({ ...form, ambiente: e.target.value })} /></div>
      </div>
      <div><Label className="text-xs">Status</Label>
        <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ativo">Ativo</SelectItem>
            <SelectItem value="aguardando_plano">Aguardando plano</SelectItem>
            <SelectItem value="plano_gerado">Plano gerado</SelectItem>
            <SelectItem value="em_producao">Em produção</SelectItem>
            <SelectItem value="concluido">Concluído</SelectItem>
            <SelectItem value="arquivado">Arquivado</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div><Label className="text-xs">Observação</Label><Textarea rows={4} value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} /></div>
      <Button onClick={() => salvar.mutate()}><Save className="mr-2 h-4 w-4" />Salvar identificação</Button>
    </div>
  );
}

function Placeholder({ titulo, desc }: { titulo: string; desc: string }) {
  return (
    <div className="rounded border border-dashed border-border bg-surface p-12 text-center">
      <h3 className="mb-2 text-lg font-semibold">{titulo}</h3>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
