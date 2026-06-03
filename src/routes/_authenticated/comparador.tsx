import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Play, Save, Settings, Printer, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { analisar, comandosNormalizados, diferencaConjuntos, diffLinhas } from "@/lib/gcode-diff";
import { gerarSugestoes, type Tolerancia } from "@/lib/gcode-suggest";
import { z } from "zod";

const SearchSchema = z.object({
  projeto_id: z.string().optional(),
  peca_id: z.string().optional(),
  cmp_id: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/comparador")({
  head: () => ({ meta: [{ title: "Comparador CNC — Visualizador CNC" }] }),
  validateSearch: SearchSchema,
  component: ComparadorPage,
});

type ArqOriginal = { id: string; nome_arquivo: string; storage_url: string | null; peca_id: string | null };
type PreviewSys = { id: string; nome_arquivo: string; conteudo: string; peca_id: string };

function ComparadorPage() {
  const qc = useQueryClient();
  const search = useSearch({ from: "/_authenticated/comparador" });

  const [projetoId, setProjetoId] = useState<string>(search.projeto_id ?? "");
  const [pecaId, setPecaId] = useState<string>(search.peca_id ?? "");
  const [arqOrigId, setArqOrigId] = useState<string>("");
  const [prevId, setPrevId] = useState<string>("");
  const [original, setOriginal] = useState("");
  const [gerado, setGerado] = useState("");
  const [tol, setTol] = useState<Tolerancia>({ xy: 0.5, z: 0.5, feed: 50, rpm: 500 });
  const [observacoes, setObservacoes] = useState("");
  const [status, setStatus] = useState("pendente");
  const [aba, setAba] = useState<"diff" | "resumo" | "sugestoes">("diff");
  const [cmpId, setCmpId] = useState<string | null>(search.cmp_id ?? null);

  const projetos = useQuery({
    queryKey: ["cmp", "projetos"],
    queryFn: async () => {
      const { data } = await supabase.from("projetos").select("id, nome, cliente").order("created_at", { ascending: false });
      return (data ?? []) as Array<{ id: string; nome: string; cliente: string | null }>;
    },
  });

  const pecas = useQuery({
    queryKey: ["cmp", "pecas", projetoId],
    enabled: !!projetoId,
    queryFn: async () => {
      const { data } = await supabase
        .from("projeto_pecas").select("id, descricao, observacao").eq("projeto_id", projetoId);
      return (data ?? []) as Array<{ id: string; descricao: string; observacao: string | null }>;
    },
  });

  const arqOriginais = useQuery({
    queryKey: ["cmp", "arq-original", projetoId, pecaId],
    enabled: !!projetoId,
    queryFn: async () => {
      const q = supabase
        .from("arquivos_tecnicos")
        .select("id, nome_arquivo, storage_url, peca_id")
        .eq("projeto_id", projetoId)
        .in("tipo_arquivo", ["nc_gcode", "parts_nc", "profile_nc"]);
      const { data } = await q;
      return (data ?? []) as ArqOriginal[];
    },
  });

  const previews = useQuery({
    queryKey: ["cmp", "previews", pecaId],
    enabled: !!pecaId,
    queryFn: async () => {
      const { data } = await supabase
        .from("previews_cnc").select("id, nome_arquivo, conteudo, peca_id").eq("peca_id", pecaId)
        .order("created_at", { ascending: false });
      return (data ?? []) as PreviewSys[];
    },
  });

  const cmpExistente = useQuery({
    queryKey: ["cmp", "existente", cmpId],
    enabled: !!cmpId,
    queryFn: async () => {
      const { data } = await supabase.from("comparacoes_cnc").select("*").eq("id", cmpId!).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    const c = cmpExistente.data;
    if (!c) return;
    setProjetoId(c.projeto_id ?? "");
    setPecaId(c.peca_id ?? "");
    setArqOrigId(c.arquivo_original_id ?? "");
    setPrevId(c.preview_cnc_id ?? "");
    setObservacoes(c.observacoes ?? "");
    setStatus(c.status ?? "pendente");
    if (c.tolerancias_json) setTol(c.tolerancias_json as Tolerancia);
  }, [cmpExistente.data]);

  // Carregar conteúdo do original quando muda
  useEffect(() => {
    (async () => {
      const arq = arqOriginais.data?.find((a) => a.id === arqOrigId);
      if (!arq?.storage_url) { setOriginal(""); return; }
      const { data } = await supabase.storage.from("importacoes").download(arq.storage_url);
      if (data) setOriginal(await data.text());
    })();
  }, [arqOrigId, arqOriginais.data]);

  // Carregar conteúdo do preview gerado
  useEffect(() => {
    const p = previews.data?.find((x) => x.id === prevId);
    setGerado(p?.conteudo ?? "");
  }, [prevId, previews.data]);

  const podeComparar = !!original && !!gerado;

  const linhas = useMemo(() => podeComparar ? diffLinhas(gerado, original) : [], [gerado, original, podeComparar]);
  const resumoG = useMemo(() => analisar(gerado), [gerado]);
  const resumoO = useMemo(() => analisar(original), [original]);
  const setG = useMemo(() => comandosNormalizados(gerado), [gerado]);
  const setO = useMemo(() => comandosNormalizados(original), [original]);
  const soOri = useMemo(() => diferencaConjuntos(setO, setG), [setO, setG]);
  const soGer = useMemo(() => diferencaConjuntos(setG, setO), [setG, setO]);
  const sugestoes = useMemo(() => podeComparar ? gerarSugestoes(original, gerado) : [], [original, gerado, podeComparar]);

  const totalDif = linhas.filter((l) => l.tipo !== "igual").length;

  const salvar = useMutation({
    mutationFn: async () => {
      const payload = {
        projeto_id: projetoId || null,
        peca_id: pecaId || null,
        arquivo_original_id: arqOrigId || null,
        preview_cnc_id: prevId || null,
        status,
        observacoes,
        tolerancias_json: tol,
        resumo_json: { original: resumoO, gerado: resumoG, total_linhas_dif: totalDif },
        diferencas_json: { so_original: soOri, so_gerado: soGer, total_dif: totalDif },
        sugestoes_json: sugestoes,
        atualizado_em: new Date().toISOString(),
      };
      if (cmpId) {
        const { error } = await supabase.from("comparacoes_cnc").update(payload).eq("id", cmpId);
        if (error) throw error;
        return cmpId;
      } else {
        const { data, error } = await supabase.from("comparacoes_cnc").insert(payload).select("id").single();
        if (error) throw error;
        setCmpId(data.id);
        return data.id;
      }
    },
    onSuccess: () => {
      toast.success("Comparação salva");
      qc.invalidateQueries({ queryKey: ["comparacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border-strong bg-panel px-4 py-3">
        <Button variant="ghost" size="sm" asChild><Link to="/"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Comparador CNC</h1>
          <p className="text-xs text-muted-foreground">
            Compare o G-code original importado com a prévia gerada pelo sistema para calibrar o pós-processador.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-1 h-3 w-3" /> Imprimir</Button>
        <Button variant="outline" size="sm" asChild><Link to="/maquina"><Settings className="mr-1 h-3 w-3" /> Pós-processador</Link></Button>
        <Button size="sm" onClick={() => salvar.mutate()} disabled={!podeComparar}>
          <Save className="mr-1 h-3 w-3" /> Salvar
        </Button>
      </header>

      <div className="grid grid-cols-5 gap-3 border-b border-border bg-surface p-3 text-xs">
        <Sel label="Projeto" value={projetoId} onChange={(v) => { setProjetoId(v); setPecaId(""); setArqOrigId(""); setPrevId(""); }}
          options={[["", "—"], ...(projetos.data ?? []).map((p) => [p.id, p.nome] as [string, string])]} />
        <Sel label="Peça" value={pecaId} onChange={(v) => { setPecaId(v); setPrevId(""); }}
          options={[["", "—"], ...(pecas.data ?? []).map((p) => [p.id, p.descricao] as [string, string])]} />
        <Sel label="Arquivo NC original" value={arqOrigId} onChange={setArqOrigId}
          options={[["", "—"], ...(arqOriginais.data ?? []).map((a) => [a.id, a.nome_arquivo] as [string, string])]} />
        <Sel label="Prévia gerada" value={prevId} onChange={setPrevId}
          options={[["", "—"], ...(previews.data ?? []).map((p) => [p.id, `${p.nome_arquivo}`] as [string, string])]} />
        <div>
          <Label className="text-[10px]">Status</Label>
          <select className="h-8 w-full rounded border border-border bg-surface px-2 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pendente">Pendente</option>
            <option value="comparado">Comparado</option>
            <option value="aprovado">Aprovado</option>
            <option value="precisa_ajuste">Precisa ajuste</option>
            <option value="rejeitado">Rejeitado</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 border-b border-border bg-surface px-3 py-2 text-xs">
        <TolField label="Tolerância XY (mm)" v={tol.xy} on={(v) => setTol({ ...tol, xy: v })} />
        <TolField label="Tolerância Z (mm)" v={tol.z} on={(v) => setTol({ ...tol, z: v })} />
        <TolField label="Tolerância Avanço (F)" v={tol.feed} on={(v) => setTol({ ...tol, feed: v })} />
        <TolField label="Tolerância Rotação (S)" v={tol.rpm} on={(v) => setTol({ ...tol, rpm: v })} />
      </div>

      {!podeComparar && (
        <div className="m-4 rounded border border-dashed border-border bg-surface p-6 text-center text-sm text-muted-foreground">
          Selecione um arquivo NC original e uma prévia gerada para iniciar a comparação.
        </div>
      )}

      {podeComparar && (
        <>
          <nav className="flex gap-1 border-b border-border bg-panel px-3">
            {([["diff", `Diff (${totalDif})`], ["resumo", "Resumo"], ["sugestoes", `Sugestões (${sugestoes.length})`]] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setAba(k)}
                className={`border-b-2 px-3 py-2 text-xs ${aba === k ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>
                {lbl}
              </button>
            ))}
            <div className="ml-auto py-1 text-[11px] text-muted-foreground">
              <Badge variant="outline">verde=igual</Badge>{" "}
              <Badge variant="outline" className="bg-warning/15">amarelo=dif</Badge>{" "}
              <Badge variant="outline" className="bg-destructive/15">vermelho=ausente</Badge>{" "}
              <Badge variant="outline" className="bg-success/15">azul=extra</Badge>
            </div>
          </nav>

          {aba === "diff" && (
            <div className="grid flex-1 grid-cols-2 overflow-auto bg-surface font-mono text-xs">
              <div className="border-r border-border">
                <div className="sticky top-0 z-10 border-b border-border bg-panel px-3 py-1.5 text-[11px] font-semibold uppercase">Gerado pelo sistema</div>
                <ul>
                  {linhas.map((l) => (
                    <li key={`g${l.num}`} className={corLinha(l.tipo, "esq")}>
                      <span className="inline-block w-10 select-none pr-2 text-right text-muted-foreground">{l.num}</span>
                      <span className="whitespace-pre">{l.esquerda ?? ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="sticky top-0 z-10 border-b border-border bg-panel px-3 py-1.5 text-[11px] font-semibold uppercase">Original importado</div>
                <ul>
                  {linhas.map((l) => (
                    <li key={`o${l.num}`} className={corLinha(l.tipo, "dir")}>
                      <span className="inline-block w-10 select-none pr-2 text-right text-muted-foreground">{l.num}</span>
                      <span className="whitespace-pre">{l.direita ?? ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {aba === "resumo" && (
            <div className="flex-1 overflow-auto p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <ResumoCard titulo="Original" r={resumoO} />
                <ResumoCard titulo="Gerado" r={resumoG} />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Card titulo={`No ORIGINAL e ausente no GERADO (${soOri.length})`} cor="warning">
                  <ListaFonte itens={soOri} />
                </Card>
                <Card titulo={`No GERADO e ausente no ORIGINAL (${soGer.length})`} cor="info">
                  <ListaFonte itens={soGer} />
                </Card>
              </div>
              <div className="mt-3">
                <Label className="text-xs">Observações</Label>
                <Textarea rows={4} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
              </div>
            </div>
          )}

          {aba === "sugestoes" && (
            <div className="flex-1 overflow-auto p-4 space-y-2">
              {sugestoes.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma sugestão detectada.</p>}
              {sugestoes.map((s, i) => (
                <div key={i} className={`rounded border-l-4 bg-surface p-3 ${
                  s.severidade === "erro" ? "border-destructive" : s.severidade === "warning" ? "border-warning" : "border-primary"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{s.categoria}</span>
                    <Badge variant="outline" className="text-[10px]">{s.severidade}</Badge>
                  </div>
                  <p className="mt-1 text-sm">{s.descricao}</p>
                  {(s.exemplo_original || s.exemplo_gerado) && (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="rounded bg-warning/10 p-2"><b className="block text-[10px] text-muted-foreground">Original</b>{s.exemplo_original ?? "—"}</div>
                      <div className="rounded bg-success/10 p-2"><b className="block text-[10px] text-muted-foreground">Gerado</b>{s.exemplo_gerado ?? "—"}</div>
                    </div>
                  )}
                </div>
              ))}
              <div className="pt-2">
                <Button asChild size="sm"><Link to="/maquina"><Wand2 className="mr-1 h-3 w-3" /> Abrir pós-processador</Link></Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <div>
      <Label className="text-[10px]">{label}</Label>
      <select className="h-8 w-full truncate rounded border border-border bg-surface px-2 text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function TolField({ label, v, on }: { label: string; v: number; on: (v: number) => void }) {
  return (
    <div>
      <Label className="text-[10px]">{label}</Label>
      <Input type="number" step="0.1" className="h-8" value={v} onChange={(e) => on(parseFloat(e.target.value) || 0)} />
    </div>
  );
}

function corLinha(tipo: string, lado: "esq" | "dir") {
  const base = "block px-3 py-0.5 ";
  if (tipo === "igual") return base + "text-muted-foreground";
  if (tipo === "diferente") return base + "bg-warning/15";
  if (tipo === "so_esquerda") return base + (lado === "esq" ? "bg-success/15" : "bg-muted/30 italic text-muted-foreground");
  return base + (lado === "dir" ? "bg-destructive/15" : "bg-muted/30 italic text-muted-foreground");
}

function ResumoCard({ titulo, r }: { titulo: string; r: ReturnType<typeof analisar> }) {
  const fmt = (v: [number, number] | null) => v ? `${v[0].toFixed(2)} → ${v[1].toFixed(2)}` : "—";
  return (
    <div className="rounded border border-border bg-surface p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</h3>
      <dl className="grid grid-cols-[120px_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Linhas</dt><dd>{r.totalLinhas}</dd>
        <dt className="text-muted-foreground">Ferramentas</dt><dd className="font-mono">{r.ferramentas.join(", ") || "—"}</dd>
        <dt className="text-muted-foreground">Range X</dt><dd className="font-mono">{fmt(r.rangeX)}</dd>
        <dt className="text-muted-foreground">Range Y</dt><dd className="font-mono">{fmt(r.rangeY)}</dd>
        <dt className="text-muted-foreground">Range Z</dt><dd className="font-mono">{fmt(r.rangeZ)}</dd>
        <dt className="text-muted-foreground">Avanços</dt><dd className="font-mono">{r.feeds.join(", ") || "—"}</dd>
        <dt className="text-muted-foreground">Rotações</dt><dd className="font-mono">{r.rpms.join(", ") || "—"}</dd>
        <dt className="text-muted-foreground">G usados</dt><dd className="font-mono">{Object.keys(r.comandosG).sort().join(" ") || "—"}</dd>
        <dt className="text-muted-foreground">M usados</dt><dd className="font-mono">{Object.keys(r.comandosM).sort().join(" ") || "—"}</dd>
      </dl>
    </div>
  );
}

function Card({ titulo, cor, children }: { titulo: string; cor: "warning" | "info"; children: React.ReactNode }) {
  return (
    <div className={`rounded border-l-4 ${cor === "warning" ? "border-warning" : "border-primary"} bg-surface p-3`}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</h3>
      {children}
    </div>
  );
}

function ListaFonte({ itens }: { itens: string[] }) {
  if (!itens.length) return <p className="text-xs text-muted-foreground">Nenhum.</p>;
  return <ul className="max-h-48 space-y-0.5 overflow-auto font-mono text-xs">{itens.map((c) => <li key={c}>{c}</li>)}</ul>;
}
