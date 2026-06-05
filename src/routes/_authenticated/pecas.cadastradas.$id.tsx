import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Plus, Save, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";
import { ehDivisoria, FACE_LABELS } from "@/lib/pecas-cadastradas-parser";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const Route = createFileRoute("/_authenticated/pecas/cadastradas/$id")({
  head: () => ({ meta: [{ title: "Peça cadastrada — detalhe" }] }),
  component: PecaCadastradaDetalhe,
});

type Peca = {
  id: string;
  codigo_completo: string;
  prefixo: string | null;
  nome_peca: string | null;
  tipo_peca: string | null;
  modulo_origem: string | null;
  largura_ref: number | null;
  altura_ref: number | null;
  espessura_ref: number | null;
  material_ref: string | null;
  fita_ref: string | null;
  pdf_url: string | null;
  pdf_nome_arquivo: string | null;
  status_parser: string;
  motivo_status: string | null;
  erros_parser: string[];
  parser_alertas_json: string[] | null;
  resumo_parser_json: Record<string, unknown> | null;
  dados_brutos_json: Record<string, unknown> | null;
  logs_parser: string[];
};

type PontoUsinagem = {
  x: number | null;
  y: number | null;
  profundidade: number | null;
  tipo?: string | null;
  ordem: number;
};

type Operacao = {
  id: string;
  tipo_operacao: string;
  nome_operacao: string | null;
  face: string | number | null;
  x: number | null;
  y: number | null;
  diametro: number | null;
  profundidade: number | null;
  largura: number | null;
  comprimento: number | null;
  x1: number | null;
  x2: number | null;
  y1: number | null;
  y2: number | null;
  ancora_x: string | null;
  ancora_y: string | null;
  offset_x: number | null;
  offset_y: number | null;
  pontos_json: PontoUsinagem[] | null;
  confianca_parser: string;
  ordem: number;
};

type Borda = {
  id: string;
  lado: string;
  codigo_borda: string | null;
  descricao_borda: string | null;
  espessura: number | null;
  largura: number | null;
  cor: string | null;
};

const TIPOS_OP = ["furo", "rasgo", "rebaixo", "usinagem_parametrica", "contorno", "usinagem", "outro"];
const LADOS = ["superior", "inferior", "esquerda", "direita", "frente", "traseira", "desconhecido"];

function PecaCadastradaDetalhe() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [mostrarPdf, setMostrarPdf] = useState(false);

  const peca = useQuery({
    queryKey: ["peca-cadastrada", id],
    queryFn: async () => {
      const { data, error } = await db.from("pecas_cadastradas").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Peca;
    },
  });

  const ops = useQuery({
    queryKey: ["peca-cadastrada-ops", id],
    queryFn: async () => {
      const { data, error } = await db
        .from("peca_cadastrada_operacoes")
        .select("*")
        .eq("peca_cadastrada_id", id)
        .order("face")
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as Operacao[];
    },
  });

  const bordas = useQuery({
    queryKey: ["peca-cadastrada-bordas", id],
    queryFn: async () => {
      const { data, error } = await db
        .from("peca_cadastrada_bordas")
        .select("*")
        .eq("peca_cadastrada_id", id);
      if (error) throw error;
      return (data ?? []) as Borda[];
    },
  });

  useEffect(() => {
    if (!peca.data?.pdf_url) return;
    let cancel = false;
    supabase.storage
      .from("pecas-cadastradas")
      .createSignedUrl(peca.data.pdf_url, 3600)
      .then(({ data }) => {
        if (!cancel) setPdfUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancel = true;
    };
  }, [peca.data?.pdf_url]);

  const ehDiv = ehDivisoria(peca.data?.prefixo);

  // Agrupar ops por face
  const opsPorFace = new Map<string, Operacao[]>();
  for (const o of ops.data ?? []) {
    const k = o.face == null ? "—" : String(o.face);
    if (!opsPorFace.has(k)) opsPorFace.set(k, []);
    opsPorFace.get(k)!.push(o);
  }
  const facesOrdenadas = Array.from(opsPorFace.keys()).sort();

  const salvarOp = useMutation({
    mutationFn: async (o: Operacao) => {
      const { error } = await db
        .from("peca_cadastrada_operacoes")
        .update({
          tipo: o.tipo_operacao,
          tipo_operacao: o.tipo_operacao,
          nome_operacao: o.nome_operacao,
          face: Number(o.face ?? 0),
          x: o.x,
          y: o.y,
          diametro: o.diametro,
          profundidade: o.profundidade,
          largura: o.largura,
          comprimento: o.comprimento,
          x1: o.x1,
          x2: o.x2,
          y1: o.y1,
          y2: o.y2,
          ancora_x: o.ancora_x,
          ancora_y: o.ancora_y,
          offset_x: o.offset_x,
          offset_y: o.offset_y,
          pontos_json: o.pontos_json ?? [],
        })
        .eq("id", o.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Operação atualizada");
      qc.invalidateQueries({ queryKey: ["peca-cadastrada-ops", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const apagarOp = useMutation({
    mutationFn: async (opId: string) => {
      const { error } = await db.from("peca_cadastrada_operacoes").delete().eq("id", opId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["peca-cadastrada-ops", id] }),
  });

  const novaOp = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await db.from("peca_cadastrada_operacoes").insert({
        user_id: u.user!.id,
        peca_cadastrada_id: id,
        tipo: "furo",
        tipo_operacao: "furo",
        face: 0,
        x: 0,
        y: 0,
        diametro: 8,
        profundidade: 12,
        ordem: (ops.data?.length ?? 0) + 1,
        confianca_parser: "alta",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["peca-cadastrada-ops", id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarBorda = useMutation({
    mutationFn: async (b: Borda) => {
      const { error } = await db
        .from("peca_cadastrada_bordas")
        .update({
          lado: b.lado,
          codigo_borda: b.codigo_borda,
          descricao_borda: b.descricao_borda,
          espessura: b.espessura,
          largura: b.largura,
          cor: b.cor,
        })
        .eq("id", b.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Borda atualizada");
      qc.invalidateQueries({ queryKey: ["peca-cadastrada-bordas", id] });
    },
  });

  const apagarBorda = useMutation({
    mutationFn: async (bid: string) => {
      const { error } = await db.from("peca_cadastrada_bordas").delete().eq("id", bid);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["peca-cadastrada-bordas", id] }),
  });

  const novaBorda = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await db.from("peca_cadastrada_bordas").insert({
        user_id: u.user!.id,
        peca_cadastrada_id: id,
        lado: "desconhecido",
        confianca_parser: "alta",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["peca-cadastrada-bordas", id] }),
  });

  if (peca.isLoading) return <div className="p-6">Carregando...</div>;
  if (!peca.data) return <div className="p-6">Peça não encontrada.</div>;
  const p = peca.data;

  return (
    <div className="p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/pecas/cadastradas">← Biblioteca</Link>
            </Button>
            {ehDiv && <Badge>Divisória</Badge>}
            <StatusBadgeDetalhe status={p.status_parser} motivo={p.motivo_status} />
          </div>
          {p.motivo_status && (
            <p className="mt-1 text-xs text-muted-foreground">{p.motivo_status}</p>
          )}
          <h1 className="mt-1 font-mono text-2xl font-semibold">{p.codigo_completo}</h1>
          <p className="text-sm text-muted-foreground">
            {p.nome_peca ?? "—"} {p.modulo_origem ? `• módulo ${p.modulo_origem}` : ""}
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Ref: {p.largura_ref ?? "—"} × {p.altura_ref ?? "—"} × {p.espessura_ref ?? "—"} mm
            {p.material_ref ? ` • ${p.material_ref}` : ""}
          </p>
        </div>
      </header>

      <MarcadoresDesenho dados={p.dados_brutos_json} />

      {p.erros_parser?.length > 0 && (
        <div className="mb-4 rounded border border-destructive/50 bg-destructive/5 p-3 text-sm">
          <div className="mb-1 flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" /> Erros do parser
          </div>
          <ul className="ml-5 list-disc text-muted-foreground">
            {p.erros_parser.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {Array.isArray(p.parser_alertas_json) && p.parser_alertas_json.length > 0 && (
        <div className="mb-4 rounded border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <div className="mb-1 flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" /> Alertas do parser
          </div>
          <ul className="ml-5 list-disc text-muted-foreground">
            {p.parser_alertas_json.map((a, i) => <li key={i}>{String(a)}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        {/* PDF */}
        <div className="rounded border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border p-2 text-sm">
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4" /> {p.pdf_nome_arquivo ?? "PDF original"}
            </span>
            {pdfUrl && (
              <Button asChild size="sm" variant="ghost">
                <a href={pdfUrl} target="_blank" rel="noreferrer">
                  Abrir
                </a>
              </Button>
            )}
          </div>
          <div className="h-[600px] bg-surface-2">
            {pdfUrl ? (
              mostrarPdf ? (
                <iframe src={pdfUrl} className="h-full w-full" title="PDF" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-8 w-8 opacity-50" />
                  <span>PDF carregado sob demanda para acelerar a abertura.</span>
                  <Button size="sm" variant="outline" onClick={() => setMostrarPdf(true)}>
                    Carregar PDF aqui
                  </Button>
                  <a href={pdfUrl} target="_blank" rel="noreferrer" className="text-xs underline">
                    ou abrir em nova aba
                  </a>
                </div>
              )
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Sem PDF
              </div>
            )}
          </div>
        </div>

        {/* Operações + Bordas */}
        <div className="space-y-4">
          <EngenhariaResumo ops={ops.data ?? []} bordas={bordas.data ?? []} />

          <div className="rounded border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border p-2">
              <h2 className="text-sm font-semibold">
                Engenharia fixa — operações ({ops.data?.length ?? 0})
              </h2>
              <Button size="sm" variant="outline" onClick={() => novaOp.mutate()}>
                <Plus className="mr-1 h-3 w-3" /> Adicionar
              </Button>
            </div>
            <div className="max-h-[600px] overflow-auto p-2">
              {facesOrdenadas.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Nenhuma operação detectada.
                </div>
              )}
              {facesOrdenadas.map((face) => {
                const opsFace = opsPorFace.get(face)!;
                const furos = opsFace.filter((o) => o.tipo_operacao === "furo");
                const rasgos = opsFace.filter((o) => o.tipo_operacao === "rasgo");
                const usinagens = opsFace.filter(
                  (o) =>
                    o.tipo_operacao === "usinagem_parametrica" ||
                    o.tipo_operacao === "contorno" ||
                    o.tipo_operacao === "usinagem",
                );
                const outras = opsFace.filter(
                  (o) =>
                    !["furo", "rasgo", "usinagem_parametrica", "contorno", "usinagem"].includes(
                      o.tipo_operacao,
                    ),
                );
                return (
                  <div key={face} className="mb-4">
                    <div className="mb-2 flex items-center gap-2 border-b border-border pb-1 text-xs uppercase tracking-wider text-muted-foreground">
                      <strong className="text-foreground">Face {face}</strong>
                      <span className="text-[10px]">({opsFace.length} op.)</span>
                    </div>


                    {furos.length > 0 && (
                      <SecaoOps
                        titulo="Furações"
                        count={furos.length}
                        ops={furos}
                        salvar={salvarOp.mutate}
                        apagar={apagarOp.mutate}
                      />
                    )}
                    {rasgos.length > 0 && (
                      <SecaoOps
                        titulo="Rasgos"
                        count={rasgos.length}
                        ops={rasgos}
                        salvar={salvarOp.mutate}
                        apagar={apagarOp.mutate}
                      />
                    )}
                    {usinagens.length > 0 && (
                      <SecaoOps
                        titulo="Usinagens / Contornos"
                        count={usinagens.length}
                        ops={usinagens}
                        salvar={salvarOp.mutate}
                        apagar={apagarOp.mutate}
                      />
                    )}
                    {outras.length > 0 && (
                      <SecaoOps
                        titulo="Outras"
                        count={outras.length}
                        ops={outras}
                        salvar={salvarOp.mutate}
                        apagar={apagarOp.mutate}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>


          <div className="rounded border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border p-2">
              <h2 className="text-sm font-semibold">Fita de borda ({bordas.data?.length ?? 0})</h2>
              <Button size="sm" variant="outline" onClick={() => novaBorda.mutate()}>
                <Plus className="mr-1 h-3 w-3" /> Adicionar
              </Button>
            </div>
            <div className="space-y-1 p-2">
              {(bordas.data ?? []).map((b) => (
                <BordaRow
                  key={b.id}
                  borda={b}
                  onSave={(u) => salvarBorda.mutate(u)}
                  onDelete={() => apagarBorda.mutate(b.id)}
                />
              ))}
              {!bordas.data?.length && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Nenhuma fita detectada.
                </div>
              )}
            </div>
          </div>

          {p.logs_parser?.length > 0 && (
            <details className="rounded border border-border bg-surface p-2">
              <summary className="cursor-pointer text-xs font-medium">
                Logs de leitura ({p.logs_parser.length})
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto bg-surface-2 p-2 text-[10px] text-muted-foreground">
                {p.logs_parser.join("\n")}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function OpRow({
  op,
  onSave,
  onDelete,
}: {
  op: Operacao;
  onSave: (o: Operacao) => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState(op);
  useEffect(() => setLocal(op), [op]);
  const dirty = JSON.stringify(local) !== JSON.stringify(op);
  return (
    <div className="rounded bg-surface-2 p-1 text-xs">
      <div className="grid grid-cols-[90px_70px_repeat(4,1fr)_auto_auto] items-center gap-1">
        <Select value={local.tipo_operacao} onValueChange={(v) => setLocal({ ...local, tipo_operacao: v })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{TIPOS_OP.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(local.face ?? "0")} onValueChange={(v) => setLocal({ ...local, face: v })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.keys(FACE_LABELS).map((f) => (
              <SelectItem key={f} value={f}>Face {f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <NumCell label="X" v={local.x} on={(v) => setLocal({ ...local, x: v })} />
        <NumCell label="Y" v={local.y} on={(v) => setLocal({ ...local, y: v })} />
        <NumCell label="Ø" v={local.diametro} on={(v) => setLocal({ ...local, diametro: v })} />
        <NumCell label="P" v={local.profundidade} on={(v) => setLocal({ ...local, profundidade: v })} />
        <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => onSave(local)} className="h-7 w-7 p-0">
          <Save className="h-3 w-3" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0 text-destructive">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      {local.nome_operacao && (
        <div className="mt-1 px-1 text-[10px] font-semibold text-foreground">{local.nome_operacao}</div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 px-1 text-[10px] text-muted-foreground">
        {local.largura != null && <span>L: {local.largura}</span>}
        {local.comprimento != null && <span>C: {local.comprimento}</span>}
        {local.x1 != null && <span>X1: {local.x1}</span>}
        {local.x2 != null && <span>X2: {local.x2}</span>}
        {local.ancora_x && <span>↔ {local.ancora_x}{local.offset_x != null ? ` (${local.offset_x})` : ""}</span>}
        {local.ancora_y && <span>↕ {local.ancora_y}{local.offset_y != null ? ` (${local.offset_y})` : ""}</span>}
        <span>conf: {local.confianca_parser}</span>
      </div>
      {Array.isArray(local.pontos_json) && local.pontos_json.length > 0 && (
        <div className="mt-1 rounded bg-surface p-1.5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Pontos ({local.pontos_json.length})
          </div>
          <table className="w-full text-[10px]">
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-1 text-left">#</th>
                <th className="px-1 text-right">X</th>
                <th className="px-1 text-right">Y</th>
                <th className="px-1 text-right">Prof.</th>
                <th className="px-1 text-left">Tipo</th>
              </tr>
            </thead>
            <tbody>
              {local.pontos_json.map((p, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="px-1">{i + 1}</td>
                  <td className="px-1 text-right font-mono">{p.x ?? "—"}</td>
                  <td className="px-1 text-right font-mono">{p.y ?? "—"}</td>
                  <td className="px-1 text-right font-mono">{p.profundidade ?? "—"}</td>
                  <td className="px-1">{p.tipo ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NumCell({ label, v, on }: { label: string; v: number | null; on: (v: number | null) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] text-muted-foreground">{label}</span>
      <Input
        className="h-7 px-1 text-xs"
        type="number"
        value={v ?? ""}
        onChange={(e) => on(e.target.value === "" ? null : Number(e.target.value))}
      />
    </div>
  );
}

function BordaRow({
  borda,
  onSave,
  onDelete,
}: {
  borda: Borda;
  onSave: (b: Borda) => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState(borda);
  useEffect(() => setLocal(borda), [borda]);
  const dirty = JSON.stringify(local) !== JSON.stringify(borda);
  return (
    <div className="rounded bg-surface-2 p-2 text-xs">
      <div className="grid grid-cols-[110px_1fr_auto_auto] items-center gap-2">
        <Select value={local.lado} onValueChange={(v) => setLocal({ ...local, lado: v })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{LADOS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <Input
          className="h-7 text-xs"
          placeholder="Código (FTABS.1.19.100)"
          value={local.codigo_borda ?? ""}
          onChange={(e) => setLocal({ ...local, codigo_borda: e.target.value })}
        />
        <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => onSave(local)} className="h-7 w-7 p-0">
          <Save className="h-3 w-3" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0 text-destructive">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <div className="mt-1 grid grid-cols-4 gap-1">
        <Label className="col-span-4 text-[10px] text-muted-foreground">Descrição</Label>
        <Input
          className="col-span-4 h-7 text-xs"
          value={local.descricao_borda ?? ""}
          onChange={(e) => setLocal({ ...local, descricao_borda: e.target.value })}
        />
        <NumCell label="Esp" v={local.espessura} on={(v) => setLocal({ ...local, espessura: v })} />
        <NumCell label="Larg" v={local.largura} on={(v) => setLocal({ ...local, largura: v })} />
        <Input
          className="col-span-2 h-7 text-xs"
          placeholder="Cor"
          value={local.cor ?? ""}
          onChange={(e) => setLocal({ ...local, cor: e.target.value })}
        />
      </div>
    </div>
  );
}

function StatusBadgeDetalhe({ status, motivo }: { status: string; motivo: string | null }) {
  const cls =
    status === "ok" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : status === "com_erros" ? "border-destructive/50 bg-destructive/10 text-destructive"
    : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  const label =
    status === "ok" ? "OK"
    : status === "com_alertas" ? "Com alertas"
    : status === "pendente_revisao" ? "Pendente revisão"
    : status === "com_erros" ? "Com erros"
    : status;
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${cls}`} title={motivo ?? undefined}>
      {label}
    </span>
  );
}

function EngenhariaResumo({ ops, bordas }: { ops: Operacao[]; bordas: Borda[] }) {
  const furos = ops.filter((o) => o.tipo_operacao === "furo").length;
  const rasgos = ops.filter((o) => o.tipo_operacao === "rasgo").length;
  const usinagens = ops.filter(
    (o) =>
      o.tipo_operacao === "usinagem_parametrica" ||
      o.tipo_operacao === "contorno" ||
      o.tipo_operacao === "usinagem",
  ).length;
  const faces = Array.from(new Set(ops.map((o) => String(o.face ?? "—")))).sort();
  return (
    <div className="rounded border border-border bg-surface p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Engenharia fixa da peça
      </h2>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
        <Resumo label="Furos" valor={furos} />
        <Resumo label="Rasgos" valor={rasgos} />
        <Resumo label="Usinagens" valor={usinagens} />
        <Resumo label="Bordas" valor={bordas.length} />
        <Resumo label="Faces" valor={faces.join(", ") || "—"} />
      </div>
    </div>
  );
}

function Resumo({ label, valor }: { label: string; valor: number | string }) {
  return (
    <div className="rounded bg-surface-2 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-base font-semibold">{valor}</div>
    </div>
  );
}

function SecaoOps({
  titulo,
  count,
  ops,
  salvar,
  apagar,
}: {
  titulo: string;
  count: number;
  ops: Operacao[];
  salvar: (o: Operacao) => void;
  apagar: (id: string) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
        <span>{titulo} ({count})</span>
      </div>
      <div className="space-y-1">
        {ops.map((o) => (
          <OpRow key={o.id} op={o} onSave={salvar} onDelete={() => apagar(o.id)} />
        ))}
      </div>
    </div>
  );
}

function MarcadoresDesenho({ dados }: { dados: Record<string, unknown> | null }) {
  if (!dados) return null;
  const faceAlinhamento = (dados.face_alinhamento as string | null) ?? null;
  const faceAlinhamentoRegiao = (dados.face_alinhamento_regiao as string | null) ?? null;
  const indicadores = Array.isArray(dados.indicadores_borda)
    ? (dados.indicadores_borda as string[])
    : [];
  const facesDetectadas = Array.isArray(dados.faces_detectadas)
    ? (dados.faces_detectadas as string[])
    : [];
  const facePrincipal = (dados.face_principal_visual as string | null) ?? null;

  if (!faceAlinhamento && indicadores.length === 0 && facesDetectadas.length === 0 && !facePrincipal) {
    return null;
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded border border-border bg-surface p-2 text-xs">
      <span className="font-semibold text-muted-foreground">Marcadores do desenho:</span>
      {faceAlinhamento && (
        <Badge variant="outline" className="font-mono">
          Face de alinhamento: {faceAlinhamento}
          {faceAlinhamentoRegiao && faceAlinhamentoRegiao !== "desconhecida"
            ? ` • ${faceAlinhamentoRegiao}`
            : ""}
        </Badge>
      )}
      {facePrincipal && (
        <Badge variant="outline" className="font-mono">
          Face principal: {facePrincipal}
        </Badge>
      )}
      {facesDetectadas.length > 0 && (
        <Badge variant="outline" className="font-mono">
          Faces detectadas: {facesDetectadas.join(", ")}
        </Badge>
      )}
      {indicadores.map((m) => (
        <Badge key={m} variant="secondary" className="font-mono">
          {m}
        </Badge>
      ))}
    </div>
  );
}
