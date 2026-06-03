import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Printer, FileDown, RefreshCw, CheckCheck, QrCode } from "lucide-react";
import { toast } from "sonner";
import { EtiquetaPreview } from "@/components/etiqueta-preview";
import {
  gerarCodigoBarras,
  gerarIndicePeca,
  PRESETS_ETIQUETA,
  type PresetEtiqueta,
  type CamposVisiveis,
  type ConteudoEtiqueta,
} from "@/lib/etiquetas";

export const Route = createFileRoute("/_authenticated/etiquetas")({
  head: () => ({ meta: [{ title: "Etiquetas — Visualizador CNC" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    projeto: typeof s.projeto === "string" ? s.projeto : undefined,
    chapa: typeof s.chapa === "string" ? s.chapa : undefined,
    peca: typeof s.peca === "string" ? s.peca : undefined,
  }),
  component: EtiquetasPage,
});

const CAMPOS_DEFAULT: CamposVisiveis = {
  cliente: true, projeto: true, ambiente: true, modulo: true,
  peca: true, chapa: true, numero_peca: true, dimensoes: true,
  fita: true, codigo_item: true, codigo_barras: true, qr_code: false,
  mini_mapa: true, observacao: true,
};

function EtiquetasPage() {
  const qc = useQueryClient();
  const search = Route.useSearch();
  const [projetoId, setProjetoId] = useState<string | undefined>(search.projeto);
  const [filtroChapa, setFiltroChapa] = useState<string>(search.chapa ?? "todas");
  const [filtroStatus, setFiltroStatus] = useState<string>("todas");
  const [filtroModulo, setFiltroModulo] = useState<string>("todos");
  const [busca, setBusca] = useState<string>("");
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());

  // Configuração de impressão (local + sync com banco)
  const { data: configDb } = useQuery({
    queryKey: ["etiqueta-config"],
    queryFn: async () => {
      const { data } = await supabase.from("etiqueta_config").select("*").maybeSingle();
      return data;
    },
  });

  const [preset, setPreset] = useState<PresetEtiqueta>("media");
  const [campos, setCampos] = useState<CamposVisiveis>(CAMPOS_DEFAULT);
  const [largMm, setLargMm] = useState(80);
  const [altMm, setAltMm] = useState(50);
  const [colunas, setColunas] = useState(2);
  const [linhas, setLinhas] = useState(5);
  const [orientacao, setOrientacao] = useState<"retrato" | "paisagem">("retrato");

  // Aplicar config do banco quando carregar
  useMemo(() => {
    if (!configDb) return;
    setPreset(configDb.preset as PresetEtiqueta);
    setCampos({ ...CAMPOS_DEFAULT, ...(configDb.campos_visiveis as Partial<CamposVisiveis>) });
    setLargMm(Number(configDb.largura_mm));
    setAltMm(Number(configDb.altura_mm));
    setColunas(configDb.colunas);
    setLinhas(configDb.linhas);
    setOrientacao(configDb.orientacao as "retrato" | "paisagem");
  }, [configDb]);

  function aplicarPreset(p: PresetEtiqueta) {
    const cfg = PRESETS_ETIQUETA[p];
    setPreset(p);
    setLargMm(cfg.largura_mm);
    setAltMm(cfg.altura_mm);
    setColunas(cfg.colunas);
    setLinhas(cfg.linhas);
  }

  const salvarConfig = useMutation({
    mutationFn: async () => {
      const payload = {
        preset, largura_mm: largMm, altura_mm: altMm,
        colunas, linhas, orientacao,
        margem_mm: 5, espacamento_h_mm: 3, espacamento_v_mm: 3,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        campos_visiveis: campos as any,
      };
      if (configDb) {
        const { error } = await supabase.from("etiqueta_config").update(payload).eq("id", configDb.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("etiqueta_config").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["etiqueta-config"] }); toast.success("Configuração salva"); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Lista de projetos
  const { data: projetos } = useQuery({
    queryKey: ["projetos-com-plano"],
    queryFn: async () => {
      const { data } = await supabase
        .from("projetos")
        .select("id, nome, cliente, ambiente")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Dados do projeto: plano + chapas + peças
  const { data: dadosPlano, refetch: refetchPlano } = useQuery({
    enabled: !!projetoId,
    queryKey: ["plano-completo", projetoId],
    queryFn: async () => {
      const { data: projeto } = await supabase.from("projetos").select("*").eq("id", projetoId!).single();
      const { data: plano } = await supabase.from("planos_corte")
        .select("*").eq("projeto_id", projetoId!).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!plano) return { projeto, plano: null, chapas: [], pecas: [], projetoPecas: [], chapasInfo: [] };
      const { data: chapasPlano } = await supabase.from("plano_corte_chapas")
        .select("*").eq("plano_id", plano.id).order("indice");
      const idsCh = (chapasPlano ?? []).map((c) => c.id);
      const { data: pecasPlano } = idsCh.length
        ? await supabase.from("plano_corte_pecas").select("*").in("plano_chapa_id", idsCh)
        : { data: [] as Array<{ id: string; plano_chapa_id: string; projeto_peca_id: string; x: number; y: number; largura: number; altura: number; rotacionada: boolean }> };
      const { data: projetoPecas } = await supabase.from("projeto_pecas")
        .select("*").eq("projeto_id", projetoId!);
      const idsChapas = Array.from(new Set((chapasPlano ?? []).map((c) => c.chapa_id)));
      const { data: chapasInfo } = idsChapas.length
        ? await supabase.from("chapas").select("*").in("id", idsChapas)
        : { data: [] };
      return { projeto, plano, chapas: chapasPlano ?? [], pecas: pecasPlano ?? [], projetoPecas: projetoPecas ?? [], chapasInfo: chapasInfo ?? [] };
    },
  });

  // Etiquetas existentes
  const { data: etiquetas } = useQuery({
    enabled: !!projetoId,
    queryKey: ["etiquetas", projetoId],
    queryFn: async () => {
      const { data } = await supabase.from("etiquetas").select("*").eq("projeto_id", projetoId!);
      return data ?? [];
    },
  });

  // Etiquetas computadas (preview)
  const previews = useMemo(() => {
    if (!dadosPlano?.plano) return [];
    const items: Array<{
      key: string;
      codigo: string;
      numero_chapa: number;
      indice: string;
      conteudo: ConteudoEtiqueta;
      plano_chapa_id: string;
      plano_corte_peca_id: string;
      projeto_peca_id: string;
      modulo: string;
      status: string;
    }> = [];
    const { plano, chapas, pecas, projetoPecas, chapasInfo, projeto } = dadosPlano;
    for (const ch of chapas) {
      const pecasNessaCh = pecas.filter((p) => p.plano_chapa_id === ch.id);
      const chapaInfo = chapasInfo.find((c) => c.id === ch.chapa_id);
      // Mini mapa
      const miniPecas = pecasNessaCh.map((p) => ({ x: Number(p.x), y: Number(p.y), w: Number(p.largura), h: Number(p.altura), destaque: false }));
      pecasNessaCh.forEach((pc, i) => {
        const pp = projetoPecas.find((x) => x.id === pc.projeto_peca_id);
        if (!pp) return;
        const indice = gerarIndicePeca(ch.indice, i);
        const codigo = gerarCodigoBarras({ projetoId: plano.projeto_id, numChapa: ch.indice, indicePeca: indice.replace(/^\d+/, "") });
        const existing = etiquetas?.find((e) => e.codigo_barras === codigo);
        const conteudo: ConteudoEtiqueta = {
          cliente: projeto?.cliente ?? "",
          projeto: projeto?.nome ?? "",
          ambiente: projeto?.ambiente ?? "",
          modulo: pp.modulo ?? "",
          peca_descricao: pp.descricao,
          peca_codigo: "",
          numero_peca: indice,
          numero_chapa: ch.indice,
          material: chapaInfo?.nome ?? "—",
          cor_chapa: chapaInfo?.cor ?? "#cccccc",
          largura: Number(pp.largura),
          altura: Number(pp.altura),
          espessura: Number(pp.espessura),
          fita: pp.fita_codigo ?? "",
          observacao: pp.observacao ?? "",
          mini_mapa: chapaInfo ? {
            chapa_largura: Number(chapaInfo.largura),
            chapa_altura: Number(chapaInfo.altura),
            pecas: miniPecas.map((mp, j) => ({ ...mp, destaque: j === i })),
          } : null,
        };
        items.push({
          key: `${ch.id}-${pc.id}`,
          codigo,
          numero_chapa: ch.indice,
          indice,
          conteudo,
          plano_chapa_id: ch.id,
          plano_corte_peca_id: pc.id,
          projeto_peca_id: pp.id,
          modulo: pp.modulo ?? "",
          status: existing?.status_impressao ?? "pendente",
        });
      });
    }
    return items;
  }, [dadosPlano, etiquetas]);

  // Aplicar filtros
  const previewsFiltrados = useMemo(() => {
    return previews.filter((p) => {
      if (filtroChapa !== "todas" && String(p.numero_chapa) !== filtroChapa) return false;
      if (filtroStatus !== "todas" && p.status !== filtroStatus) return false;
      if (filtroModulo !== "todos" && p.modulo !== filtroModulo) return false;
      if (busca && !`${p.conteudo.peca_descricao} ${p.codigo}`.toLowerCase().includes(busca.toLowerCase())) return false;
      if (search.peca && p.projeto_peca_id !== search.peca) return false;
      return true;
    });
  }, [previews, filtroChapa, filtroStatus, filtroModulo, busca, search.peca]);

  const modulosDisponiveis = useMemo(() => Array.from(new Set(previews.map((p) => p.modulo).filter(Boolean))), [previews]);
  const chapasDisponiveis = useMemo(() => Array.from(new Set(previews.map((p) => p.numero_chapa))).sort((a, b) => a - b), [previews]);

  const totalPendentes = previews.filter((p) => p.status === "pendente").length;
  const totalImpressas = previews.filter((p) => p.status === "impressa" || p.status === "reimpressa").length;

  // Gerar/Persistir etiquetas
  const gerarEtiquetas = useMutation({
    mutationFn: async (escopo: "todas" | "selecionadas" | "pendentes") => {
      if (!dadosPlano?.plano) throw new Error("Sem plano de corte salvo");
      let alvo = previews;
      if (escopo === "selecionadas") alvo = previews.filter((p) => selecionadas.has(p.key));
      if (escopo === "pendentes") alvo = previews.filter((p) => !etiquetas?.find((e) => e.codigo_barras === p.codigo));
      const novas = alvo
        .filter((p) => !etiquetas?.find((e) => e.codigo_barras === p.codigo))
        .map((p) => ({
          projeto_id: projetoId!,
          plano_id: dadosPlano.plano!.id,
          plano_chapa_id: p.plano_chapa_id,
          plano_corte_peca_id: p.plano_corte_peca_id,
          projeto_peca_id: p.projeto_peca_id,
          numero_chapa: p.numero_chapa,
          indice_peca: p.indice,
          codigo_barras: p.codigo,
          conteudo_json: p.conteudo as unknown as Record<string, unknown>,
          status_impressao: "gerada",
        }));
      if (novas.length === 0) return 0;
      const { error } = await supabase.from("etiquetas").insert(novas);
      if (error) throw error;
      return novas.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["etiquetas", projetoId] });
      toast.success(`${n} etiqueta(s) geradas`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const marcarImpressas = useMutation({
    mutationFn: async (escopo: "filtradas" | "selecionadas") => {
      const alvo = escopo === "selecionadas"
        ? previewsFiltrados.filter((p) => selecionadas.has(p.key))
        : previewsFiltrados;
      const ids = (etiquetas ?? []).filter((e) => alvo.some((p) => p.codigo === e.codigo_barras)).map((e) => e.id);
      if (ids.length === 0) return 0;
      const { error } = await supabase.from("etiquetas")
        .update({
          status_impressao: "impressa",
          impresso_em: new Date().toISOString(),
        })
        .in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["etiquetas", projetoId] });
      toast.success(`${n} marcada(s) como impressa(s)`);
    },
  });

  function imprimir() {
    window.print();
  }

  function toggleSelecao(key: string) {
    setSelecionadas((s) => {
      const ns = new Set(s);
      if (ns.has(key)) ns.delete(key); else ns.add(key);
      return ns;
    });
  }

  function selecionarTodas() {
    if (selecionadas.size === previewsFiltrados.length) setSelecionadas(new Set());
    else setSelecionadas(new Set(previewsFiltrados.map((p) => p.key)));
  }

  return (
    <div className="flex h-full flex-col">
      {/* Cabeçalho */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-panel px-6 py-3 print:hidden">
        <div className="flex items-center gap-3">
          <QrCode className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Etiquetas</h1>
            <p className="text-xs text-muted-foreground">
              {previews.length} etiquetas · {totalPendentes} pendentes · {totalImpressas} impressas
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={projetoId ?? ""} onValueChange={(v) => setProjetoId(v)}>
            <SelectTrigger className="h-9 w-[260px]"><SelectValue placeholder="Selecione um projeto" /></SelectTrigger>
            <SelectContent>
              {projetos?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nome} {p.cliente ? `— ${p.cliente}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => refetchPlano()} disabled={!projetoId}>
            <RefreshCw className="mr-1 h-4 w-4" />Recarregar
          </Button>
          <Button size="sm" onClick={() => gerarEtiquetas.mutate("todas")} disabled={!dadosPlano?.plano}>
            <QrCode className="mr-1 h-4 w-4" />Gerar etiquetas
          </Button>
          <Button size="sm" variant="outline" onClick={imprimir} disabled={previewsFiltrados.length === 0}>
            <Printer className="mr-1 h-4 w-4" />Imprimir / PDF
          </Button>
          <Button size="sm" variant="outline" onClick={() => marcarImpressas.mutate("filtradas")} disabled={previewsFiltrados.length === 0}>
            <CheckCheck className="mr-1 h-4 w-4" />Marcar impressas
          </Button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[260px_1fr_280px] overflow-hidden print:block">
        {/* Filtros */}
        <aside className="overflow-auto border-r border-border bg-panel p-3 print:hidden">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Filtros</h3>
          <div className="space-y-3">
            <div>
              <Label className="text-[11px]">Buscar</Label>
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Código ou descrição" className="h-8" />
            </div>
            <div>
              <Label className="text-[11px]">Chapa</Label>
              <Select value={filtroChapa} onValueChange={setFiltroChapa}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as chapas</SelectItem>
                  {chapasDisponiveis.map((c) => (
                    <SelectItem key={c} value={String(c)}>Chapa {c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px]">Módulo</Label>
              <Select value={filtroModulo} onValueChange={setFiltroModulo}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {modulosDisponiveis.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px]">Status</Label>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todos</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="gerada">Gerada</SelectItem>
                  <SelectItem value="impressa">Impressa</SelectItem>
                  <SelectItem value="reimpressa">Reimpressa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="border-t border-border pt-3 space-y-2">
              <Button size="sm" variant="outline" className="w-full" onClick={selecionarTodas}>
                {selecionadas.size === previewsFiltrados.length && previewsFiltrados.length > 0 ? "Limpar seleção" : "Selecionar tudo"}
              </Button>
              <Button size="sm" variant="outline" className="w-full" onClick={() => gerarEtiquetas.mutate("selecionadas")} disabled={selecionadas.size === 0}>
                Gerar selecionadas ({selecionadas.size})
              </Button>
              <Button size="sm" variant="outline" className="w-full" onClick={() => gerarEtiquetas.mutate("pendentes")}>
                Gerar pendentes
              </Button>
            </div>
          </div>
        </aside>

        {/* Grid de previews */}
        <main className="overflow-auto bg-surface-2 p-6 print:bg-white print:p-0">
          {!projetoId ? (
            <Vazio msg="Selecione um projeto para visualizar etiquetas." />
          ) : !dadosPlano?.plano ? (
            <Vazio msg="Esse projeto ainda não tem plano de corte salvo. Gere e salve o plano antes." />
          ) : previewsFiltrados.length === 0 ? (
            <Vazio msg="Nenhuma etiqueta para os filtros atuais." />
          ) : (
            <div
              className="grid gap-3 print:gap-0"
              style={{ gridTemplateColumns: `repeat(${colunas}, ${largMm}mm)` }}
            >
              {previewsFiltrados.map((p) => (
                <div
                  key={p.key}
                  className={`relative cursor-pointer transition-all print:cursor-default ${selecionadas.has(p.key) ? "ring-2 ring-primary ring-offset-2" : ""}`}
                  onClick={() => toggleSelecao(p.key)}
                >
                  <EtiquetaPreview
                    conteudo={p.conteudo}
                    codigo_barras={p.codigo}
                    largura_mm={largMm}
                    altura_mm={altMm}
                    campos={campos}
                    status={p.status}
                  />
                </div>
              ))}
            </div>
          )}
        </main>

        {/* Configurador */}
        <aside className="overflow-auto border-l border-border bg-panel p-3 print:hidden">
          <Tabs defaultValue="layout">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="layout">Layout</TabsTrigger>
              <TabsTrigger value="campos">Campos</TabsTrigger>
            </TabsList>
            <TabsContent value="layout" className="space-y-3 pt-3">
              <div>
                <Label className="text-[11px]">Preset</Label>
                <Select value={preset} onValueChange={(v) => aplicarPreset(v as PresetEtiqueta)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pequena">Pequena (50×30)</SelectItem>
                    <SelectItem value="media">Média (80×50)</SelectItem>
                    <SelectItem value="grande">Grande (100×70)</SelectItem>
                    <SelectItem value="a4">Folha A4 (2×4)</SelectItem>
                    <SelectItem value="termica">Térmica (100×50)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-[11px]">Largura (mm)</Label><Input type="number" className="h-8" value={largMm} onChange={(e) => setLargMm(Number(e.target.value) || 0)} /></div>
                <div><Label className="text-[11px]">Altura (mm)</Label><Input type="number" className="h-8" value={altMm} onChange={(e) => setAltMm(Number(e.target.value) || 0)} /></div>
                <div><Label className="text-[11px]">Colunas</Label><Input type="number" className="h-8" value={colunas} onChange={(e) => setColunas(Number(e.target.value) || 1)} /></div>
                <div><Label className="text-[11px]">Linhas</Label><Input type="number" className="h-8" value={linhas} onChange={(e) => setLinhas(Number(e.target.value) || 1)} /></div>
              </div>
              <div>
                <Label className="text-[11px]">Orientação</Label>
                <Select value={orientacao} onValueChange={(v) => setOrientacao(v as "retrato" | "paisagem")}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retrato">Retrato</SelectItem>
                    <SelectItem value="paisagem">Paisagem</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" className="w-full" onClick={() => salvarConfig.mutate()}>
                <FileDown className="mr-1 h-4 w-4" />Salvar como padrão
              </Button>
            </TabsContent>
            <TabsContent value="campos" className="space-y-1 pt-3 text-xs">
              {(Object.keys(CAMPOS_DEFAULT) as Array<keyof CamposVisiveis>).map((k) => (
                <label key={k} className="flex cursor-pointer items-center justify-between rounded px-2 py-1 hover:bg-surface-2">
                  <span className="capitalize">{k.replace(/_/g, " ")}</span>
                  <input
                    type="checkbox"
                    checked={campos[k]}
                    onChange={(e) => setCampos((c) => ({ ...c, [k]: e.target.checked }))}
                  />
                </label>
              ))}
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      <style>{`
        @media print {
          @page { size: ${orientacao === "paisagem" ? "landscape" : "portrait"}; margin: 8mm; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  );
}

function Vazio({ msg }: { msg: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="rounded border border-dashed border-border bg-surface p-12 text-center text-sm text-muted-foreground">
        {msg}
      </div>
    </div>
  );
}
