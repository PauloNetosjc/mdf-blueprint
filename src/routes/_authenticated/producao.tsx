import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Scan, AlertTriangle, CheckCircle2, Volume2, VolumeX, Zap, History, X,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/producao")({
  head: () => ({ meta: [{ title: "Produção — Visualizador CNC" }] }),
  component: ProducaoPage,
});

type EtapaKey =
  | "corte" | "furacao" | "borda" | "separacao" | "almoxarifado" | "expedicao";

const ETAPAS: { key: EtapaKey; label: string; statusOk: string; statusEm: string; statusProblema: string }[] = [
  { key: "corte",        label: "Corte",        statusEm: "em corte",       statusOk: "cortada",            statusProblema: "problema no corte" },
  { key: "furacao",      label: "Furação",      statusEm: "em furação",     statusOk: "furada",             statusProblema: "problema na furação" },
  { key: "borda",        label: "Borda",        statusEm: "em borda",       statusOk: "bordada",            statusProblema: "problema na borda" },
  { key: "separacao",    label: "Separação",    statusEm: "em separação",   statusOk: "separada",           statusProblema: "peça faltante" },
  { key: "almoxarifado", label: "Almoxarifado", statusEm: "em separação",   statusOk: "separado",           statusProblema: "faltando item" },
  { key: "expedicao",    label: "Expedição",    statusEm: "pronto",         statusOk: "expedido",           statusProblema: "problema" },
];

const TIPOS_OCORRENCIA = [
  "peça danificada", "peça faltante", "furo errado", "borda errada",
  "medida errada", "material errado", "etiqueta ilegível", "outro",
];

const STATUS_COLORS: Record<string, string> = {
  pendente: "bg-muted text-muted-foreground",
  cortada: "bg-emerald-600/20 text-emerald-300 border-emerald-700",
  furada: "bg-emerald-600/20 text-emerald-300 border-emerald-700",
  bordada: "bg-emerald-600/20 text-emerald-300 border-emerald-700",
  separada: "bg-emerald-600/20 text-emerald-300 border-emerald-700",
  separado: "bg-emerald-600/20 text-emerald-300 border-emerald-700",
  expedido: "bg-sky-600/20 text-sky-300 border-sky-700",
};

function beep(ok: boolean) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.08;
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, ok ? 120 : 280);
  } catch { /* no-op */ }
}

function ProducaoPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Produção</h1>
        <p className="text-sm text-muted-foreground">
          Bipagem de etiquetas e controle de chão de fábrica.
        </p>
      </div>
      <Tabs defaultValue="bipagem">
        <TabsList>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="bipagem">Bipagem</TabsTrigger>
          <TabsTrigger value="projetos">Projetos</TabsTrigger>
          <TabsTrigger value="chapas">Chapas</TabsTrigger>
          <TabsTrigger value="pecas">Peças</TabsTrigger>
          <TabsTrigger value="ocorrencias">Ocorrências</TabsTrigger>
        </TabsList>
        <TabsContent value="resumo"><ResumoTab /></TabsContent>
        <TabsContent value="bipagem"><BipagemTab /></TabsContent>
        <TabsContent value="projetos"><ProjetosTab /></TabsContent>
        <TabsContent value="chapas"><ChapasTab /></TabsContent>
        <TabsContent value="pecas"><PecasTab /></TabsContent>
        <TabsContent value="ocorrencias"><OcorrenciasTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ───────────────────────────────────────────────────── BIPAGEM ──
function BipagemTab() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [codigo, setCodigo] = useState("");
  const [operador, setOperador] = useState(() => localStorage.getItem("op_nome") ?? "");
  const [centroId, setCentroId] = useState<string>(() => localStorage.getItem("op_centro") ?? "");
  const [projetoFiltro, setProjetoFiltro] = useState<string>("todos");
  const [auto, setAuto] = useState(true);
  const [som, setSom] = useState(true);
  const [ultima, setUltima] = useState<any | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => { localStorage.setItem("op_nome", operador); }, [operador]);
  useEffect(() => { localStorage.setItem("op_centro", centroId); }, [centroId]);

  // Centros + seed se vazio
  const { data: centros } = useQuery({
    queryKey: ["centros-trabalho"],
    queryFn: async () => {
      const { data } = await supabase
        .from("centros_trabalho").select("*").eq("ativo", true).order("nome");
      if (data && data.length === 0) {
        const seed = [
          { nome: "Corte", tipo: "corte" },
          { nome: "Furação", tipo: "furacao" },
          { nome: "Borda", tipo: "borda" },
          { nome: "Separação", tipo: "separacao" },
          { nome: "Almoxarifado", tipo: "almoxarifado" },
          { nome: "Expedição", tipo: "expedicao" },
        ];
        await supabase.from("centros_trabalho").insert(seed as any);
        const r = await supabase.from("centros_trabalho").select("*").order("nome");
        return r.data ?? [];
      }
      return data ?? [];
    },
  });

  const { data: projetos } = useQuery({
    queryKey: ["projetos-lista"],
    queryFn: async () => (await supabase.from("projetos").select("id,nome,cliente").order("nome")).data ?? [],
  });

  const centroAtual = useMemo(
    () => centros?.find((c: any) => c.id === centroId),
    [centros, centroId],
  );
  const etapaAtual: EtapaKey | null = useMemo(() => {
    const t = centroAtual?.tipo;
    if (!t) return null;
    if (["corte","furacao","borda","separacao","almoxarifado","expedicao"].includes(t)) return t as EtapaKey;
    return null;
  }, [centroAtual]);

  const focar = () => setTimeout(() => inputRef.current?.focus(), 0);
  useEffect(() => { focar(); }, []);

  const registrarMut = useMutation({
    mutationFn: async (codBarras: string) => {
      const cod = codBarras.trim();
      if (!cod) throw new Error("Código vazio");
      if (!centroId) throw new Error("Selecione um centro de trabalho");

      // 1. Localiza etiqueta
      const { data: et } = await supabase
        .from("etiquetas").select("*").eq("codigo_barras", cod).maybeSingle();
      if (!et) throw new Error("Etiqueta não encontrada");

      // 2. Carrega peça + projeto + chapa
      const { data: pp } = await supabase
        .from("projeto_pecas").select("*").eq("id", et.projeto_peca_id).maybeSingle();
      const { data: proj } = await supabase
        .from("projetos").select("*").eq("id", et.projeto_id).maybeSingle();
      const chapaId = pp?.chapa_id;
      const { data: chapa } = chapaId
        ? await supabase.from("chapas").select("*").eq("id", chapaId).maybeSingle()
        : { data: null as any };

      // 3. Status atual (upsert se faltar)
      let { data: status } = await supabase
        .from("producao_status_pecas").select("*")
        .eq("projeto_peca_id", et.projeto_peca_id).maybeSingle();
      if (!status) {
        const { data: novo } = await supabase
          .from("producao_status_pecas")
          .insert({
            projeto_id: et.projeto_id,
            projeto_peca_id: et.projeto_peca_id,
            plano_corte_peca_id: et.plano_corte_peca_id,
            etiqueta_id: et.id,
          } as any).select("*").single();
        status = novo!;
      }

      // 4. Histórico
      const { data: historico } = await supabase
        .from("producao_eventos").select("*")
        .eq("projeto_peca_id", et.projeto_peca_id)
        .order("criado_em", { ascending: false }).limit(10);

      let duplicado = false;
      let novoStatus: string | null = null;

      // 5. Avanço automático
      if (auto && etapaAtual) {
        const col = `status_${etapaAtual}` as const;
        const atual = (status as any)[col] as string;
        const cfg = ETAPAS.find((e) => e.key === etapaAtual)!;
        if (atual && atual !== "pendente" && atual !== cfg.statusEm) {
          duplicado = true;
        } else {
          novoStatus = cfg.statusOk;
          await supabase.from("producao_status_pecas")
            .update({ [col]: novoStatus, atualizado_em: new Date().toISOString() } as any)
            .eq("id", status.id);
          await supabase.from("producao_eventos").insert({
            projeto_id: et.projeto_id,
            projeto_peca_id: et.projeto_peca_id,
            plano_corte_peca_id: et.plano_corte_peca_id,
            etiqueta_id: et.id,
            centro_trabalho_id: centroId,
            tipo_evento: etapaAtual,
            status_anterior: atual,
            status_novo: novoStatus,
            codigo_barras: cod,
            operador: operador || null,
          } as any);
        }
      }

      return { etiqueta: et, peca: pp, projeto: proj, chapa, status, historico, duplicado, novoStatus };
    },
    onSuccess: (r) => {
      setErro(null);
      setUltima(r);
      if (r.duplicado) {
        if (som) beep(false);
        toast.warning("Peça já processada nesta etapa");
      } else {
        if (som) beep(true);
        toast.success(r.novoStatus ? `Registrado: ${r.novoStatus}` : "Peça localizada");
      }
      setCodigo("");
      qc.invalidateQueries({ queryKey: ["producao-resumo"] });
      qc.invalidateQueries({ queryKey: ["producao-pecas"] });
      focar();
    },
    onError: (e: any) => {
      if (som) beep(false);
      setErro(e.message);
      setUltima(null);
      toast.error(e.message);
      focar();
    },
  });

  const projetoSelecionado = projetos?.find((p: any) => p.id === projetoFiltro);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Scan className="h-5 w-5" /> Bipagem</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Centro de trabalho *</Label>
              <Select value={centroId} onValueChange={setCentroId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {centros?.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Operador</Label>
              <Input value={operador} onChange={(e) => setOperador(e.target.value)} placeholder="Nome" />
            </div>
            <div>
              <Label>Projeto (opcional)</Label>
              <Select value={projetoFiltro} onValueChange={setProjetoFiltro}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {projetos?.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Código da etiqueta
              </Label>
              <Input
                ref={inputRef}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); registrarMut.mutate(codigo); }
                }}
                placeholder="Bipe ou digite o código da etiqueta"
                className="h-14 text-2xl font-mono tracking-wider"
                autoFocus
                disabled={!centroId}
              />
            </div>
            <Button
              size="lg" className="h-14 px-6"
              onClick={() => registrarMut.mutate(codigo)}
              disabled={!centroId || !codigo}
            >
              Registrar
            </Button>
            <Button size="lg" variant="outline" className="h-14" onClick={() => { setCodigo(""); focar(); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-6 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={auto} onCheckedChange={setAuto} />
              <Zap className="h-4 w-4" /> Modo automático
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={som} onCheckedChange={setSom} />
              {som ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />} Som
            </label>
            <div className="ml-auto text-muted-foreground text-xs">
              {new Date().toLocaleString("pt-BR")}
            </div>
          </div>

          {erro && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <div className="flex-1">
                <div className="font-semibold text-destructive">{erro}</div>
                <div className="text-xs text-muted-foreground">Verifique se a etiqueta foi gerada.</div>
              </div>
              <RegistrarOcorrenciaBtn
                codigoBarras={codigo}
                centroId={centroId}
                projetoId={projetoSelecionado?.id}
                operador={operador}
              />
            </div>
          )}

          {ultima && <PecaCard ultima={ultima} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Últimos eventos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <UltimosEventos centroId={centroId} />
        </CardContent>
      </Card>
    </div>
  );
}

function PecaCard({ ultima }: { ultima: any }) {
  const { peca, projeto, chapa, status, historico, etiqueta, novoStatus, duplicado } = ultima;
  const dims = peca ? `${peca.largura} × ${peca.altura} mm` : "—";
  return (
    <Card className={duplicado ? "border-amber-500/60" : novoStatus ? "border-emerald-500/60" : ""}>
      <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className={novoStatus ? "text-emerald-500" : "text-muted-foreground"} />
            <div className="font-mono text-sm font-bold">{etiqueta.codigo_barras}</div>
          </div>
          <div className="text-lg font-semibold leading-tight">{peca?.descricao ?? "—"}</div>
          <div className="text-sm text-muted-foreground">
            {projeto?.nome} {projeto?.cliente ? ` · ${projeto.cliente}` : ""}
          </div>
          {peca?.modulo && <Badge variant="outline">{peca.modulo}</Badge>}
          {peca?.observacao && <div className="text-xs text-muted-foreground">{peca.observacao}</div>}
        </div>
        <div className="space-y-1 text-sm">
          <div><span className="text-muted-foreground">Chapa:</span> {chapa?.nome ?? "—"}</div>
          <div><span className="text-muted-foreground">Material:</span> {chapa?.tipo ?? "—"} {chapa?.espessura ? `${chapa.espessura}mm` : ""}</div>
          <div><span className="text-muted-foreground">Medidas:</span> {dims}</div>
          {peca?.fita_codigo && <div><span className="text-muted-foreground">Fita:</span> {peca.fita_codigo}</div>}
          <div><span className="text-muted-foreground">Chapa nº:</span> {etiqueta.numero_chapa} · {etiqueta.indice_peca}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs uppercase text-muted-foreground tracking-wider">Status</div>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {ETAPAS.map((e) => {
              const v = (status as any)[`status_${e.key}`];
              return (
                <div key={e.key} className="flex justify-between gap-2 py-0.5">
                  <span className="text-muted-foreground">{e.label}:</span>
                  <span className={`px-1.5 rounded ${STATUS_COLORS[v] ?? "bg-muted text-muted-foreground"}`}>{v}</span>
                </div>
              );
            })}
          </div>
          {historico?.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">Histórico ({historico.length})</summary>
              <div className="mt-1 space-y-0.5 max-h-32 overflow-auto">
                {historico.map((h: any) => (
                  <div key={h.id} className="flex justify-between gap-2">
                    <span>{h.tipo_evento}: {h.status_novo}</span>
                    <span className="text-muted-foreground">{new Date(h.criado_em).toLocaleString("pt-BR")}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RegistrarOcorrenciaBtn({ codigoBarras, centroId, projetoId, operador }: {
  codigoBarras: string; centroId: string; projetoId?: string; operador: string;
}) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async () => {
      await supabase.from("ocorrencias_producao").insert({
        projeto_id: projetoId ?? null,
        centro_trabalho_id: centroId || null,
        tipo: "etiqueta ilegível",
        descricao: `Código não encontrado: ${codigoBarras}`,
        operador: operador || null,
      } as any);
    },
    onSuccess: () => { toast.success("Ocorrência registrada"); qc.invalidateQueries({ queryKey: ["ocorrencias"] }); },
  });
  return <Button size="sm" variant="outline" onClick={() => mut.mutate()}>Registrar ocorrência</Button>;
}

function UltimosEventos({ centroId }: { centroId: string }) {
  const { data } = useQuery({
    queryKey: ["producao-eventos-recentes", centroId],
    queryFn: async () => {
      let q = supabase.from("producao_eventos").select("*").order("criado_em", { ascending: false }).limit(20);
      if (centroId) q = q.eq("centro_trabalho_id", centroId);
      return (await q).data ?? [];
    },
    refetchInterval: 5000,
  });
  if (!data?.length) return <div className="text-sm text-muted-foreground">Nenhum evento ainda.</div>;
  return (
    <div className="space-y-2 text-xs max-h-[500px] overflow-auto">
      {data.map((e: any) => (
        <div key={e.id} className="border-b pb-1">
          <div className="flex justify-between">
            <span className="font-semibold">{e.tipo_evento}</span>
            <span className="text-muted-foreground">{new Date(e.criado_em).toLocaleTimeString("pt-BR")}</span>
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">{e.codigo_barras}</div>
          <div className="text-muted-foreground">{e.status_anterior} → {e.status_novo} {e.operador ? `· ${e.operador}` : ""}</div>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────── RESUMO ──
function ResumoTab() {
  const { data } = useQuery({
    queryKey: ["producao-resumo"],
    queryFn: async () => {
      const [proj, status, oco] = await Promise.all([
        supabase.from("projetos").select("id,nome,status").eq("status", "ativo"),
        supabase.from("producao_status_pecas").select("*"),
        supabase.from("ocorrencias_producao").select("id,status").eq("status", "aberta"),
      ]);
      return { projetos: proj.data ?? [], status: status.data ?? [], ocoAbertas: oco.data?.length ?? 0 };
    },
  });

  const totais = useMemo(() => {
    const s = data?.status ?? [];
    const count = (col: string, ok: string[]) => s.filter((r: any) => ok.includes(r[col])).length;
    return {
      total: s.length,
      cortadas: count("status_corte", ["cortada"]),
      furadas: count("status_furacao", ["furada"]),
      bordadas: count("status_borda", ["bordada"]),
      separadas: count("status_separacao", ["separada"]),
      expedidas: count("status_expedicao", ["expedido"]),
    };
  }, [data]);

  const cards = [
    { label: "Projetos ativos", v: data?.projetos.length ?? 0 },
    { label: "Peças em produção", v: totais.total },
    { label: "Cortadas", v: totais.cortadas },
    { label: "Furadas", v: totais.furadas },
    { label: "Bordadas", v: totais.bordadas },
    { label: "Separadas", v: totais.separadas },
    { label: "Expedidas", v: totais.expedidas },
    { label: "Ocorrências abertas", v: data?.ocoAbertas ?? 0 },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground tracking-wider">{c.label}</div>
              <div className="text-3xl font-bold">{c.v}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Progresso por etapa</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {ETAPAS.map((e) => {
            const total = totais.total || 1;
            const done = (data?.status ?? []).filter((r: any) => {
              const v = r[`status_${e.key}`];
              return v && v !== "pendente" && !v.startsWith("em ");
            }).length;
            const pct = Math.round((done / total) * 100);
            return (
              <div key={e.key}>
                <div className="flex justify-between text-xs mb-1">
                  <span>{e.label}</span>
                  <span className="text-muted-foreground">{done} / {totais.total} ({pct}%)</span>
                </div>
                <Progress value={pct} />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────── PROJETOS ──
function ProjetosTab() {
  const { data } = useQuery({
    queryKey: ["producao-projetos"],
    queryFn: async () => {
      const [proj, pecas, status] = await Promise.all([
        supabase.from("projetos").select("*").order("nome"),
        supabase.from("projeto_pecas").select("id,projeto_id,quantidade"),
        supabase.from("producao_status_pecas").select("projeto_id,status_corte,status_expedicao"),
      ]);
      return { projetos: proj.data ?? [], pecas: pecas.data ?? [], status: status.data ?? [] };
    },
  });

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Projeto</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead className="text-right">Peças</TableHead>
              <TableHead>Corte</TableHead>
              <TableHead>Expedição</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.projetos ?? []).map((p: any) => {
              const ps = (data?.pecas ?? []).filter((x: any) => x.projeto_id === p.id);
              const total = ps.reduce((s: number, x: any) => s + (x.quantidade || 0), 0);
              const st = (data?.status ?? []).filter((x: any) => x.projeto_id === p.id);
              const cortadas = st.filter((s: any) => s.status_corte === "cortada").length;
              const expedidas = st.filter((s: any) => s.status_expedicao === "expedido").length;
              const pctC = total ? Math.round((cortadas / total) * 100) : 0;
              const pctE = total ? Math.round((expedidas / total) * 100) : 0;
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.nome}</TableCell>
                  <TableCell>{p.cliente ?? "—"}</TableCell>
                  <TableCell className="text-right">{total}</TableCell>
                  <TableCell className="w-48"><Progress value={pctC} /><span className="text-xs text-muted-foreground">{pctC}%</span></TableCell>
                  <TableCell className="w-48"><Progress value={pctE} /><span className="text-xs text-muted-foreground">{pctE}%</span></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────── CHAPAS ──
function ChapasTab() {
  const { data } = useQuery({
    queryKey: ["producao-chapas"],
    queryFn: async () => {
      const [chapas, pecas, status] = await Promise.all([
        supabase.from("chapas").select("*").order("nome"),
        supabase.from("projeto_pecas").select("id,chapa_id,quantidade"),
        supabase.from("producao_status_pecas").select("projeto_peca_id,status_corte"),
      ]);
      return { chapas: chapas.data ?? [], pecas: pecas.data ?? [], status: status.data ?? [] };
    },
  });

  const stByPeca = useMemo(() => {
    const m = new Map<string, string>();
    (data?.status ?? []).forEach((s: any) => m.set(s.projeto_peca_id, s.status_corte));
    return m;
  }, [data]);

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Chapa</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Peças vinculadas</TableHead>
              <TableHead>Corte</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.chapas ?? []).map((c: any) => {
              const ps = (data?.pecas ?? []).filter((x: any) => x.chapa_id === c.id);
              const total = ps.length;
              const cortadas = ps.filter((x: any) => stByPeca.get(x.id) === "cortada").length;
              const pct = total ? Math.round((cortadas / total) * 100) : 0;
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.nome}</TableCell>
                  <TableCell>{c.tipo} {c.espessura}mm</TableCell>
                  <TableCell className="text-right">{total}</TableCell>
                  <TableCell className="w-48"><Progress value={pct} /><span className="text-xs text-muted-foreground">{cortadas}/{total} ({pct}%)</span></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────── PEÇAS ──
function PecasTab() {
  const [filtroProj, setFiltroProj] = useState<string>("todos");
  const { data: projetos } = useQuery({
    queryKey: ["projetos-lista"],
    queryFn: async () => (await supabase.from("projetos").select("id,nome").order("nome")).data ?? [],
  });
  const { data } = useQuery({
    queryKey: ["producao-pecas", filtroProj],
    queryFn: async () => {
      let q = supabase.from("projeto_pecas").select("*").order("ordem");
      if (filtroProj !== "todos") q = q.eq("projeto_id", filtroProj);
      const pecas = (await q).data ?? [];
      const ids = pecas.map((p: any) => p.id);
      const status = ids.length
        ? (await supabase.from("producao_status_pecas").select("*").in("projeto_peca_id", ids)).data ?? []
        : [];
      return { pecas, status };
    },
  });
  const stMap = useMemo(() => {
    const m = new Map<string, any>();
    (data?.status ?? []).forEach((s: any) => m.set(s.projeto_peca_id, s));
    return m;
  }, [data]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label>Projeto:</Label>
        <Select value={filtroProj} onValueChange={setFiltroProj}>
          <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {projetos?.map((p: any) => (
              <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Módulo</TableHead>
                <TableHead>Qtd</TableHead>
                {ETAPAS.map((e) => <TableHead key={e.key}>{e.label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.pecas ?? []).map((p: any) => {
                const s = stMap.get(p.id);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.descricao}</TableCell>
                    <TableCell>{p.modulo ?? "—"}</TableCell>
                    <TableCell>{p.quantidade}</TableCell>
                    {ETAPAS.map((e) => {
                      const v = s?.[`status_${e.key}`] ?? "pendente";
                      return (
                        <TableCell key={e.key}>
                          <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_COLORS[v] ?? "bg-muted text-muted-foreground"}`}>
                            {v}
                          </span>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────────────────────────────────── OCORRÊNCIAS ──
function OcorrenciasTab() {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState(TIPOS_OCORRENCIA[0]);
  const [descricao, setDescricao] = useState("");
  const [projetoId, setProjetoId] = useState<string>("");
  const { data: projetos } = useQuery({
    queryKey: ["projetos-lista"],
    queryFn: async () => (await supabase.from("projetos").select("id,nome").order("nome")).data ?? [],
  });
  const { data, refetch } = useQuery({
    queryKey: ["ocorrencias"],
    queryFn: async () =>
      (await supabase.from("ocorrencias_producao").select("*").order("criado_em", { ascending: false })).data ?? [],
  });
  const criar = useMutation({
    mutationFn: async () => {
      await supabase.from("ocorrencias_producao").insert({
        projeto_id: projetoId || null,
        tipo, descricao, operador: localStorage.getItem("op_nome") || null,
      } as any);
    },
    onSuccess: () => { toast.success("Ocorrência registrada"); setDescricao(""); refetch(); },
  });
  const resolver = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("ocorrencias_producao")
        .update({ status: "resolvida", resolvido_em: new Date().toISOString() } as any).eq("id", id);
    },
    onSuccess: () => { refetch(); qc.invalidateQueries({ queryKey: ["producao-resumo"] }); },
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Nova ocorrência</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Projeto</Label>
            <Select value={projetoId} onValueChange={setProjetoId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {projetos?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS_OCORRENCIA.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={4} />
          </div>
          <Button onClick={() => criar.mutate()} disabled={!descricao}>Registrar</Button>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Histórico</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell className="text-xs">{new Date(o.criado_em).toLocaleString("pt-BR")}</TableCell>
                  <TableCell><Badge variant="outline">{o.tipo}</Badge></TableCell>
                  <TableCell className="max-w-xs truncate">{o.descricao}</TableCell>
                  <TableCell>
                    <Badge variant={o.status === "aberta" ? "destructive" : "secondary"}>{o.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {o.status === "aberta" && (
                      <Button size="sm" variant="outline" onClick={() => resolver.mutate(o.id)}>Resolver</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
