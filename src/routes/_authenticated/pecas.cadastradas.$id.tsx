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
import { ehDivisoria, nomeFace, FACE_LABELS } from "@/lib/pecas-cadastradas-parser";

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
  erros_parser: string[];
  logs_parser: string[];
};

type Operacao = {
  id: string;
  tipo_operacao: string;
  face: string | null;
  x: number | null;
  y: number | null;
  diametro: number | null;
  profundidade: number | null;
  largura: number | null;
  comprimento: number | null;
  x1: number | null;
  x2: number | null;
  ancora_x: string | null;
  ancora_y: string | null;
  offset_x: number | null;
  offset_y: number | null;
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

const TIPOS_OP = ["furo", "rasgo", "rebaixo", "usinagem", "outro"];
const LADOS = ["superior", "inferior", "esquerda", "direita", "frente", "traseira", "desconhecido"];

function PecaCadastradaDetalhe() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

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
    const k = o.face ?? "—";
    if (!opsPorFace.has(k)) opsPorFace.set(k, []);
    opsPorFace.get(k)!.push(o);
  }
  const facesOrdenadas = Array.from(opsPorFace.keys()).sort();

  const salvarOp = useMutation({
    mutationFn: async (o: Operacao) => {
      const { error } = await db
        .from("peca_cadastrada_operacoes")
        .update({
          tipo_operacao: o.tipo_operacao,
          face: o.face,
          x: o.x,
          y: o.y,
          diametro: o.diametro,
          profundidade: o.profundidade,
          largura: o.largura,
          comprimento: o.comprimento,
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
        tipo_operacao: "furo",
        face: ehDiv ? "5" : "0",
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
            <Badge variant="outline">{p.status_parser}</Badge>
          </div>
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

      {p.erros_parser?.length > 0 && (
        <div className="mb-4 rounded border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <div className="mb-1 flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" /> Alertas do parser
          </div>
          <ul className="ml-5 list-disc text-muted-foreground">
            {p.erros_parser.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
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
              <iframe src={pdfUrl} className="h-full w-full" title="PDF" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Sem PDF
              </div>
            )}
          </div>
        </div>

        {/* Operações + Bordas */}
        <div className="space-y-4">
          <div className="rounded border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border p-2">
              <h2 className="text-sm font-semibold">Operações ({ops.data?.length ?? 0})</h2>
              <Button size="sm" variant="outline" onClick={() => novaOp.mutate()}>
                <Plus className="mr-1 h-3 w-3" /> Adicionar
              </Button>
            </div>
            <div className="max-h-[500px] overflow-auto p-2">
              {facesOrdenadas.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Nenhuma operação detectada.
                </div>
              )}
              {facesOrdenadas.map((face) => {
                const alertaFace5 = face === "5" && !ehDiv;
                return (
                  <div key={face} className="mb-3">
                    <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                      <strong>
                        Face {face} — {nomeFace(face)}
                      </strong>
                      <span className="text-[10px]">({opsPorFace.get(face)!.length})</span>
                      {alertaFace5 && (
                        <Badge variant="destructive" className="gap-1 text-[10px]">
                          <AlertTriangle className="h-3 w-3" />
                          Face 5 normalmente é só de Divisória
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1">
                      {opsPorFace.get(face)!.map((o) => (
                        <OpRow
                          key={o.id}
                          op={o}
                          onSave={(updated) => salvarOp.mutate(updated)}
                          onDelete={() => apagarOp.mutate(o.id)}
                        />
                      ))}
                    </div>
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
    <div className="grid grid-cols-[80px_60px_repeat(4,1fr)_auto_auto] items-center gap-1 rounded bg-surface-2 p-1 text-xs">
      <Select value={local.tipo_operacao} onValueChange={(v) => setLocal({ ...local, tipo_operacao: v })}>
        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{TIPOS_OP.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={local.face ?? "0"} onValueChange={(v) => setLocal({ ...local, face: v })}>
        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Object.entries(FACE_LABELS).map(([f, n]) => (
            <SelectItem key={f} value={f}>{f} — {n}</SelectItem>
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
