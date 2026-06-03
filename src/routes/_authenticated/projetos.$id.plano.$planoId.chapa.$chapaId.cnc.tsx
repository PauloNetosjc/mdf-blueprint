import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Download, Play, ShieldCheck, GitCompare, AlertTriangle, Save, Settings } from "lucide-react";
import { toast } from "sonner";
import {
  generateSheetGCode, validateSheetGCode,
  type SheetPiece, type SheetOperation, type SheetParams, type SheetGenResult,
} from "@/lib/chapa-gcode";

export const Route = createFileRoute("/_authenticated/projetos/$id/plano/$planoId/chapa/$chapaId/cnc")({
  head: () => ({ meta: [{ title: "G-code da Chapa — Visualizador CNC" }] }),
  component: ChapaCNCPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Chapa não encontrada.</div>,
});

function ChapaCNCPage() {
  const { id, planoId, chapaId } = Route.useParams();
  const navigate = useNavigate();

  const { data: projeto } = useQuery({
    queryKey: ["projeto", id],
    queryFn: async () => (await supabase.from("projetos").select("*").eq("id", id).single()).data,
  });

  const { data: planoChapa } = useQuery({
    queryKey: ["plano-chapa", chapaId],
    queryFn: async () => {
      const { data } = await supabase.from("plano_corte_chapas").select("*").eq("id", chapaId).single();
      return data;
    },
  });

  const { data: chapa } = useQuery({
    queryKey: ["chapa", planoChapa?.chapa_id],
    enabled: !!planoChapa?.chapa_id,
    queryFn: async () => (await supabase.from("chapas").select("*").eq("id", planoChapa!.chapa_id).single()).data,
  });

  const { data: pecasPlano } = useQuery({
    queryKey: ["plano-chapa-pecas", chapaId],
    queryFn: async () => {
      const { data } = await supabase.from("plano_corte_pecas").select("*").eq("plano_chapa_id", chapaId);
      return data ?? [];
    },
  });

  const projetoPecaIds = useMemo(() => (pecasPlano ?? []).map((p) => p.projeto_peca_id), [pecasPlano]);

  const { data: projetoPecas } = useQuery({
    queryKey: ["projeto-pecas-by-ids", projetoPecaIds.join(",")],
    enabled: projetoPecaIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("projeto_pecas").select("*").in("id", projetoPecaIds);
      return data ?? [];
    },
  });

  const pecaIds = useMemo(
    () => (projetoPecas ?? []).map((p) => p.peca_id).filter(Boolean) as string[],
    [projetoPecas],
  );

  const { data: operacoesDB } = useQuery({
    queryKey: ["operacoes-by-pecas", pecaIds.join(",")],
    enabled: pecaIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("operacoes").select("*").in("peca_id", pecaIds);
      return data ?? [];
    },
  });

  const { data: maquinas } = useQuery({
    queryKey: ["maquinas"],
    queryFn: async () => (await supabase.from("maquinas").select("*").eq("ativa", true)).data ?? [],
  });

  const { data: ferramentas } = useQuery({
    queryKey: ["ferramentas"],
    queryFn: async () => (await supabase.from("ferramentas").select("*").eq("ativa", true)).data ?? [],
  });

  const { data: ncOriginal } = useQuery({
    queryKey: ["nc-original-chapa", planoChapa?.chapa_id],
    enabled: !!planoChapa?.chapa_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("arquivos_tecnicos").select("*")
        .eq("chapa_id", planoChapa!.chapa_id).eq("tipo_arquivo", "nc").limit(1).maybeSingle();
      return data;
    },
  });

  const maquina = maquinas?.[0];

  // Parâmetros
  const [params, setParams] = useState<SheetParams>({
    espessura: 15, passthrough: 0.5, z_seguro: 20,
    feed_corte: 4500, feed_furacao: 1500, rotacao: 18000,
    ferramenta_corte_id: null, ferramenta_furacao_id: null,
    ordem: "furos_depois_contorno",
    incluir_contorno: true, incluir_furos: true, incluir_rasgos: true, incluir_sobras: false,
    refilo: 10,
  });

  useEffect(() => {
    if (!ferramentas) return;
    setParams((p) => ({
      ...p,
      ferramenta_corte_id: p.ferramenta_corte_id ?? ferramentas.find((f) => f.tipo === "corte" || /corte|fresa/i.test(f.nome))?.id ?? ferramentas[0]?.id ?? null,
      ferramenta_furacao_id: p.ferramenta_furacao_id ?? ferramentas.find((f) => f.tipo === "furo_face")?.id ?? ferramentas[0]?.id ?? null,
    }));
  }, [ferramentas]);

  useEffect(() => {
    if (chapa?.espessura) setParams((p) => ({ ...p, espessura: chapa.espessura, z_seguro: Math.max(p.z_seguro, 10) }));
  }, [chapa]);

  const [resultado, setResultado] = useState<SheetGenResult | null>(null);
  const [responsavel, setResponsavel] = useState("");
  const [confirmou, setConfirmou] = useState(false);

  const pecasSheet: SheetPiece[] = useMemo(() => {
    if (!pecasPlano || !projetoPecas) return [];
    return pecasPlano.map((pp) => {
      const desc = projetoPecas.find((x) => x.id === pp.projeto_peca_id);
      return {
        id: pp.id, projeto_peca_id: pp.projeto_peca_id,
        descricao: desc?.descricao ?? "Peça",
        x: Number(pp.x), y: Number(pp.y),
        largura: Number(pp.largura), altura: Number(pp.altura),
        rotacionada: !!pp.rotacionada,
        espessura: Number(desc?.espessura ?? params.espessura),
      };
    });
  }, [pecasPlano, projetoPecas, params.espessura]);

  const operacoesSheet: SheetOperation[] = useMemo(() => {
    if (!operacoesDB || !projetoPecas) return [];
    const out: SheetOperation[] = [];
    for (const op of operacoesDB) {
      const pp = projetoPecas.find((x) => x.peca_id === op.peca_id);
      if (!pp) continue;
      out.push({
        id: op.id, projeto_peca_id: pp.id, tipo: op.tipo,
        face: op.numero_face,
        x: Number(op.x), y: Number(op.y), z: op.z !== null ? Number(op.z) : null,
        diametro: op.diametro !== null ? Number(op.diametro) : null,
        profundidade: op.profundidade !== null ? Number(op.profundidade) : null,
        largura: op.largura !== null ? Number(op.largura) : null,
        comprimento: op.comprimento !== null ? Number(op.comprimento) : null,
      });
    }
    return out;
  }, [operacoesDB, projetoPecas]);

  const gerar = () => {
    if (!maquina || !chapa || !planoChapa) {
      toast.error("Dados incompletos");
      return;
    }
    const res = generateSheetGCode(
      { nome: projeto?.nome ?? "Projeto", cliente: projeto?.cliente, ambiente: projeto?.ambiente },
      {
        nome: chapa.nome, codigo: chapa.codigo,
        largura: Number(chapa.largura), altura: Number(chapa.altura), espessura: Number(chapa.espessura),
        numero: planoChapa.indice ?? 1,
      },
      pecasSheet, operacoesSheet,
      {
        id: maquina.id, nome: maquina.nome, area_x: Number(maquina.area_x),
        area_y: Number(maquina.area_y), area_z: Number(maquina.area_z),
        altura_segura_z: Number(maquina.altura_segura_z),
        template_inicio: maquina.template_inicio,
        template_fim: maquina.template_fim,
        template_troca_ferramenta: maquina.template_troca_ferramenta,
      },
      (ferramentas ?? []).map((f) => ({
        id: f.id, codigo: f.codigo, nome: f.nome, tipo: f.tipo,
        diametro: Number(f.diametro), rotacao_padrao: f.rotacao_padrao, avanco_padrao: f.avanco_padrao,
      })),
      params, Number(planoChapa.aproveitamento ?? 0),
    );
    setResultado(res);
    const v = validateSheetGCode(res);
    if (v.erros > 0) toast.error(`Geração com ${v.erros} erro(s) crítico(s)`);
    else toast.success(`G-code gerado (${v.avisos} aviso(s))`);
  };

  const salvar = useMutation({
    mutationFn: async (status: "rascunho" | "validado" | "exportado") => {
      if (!resultado) throw new Error("Gere o G-code antes");
      const { error } = await supabase.from("previews_cnc_chapas").insert({
        projeto_id: id, plano_id: planoId, plano_chapa_id: chapaId,
        chapa_id: planoChapa?.chapa_id, maquina_id: maquina?.id,
        nome_arquivo: resultado.nome_arquivo, conteudo: resultado.codigo,
        parametros_json: params as never,
        validacoes_json: resultado.validacoes as never,
        status,
        validado_por: status !== "rascunho" ? responsavel : null,
        validado_em: status !== "rascunho" ? new Date().toISOString() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Versão salva"),
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: versoes, refetch: refetchVersoes } = useQuery({
    queryKey: ["previews-cnc-chapa", chapaId],
    queryFn: async () => {
      const { data } = await supabase.from("previews_cnc_chapas")
        .select("*").eq("plano_chapa_id", chapaId).order("criado_em", { ascending: false });
      return data ?? [];
    },
  });

  useEffect(() => { if (!salvar.isPending) refetchVersoes(); }, [salvar.isPending, refetchVersoes]);

  const baixar = () => {
    if (!resultado) return;
    const v = validateSheetGCode(resultado);
    if (v.erros > 0) { toast.error("Existem erros críticos"); return; }
    if (!confirmou || !responsavel.trim()) { toast.error("Confirme a validação técnica e informe o responsável"); return; }
    const blob = new Blob([resultado.codigo], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = resultado.nome_arquivo; a.click();
    URL.revokeObjectURL(url);
    salvar.mutate("exportado");
  };

  const validacaoStatus = resultado ? validateSheetGCode(resultado) : null;

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-panel px-4 py-2">
        <div className="flex items-center gap-3">
          <Link to="/projetos/$id/plano" params={{ id }}>
            <Button size="sm" variant="ghost"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-sm font-semibold">G-code da Chapa · {projeto?.nome ?? ""}</h1>
            <p className="text-[11px] text-muted-foreground">
              Chapa #{planoChapa?.indice} · {chapa?.nome} · {chapa?.largura}×{chapa?.altura}×{params.espessura}mm
              {maquina && <> · {maquina.nome}</>}
              {validacaoStatus && (
                <Badge variant={validacaoStatus.ok ? "secondary" : "destructive"} className="ml-2">
                  {validacaoStatus.ok ? "OK" : `${validacaoStatus.erros} erro(s)`}
                </Badge>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={gerar}><Play className="mr-1 h-4 w-4" />Gerar prévia</Button>
          <Button size="sm" variant="outline" onClick={() => salvar.mutate("rascunho")} disabled={!resultado}>
            <Save className="mr-1 h-4 w-4" />Salvar rascunho
          </Button>
          {ncOriginal && (
            <Link to="/comparador">
              <Button size="sm" variant="outline"><GitCompare className="mr-1 h-4 w-4" />Comparar com NC</Button>
            </Link>
          )}
          <Link to="/maquina"><Button size="sm" variant="outline"><Settings className="mr-1 h-4 w-4" />Pós-processador</Button></Link>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[300px_1fr_360px] overflow-hidden">
        {/* Painel esquerdo - operações + parâmetros */}
        <aside className="space-y-4 overflow-auto border-r border-border bg-panel p-3 text-xs">
          <Card className="p-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Operações</h3>
            {([
              ["incluir_contorno", "Contorno externo"],
              ["incluir_furos", "Furos"],
              ["incluir_rasgos", "Rasgos/Rebaixos"],
              ["incluir_sobras", "Corte de sobras"],
            ] as const).map(([k, label]) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 py-1">
                <Checkbox checked={params[k]} onCheckedChange={(v) => setParams((p) => ({ ...p, [k]: !!v }))} />
                {label}
              </label>
            ))}
          </Card>

          <Card className="space-y-2 p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Parâmetros</h3>
            <Field label="Espessura (mm)" v={params.espessura} on={(v) => setParams({ ...params, espessura: v })} />
            <Field label="Passthrough (mm)" v={params.passthrough} on={(v) => setParams({ ...params, passthrough: v })} />
            <Field label="Z seguro (mm)" v={params.z_seguro} on={(v) => setParams({ ...params, z_seguro: v })} />
            <Field label="Feed corte" v={params.feed_corte} on={(v) => setParams({ ...params, feed_corte: v })} />
            <Field label="Feed furação" v={params.feed_furacao} on={(v) => setParams({ ...params, feed_furacao: v })} />
            <Field label="Rotação (RPM)" v={params.rotacao} on={(v) => setParams({ ...params, rotacao: v })} />

            <div>
              <Label className="text-[11px]">Ferramenta de corte</Label>
              <select
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs"
                value={params.ferramenta_corte_id ?? ""}
                onChange={(e) => setParams({ ...params, ferramenta_corte_id: e.target.value || null })}
              >
                <option value="">—</option>
                {(ferramentas ?? []).map((f) => <option key={f.id} value={f.id}>{f.codigo} · {f.nome}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[11px]">Ferramenta de furação</Label>
              <select
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs"
                value={params.ferramenta_furacao_id ?? ""}
                onChange={(e) => setParams({ ...params, ferramenta_furacao_id: e.target.value || null })}
              >
                <option value="">—</option>
                {(ferramentas ?? []).map((f) => <option key={f.id} value={f.id}>{f.codigo} · {f.nome}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[11px]">Ordem</Label>
              <select
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs"
                value={params.ordem}
                onChange={(e) => setParams({ ...params, ordem: e.target.value as SheetParams["ordem"] })}
              >
                <option value="furos_depois_contorno">Furos → Contorno</option>
                <option value="usinagens_depois_corte">Usinagens → Corte</option>
                <option value="personalizada">Personalizada</option>
              </select>
            </div>
          </Card>

          {versoes && versoes.length > 0 && (
            <Card className="p-3">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Versões</h3>
              <div className="space-y-1">
                {versoes.map((v) => (
                  <div key={v.id} className="flex items-center justify-between border-b border-border/40 py-1 text-[11px]">
                    <span>{v.nome_arquivo}</span>
                    <Badge variant="outline">{v.status}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </aside>

        {/* Centro - preview visual + g-code */}
        <main className="overflow-auto p-4">
          <Card className="mb-4 p-3">
            <h3 className="mb-2 text-xs font-semibold">Percurso (prévia)</h3>
            {chapa && <SheetPreview
              chapaW={Number(chapa.largura)} chapaH={Number(chapa.altura)}
              pecas={pecasSheet} paths={resultado?.paths ?? []}
            />}
            <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
              <Legend color="#3b82f6" label="Corte externo" />
              <Legend color="#ef4444" label="Furação" />
              <Legend color="#10b981" label="Rasgo" />
              <Legend color="#94a3b8" label="Peça" />
            </div>
          </Card>

          {resultado && (
            <Card className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold">G-code · {resultado.nome_arquivo}</h3>
                <span className="text-[11px] text-muted-foreground">{resultado.codigo.split("\n").length} linhas</span>
              </div>
              <pre className="max-h-96 overflow-auto rounded bg-surface p-2 font-mono text-[11px] leading-tight">
                {resultado.codigo}
              </pre>
            </Card>
          )}
        </main>

        {/* Painel direito - validações + exportação */}
        <aside className="space-y-3 overflow-auto border-l border-border bg-panel p-3 text-xs">
          <Card className="p-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Validações</h3>
            {!resultado && <p className="text-muted-foreground">Gere a prévia para ver validações.</p>}
            {resultado && resultado.validacoes.length === 0 && (
              <p className="text-green-600">Nenhum problema detectado.</p>
            )}
            {resultado?.validacoes.map((v, i) => (
              <div key={i} className={`flex items-start gap-2 border-l-2 py-1 pl-2 ${v.nivel === "erro" ? "border-destructive text-destructive" : "border-yellow-500 text-yellow-700"}`}>
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{v.mensagem}</span>
              </div>
            ))}
          </Card>

          <Card className="space-y-2 p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Confirmação técnica</h3>
            <p className="text-[10px] leading-tight text-muted-foreground">
              O G-code gerado é uma prévia técnica. Antes de usar em máquina real, o operador responsável
              deve validar o código, o pós-processador, a origem, as ferramentas, os avanços, a rotação
              e os limites da máquina conforme o manual técnico.
            </p>
            <div>
              <Label className="text-[11px]">Responsável</Label>
              <Input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className="h-8 text-xs" />
            </div>
            <label className="flex cursor-pointer items-start gap-2 py-1">
              <Checkbox checked={confirmou} onCheckedChange={(v) => setConfirmou(!!v)} />
              <span className="text-[11px]">Confirmo a validação técnica do G-code.</span>
            </label>
            <Button
              size="sm" className="w-full" onClick={baixar}
              disabled={!resultado || !confirmou || !responsavel.trim() || (validacaoStatus?.erros ?? 0) > 0}
            >
              <ShieldCheck className="mr-1 h-4 w-4" />Confirmar validação técnica
            </Button>
            <Button
              size="sm" variant="outline" className="w-full" onClick={baixar}
              disabled={!resultado || (validacaoStatus?.erros ?? 0) > 0}
            >
              <Download className="mr-1 h-4 w-4" />Baixar .nc
            </Button>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, v, on }: { label: string; v: number; on: (n: number) => void }) {
  return (
    <div>
      <Label className="text-[11px]">{label}</Label>
      <Input type="number" value={v} onChange={(e) => on(parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-2 w-4" style={{ background: color }} /> {label}
    </span>
  );
}

function SheetPreview({
  chapaW, chapaH, pecas, paths,
}: { chapaW: number; chapaH: number; pecas: SheetPiece[]; paths: SheetGenResult["paths"] }) {
  const padding = 10;
  const maxW = 700, maxH = 350;
  const scale = Math.min((maxW - padding * 2) / chapaW, (maxH - padding * 2) / chapaH);
  const w = chapaW * scale + padding * 2;
  const h = chapaH * scale + padding * 2;
  const T = (x: number, y: number) => `${padding + x * scale},${padding + (chapaH - y) * scale}`;
  const colorFor = (t: string) =>
    t === "corte" ? "#3b82f6" : t === "furo" ? "#ef4444" : t === "rasgo" ? "#10b981" : "#94a3b8";
  return (
    <svg width={w} height={h} className="rounded border border-border bg-white">
      <rect x={padding} y={padding} width={chapaW * scale} height={chapaH * scale} fill="#f8fafc" stroke="#cbd5e1" />
      {pecas.map((p) => (
        <rect
          key={p.id}
          x={padding + p.x * scale} y={padding + (chapaH - p.y - p.altura) * scale}
          width={p.largura * scale} height={p.altura * scale}
          fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.5}
        />
      ))}
      {paths.map((pt, i) => {
        if (pt.tipo === "furo") {
          const [c] = pt.pontos;
          const [cx, cy] = T(c.x, c.y).split(",").map(Number);
          return <circle key={i} cx={cx} cy={cy} r={3} fill={colorFor(pt.tipo)} />;
        }
        return (
          <polyline
            key={i}
            points={pt.pontos.map((p) => T(p.x, p.y)).join(" ")}
            fill="none" stroke={colorFor(pt.tipo)} strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}
