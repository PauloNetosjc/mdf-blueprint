import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Copy, Trash2, Cpu, Save, AlertTriangle, Clipboard, ClipboardPaste, GitBranch, BookOpen, ChevronDown, ChevronRight, CheckCircle2, XCircle, Eye, Wand2 } from "lucide-react";
import { VisualizadorPecaProjetoDialog } from "@/components/projetos/VisualizadorPecaProjetoDialog";
import { aplicarModeloTecnicoNaPecaProjeto } from "@/lib/aplicar-modelo-projeto";
import { gerarDadosTecnicosManuais } from "@/lib/peca-manual-tecnica";
import type { ModeloTecnicoJson } from "@/lib/peca-modelo-tecnico";
import { toast } from "sonner";
import { LEGENDA_FITA } from "./fitas";
import { ListaComprasTab } from "@/components/lista-compras-tab";
import { ProjetoNav } from "@/components/projeto-nav";
import { StatusBadge } from "@/components/status-badge";
import { VinculoBibliotecaTab } from "@/components/vinculo-biblioteca-tab";
import { SelecionarPecaBibliotecaDialog, type PecaCadastradaResumo } from "@/components/projetos/SelecionarPecaBibliotecaDialog";
import { PainelAplicacaoTecnica } from "@/components/projetos/PainelAplicacaoTecnica";
import { PlanoCorteTab } from "@/components/projetos/PlanoCorteTab";
import type { StatusTecnico, ResultadoAplicacao } from "@/lib/aplicar-modelo-projeto";

export const Route = createFileRoute("/_authenticated/projetos/$id")({
  head: () => ({ meta: [{ title: "Editor de Projeto — Visualizador CNC" }] }),
  component: ProjetoEditor,
});

type ProjetoPeca = {
  id: string;
  projeto_id: string;
  peca_id: string | null;
  peca_cadastrada_id: string | null;
  descricao: string;
  codigo: string | null;
  quantidade: number;
  altura: number;
  largura: number;
  espessura: number;
  chapa_id: string | null;
  fita_codigo: string | null;
  modulo: string | null;
  observacao: string | null;
  ordem: number;
  veio: boolean;
  status_tecnico: StatusTecnico | null;
  dados_tecnicos_aplicados_json: any | null;
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
      const largura = 400;
      const altura = 600;
      const espessura = 15;
      const { json, status_tecnico } = gerarDadosTecnicosManuais({
        largura,
        altura,
        espessura,
        descricao: "Nova peça",
        quantidade: 1,
      });
      const { error } = await supabase.from("projeto_pecas").insert({
        projeto_id: id,
        descricao: "Nova peça",
        quantidade: 1,
        altura,
        largura,
        espessura,
        ordem,
        dados_tecnicos_aplicados_json: json as any,
        status_tecnico,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projeto-pecas", id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const adicionarDaBiblioteca = useMutation({
    mutationFn: async (p: PecaCadastradaResumo) => {
      const ordem = (pecas?.length ?? 0) + 1;
      const { error } = await supabase.from("projeto_pecas").insert({
        projeto_id: id,
        peca_cadastrada_id: p.id,
        codigo: p.codigo,
        descricao: p.nome_peca ?? p.nome ?? p.codigo ?? "Peça da biblioteca",
        quantidade: 1,
        largura: p.largura_ref ?? 400,
        altura: p.altura_ref ?? 600,
        espessura: p.espessura_ref ?? 15,
        fita_codigo: p.fita_ref ?? null,
        status_tecnico: "nao_aplicado",
        ordem,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projeto-pecas", id] });
      toast.success("Peça adicionada da biblioteca");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const atualizar = useMutation({
    mutationFn: async (p: Partial<ProjetoPeca> & { id: string }) => {
      const { id: pid, ...rest } = p;
      const atual = (pecas ?? []).find((x) => x.id === pid);
      const ehManual = atual && !atual.peca_cadastrada_id;
      const dimsMudaram =
        atual &&
        (("largura" in rest && rest.largura !== atual.largura) ||
          ("altura" in rest && rest.altura !== atual.altura) ||
          ("espessura" in rest && rest.espessura !== atual.espessura));
      let extra: Partial<ProjetoPeca> = {};
      if (ehManual && dimsMudaram) {
        const largura = (rest.largura as number | undefined) ?? atual!.largura;
        const altura = (rest.altura as number | undefined) ?? atual!.altura;
        const espessura = (rest.espessura as number | undefined) ?? atual!.espessura;
        const opsExistentes =
          (atual!.dados_tecnicos_aplicados_json as any)?.operacoes_recalculadas ?? [];
        const { json, status_tecnico } = gerarDadosTecnicosManuais({
          largura,
          altura,
          espessura,
          codigo: atual!.codigo,
          descricao: (rest.descricao as string | undefined) ?? atual!.descricao,
          material_chapa: (atual as any)?.material_chapa ?? null,
          fita_codigo: (rest.fita_codigo as string | undefined) ?? atual!.fita_codigo,
          modulo: (rest.modulo as string | undefined) ?? atual!.modulo,
          quantidade: (rest.quantidade as number | undefined) ?? atual!.quantidade,
          veio: (rest.veio as boolean | undefined) ?? atual!.veio,
          operacoesExistentes: opsExistentes,
        });
        extra = { dados_tecnicos_aplicados_json: json as any, status_tecnico };
      }
      const { error } = await supabase
        .from("projeto_pecas")
        .update({ ...rest, ...extra })
        .eq("id", pid);
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
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold leading-tight">{projeto?.nome ?? "Carregando..."}</h1>
              {projeto?.status && <StatusBadge status={projeto.status} />}
            </div>
            <p className="text-xs text-muted-foreground">{[projeto?.cliente, projeto?.ambiente].filter(Boolean).join(" · ") || "—"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/projetos/$id/fluxo" params={{ id }}>
            <Button variant="outline"><GitBranch className="mr-2 h-4 w-4" />Fluxo do Projeto</Button>
          </Link>
          <Button onClick={() => { setTab("plano"); setGerarPlanoOpen(true); }}>
            <Cpu className="mr-2 h-4 w-4" />Gerar plano de corte
          </Button>
        </div>
      </header>

      <ConfigurarPlanoCorteDialog
        open={gerarPlanoOpen} onOpenChange={setGerarPlanoOpen} projetoId={id}
      />


      <ProjetoNav projetoId={id} />

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col overflow-hidden">

        <TabsList className="mx-6 mt-3 w-fit">
          <TabsTrigger value="pecas">Peças</TabsTrigger>
          <TabsTrigger value="vinculo">Vínculo Biblioteca</TabsTrigger>
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
            onAddFromBiblioteca={(p) => adicionarDaBiblioteca.mutate(p)}
            onUpdate={(p) => atualizar.mutate(p)}
            onDuplicate={(p) => duplicar.mutate(p)}
            onDelete={(pid) => excluir.mutate(pid)}
            onAbrirEngenharia={(p) => abrirEngenharia.mutate(p)}
            projetoId={id}
          />
        </TabsContent>

        <TabsContent value="vinculo" className="flex-1 overflow-auto p-6 pt-3">
          <VinculoBibliotecaTab projetoId={id} />
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
          <PlanoCorteTab projetoId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type ChapaInfo = { id: string; nome: string; cor: string; espessura: number };

function PecasTab({
  pecas, chapas, onAdd, onAddFromBiblioteca, onUpdate, onDuplicate, onDelete, onAbrirEngenharia, projetoId,
}: {
  pecas: ProjetoPeca[];
  chapas: ChapaInfo[];
  onAdd: () => void;
  onAddFromBiblioteca: (p: PecaCadastradaResumo) => void;
  onUpdate: (p: Partial<ProjetoPeca> & { id: string }) => void;
  onDuplicate: (p: ProjetoPeca) => void;
  onDelete: (pid: string) => void;
  onAbrirEngenharia: (p: ProjetoPeca) => void;
  projetoId: string;
}) {
  const qc = useQueryClient();
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [expandida, setExpandida] = useState<string | null>(null);
  const [visualizar, setVisualizar] = useState<ProjetoPeca | null>(null);

  async function aplicarEAbrir(p: ProjetoPeca) {
    if (!p.peca_cadastrada_id) {
      toast.error("Peça sem vínculo com a biblioteca.");
      return;
    }
    try {
      const { data: cad, error: e1 } = await supabase
        .from("pecas_cadastradas")
        .select("dados_brutos_json")
        .eq("id", p.peca_cadastrada_id)
        .single();
      if (e1) throw e1;
      const modelo = (cad?.dados_brutos_json as any)?.modelo_tecnico_json as ModeloTecnicoJson | undefined;
      if (!modelo) {
        toast.error("Peça da biblioteca ainda não tem modelo técnico processado.");
        return;
      }
      const res = aplicarModeloTecnicoNaPecaProjeto(modelo, {
        largura: p.largura,
        altura: p.altura,
        espessura: p.espessura,
      });
      const aplicadoJson = {
        origem: "biblioteca_parametrica",
        peca_cadastrada_id: p.peca_cadastrada_id,
        codigo_modelo: res.modelo_aplicado.codigo ?? null,
        medidas_base: res.modelo_aplicado.parametrizacao
          ? {
              largura: res.modelo_aplicado.parametrizacao.largura_base,
              altura: res.modelo_aplicado.parametrizacao.altura_base,
              espessura: res.modelo_aplicado.parametrizacao.espessura_base,
            }
          : null,
        medidas_projeto: { largura: p.largura, altura: p.altura, espessura: p.espessura },
        operacoes_recalculadas: res.operacoes_recalculadas,
        alertas: res.alertas,
        erros: res.erros,
        aplicado_em: new Date().toISOString(),
      };
      const { error: e2 } = await supabase
        .from("projeto_pecas")
        .update({
          dados_tecnicos_aplicados_json: aplicadoJson,
          status_tecnico: res.status_tecnico,
        })
        .eq("id", p.id);
      if (e2) throw e2;
      toast.success(`Modelo aplicado (${res.status_tecnico})`);
      qc.invalidateQueries({ queryKey: ["projeto-pecas", projetoId] });
      setVisualizar({
        ...p,
        dados_tecnicos_aplicados_json: aplicadoJson,
        status_tecnico: res.status_tecnico,
      });
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao aplicar técnica");
    }
  }

  async function gerarManual(p: ProjetoPeca) {
    try {
      const { json, status_tecnico } = gerarDadosTecnicosManuais({
        largura: p.largura,
        altura: p.altura,
        espessura: p.espessura,
        codigo: p.codigo,
        descricao: p.descricao,
        fita_codigo: p.fita_codigo,
        modulo: p.modulo,
        quantidade: p.quantidade,
        veio: p.veio,
        operacoesExistentes:
          (p.dados_tecnicos_aplicados_json as any)?.operacoes_recalculadas ?? [],
      });
      const { error } = await supabase
        .from("projeto_pecas")
        .update({ dados_tecnicos_aplicados_json: json as any, status_tecnico })
        .eq("id", p.id);
      if (error) throw error;
      toast.success("Técnica manual gerada");
      qc.invalidateQueries({ queryKey: ["projeto-pecas", projetoId] });
      setVisualizar({ ...p, dados_tecnicos_aplicados_json: json as any, status_tecnico });
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao gerar técnica manual");
    }
  }

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
          <SelecionarPecaBibliotecaDialog
            onSelect={onAddFromBiblioteca}
            trigger={
              <Button size="sm" variant="outline">
                <BookOpen className="mr-1 h-4 w-4" />Da biblioteca
              </Button>
            }
          />
          <Button size="sm" onClick={onAdd}><Plus className="mr-1 h-4 w-4" />Adicionar peça</Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2"></th>
              <th className="w-8 px-1 py-2"></th>
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
              const temBib = !!p.peca_cadastrada_id;
              const aberto = expandida === p.id;
              return (
              <React.Fragment key={p.id}>
                <tr className={`border-t border-border hover:bg-surface-2 ${selectedRows.has(p.id) ? "bg-primary/5" : ""}`}>
                  <td className="px-2 py-1 text-center">
                    <input type="checkbox" checked={selectedRows.has(p.id)} onChange={() => toggleRow(p.id)} />
                  </td>
                  <td className="px-1 py-1 text-center">
                    {temBib ? (
                      <button
                        type="button"
                        onClick={() => setExpandida(aberto ? null : p.id)}
                        title="Ver aplicação técnica"
                        className="inline-flex items-center justify-center rounded hover:bg-surface-2"
                      >
                        {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    ) : null}
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
                    <StatusTecnicoBadge status={p.status_tecnico ?? "nao_aplicado"} />
                    {p.dados_tecnicos_aplicados_json ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title={`Visualizar técnica aplicada\nBiblioteca: sim · Aplicado: sim · ${p.status_tecnico ?? "—"}`}
                        onClick={() => setVisualizar(p)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    ) : p.peca_cadastrada_id ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Aplicar técnica e visualizar (Biblioteca: sim · Aplicado: não)"
                        onClick={() => aplicarEAbrir(p)}
                      >
                        <Wand2 className="h-3.5 w-3.5 text-primary" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Gerar técnica manual e visualizar (Peça manual · Aplicado: não)"
                        onClick={() => gerarManual(p)}
                      >
                        <Wand2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
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
                {aberto && temBib && (
                  <tr className="border-t border-border bg-surface-2/30">
                    <td colSpan={12} className="p-3">
                      <PainelAplicacaoTecnica
                        pecaCadastradaId={p.peca_cadastrada_id!}
                        medidasProjeto={{ largura: p.largura, altura: p.altura, espessura: p.espessura }}
                        statusAtual={p.status_tecnico}
                        onPersist={async (res) => {
                          const { error } = await supabase
                            .from("projeto_pecas")
                            .update({
                              dados_tecnicos_aplicados_json: {
                                origem: "biblioteca_parametrica",
                                peca_cadastrada_id: p.peca_cadastrada_id,
                                codigo_modelo: res.modelo_aplicado.codigo ?? null,
                                medidas_base: res.modelo_aplicado.parametrizacao
                                  ? {
                                      largura: res.modelo_aplicado.parametrizacao.largura_base,
                                      altura: res.modelo_aplicado.parametrizacao.altura_base,
                                      espessura: res.modelo_aplicado.parametrizacao.espessura_base,
                                    }
                                  : null,
                                medidas_projeto: { largura: p.largura, altura: p.altura, espessura: p.espessura },
                                operacoes_recalculadas: res.operacoes_recalculadas,
                                alertas: res.alertas,
                                erros: res.erros,
                                aplicado_em: new Date().toISOString(),
                              },
                              status_tecnico: res.status_tecnico,
                            })
                            .eq("id", p.id);
                          if (error) {
                            toast.error(error.message);
                            return;
                          }
                          toast.success(`Modelo aplicado (${res.status_tecnico})`);
                          qc.invalidateQueries({ queryKey: ["projeto-pecas", projetoId] });
                        }}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
              );
            })}
            {pecas.length === 0 && (
              <tr><td colSpan={12} className="px-3 py-8 text-center text-muted-foreground">Nenhuma peça. Clique em "Adicionar peça" ou cole linhas do Excel.</td></tr>
            )}
          </tbody>
          {pecas.length > 0 && (
            <tfoot className="bg-surface-2 text-xs font-semibold">
              <tr className="border-t-2 border-border">
                <td colSpan={3} className="px-2 py-2 text-right">Totais</td>
                <td className="px-2 py-2 text-right font-mono">{totalPecas}</td>
                <td colSpan={2} className="px-2 py-2 text-right text-muted-foreground">Área total</td>
                <td colSpan={2} className="px-2 py-2 text-right font-mono">{areaTotalM2.toFixed(2)} m²</td>
                <td colSpan={4}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {visualizar && (
        <VisualizadorPecaProjetoDialog
          open={!!visualizar}
          onOpenChange={(v) => { if (!v) setVisualizar(null); }}
          peca={visualizar}
          onPersist={async (res) => {
            const { error } = await supabase
              .from("projeto_pecas")
              .update({
                dados_tecnicos_aplicados_json: {
                  origem: "biblioteca_parametrica",
                  peca_cadastrada_id: visualizar.peca_cadastrada_id,
                  codigo_modelo: res.modelo_aplicado.codigo ?? null,
                  medidas_base: res.modelo_aplicado.parametrizacao
                    ? {
                        largura: res.modelo_aplicado.parametrizacao.largura_base,
                        altura: res.modelo_aplicado.parametrizacao.altura_base,
                        espessura: res.modelo_aplicado.parametrizacao.espessura_base,
                      }
                    : null,
                  medidas_projeto: {
                    largura: visualizar.largura,
                    altura: visualizar.altura,
                    espessura: visualizar.espessura,
                  },
                  operacoes_recalculadas: res.operacoes_recalculadas,
                  alertas: res.alertas,
                  erros: res.erros,
                  aplicado_em: new Date().toISOString(),
                },
                status_tecnico: res.status_tecnico,
              })
              .eq("id", visualizar.id);
            if (error) {
              toast.error(error.message);
              return;
            }
            toast.success(`Modelo reaplicado (${res.status_tecnico})`);
            qc.invalidateQueries({ queryKey: ["projeto-pecas", projetoId] });
            setVisualizar(null);
          }}
        />
      )}
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

function StatusTecnicoBadge({ status }: { status: StatusTecnico }) {
  const map: Record<StatusTecnico, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
    nao_aplicado: { label: "Não aplicado", cls: "bg-muted text-muted-foreground", Icon: AlertTriangle },
    aplicado_ok: { label: "OK", cls: "bg-success/10 text-success", Icon: CheckCircle2 },
    aplicado_com_alerta: { label: "Alerta", cls: "bg-warning/10 text-warning", Icon: AlertTriangle },
    aplicado_com_erro: { label: "Erro", cls: "bg-destructive/10 text-destructive", Icon: XCircle },
  };
  const m = map[status];
  return (
    <span
      className={`mr-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${m.cls}`}
      title={`Técnica: ${m.label}`}
    >
      <m.Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}
