import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X, Move, Lock, Save, Undo2, Shield, ShieldOff } from "lucide-react";
import { toast } from "sonner";

type PecaJson = {
  id: string;
  projeto_peca_id?: string;
  descricao?: string;
  codigo?: string | null;
  x: number; y: number;
  largura: number; altura: number;
  espessura?: number;
  rotacionada?: boolean;
  quantidade_index?: number;
  modulo?: string | null;
  fita?: string | null;
};

type ChapaJson = {
  indice: number;
  chapa: { id: string; nome: string; largura: number; altura: number; espessura: number };
  pecas: PecaJson[];
  aproveitamento: number;
  area_usada: number;
};

type PlanoJson = {
  nome?: string;
  configuracao?: Record<string, unknown>;
  plano?: ChapaJson[];
  pecas_nao_encaixadas?: Array<{ descricao: string; motivo: string; largura: number; altura: number }>;
  area_total_pecas?: number;
  area_total_chapas?: number;
  aproveitamento_percentual?: number;
};

export type PlanoRow = {
  id: string;
  versao: number;
  status: string;
  aproveitamento_medio: number;
  aproveitamento_percentual?: number | null;
  total_chapas: number;
  total_pecas: number;
  observacao: string | null;
  plano_corte_json?: PlanoJson | null;
};

function abreviar(txt: string, limite: number): string {
  if (!txt) return "";
  if (txt.length <= limite) return txt;
  return txt.slice(0, Math.max(1, limite - 1)) + "…";
}

function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function colide(a: PecaJson, b: PecaJson): boolean {
  return (
    a.x < b.x + b.largura &&
    a.x + a.largura > b.x &&
    a.y < b.y + b.altura &&
    a.y + a.altura > b.y
  );
}

// Considera a peça "a" expandida por `gap` em cada lado e verifica overlap com b
function colideComMargem(a: PecaJson, b: PecaJson, gap: number): boolean {
  return (
    a.x - gap < b.x + b.largura &&
    a.x + a.largura + gap > b.x &&
    a.y - gap < b.y + b.altura &&
    a.y + a.altura + gap > b.y
  );
}

function pecasComColisaoNaChapa(chapa: ChapaJson): Set<string> {
  const ids = new Set<string>();
  const arr = chapa.pecas;
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (colide(arr[i], arr[j])) {
        ids.add(arr[i].id); ids.add(arr[j].id);
      }
    }
  }
  return ids;
}

function pecasMuitoProximas(chapa: ChapaJson, gap: number): Set<string> {
  const ids = new Set<string>();
  const arr = chapa.pecas;
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (!colide(arr[i], arr[j]) && colideComMargem(arr[i], arr[j], gap)) {
        ids.add(arr[i].id); ids.add(arr[j].id);
      }
    }
  }
  return ids;
}

function pecaForaDaChapa(p: PecaJson, c: ChapaJson): boolean {
  return p.x < 0 || p.y < 0 || p.x + p.largura > c.chapa.largura || p.y + p.altura > c.chapa.altura;
}

function pecaForaAreaUtil(p: PecaJson, c: ChapaJson, margem: number): boolean {
  return (
    p.x < margem ||
    p.y < margem ||
    p.x + p.largura > c.chapa.largura - margem ||
    p.y + p.altura > c.chapa.altura - margem
  );
}

type MotivoBloqueio = "fora_da_chapa" | "colisao" | "margem_borda" | "distancia_minima";

const EPS = 0.01;

function validarMovimentoComMargem(
  pecaMovida: PecaJson,
  outrasPecas: PecaJson[],
  chapa: ChapaJson,
  cfg: { distanciaMinima: number; margemBorda: number },
): { valido: boolean; motivo?: MotivoBloqueio } {
  if (pecaForaDaChapa(pecaMovida, chapa)) return { valido: false, motivo: "fora_da_chapa" };
  if (pecaForaAreaUtil(pecaMovida, chapa, cfg.margemBorda)) return { valido: false, motivo: "margem_borda" };
  for (const o of outrasPecas) {
    if (o.id === pecaMovida.id) continue;
    if (colide(pecaMovida, o)) return { valido: false, motivo: "colisao" };
    // distância exatamente igual a S é válida; usamos S - EPS para tolerar floats.
    if (colideComMargem(pecaMovida, o, Math.max(0, cfg.distanciaMinima - EPS))) {
      return { valido: false, motivo: "distancia_minima" };
    }
  }
  return { valido: true };
}

/**
 * Snap/alinhador: dada uma posição alvo, retorna a posição válida mais próxima
 * respeitando margem da borda, sobreposição e distância mínima.
 * O sentido do movimento decide para qual lado encostar quando houver obstáculo.
 */
function calcularPosicaoValidaComSnap(
  peca: PecaJson,
  alvoX: number,
  alvoY: number,
  outras: PecaJson[],
  chapa: ChapaJson,
  cfg: { distanciaMinima: number; margemBorda: number },
  dxSinal: number,
  dySinal: number,
): { x: number; y: number } {
  const m = cfg.margemBorda;
  const S = cfg.distanciaMinima;
  const W = chapa.chapa.largura;
  const H = chapa.chapa.altura;

  let x = Math.max(m, Math.min(alvoX, W - peca.largura - m));
  let y = Math.max(m, Math.min(alvoY, H - peca.altura - m));

  const resolverX = (curY: number, curX: number): number => {
    let nx = curX;
    for (const o of outras) {
      if (o.id === peca.id) continue;
      const yLivre = curY + peca.altura + S <= o.y + EPS || curY >= o.y + o.altura + S - EPS;
      if (yLivre) continue;
      const left = o.x - peca.largura - S;
      const right = o.x + o.largura + S;
      if (nx > left + EPS && nx < right - EPS) {
        const escolha = dxSinal > 0 ? "left" : dxSinal < 0 ? "right"
          : Math.abs(nx - left) <= Math.abs(nx - right) ? "left" : "right";
        nx = escolha === "left" ? left : right;
      }
    }
    return Math.max(m, Math.min(nx, W - peca.largura - m));
  };

  const resolverY = (curX: number, curY: number): number => {
    let ny = curY;
    for (const o of outras) {
      if (o.id === peca.id) continue;
      const xLivre = curX + peca.largura + S <= o.x + EPS || curX >= o.x + o.largura + S - EPS;
      if (xLivre) continue;
      const top = o.y - peca.altura - S;
      const bot = o.y + o.altura + S;
      if (ny > top + EPS && ny < bot - EPS) {
        const escolha = dySinal > 0 ? "top" : dySinal < 0 ? "bot"
          : Math.abs(ny - top) <= Math.abs(ny - bot) ? "top" : "bot";
        ny = escolha === "top" ? top : bot;
      }
    }
    return Math.max(m, Math.min(ny, H - peca.altura - m));
  };

  if (Math.abs(dxSinal) >= Math.abs(dySinal)) {
    x = resolverX(y, x);
    y = resolverY(x, y);
    x = resolverX(y, x);
  } else {
    y = resolverY(x, y);
    x = resolverX(y, x);
    y = resolverY(x, y);
  }
  return { x, y };
}

function lerConfigJson(j: PlanoJson | null | undefined): { distanciaMinima: number; margemBorda: number } {
  const cfg = (j?.configuracao ?? {}) as Record<string, unknown>;
  const esp = Number(cfg.espacamento);
  const mar = Number(cfg.margem);
  return {
    distanciaMinima: Number.isFinite(esp) && esp >= 0 ? esp : 6,
    margemBorda: Number.isFinite(mar) && mar >= 0 ? mar : 10,
  };
}

export function VisualizadorPlanoCorteDialog({
  open, onOpenChange, plano,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plano: PlanoRow | null;
}) {
  const qc = useQueryClient();
  const [pecaSel, setPecaSel] = useState<{ p: PecaJson; chapaNum: number; chapaNome: string } | null>(null);
  const [modoEdicaoManual, setModoEdicaoManual] = useState(false);
  const [colisaoAtiva, setColisaoAtiva] = useState(true);
  const [bloqueio, setBloqueio] = useState<{ pecaId: string; motivo: MotivoBloqueio } | null>(null);
  const [planoEditavel, setPlanoEditavel] = useState<PlanoJson | null>(null);
  const [planoOriginal, setPlanoOriginal] = useState<PlanoJson | null>(null);
  const [alteracoesPendentes, setAlteracoesPendentes] = useState(false);
  const [, forceTick] = useState(0);

  const parsed: { json: PlanoJson | null; error: string | null } = useMemo(() => {
    if (!plano) return { json: null, error: null };
    const empty = "Plano de corte vazio ou inválido. Gere novamente o plano antes de editar.";
    let j: PlanoJson | null = null;
    // Fonte da verdade: plano_corte_json (jsonb). Fallback legado: observacao (texto JSON).
    if (plano.plano_corte_json && typeof plano.plano_corte_json === "object") {
      j = plano.plano_corte_json as PlanoJson;
    } else if (plano.observacao && plano.observacao.trim().startsWith("{")) {
      try { j = JSON.parse(plano.observacao) as PlanoJson; } catch { j = null; }
    }
    if (!j) return { json: null, error: empty };
    const chapas = j.plano ?? [];
    if (chapas.length === 0) return { json: null, error: empty };
    const totalPecas = chapas.reduce((s, c) => s + (c.pecas?.length ?? 0), 0);
    if (totalPecas === 0) return { json: null, error: empty };
    return { json: j, error: null };
  }, [plano]);

  // Reset state ao abrir/trocar plano
  useEffect(() => {
    if (open && parsed.json) {
      setPlanoOriginal(deepCopy(parsed.json));
      setPlanoEditavel(deepCopy(parsed.json));
      setAlteracoesPendentes(false);
      setModoEdicaoManual(false);
      setColisaoAtiva(true);
      setBloqueio(null);
      setPecaSel(null);
    }
    if (!open) {
      setPlanoOriginal(null);
      setPlanoEditavel(null);
      setAlteracoesPendentes(false);
      setModoEdicaoManual(false);
      setColisaoAtiva(true);
      setBloqueio(null);
      setPecaSel(null);
    }
  }, [open, parsed.json]);

  const cfgMargem = useMemo(() => lerConfigJson(planoEditavel ?? parsed.json), [planoEditavel, parsed.json]);

  const colisoesPorChapa = useMemo(() => {
    const m = new Map<number, Set<string>>();
    if (!planoEditavel?.plano) return m;
    planoEditavel.plano.forEach((c, idx) => m.set(idx, pecasComColisaoNaChapa(c)));
    return m;
  }, [planoEditavel]);

  const temColisao = useMemo(
    () => Array.from(colisoesPorChapa.values()).some((s) => s.size > 0),
    [colisoesPorChapa],
  );

  const proximidadePorChapa = useMemo(() => {
    const m = new Map<number, Set<string>>();
    if (!planoEditavel?.plano) return m;
    planoEditavel.plano.forEach((c, idx) => m.set(idx, pecasMuitoProximas(c, cfgMargem.distanciaMinima)));
    return m;
  }, [planoEditavel, cfgMargem.distanciaMinima]);

  const temProximidade = useMemo(
    () => Array.from(proximidadePorChapa.values()).some((s) => s.size > 0),
    [proximidadePorChapa],
  );

  const temForaChapa = useMemo(() => {
    if (!planoEditavel?.plano) return false;
    return planoEditavel.plano.some((c) => c.pecas.some((p) => pecaForaDaChapa(p, c)));
  }, [planoEditavel]);

  const temForaAreaUtil = useMemo(() => {
    if (!planoEditavel?.plano) return false;
    return planoEditavel.plano.some((c) => c.pecas.some((p) => pecaForaAreaUtil(p, c, cfgMargem.margemBorda)));
  }, [planoEditavel, cfgMargem.margemBorda]);

  const podeSalvar = !temColisao && !temForaChapa && !temForaAreaUtil && !temProximidade;

  const salvarMut = useMutation({
    mutationFn: async () => {
      if (!plano || !planoEditavel) throw new Error("Sem plano");
      if (!planoEditavel.plano || planoEditavel.plano.length === 0)
        throw new Error("Não é possível salvar: plano vazio ou inválido.");
      const totalPecasEd = planoEditavel.plano.reduce((s, c) => s + c.pecas.length, 0);
      if (totalPecasEd === 0) throw new Error("Não é possível salvar: plano vazio ou inválido.");
      if (temForaChapa) throw new Error("Não é possível salvar: peça fora da área útil da chapa.");
      if (temForaAreaUtil) throw new Error("Não é possível salvar: margem mínima da borda não respeitada.");
      if (temColisao) throw new Error("Não é possível salvar: existem peças sobrepostas.");
      if (temProximidade) throw new Error("Não é possível salvar: distância mínima entre peças não respeitada.");

      let areaPecas = 0;
      let areaChapas = 0;
      for (const c of planoEditavel.plano) {
        areaChapas += c.chapa.largura * c.chapa.altura;
        for (const p of c.pecas) {
          areaPecas += p.largura * p.altura;
        }
        const ac = c.chapa.largura * c.chapa.altura;
        const ap = c.pecas.reduce((s, p) => s + p.largura * p.altura, 0);
        c.area_usada = ap;
        c.aproveitamento = ac > 0 ? ap / ac : 0;
      }
      const aprovPct = areaChapas > 0 ? (areaPecas / areaChapas) * 100 : 0;
      planoEditavel.area_total_pecas = areaPecas;
      planoEditavel.area_total_chapas = areaChapas;
      planoEditavel.aproveitamento_percentual = aprovPct;

      const { error } = await supabase
        .from("planos_corte")
        .update({
          plano_corte_json: planoEditavel as never,
          aproveitamento_percentual: aprovPct,
          aproveitamento_medio: aprovPct / 100,
          status: "gerado",
        } as never)
        .eq("id", plano.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planos-corte-list"] });
      setPlanoOriginal(planoEditavel ? deepCopy(planoEditavel) : null);
      setAlteracoesPendentes(false);
      toast.success("Plano de corte atualizado com sucesso.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function cancelarAlteracoes() {
    if (planoOriginal) {
      setPlanoEditavel(deepCopy(planoOriginal));
      setAlteracoesPendentes(false);
      setPecaSel(null);
    }
  }

  // Drag state
  const dragRef = useRef<{
    chapaIdx: number; pecaId: string;
    startMouseX: number; startMouseY: number;
    startPecaX: number; startPecaY: number;
    svgEl: SVGSVGElement;
    svgW: number; svgH: number;
  } | null>(null);

  function onPecaMouseDown(
    e: React.MouseEvent<SVGGElement>,
    chapaIdx: number,
    peca: PecaJson,
    chapa: ChapaJson,
  ) {
    if (!modoEdicaoManual || !planoEditavel) {
      // só seleciona
      setPecaSel({ p: peca, chapaNum: chapaIdx + 1, chapaNome: chapa.chapa.nome });
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const svg = (e.currentTarget.ownerSVGElement) as SVGSVGElement | null;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    dragRef.current = {
      chapaIdx, pecaId: peca.id,
      startMouseX: e.clientX, startMouseY: e.clientY,
      startPecaX: peca.x, startPecaY: peca.y,
      svgEl: svg,
      svgW: rect.width, svgH: rect.height,
    };
    setPecaSel({ p: peca, chapaNum: chapaIdx + 1, chapaNome: chapa.chapa.nome });

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d || !planoEditavel?.plano) return;
      const c = planoEditavel.plano[d.chapaIdx];
      if (!c) return;
      const scaleX = c.chapa.largura / d.svgW;
      const scaleY = c.chapa.altura / d.svgH;
      const dx = (ev.clientX - d.startMouseX) * scaleX;
      const dy = (ev.clientY - d.startMouseY) * scaleY;
      const p = c.pecas.find((x) => x.id === d.pecaId);
      if (!p) return;
      let nx = d.startPecaX + dx;
      let ny = d.startPecaY + dy;

      if (colisaoAtiva) {
        // Restringe à área útil (margem da borda)
        const m = cfgMargem.margemBorda;
        nx = Math.max(m, Math.min(nx, c.chapa.largura - p.largura - m));
        ny = Math.max(m, Math.min(ny, c.chapa.altura - p.altura - m));
        const candidato = { ...p, x: nx, y: ny };
        const r = validarMovimentoComMargem(candidato, c.pecas, c, cfgMargem);
        if (!r.valido) {
          setBloqueio({ pecaId: p.id, motivo: r.motivo! });
          // mantém última posição válida — não atualiza p.x/p.y
          setPecaSel((cur) => (cur && cur.p.id === p.id ? { ...cur, p: { ...p } } : cur));
          forceTick((t) => t + 1);
          return;
        }
        setBloqueio(null);
      } else {
        // livre dentro dos limites físicos da chapa
        nx = Math.max(0, Math.min(nx, c.chapa.largura - p.largura));
        ny = Math.max(0, Math.min(ny, c.chapa.altura - p.altura));
        setBloqueio(null);
      }

      p.x = nx;
      p.y = ny;
      setPecaSel((cur) => (cur && cur.p.id === p.id ? { ...cur, p: { ...p } } : cur));
      forceTick((t) => t + 1);
    };
    const onUp = () => {
      if (dragRef.current) {
        setAlteracoesPendentes(true);
        dragRef.current = null;
      }
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const nome = (planoEditavel?.nome ?? parsed.json?.nome) ?? (plano ? `Plano v${plano.versao}` : "Plano");
  const aprovPctView = planoEditavel?.aproveitamento_percentual != null
    ? Math.round(planoEditavel.aproveitamento_percentual)
    : plano?.aproveitamento_percentual != null && plano.aproveitamento_percentual > 0
      ? Math.round(plano.aproveitamento_percentual)
      : (plano ? Math.round((plano.aproveitamento_medio ?? 0) * 100) : 0);

  const totalChapasView = planoEditavel?.plano?.length ?? plano?.total_chapas ?? 0;
  const totalPecasView = planoEditavel?.plano?.reduce((s, c) => s + c.pecas.length, 0) ?? plano?.total_pecas ?? 0;

  return (
    <Dialog open={open} onOpenChange={(v) => onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{nome}</span>
            {plano && <Badge variant="secondary">{plano.status}</Badge>}
            {alteracoesPendentes && <Badge variant="outline" className="text-warning border-warning">alterações não salvas</Badge>}
          </DialogTitle>
        </DialogHeader>

        {parsed.error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            {parsed.error}
          </div>
        )}

        {planoEditavel && plano && (
          <div className="space-y-4">
            {/* Toolbar de edição */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={modoEdicaoManual ? "default" : "outline"}
                onClick={() => setModoEdicaoManual((v) => !v)}
              >
                {modoEdicaoManual
                  ? (<><Lock className="mr-1 h-4 w-4" />Bloquear movimentação</>)
                  : (<><Move className="mr-1 h-4 w-4" />Permitir movimentar peças</>)}
              </Button>
              {modoEdicaoManual && (
                <Button
                  size="sm"
                  variant={colisaoAtiva ? "default" : "outline"}
                  onClick={() => { setColisaoAtiva((v) => !v); setBloqueio(null); }}
                  title="Bloquear ou permitir sobreposição entre peças durante a movimentação"
                >
                  {colisaoAtiva
                    ? (<><Shield className="mr-1 h-4 w-4" />Colisão: ligada</>)
                    : (<><ShieldOff className="mr-1 h-4 w-4" />Colisão: desligada</>)}
                </Button>
              )}
              {alteracoesPendentes && (
                <>
                  <Button
                    size="sm"
                    onClick={() => salvarMut.mutate()}
                    disabled={salvarMut.isPending || !podeSalvar}
                  >
                    <Save className="mr-1 h-4 w-4" />Salvar alterações
                  </Button>
                  <Button size="sm" variant="outline" onClick={cancelarAlteracoes}>
                    <Undo2 className="mr-1 h-4 w-4" />Cancelar alterações
                  </Button>
                </>
              )}
            </div>

            {modoEdicaoManual && (
              <div className="rounded border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
                Modo manual ativo: arraste as peças para ajustar o plano. Margem da borda: {cfgMargem.margemBorda} mm · Distância mínima entre peças: {cfgMargem.distanciaMinima} mm.
              </div>
            )}
            {modoEdicaoManual && !colisaoAtiva && (
              <div className="rounded border border-warning/40 bg-warning/10 p-2 text-xs text-warning-foreground">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                Colisão desligada: sobreposições são permitidas apenas temporariamente. Corrija antes de salvar.
              </div>
            )}
            {modoEdicaoManual && colisaoAtiva && bloqueio && (
              <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                Movimento bloqueado: {bloqueio.motivo === "distancia_minima"
                  ? "distância mínima não respeitada."
                  : bloqueio.motivo === "margem_borda"
                    ? "margem mínima da borda não respeitada."
                    : bloqueio.motivo === "colisao"
                      ? "colisão com outra peça."
                      : "peça fora da chapa."}
              </div>
            )}
            {temColisao && (
              <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                Existem peças sobrepostas. Ajuste antes de salvar.
              </div>
            )}
            {temProximidade && !temColisao && (
              <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                Existem peças a menos de {cfgMargem.distanciaMinima} mm umas das outras.
              </div>
            )}
            {(temForaChapa || temForaAreaUtil) && (
              <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                {temForaChapa ? "Existem peças fora da chapa." : `Peça fora da área útil (margem ${cfgMargem.margemBorda} mm).`}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Metric label="Aproveitamento" value={`${aprovPctView}%`} />
              <Metric label="Chapas" value={String(totalChapasView)} />
              <Metric label="Peças" value={String(totalPecasView)} />
              <Metric
                label="Não encaixadas"
                value={String(planoEditavel.pecas_nao_encaixadas?.length ?? 0)}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <div className="space-y-6">
                {(planoEditavel.plano ?? []).map((c, idx) => {
                  const numero = idx + 1;
                  const areaChapa = c.chapa.largura * c.chapa.altura;
                  const areaPecas = c.pecas.reduce((s, p) => s + p.largura * p.altura, 0);
                  const aprov = areaChapa > 0 ? areaPecas / areaChapa : 0;
                  return (
                    <ChapaSvg
                      key={`${c.chapa.id}-${idx}`}
                      chapa={c}
                      numero={numero}
                      aprovChapa={aprov}
                      colisaoIds={colisoesPorChapa.get(idx) ?? new Set()}
                      proximidadeIds={proximidadePorChapa.get(idx) ?? new Set()}
                      onPecaMouseDown={(e, p) => onPecaMouseDown(e, idx, p, c)}
                      selecionadaId={pecaSel?.p.id ?? null}
                      modoEdicao={modoEdicaoManual}
                      mostrarAreaUtil={modoEdicaoManual}
                      margemBorda={cfgMargem.margemBorda}
                    />
                  );
                })}
              </div>

              {pecaSel && (() => {
                const c = planoEditavel.plano?.[pecaSel.chapaNum - 1];
                const fora = c ? pecaForaDaChapa(pecaSel.p, c) : false;
                const sobreposta = (colisoesPorChapa.get(pecaSel.chapaNum - 1) ?? new Set()).has(pecaSel.p.id);
                const proxima = (proximidadePorChapa.get(pecaSel.chapaNum - 1) ?? new Set()).has(pecaSel.p.id);
                const foraAreaUtil = c ? pecaForaAreaUtil(pecaSel.p, c, cfgMargem.margemBorda) : false;
                const statusColisao = fora
                  ? "Fora da chapa"
                  : foraAreaUtil
                    ? "Fora da área útil"
                    : sobreposta
                      ? "Sobreposta"
                      : proxima
                        ? "Próxima demais"
                        : "Livre";
                const bloquedoEssa = bloqueio && bloqueio.pecaId === pecaSel.p.id ? bloqueio : null;
                return (
                  <aside className="h-fit space-y-2 rounded border border-border bg-surface p-3 text-xs lg:sticky lg:top-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Detalhe da peça</span>
                      <button
                        onClick={() => setPecaSel(null)}
                        className="rounded p-1 hover:bg-muted"
                        aria-label="Fechar"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <Linha k="Código" v={pecaSel.p.codigo ?? "—"} />
                    <Linha k="Descrição" v={pecaSel.p.descricao ?? "—"} />
                    <Linha k="Posição X" v={`${Math.round(pecaSel.p.x)} mm`} />
                    <Linha k="Posição Y" v={`${Math.round(pecaSel.p.y)} mm`} />
                    <Linha k="Largura" v={`${Math.round(pecaSel.p.largura)} mm`} />
                    <Linha k="Altura" v={`${Math.round(pecaSel.p.altura)} mm`} />
                    {pecaSel.p.espessura != null && <Linha k="Espessura" v={`${pecaSel.p.espessura} mm`} />}
                    <Linha k="Chapa" v={`${pecaSel.chapaNum} · ${pecaSel.chapaNome}`} />
                    <Linha k="Rotacionada" v={pecaSel.p.rotacionada ? "Sim" : "Não"} />
                    <Linha k="Status colisão" v={statusColisao} />
                    <Linha k="Distância mínima" v={`${cfgMargem.distanciaMinima} mm`} />
                    <Linha k="Margem da borda" v={`${cfgMargem.margemBorda} mm`} />
                    {bloquedoEssa && (
                      <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive">
                        Movimento bloqueado: {bloquedoEssa.motivo === "distancia_minima"
                          ? "distância mínima não respeitada."
                          : bloquedoEssa.motivo === "margem_borda"
                            ? "margem mínima da borda não respeitada."
                            : bloquedoEssa.motivo === "colisao"
                              ? "colisão com outra peça."
                              : "peça fora da chapa."}
                      </div>
                    )}
                  </aside>
                );
              })()}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Linha({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-border/40 py-1">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-surface p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

function ChapaSvg({
  chapa, numero, aprovChapa, onPecaMouseDown, selecionadaId, colisaoIds, proximidadeIds,
  modoEdicao, mostrarAreaUtil, margemBorda,
}: {
  chapa: ChapaJson;
  numero: number;
  aprovChapa: number;
  onPecaMouseDown: (e: React.MouseEvent<SVGGElement>, p: PecaJson) => void;
  selecionadaId: string | null;
  colisaoIds: Set<string>;
  proximidadeIds: Set<string>;
  modoEdicao: boolean;
  mostrarAreaUtil: boolean;
  margemBorda: number;
}) {
  const { largura, altura, espessura, nome } = chapa.chapa;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium">
          Chapa {numero} · {nome} · {largura} × {altura} × {espessura} mm
        </span>
        <span className="text-muted-foreground">
          {chapa.pecas.length} peça(s) · {Math.round(aprovChapa * 100)}% aprov.
        </span>
      </div>
      <div className="overflow-hidden rounded border-2 border-[#8a7a55] bg-[#f6efe0]">
        <svg
          viewBox={`0 0 ${largura} ${altura}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-auto w-full select-none"
        >
          <rect x={0} y={0} width={largura} height={altura} fill="#f6efe0" />
          {mostrarAreaUtil && margemBorda > 0 && (
            <rect
              x={margemBorda} y={margemBorda}
              width={Math.max(0, largura - margemBorda * 2)}
              height={Math.max(0, altura - margemBorda * 2)}
              fill="none" stroke="#8a7a55" strokeWidth={1.5}
              strokeDasharray="14 10"
              pointerEvents="none"
            />
          )}
          {chapa.pecas.map((p) => {
            const menorDim = Math.min(p.largura, p.altura);
            const fontCentro = Math.max(18, Math.min(menorDim * 0.12, 80));
            const fontLado = Math.max(14, Math.min(menorDim * 0.08, 56));
            const cx = p.x + p.largura / 2;
            const cy = p.y + p.altura / 2;
            const codigoRaw = p.codigo || p.descricao || "—";
            const limiteCaracteres = Math.max(6, Math.floor(p.largura / (fontCentro * 0.6)));
            const codigo = abreviar(codigoRaw, limiteCaracteres);
            const labelLargura = `L: ${Math.round(p.largura)} mm`;
            const labelAltura = `A: ${Math.round(p.altura)} mm`;
            const indexLabel = p.quantidade_index != null ? `#${p.quantidade_index}` : "";
            const selecionada = selecionadaId === p.id;
            const colide = colisaoIds.has(p.id);
            const proxima = proximidadeIds.has(p.id);
            const stroke = colide
              ? "#dc2626"
              : proxima
                ? "#f59e0b"
                : selecionada
                  ? "#2563eb"
                  : "#3b6e8f";
            const strokeW = colide || selecionada || proxima ? 4 : 2;
            const fill = colide ? "#fee2e2" : proxima ? "#fef3c7" : "#ffffff";

            return (
              <g
                key={p.id}
                onMouseDown={(e) => onPecaMouseDown(e, p)}
                style={{ cursor: modoEdicao ? "move" : "pointer" }}
              >
                <title>
                  {`${codigoRaw}\n${Math.round(p.largura)} × ${Math.round(p.altura)} mm${p.espessura ? ` × ${p.espessura}` : ""}`}
                </title>
                <rect
                  x={p.x} y={p.y} width={p.largura} height={p.altura}
                  fill={fill} stroke={stroke} strokeWidth={strokeW}
                />
                {indexLabel && (
                  <text
                    x={p.x + fontLado * 0.4}
                    y={p.y + fontLado * 1.1}
                    fontSize={fontLado * 0.85}
                    fill="#6b7280" fontFamily="monospace"
                  >{indexLabel}</text>
                )}
                <text
                  x={cx} y={cy}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={fontCentro} fontWeight={700} fill="#1f2937"
                  fontFamily="monospace"
                >{codigo}</text>
                <text
                  x={cx}
                  y={p.y + p.altura - fontLado * 0.6}
                  textAnchor="middle"
                  fontSize={fontLado} fill="#374151" fontFamily="monospace"
                >{labelLargura}</text>
                <text
                  x={p.x + p.largura - fontLado * 0.6}
                  y={cy}
                  textAnchor="middle"
                  fontSize={fontLado} fill="#374151" fontFamily="monospace"
                  transform={`rotate(90 ${p.x + p.largura - fontLado * 0.6} ${cy})`}
                >{labelAltura}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
