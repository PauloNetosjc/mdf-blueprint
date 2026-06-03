import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Cpu, Maximize2, MousePointer2, Move, RotateCw, Trash2, Plus, Save,
  AlertTriangle, RefreshCw, Tag, Image as ImageIcon, Download, FileArchive,
} from "lucide-react";
import { toast } from "sonner";
import {
  calcularPlanoCorte,
  detectarColisao,
  type Chapa as ChapaT,
  type ChapaPlano,
  type PecaInput,
  type PecaPosicionada,
  type ResultadoPlano,
} from "@/lib/nesting";

export const Route = createFileRoute("/_authenticated/projetos/$id/plano")({
  head: () => ({ meta: [{ title: "Plano de Corte — Visualizador CNC" }] }),
  component: PlanoPage,
});

function PlanoPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [chapaIndex, setChapaIndex] = useState(0);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [modoMover, setModoMover] = useState(false);
  const [autoRecalc, setAutoRecalc] = useState(false);
  const [refilo, setRefilo] = useState(10);
  const [clipboard, setClipboard] = useState<PecaPosicionada[]>([]);
  const [resultado, setResultado] = useState<ResultadoPlano | null>(null);
  const [colisao, setColisao] = useState(false);

  const { data: projeto } = useQuery({
    queryKey: ["projeto", id],
    queryFn: async () => {
      const { data } = await supabase.from("projetos").select("*").eq("id", id).single();
      return data;
    },
  });

  const { data: pecas } = useQuery({
    queryKey: ["projeto-pecas", id],
    queryFn: async () => {
      const { data } = await supabase.from("projeto_pecas").select("*").eq("projeto_id", id).order("ordem");
      return (data ?? []) as Array<{
        id: string; descricao: string; quantidade: number; altura: number;
        largura: number; espessura: number; chapa_id: string | null;
        fita_codigo: string | null; modulo: string | null; peca_id: string | null;
      }>;
    },
  });

  const { data: chapas } = useQuery({
    queryKey: ["chapas"],
    queryFn: async () => {
      const { data } = await supabase.from("chapas").select("*");
      return (data ?? []) as ChapaT[];
    },
  });

  // Recursos importados (Promob/Nesting)
  const { data: previewsImp } = useQuery({
    queryKey: ["plano-previews", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("importacao_preview_chapas")
        .select("*").eq("projeto_id", id);
      return (data ?? []) as Array<{
        id: string; numero_chapa: number | null; chapa_id: string | null;
        tipo_preview: string; storage_url: string | null; arquivo_nome: string;
        pagina_pdf: number | null;
      }>;
    },
  });
  const { data: ncsImp } = useQuery({
    queryKey: ["plano-ncs", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("arquivos_tecnicos")
        .select("id, nome_arquivo, storage_url, chapa_id, tipo_arquivo")
        .eq("projeto_id", id).eq("tipo_arquivo", "nc_gcode");
      return (data ?? []) as Array<{ id: string; nome_arquivo: string; storage_url: string; chapa_id: string | null; tipo_arquivo: string }>;
    },
  });
  const projetoImportado = (previewsImp?.length ?? 0) > 0 || (ncsImp?.length ?? 0) > 0;

  // Plano salvo + chapas salvas para botão "G-code da Chapa"
  const { data: planoSalvo } = useQuery({
    queryKey: ["plano-salvo", id],
    queryFn: async () => {
      const { data } = await supabase.from("planos_corte").select("id, status, observacao").eq("projeto_id", id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });
  const { data: chapasSalvas } = useQuery({
    queryKey: ["plano-chapas-salvas", planoSalvo?.id],
    enabled: !!planoSalvo?.id,
    queryFn: async () => {
      const { data } = await supabase.from("plano_corte_chapas").select("id, indice, chapa_id").eq("plano_id", planoSalvo!.id);
      return data ?? [];
    },
  });

  const calcular = useCallback(() => {
    if (!pecas || !chapas) return;
    const input: PecaInput[] = pecas
      .filter((p) => p.chapa_id)
      .map((p) => ({
        id: p.id, descricao: p.descricao, largura: p.largura, altura: p.altura,
        espessura: p.espessura, chapa_id: p.chapa_id!, quantidade: p.quantidade,
      }));
    const r = calcularPlanoCorte(input, chapas, refilo);
    setResultado(r);
    setChapaIndex(0);
    setSelecionada(null);
    setColisao(false);
  }, [pecas, chapas, refilo]);

  useEffect(() => {
    if (pecas && chapas && !resultado) calcular();
  }, [pecas, chapas, resultado, calcular]);

  useEffect(() => {
    if (autoRecalc) calcular();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refilo, autoRecalc]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!resultado) throw new Error("Calcule o plano antes de salvar");
      if (colisao) throw new Error("Existem colisões — corrija antes de salvar");
      await supabase.from("planos_corte").delete().eq("projeto_id", id);
      const { data: plano, error } = await supabase.from("planos_corte").insert({
        projeto_id: id, versao: 1,
        aproveitamento_medio: resultado.aproveitamento_medio,
        total_chapas: resultado.total_chapas, total_pecas: resultado.total_pecas,
      }).select().single();
      if (error) throw error;
      for (const c of resultado.chapas) {
        const { data: pc, error: e1 } = await supabase.from("plano_corte_chapas").insert({
          plano_id: plano.id, chapa_id: c.chapa.id, indice: c.indice,
          aproveitamento: c.aproveitamento, area_usada: c.area_usada,
        }).select().single();
        if (e1) throw e1;
        if (c.pecas.length > 0) {
          await supabase.from("plano_corte_pecas").insert(c.pecas.map((p) => ({
            plano_chapa_id: pc.id, projeto_peca_id: p.projeto_peca_id,
            x: p.x, y: p.y, largura: p.largura, altura: p.altura, rotacionada: p.rotacionada,
          })));
        }
        if (c.sobras.length > 0) {
          await supabase.from("sobras_chapa").insert(c.sobras.map((s) => ({
            plano_chapa_id: pc.id, ...s,
          })));
        }
      }
      await supabase.from("projetos").update({ status: "plano_gerado" }).eq("id", id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projetos"] }); toast.success("Plano salvo"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const chapaAtual = resultado?.chapas[chapaIndex];
  const pecaSelecionada = chapaAtual?.pecas.find((p) => p.id === selecionada) ?? null;
  const projPeca = pecas?.find((p) => p.id === pecaSelecionada?.projeto_peca_id);

  const updatePecaPos = useCallback((updated: PecaPosicionada) => {
    setResultado((prev) => {
      if (!prev) return prev;
      const ca = prev.chapas[chapaIndex];
      if (!ca) return prev;
      const novasPecas = ca.pecas.map((p) => p.id === updated.id ? updated : p);
      const col = detectarColisao(novasPecas, ca.chapa);
      setColisao(col);
      const chapasN = prev.chapas.slice();
      chapasN[chapaIndex] = { ...ca, pecas: novasPecas };
      return { ...prev, chapas: chapasN };
    });
  }, [chapaIndex]);

  const rotacionarSelecionada = useCallback(() => {
    if (!pecaSelecionada) return;
    updatePecaPos({
      ...pecaSelecionada,
      largura: pecaSelecionada.altura,
      altura: pecaSelecionada.largura,
      rotacionada: !pecaSelecionada.rotacionada,
    });
  }, [pecaSelecionada, updatePecaPos]);

  const moverSelecionada = useCallback((dx: number, dy: number) => {
    if (!pecaSelecionada || !chapaAtual) return;
    updatePecaPos({
      ...pecaSelecionada,
      x: Math.max(0, Math.min(chapaAtual.chapa.largura - pecaSelecionada.largura, pecaSelecionada.x + dx)),
      y: Math.max(0, Math.min(chapaAtual.chapa.altura - pecaSelecionada.altura, pecaSelecionada.y + dy)),
    });
  }, [pecaSelecionada, chapaAtual, updatePecaPos]);

  const removerSelecionada = useCallback(() => {
    if (!pecaSelecionada) return;
    setClipboard((cb) => [...cb, pecaSelecionada]);
    setResultado((prev) => {
      if (!prev) return prev;
      const ca = prev.chapas[chapaIndex];
      if (!ca) return prev;
      const chapasN = prev.chapas.slice();
      chapasN[chapaIndex] = { ...ca, pecas: ca.pecas.filter((p) => p.id !== pecaSelecionada.id) };
      return { ...prev, chapas: chapasN };
    });
    setSelecionada(null);
  }, [pecaSelecionada, chapaIndex]);

  // Atalhos de teclado
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!pecaSelecionada) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "r" || e.key === "R") { e.preventDefault(); rotacionarSelecionada(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removerSelecionada(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); moverSelecionada(-step, 0); }
      else if (e.key === "ArrowRight") { e.preventDefault(); moverSelecionada(step, 0); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moverSelecionada(0, -step); }
      else if (e.key === "ArrowDown") { e.preventDefault(); moverSelecionada(0, step); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pecaSelecionada, rotacionarSelecionada, removerSelecionada, moverSelecionada]);

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-panel px-4 py-2">
        <div className="flex items-center gap-3">
          <Link to="/projetos/$id" params={{ id }}><Button size="sm" variant="ghost"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Plano de Corte · {projeto?.nome ?? ""}</h1>
            <p className="text-[11px] text-muted-foreground">
              {resultado ? `${resultado.total_chapas} chapas · ${resultado.total_pecas} peças · ${Math.round(resultado.aproveitamento_medio * 100)}% aprov.` : "Calculando…"}
              {colisao && <span className="ml-2 text-destructive">⚠ Colisão detectada</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Label className="text-[11px] text-muted-foreground">Refilo</Label>
            <Input
              type="number" min={0} max={50} value={refilo}
              onChange={(e) => setRefilo(parseInt(e.target.value) || 0)}
              className="h-8 w-16 text-right font-mono text-xs"
            />
            <span className="text-[11px] text-muted-foreground">mm</span>
          </div>
          <label className="flex cursor-pointer items-center gap-1 text-[11px]">
            <input type="checkbox" checked={autoRecalc} onChange={(e) => setAutoRecalc(e.target.checked)} />
            Auto-recalcular
          </label>
          <Button size="sm" variant={modoMover ? "default" : "outline"} onClick={() => setModoMover(!modoMover)}>
            {modoMover ? <Move className="mr-1 h-4 w-4" /> : <MousePointer2 className="mr-1 h-4 w-4" />}
            {modoMover ? "Mover Peças" : "Selecionar"}
          </Button>
          <Button size="sm" variant="outline" onClick={calcular}>
            <RefreshCw className="mr-1 h-4 w-4" />Recalcular
          </Button>
          <Link to="/etiquetas" search={{ projeto: id }}>
            <Button size="sm" variant="outline">
              <Tag className="mr-1 h-4 w-4" />Etiquetas
            </Button>
          </Link>
          {projetoImportado && (() => {
            const chapaAtualId = resultado?.chapas[chapaIndex]?.chapa.id;
            const numAtual = (chapaIndex ?? 0) + 1;
            const prev = previewsImp?.find((p) =>
              (chapaAtualId && p.chapa_id === chapaAtualId) || p.numero_chapa === numAtual,
            );
            const nc = ncsImp?.find((n) => chapaAtualId && n.chapa_id === chapaAtualId);
            const open = async (path: string) => {
              const { data, error } = await supabase.storage.from("importacoes").createSignedUrl(path, 300);
              if (error || !data) { toast.error("Falha"); return; }
              window.open(data.signedUrl, "_blank");
            };
            return (
              <>
                <Badge variant="secondary" className="gap-1"><FileArchive className="h-3 w-3" />Importado</Badge>
                {prev?.storage_url && (
                  <Button size="sm" variant="outline" onClick={() => open(prev.storage_url!)}>
                    <ImageIcon className="mr-1 h-4 w-4" />Preview original
                  </Button>
                )}
                {nc?.storage_url && (
                  <Button size="sm" variant="outline" onClick={() => open(nc.storage_url)}>
                    <Download className="mr-1 h-4 w-4" />NC chapa
                  </Button>
                )}
              </>
            );
          })()}
          {planoSalvo && chapasSalvas && chapaAtual && (() => {
            const chapaSalva = chapasSalvas.find(
              (c) => c.chapa_id === chapaAtual.chapa.id && c.indice === chapaAtual.indice,
            ) ?? chapasSalvas[chapaIndex];
            if (!chapaSalva) return null;
            return (
              <Link
                to="/projetos/$id/plano/$planoId/chapa/$chapaId/cnc"
                params={{ id, planoId: planoSalvo.id, chapaId: chapaSalva.id }}
              >
                <Button size="sm" variant="outline"><Cpu className="mr-1 h-4 w-4" />G-code da Chapa</Button>
              </Link>
            );
          })()}
          <Button size="sm" onClick={() => salvar.mutate()} disabled={!resultado || salvar.isPending || colisao}>
            <Save className="mr-1 h-4 w-4" />Salvar plano
          </Button>
        </div>
      </header>

      {planoSalvo?.status === "importado_referencia_visual" && (
        <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning-foreground">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {planoSalvo.observacao || "Plano importado com referência visual. As posições originais estão no PreviewCorte/LargePreview. Coordenadas estruturadas ainda não foram extraídas."}
        </div>
      )}

      <div className="grid flex-1 grid-cols-[260px_1fr_300px] overflow-hidden">
        {/* Painel esquerdo */}
        <aside className="overflow-auto border-r border-border bg-panel p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Resumo geral</h3>
          {resultado && (
            <div className="mb-4 space-y-1 rounded bg-surface p-3 text-xs">
              <Linha k="Chapas necessárias" v={String(resultado.total_chapas)} />
              <Linha k="Total de peças" v={String(resultado.total_pecas)} />
              <Linha k="Aproveitamento médio" v={`${Math.round(resultado.aproveitamento_medio * 100)}%`} />
              <Linha k="Refilo" v={`${refilo} mm`} />
            </div>
          )}

          {chapaAtual && (
            <div className="mb-4 rounded border border-border bg-surface p-3 text-xs">
              <div className="mb-1 font-semibold">Chapa atual #{chapaAtual.indice}</div>
              <Linha k="Aproveitamento" v={`${Math.round(chapaAtual.aproveitamento * 100)}%`} />
              <Linha k="Área usada" v={`${(chapaAtual.area_usada / 1_000_000).toFixed(2)} m²`} />
              <Linha k="Área sobra" v={`${((chapaAtual.chapa.largura * chapaAtual.chapa.altura - chapaAtual.area_usada) / 1_000_000).toFixed(2)} m²`} />
              <Linha k="Peças" v={String(chapaAtual.pecas.length)} />
            </div>
          )}

          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Chapas geradas</h3>
          <div className="space-y-2">
            {resultado?.chapas.map((c, i) => (
              <button
                key={i}
                onClick={() => { setChapaIndex(i); setSelecionada(null); }}
                className={`w-full overflow-hidden rounded border text-left transition-colors ${i === chapaIndex ? "border-primary bg-surface-2" : "border-border bg-surface hover:bg-surface-2"}`}
              >
                <div className="h-8 w-full" style={{ background: c.chapa.cor }} />
                <div className="p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">#{c.indice} · {c.chapa.codigo}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{Math.round(c.aproveitamento * 100)}%</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">{c.pecas.length} peças · {c.chapa.espessura}mm</div>
                </div>
              </button>
            ))}
            {resultado?.chapas.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma chapa. Verifique se as peças têm chapa atribuída.</p>
            )}
          </div>

          {/* Legenda */}
          <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Legenda</h3>
          <div className="space-y-1 rounded bg-surface p-2 text-[11px]">
            <LegendaItem cor="#ffffff" borda="#222" label="Peça" />
            <LegendaItem cor="hsl(var(--primary) / 0.2)" borda="hsl(var(--primary))" label="Peça selecionada" />
            <LegendaItem cor="repeating-linear-gradient(45deg,#888 0 2px,transparent 2px 6px)" borda="#888" label="Sobra aproveitável" />
            <LegendaItem cor="hsl(var(--destructive) / 0.2)" borda="hsl(var(--destructive))" label="Refilo / borda" />
          </div>

          {clipboard.length > 0 && (
            <>
              <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Removidas</h3>
              <div className="space-y-1 rounded bg-surface p-2 text-[11px]">
                {clipboard.map((p, i) => <div key={`${p.id}-${i}`} className="truncate text-muted-foreground">{p.descricao}</div>)}
              </div>
            </>
          )}
        </aside>

        {/* Visualizador central */}
        <div className="relative overflow-hidden bg-[hsl(var(--background))]">
          {chapaAtual ? (
            <ChapaCanvas
              chapaPlano={chapaAtual}
              selecionada={selecionada}
              onSelect={setSelecionada}
              modoMover={modoMover}
              onUpdate={updatePecaPos}
              refilo={refilo}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Calcule um plano para visualizar.
            </div>
          )}
        </div>

        {/* Painel direito */}
        <aside className="overflow-auto border-l border-border bg-panel p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Peça selecionada</h3>
          {pecaSelecionada && projPeca ? (
            <div className="space-y-3">
              <div className="rounded bg-surface p-3 text-xs">
                <div className="mb-1 truncate text-sm font-semibold">{pecaSelecionada.descricao}</div>
                <Linha k="Largura" v={`${Math.round(pecaSelecionada.largura)} mm`} />
                <Linha k="Altura" v={`${Math.round(pecaSelecionada.altura)} mm`} />
                <Linha k="Espessura" v={`${projPeca.espessura} mm`} />
                <Linha k="Fita de borda" v={projPeca.fita_codigo ?? "—"} />
                <Linha k="Módulo" v={projPeca.modulo ?? "—"} />
                <Linha k="Posição X" v={`${Math.round(pecaSelecionada.x)} mm`} />
                <Linha k="Posição Y" v={`${Math.round(pecaSelecionada.y)} mm`} />
                <Linha k="Rotação" v={pecaSelecionada.rotacionada ? "90°" : "0°"} />
              </div>

              <div className="rounded border border-border bg-surface-2 p-2 text-[10px] text-muted-foreground">
                <div className="mb-1 font-semibold">Atalhos</div>
                <div>R — girar · Delete — remover</div>
                <div>← → ↑ ↓ — mover 1 mm</div>
                <div>Shift + setas — mover 10 mm</div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={rotacionarSelecionada}><RotateCw className="mr-1 h-3.5 w-3.5" />Girar (R)</Button>
                <Button size="sm" variant="outline" onClick={removerSelecionada}><Trash2 className="mr-1 h-3.5 w-3.5" />Remover</Button>
              </div>
              <Link to="/etiquetas" search={{ projeto: id, peca: projPeca.id }} className="block">
                <Button size="sm" variant="outline" className="w-full">
                  <Tag className="mr-1 h-3.5 w-3.5" />Ver etiqueta
                </Button>
              </Link>
              <Button
                size="sm"
                className="w-full"
                onClick={async () => {
                  if (projPeca.peca_id) {
                    navigate({ to: "/pecas/$id", params: { id: projPeca.peca_id } });
                    return;
                  }
                  const codigo = `PRJ-${id.slice(0, 6)}-${projPeca.id.slice(0, 4)}`;
                  const { data: novaPeca, error } = await supabase.from("pecas").insert({
                    codigo, nome: projPeca.descricao,
                    largura: projPeca.largura, altura: projPeca.altura,
                    espessura: projPeca.espessura, material: "MDP", status: "rascunho",
                  }).select().single();
                  if (error) { toast.error(error.message); return; }
                  const faces = [0, 1, 2, 3, 4].map((n) => ({
                    peca_id: novaPeca.id, numero_face: n,
                    nome_face: ["Face Superior", "Topo Frontal", "Topo Direito", "Topo Traseiro", "Topo Esquerdo"][n],
                  }));
                  await supabase.from("faces").insert(faces);
                  await supabase.from("projeto_pecas").update({ peca_id: novaPeca.id }).eq("id", projPeca.id);
                  navigate({ to: "/pecas/$id", params: { id: novaPeca.id } });
                }}
              >
                <Cpu className="mr-1 h-3.5 w-3.5" />Abrir engenharia
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {modoMover ? "Arraste peças para mover. Clique para selecionar." : "Clique em uma peça no visualizador."}
            </p>
          )}

          {colisao && (
            <div className="mt-4 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>Há sobreposição entre peças. Corrija antes de salvar.</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Linha({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}

function LegendaItem({ cor, borda, label }: { cor: string; borda: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-3 w-5 rounded-sm border" style={{ background: cor, borderColor: borda }} />
      <span>{label}</span>
    </div>
  );
}

// ============ Canvas SVG ============

const ChapaCanvas = memo(function ChapaCanvas({
  chapaPlano, selecionada, onSelect, modoMover, onUpdate, refilo,
}: {
  chapaPlano: ChapaPlano;
  selecionada: string | null;
  onSelect: (id: string | null) => void;
  modoMover: boolean;
  onUpdate: (p: PecaPosicionada) => void;
  refilo: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef<{
    type: "pan" | "peca"; id?: string; startX: number; startY: number; origX: number; origY: number;
  } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);

  const W = chapaPlano.chapa.largura;
  const H = chapaPlano.chapa.altura;

  const ajustar = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    const pad = 80;
    const sx = (c.clientWidth - pad * 2) / W;
    const sy = (c.clientHeight - pad * 2) / H;
    const s = Math.min(sx, sy);
    setView({ scale: s, tx: (c.clientWidth - W * s) / 2, ty: (c.clientHeight - H * s) / 2 });
  }, [W, H]);

  useEffect(() => { ajustar(); }, [ajustar, chapaPlano.chapa.id]);

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.05, Math.min(5, view.scale * delta));
    const tx = mx - (mx - view.tx) * (newScale / view.scale);
    const ty = my - (my - view.ty) * (newScale / view.scale);
    setView({ scale: newScale, tx, ty });
  }

  function onMouseDown(e: React.MouseEvent) {
    const target = e.target as Element;
    if (target === e.currentTarget || (target.tagName === "rect" && target.getAttribute("data-bg") === "true") || target.tagName === "svg") {
      dragRef.current = { type: "pan", startX: e.clientX, startY: e.clientY, origX: view.tx, origY: view.ty };
    }
  }
  function onMouseMove(e: React.MouseEvent) {
    const d = dragRef.current;
    if (!d) return;
    if (d.type === "pan") {
      setView((v) => ({ ...v, tx: d.origX + (e.clientX - d.startX), ty: d.origY + (e.clientY - d.startY) }));
    } else if (d.type === "peca" && d.id) {
      const dx = (e.clientX - d.startX) / view.scale;
      const dy = (e.clientY - d.startY) / view.scale;
      setDragPos({
        id: d.id,
        x: Math.max(0, Math.round(d.origX + dx)),
        y: Math.max(0, Math.round(d.origY + dy)),
      });
    }
  }
  function onMouseUp() {
    const d = dragRef.current;
    if (d?.type === "peca" && d.id && dragPos && dragPos.id === d.id) {
      const p = chapaPlano.pecas.find((x) => x.id === d.id);
      if (p) onUpdate({ ...p, x: dragPos.x, y: dragPos.y });
    }
    dragRef.current = null;
    setDragPos(null);
  }

  function startDragPeca(e: React.MouseEvent, p: PecaPosicionada) {
    e.stopPropagation();
    onSelect(p.id);
    if (modoMover) {
      dragRef.current = { type: "peca", id: p.id, startX: e.clientX, startY: e.clientY, origX: p.x, origY: p.y };
    }
  }

  const s = view.scale;
  const cota = useMemo(() => 14 / s, [s]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{ cursor: dragRef.current?.type === "pan" ? "grabbing" : "default" }}
    >
      <svg width="100%" height="100%" className="select-none">
        <defs>
          <pattern id="hatch" patternUnits="userSpaceOnUse" width={8 / s} height={8 / s}>
            <path d={`M0,${8 / s} l${8 / s},-${8 / s}`} stroke="hsl(var(--muted-foreground))" strokeWidth={1 / s} opacity="0.5" />
          </pattern>
          <pattern id="refilo" patternUnits="userSpaceOnUse" width={6 / s} height={6 / s}>
            <path d={`M0,${6 / s} l${6 / s},-${6 / s}`} stroke="hsl(var(--destructive))" strokeWidth={1 / s} opacity="0.35" />
          </pattern>
        </defs>
        <g transform={`translate(${view.tx}, ${view.ty}) scale(${s})`}>
          {/* fundo da chapa */}
          <rect data-bg="true" x={0} y={0} width={W} height={H} fill={chapaPlano.chapa.cor} stroke="#1a1a1a" strokeWidth={2 / s} />

          {/* refilo (borda) */}
          {refilo > 0 && (
            <path
              d={`M0,0 L${W},0 L${W},${H} L0,${H} Z M${refilo},${refilo} L${refilo},${H - refilo} L${W - refilo},${H - refilo} L${W - refilo},${refilo} Z`}
              fill="url(#refilo)"
              fillRule="evenodd"
              stroke="hsl(var(--destructive))"
              strokeWidth={0.5 / s}
              strokeDasharray={`${3 / s} ${3 / s}`}
            />
          )}

          {/* grid 100mm */}
          <g opacity={0.12}>
            {Array.from({ length: Math.floor(W / 100) + 1 }, (_, i) => (
              <line key={`vx${i}`} x1={i * 100} y1={0} x2={i * 100} y2={H} stroke="#000" strokeWidth={0.5 / s} />
            ))}
            {Array.from({ length: Math.floor(H / 100) + 1 }, (_, i) => (
              <line key={`hy${i}`} x1={0} y1={i * 100} x2={W} y2={i * 100} stroke="#000" strokeWidth={0.5 / s} />
            ))}
          </g>

          {/* Régua superior — marcações a cada 100 mm */}
          <g>
            {Array.from({ length: Math.floor(W / 100) + 1 }, (_, i) => i * 100).map((mm) => (
              <g key={`ru-${mm}`}>
                <line x1={mm} y1={-2 / s} x2={mm} y2={-10 / s} stroke="hsl(var(--foreground))" strokeWidth={1 / s} />
                {mm % 500 === 0 && (
                  <text x={mm} y={-14 / s} fontSize={cota} textAnchor="middle" fill="hsl(var(--muted-foreground))">{mm}</text>
                )}
              </g>
            ))}
            {Array.from({ length: Math.floor(H / 100) + 1 }, (_, i) => i * 100).map((mm) => (
              <g key={`rl-${mm}`}>
                <line x1={-2 / s} y1={mm} x2={-10 / s} y2={mm} stroke="hsl(var(--foreground))" strokeWidth={1 / s} />
                {mm % 500 === 0 && (
                  <text x={-14 / s} y={mm} fontSize={cota} textAnchor="end" dominantBaseline="middle" fill="hsl(var(--muted-foreground))">{mm}</text>
                )}
              </g>
            ))}
          </g>

          {/* Dimensões nas bordas */}
          <text x={W / 2} y={-30 / s} fontSize={cota * 1.3} textAnchor="middle" fontWeight="600" fill="hsl(var(--foreground))">
            {W} mm
          </text>
          <text
            x={-30 / s} y={H / 2}
            fontSize={cota * 1.3} textAnchor="middle" fontWeight="600" fill="hsl(var(--foreground))"
            transform={`rotate(-90, ${-30 / s}, ${H / 2})`}
          >
            {H} mm
          </text>

          {/* sobras */}
          {chapaPlano.sobras.map((sob, i) => (
            <g key={`s${i}`}>
              <rect
                x={sob.x} y={sob.y} width={sob.largura} height={sob.altura}
                fill="url(#hatch)" stroke="hsl(var(--muted-foreground))"
                strokeWidth={1 / s} strokeDasharray={`${4 / s} ${2 / s}`}
              />
              {sob.largura > 200 && sob.altura > 80 && (
                <text
                  x={sob.x + sob.largura / 2} y={sob.y + sob.altura / 2}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={cota} fill="hsl(var(--muted-foreground))"
                  style={{ pointerEvents: "none" }}
                >
                  sobra {Math.round(sob.largura)}×{Math.round(sob.altura)}
                </text>
              )}
            </g>
          ))}

          {/* peças */}
          {chapaPlano.pecas.map((p) => {
            const sel = p.id === selecionada;
            const dx = dragPos?.id === p.id ? dragPos.x : p.x;
            const dy = dragPos?.id === p.id ? dragPos.y : p.y;
            return (
              <g key={p.id} onMouseDown={(e) => startDragPeca(e, p)} style={{ cursor: modoMover ? "move" : "pointer" }}>
                <rect
                  x={dx} y={dy} width={p.largura} height={p.altura}
                  fill={sel ? "hsl(var(--primary) / 0.18)" : "rgba(255,255,255,0.92)"}
                  stroke={sel ? "hsl(var(--primary))" : "#1a1a1a"}
                  strokeWidth={(sel ? 2.5 : 1) / s}
                />
                <text
                  x={dx + p.largura / 2} y={dy + p.altura / 2 - cota * 0.6}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={Math.min(cota * 1.4, Math.min(p.largura, p.altura) * 0.13)}
                  fill="#111" fontWeight="600"
                  style={{ pointerEvents: "none" }}
                >
                  {p.descricao.slice(0, 22)}
                </text>
                <text
                  x={dx + p.largura / 2} y={dy + p.altura / 2 + cota * 0.7}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={Math.min(cota * 1.1, Math.min(p.largura, p.altura) * 0.1)}
                  fill="#444"
                  style={{ pointerEvents: "none" }}
                >
                  {Math.round(p.largura)} × {Math.round(p.altura)}{p.rotacionada ? "  ↻" : ""}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute bottom-3 right-3 flex gap-1 rounded border border-border bg-panel/95 p-1 backdrop-blur">
        <Button size="sm" variant="ghost" onClick={() => setView((v) => ({ ...v, scale: v.scale * 1.2 }))}><Plus className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" onClick={() => setView((v) => ({ ...v, scale: v.scale / 1.2 }))}>−</Button>
        <Button size="sm" variant="ghost" onClick={ajustar}><Maximize2 className="h-3.5 w-3.5" /></Button>
        <span className="self-center px-2 font-mono text-[11px] text-muted-foreground">{Math.round(view.scale * 100)}%</span>
      </div>
    </div>
  );
});
