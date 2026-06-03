import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Cpu, Maximize2, MousePointer2, Move, RotateCw, Trash2, Plus, Save } from "lucide-react";
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
  const [clipboard, setClipboard] = useState<PecaPosicionada[]>([]);
  const [resultado, setResultado] = useState<ResultadoPlano | null>(null);

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

  const calcular = useCallback(() => {
    if (!pecas || !chapas) return;
    const input: PecaInput[] = pecas
      .filter((p) => p.chapa_id)
      .map((p) => ({
        id: p.id,
        descricao: p.descricao,
        largura: p.largura,
        altura: p.altura,
        espessura: p.espessura,
        chapa_id: p.chapa_id!,
        quantidade: p.quantidade,
      }));
    const r = calcularPlanoCorte(input, chapas);
    setResultado(r);
    setChapaIndex(0);
    setSelecionada(null);
  }, [pecas, chapas]);

  // calcula automaticamente quando os dados chegam
  useEffect(() => {
    if (pecas && chapas && !resultado) calcular();
  }, [pecas, chapas, resultado, calcular]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!resultado) throw new Error("Calcule o plano antes de salvar");
      // apaga planos anteriores deste projeto (cascade cuida do resto)
      await supabase.from("planos_corte").delete().eq("projeto_id", id);
      const { data: plano, error } = await supabase.from("planos_corte").insert({
        projeto_id: id,
        versao: 1,
        aproveitamento_medio: resultado.aproveitamento_medio,
        total_chapas: resultado.total_chapas,
        total_pecas: resultado.total_pecas,
      }).select().single();
      if (error) throw error;

      for (const c of resultado.chapas) {
        const { data: pc, error: e1 } = await supabase.from("plano_corte_chapas").insert({
          plano_id: plano.id,
          chapa_id: c.chapa.id,
          indice: c.indice,
          aproveitamento: c.aproveitamento,
          area_usada: c.area_usada,
        }).select().single();
        if (e1) throw e1;
        if (c.pecas.length > 0) {
          await supabase.from("plano_corte_pecas").insert(c.pecas.map((p) => ({
            plano_chapa_id: pc.id,
            projeto_peca_id: p.projeto_peca_id,
            x: p.x, y: p.y, largura: p.largura, altura: p.altura,
            rotacionada: p.rotacionada,
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

  function updatePecaPos(updated: PecaPosicionada) {
    if (!resultado || !chapaAtual) return;
    const novasPecas = chapaAtual.pecas.map((p) => p.id === updated.id ? updated : p);
    const colidiu = detectarColisao(novasPecas, chapaAtual.chapa, updated.id);
    if (colidiu) {
      toast.error("Colisão detectada", { id: "col", duration: 800 });
    }
    const novoResultado = { ...resultado };
    novoResultado.chapas = [...resultado.chapas];
    novoResultado.chapas[chapaIndex] = { ...chapaAtual, pecas: novasPecas };
    setResultado(novoResultado);
  }

  function rotacionarSelecionada() {
    if (!pecaSelecionada || !chapaAtual) return;
    updatePecaPos({
      ...pecaSelecionada,
      largura: pecaSelecionada.altura,
      altura: pecaSelecionada.largura,
      rotacionada: !pecaSelecionada.rotacionada,
    });
  }

  function removerSelecionada() {
    if (!pecaSelecionada || !chapaAtual || !resultado) return;
    setClipboard((cb) => [...cb, pecaSelecionada]);
    const novasPecas = chapaAtual.pecas.filter((p) => p.id !== pecaSelecionada.id);
    const novoResultado = { ...resultado };
    novoResultado.chapas = [...resultado.chapas];
    novoResultado.chapas[chapaIndex] = { ...chapaAtual, pecas: novasPecas };
    setResultado(novoResultado);
    setSelecionada(null);
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border bg-panel px-4 py-2">
        <div className="flex items-center gap-3">
          <Link to="/projetos/$id" params={{ id }}><Button size="sm" variant="ghost"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Plano de Corte · {projeto?.nome ?? ""}</h1>
            <p className="text-[11px] text-muted-foreground">
              {resultado ? `${resultado.total_chapas} chapas · ${resultado.total_pecas} peças · aproveitamento médio ${Math.round(resultado.aproveitamento_medio * 100)}%` : "Calculando…"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={modoMover ? "default" : "outline"} onClick={() => setModoMover(!modoMover)}>
            {modoMover ? <Move className="mr-1 h-4 w-4" /> : <MousePointer2 className="mr-1 h-4 w-4" />}
            {modoMover ? "Mover Peças" : "Selecionar"}
          </Button>
          <Button size="sm" variant="outline" onClick={calcular}>Recalcular</Button>
          <Button size="sm" onClick={() => salvar.mutate()} disabled={!resultado || salvar.isPending}>
            <Save className="mr-1 h-4 w-4" />Salvar plano
          </Button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[260px_1fr_300px] overflow-hidden">
        {/* Painel esquerdo */}
        <aside className="overflow-auto border-r border-border bg-panel p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Resumo geral</h3>
          {resultado && (
            <div className="mb-4 space-y-1 rounded bg-surface p-3 text-xs">
              <Linha k="Chapas necessárias" v={String(resultado.total_chapas)} />
              <Linha k="Total de peças" v={String(resultado.total_pecas)} />
              <Linha k="Aproveitamento médio" v={`${Math.round(resultado.aproveitamento_medio * 100)}%`} />
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

          {clipboard.length > 0 && (
            <>
              <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Removidas</h3>
              <div className="space-y-1 rounded bg-surface p-2 text-[11px]">
                {clipboard.map((p) => <div key={p.id} className="truncate text-muted-foreground">{p.descricao}</div>)}
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
                <Linha k="Fita" v={projPeca.fita_codigo ?? "—"} />
                <Linha k="Módulo" v={projPeca.modulo ?? "—"} />
                <Linha k="Posição X" v={`${Math.round(pecaSelecionada.x)} mm`} />
                <Linha k="Posição Y" v={`${Math.round(pecaSelecionada.y)} mm`} />
                <Linha k="Rotacionada" v={pecaSelecionada.rotacionada ? "Sim" : "Não"} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={rotacionarSelecionada}><RotateCw className="mr-1 h-3.5 w-3.5" />Girar</Button>
                <Button size="sm" variant="outline" onClick={removerSelecionada}><Trash2 className="mr-1 h-3.5 w-3.5" />Remover</Button>
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={async () => {
                  if (projPeca.peca_id) {
                    navigate({ to: "/pecas/$id", params: { id: projPeca.peca_id } });
                    return;
                  }
                  // cria peça vinculada
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

// ============ Canvas SVG ============

function ChapaCanvas({
  chapaPlano, selecionada, onSelect, modoMover, onUpdate,
}: {
  chapaPlano: ChapaPlano;
  selecionada: string | null;
  onSelect: (id: string | null) => void;
  modoMover: boolean;
  onUpdate: (p: PecaPosicionada) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [drag, setDrag] = useState<{
    type: "pan" | "peca"; id?: string; startX: number; startY: number; origX: number; origY: number;
  } | null>(null);

  const W = chapaPlano.chapa.largura;
  const H = chapaPlano.chapa.altura;

  const ajustar = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    const pad = 40;
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
    // zoom centrado no mouse
    const tx = mx - (mx - view.tx) * (newScale / view.scale);
    const ty = my - (my - view.ty) * (newScale / view.scale);
    setView({ scale: newScale, tx, ty });
  }

  function onMouseDown(e: React.MouseEvent) {
    if (e.target === e.currentTarget || (e.target as Element).tagName === "rect" && (e.target as Element).getAttribute("data-bg") === "true") {
      setDrag({ type: "pan", startX: e.clientX, startY: e.clientY, origX: view.tx, origY: view.ty });
    }
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!drag) return;
    if (drag.type === "pan") {
      setView({ ...view, tx: drag.origX + (e.clientX - drag.startX), ty: drag.origY + (e.clientY - drag.startY) });
    } else if (drag.type === "peca" && drag.id) {
      const p = chapaPlano.pecas.find((x) => x.id === drag.id);
      if (!p) return;
      const dx = (e.clientX - drag.startX) / view.scale;
      const dy = (e.clientY - drag.startY) / view.scale;
      onUpdate({ ...p, x: Math.max(0, Math.round(drag.origX + dx)), y: Math.max(0, Math.round(drag.origY + dy)) });
    }
  }
  function onMouseUp() { setDrag(null); }

  function startDragPeca(e: React.MouseEvent, p: PecaPosicionada) {
    e.stopPropagation();
    onSelect(p.id);
    if (modoMover) {
      setDrag({ type: "peca", id: p.id, startX: e.clientX, startY: e.clientY, origX: p.x, origY: p.y });
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{ cursor: drag?.type === "pan" ? "grabbing" : "default" }}
    >
      <svg width="100%" height="100%" className="select-none">
        <g transform={`translate(${view.tx}, ${view.ty}) scale(${view.scale})`}>
          {/* fundo da chapa */}
          <rect data-bg="true" x={0} y={0} width={W} height={H} fill={chapaPlano.chapa.cor} stroke="#000" strokeWidth={2 / view.scale} />
          {/* grid 100mm */}
          <g opacity={0.15}>
            {Array.from({ length: Math.floor(W / 100) + 1 }, (_, i) => (
              <line key={`vx${i}`} x1={i * 100} y1={0} x2={i * 100} y2={H} stroke="#000" strokeWidth={0.5 / view.scale} />
            ))}
            {Array.from({ length: Math.floor(H / 100) + 1 }, (_, i) => (
              <line key={`hy${i}`} x1={0} y1={i * 100} x2={W} y2={i * 100} stroke="#000" strokeWidth={0.5 / view.scale} />
            ))}
          </g>
          {/* sobras */}
          {chapaPlano.sobras.map((s, i) => (
            <rect key={`s${i}`} x={s.x} y={s.y} width={s.largura} height={s.altura}
              fill="url(#hatch)" stroke="hsl(var(--muted-foreground))" strokeWidth={1 / view.scale} strokeDasharray={`${4 / view.scale} ${2 / view.scale}`} />
          ))}
          {/* peças */}
          {chapaPlano.pecas.map((p) => {
            const sel = p.id === selecionada;
            return (
              <g key={p.id} onMouseDown={(e) => startDragPeca(e, p)} style={{ cursor: modoMover ? "move" : "pointer" }}>
                <rect
                  x={p.x} y={p.y} width={p.largura} height={p.altura}
                  fill="rgba(255,255,255,0.85)"
                  stroke={sel ? "hsl(var(--primary))" : "#222"}
                  strokeWidth={(sel ? 3 : 1.2) / view.scale}
                />
                <text
                  x={p.x + p.largura / 2} y={p.y + p.altura / 2}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={Math.min(p.largura, p.altura) * 0.12}
                  fill="#111"
                  style={{ pointerEvents: "none" }}
                >
                  {p.descricao.slice(0, 18)}
                </text>
                <text
                  x={p.x + p.largura / 2} y={p.y + p.altura / 2 + Math.min(p.largura, p.altura) * 0.12}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={Math.min(p.largura, p.altura) * 0.09}
                  fill="#555"
                  style={{ pointerEvents: "none" }}
                >
                  {Math.round(p.largura)}×{Math.round(p.altura)}{p.rotacionada ? " ↻" : ""}
                </text>
              </g>
            );
          })}
          <defs>
            <pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform={`scale(${1 / view.scale})`}>
              <path d="M0,8 l8,-8" stroke="hsl(var(--muted-foreground))" strokeWidth="1" opacity="0.4" />
            </pattern>
          </defs>
        </g>
      </svg>

      <div className="absolute bottom-3 right-3 flex gap-1 rounded border border-border bg-panel/95 p-1 backdrop-blur">
        <Button size="sm" variant="ghost" onClick={() => setView({ ...view, scale: view.scale * 1.2 })}><Plus className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" onClick={() => setView({ ...view, scale: view.scale / 1.2 })}>−</Button>
        <Button size="sm" variant="ghost" onClick={ajustar}><Maximize2 className="h-3.5 w-3.5" /></Button>
        <span className="px-2 text-[11px] font-mono text-muted-foreground self-center">{Math.round(view.scale * 100)}%</span>
      </div>
    </div>
  );
}
