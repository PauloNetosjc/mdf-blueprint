import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { gerarGCode } from "@/lib/gcode";
import {
  analisar,
  comandosNormalizados,
  diferencaConjuntos,
  diffLinhas,
} from "@/lib/gcode-diff";
import type { Ferramenta, Maquina, Operacao, Peca } from "@/lib/db";
import { ArrowLeft, Upload, Save, FileSearch } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pecas/$id/comparar")({
  head: () => ({ meta: [{ title: "Comparar G-code — Visualizador CNC" }] }),
  component: CompararPagina,
});

const TEMPLATE_FIELDS: { key: keyof Maquina; label: string }[] = [
  { key: "template_inicio", label: "Início de programa" },
  { key: "template_fim", label: "Fim de programa" },
  { key: "template_troca_ferramenta", label: "Troca de ferramenta" },
  { key: "template_spindle_on", label: "Ligar spindle" },
  { key: "template_spindle_off", label: "Desligar spindle" },
  { key: "template_furacao_face", label: "Furação de face (Face 0)" },
  { key: "template_furacao_lateral", label: "Furação lateral/topo (1-4)" },
];

function CompararPagina() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [original, setOriginal] = useState("");
  const [nomeOriginal, setNomeOriginal] = useState<string>("");
  const [templates, setTemplates] = useState<Partial<Record<keyof Maquina, string>>>({});
  const [aba, setAba] = useState<"diff" | "resumo" | "templates">("diff");
  const [filtro, setFiltro] = useState<"todas" | "diferentes">("diferentes");

  const { data } = useQuery({
    queryKey: ["cmp", id],
    queryFn: async () => {
      const [peca, ops, ferr, maq] = await Promise.all([
        supabase.from("pecas").select("*").eq("id", id).single(),
        supabase.from("operacoes").select("*").eq("peca_id", id).order("ordem"),
        supabase.from("ferramentas").select("*"),
        supabase.from("maquinas").select("*").eq("ativa", true).limit(1).maybeSingle(),
      ]);
      return {
        peca: peca.data as Peca,
        operacoes: (ops.data ?? []) as Operacao[],
        ferramentas: (ferr.data ?? []) as Ferramenta[],
        maquina: maq.data as Maquina | null,
      };
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!data?.maquina) throw new Error("Máquina não disponível");
      const patch: Partial<Maquina> = {};
      for (const f of TEMPLATE_FIELDS) {
        const v = templates[f.key];
        if (typeof v === "string" && v !== data.maquina[f.key]) {
          (patch as Record<string, unknown>)[f.key as string] = v;
        }
      }
      if (Object.keys(patch).length === 0) throw new Error("Nenhuma alteração nos templates");
      const { error } = await supabase.from("maquinas").update(patch).eq("id", data.maquina.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cmp", id] });
      qc.invalidateQueries({ queryKey: ["maquina-edit"] });
      qc.invalidateQueries({ queryKey: ["cnc", id] });
      toast.success("Templates do pós-processador atualizados");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Máquina efetiva (com possíveis edições não salvas aplicadas para a prévia gerada)
  const maquinaEfetiva: Maquina | null = useMemo(() => {
    if (!data?.maquina) return null;
    return { ...data.maquina, ...templates } as Maquina;
  }, [data?.maquina, templates]);

  const gerado = useMemo(() => {
    if (!data?.peca || !maquinaEfetiva) return "";
    return gerarGCode(data.peca, data.operacoes, maquinaEfetiva, data.ferramentas).codigo;
  }, [data, maquinaEfetiva]);

  const linhasDiff = useMemo(() => diffLinhas(gerado, original), [gerado, original]);
  const resumoGer = useMemo(() => analisar(gerado), [gerado]);
  const resumoOri = useMemo(() => analisar(original), [original]);
  const setGer = useMemo(() => comandosNormalizados(gerado), [gerado]);
  const setOri = useMemo(() => comandosNormalizados(original), [original]);
  const soOriginal = useMemo(() => diferencaConjuntos(setOri, setGer), [setOri, setGer]);
  const soGerado = useMemo(() => diferencaConjuntos(setGer, setOri), [setGer, setOri]);

  function onUpload(file: File) {
    setNomeOriginal(file.name);
    const reader = new FileReader();
    reader.onload = () => setOriginal(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  if (!data?.peca) return <div className="p-6 text-muted-foreground">Carregando...</div>;
  const { peca, maquina } = data;
  if (!maquina) {
    return (
      <div className="p-6">
        <p className="text-destructive">Cadastre uma máquina ativa antes de comparar.</p>
        <Button asChild className="mt-4"><Link to="/maquina">Ir para Máquina</Link></Button>
      </div>
    );
  }

  const linhasMostradas = filtro === "todas" ? linhasDiff : linhasDiff.filter((l) => l.tipo !== "igual");
  const totalDif = linhasDiff.filter((l) => l.tipo !== "igual").length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/pecas/$id/cnc" params={{ id }}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">
            Comparar G-code — <span className="font-mono">{peca.codigo}</span>
          </h1>
          <div className="text-xs text-muted-foreground">
            Calibre o pós-processador comparando a prévia gerada com um .nc original (Promob/Nesting).
          </div>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent">
          <Upload className="h-4 w-4" />
          {nomeOriginal ? `Trocar (${nomeOriginal})` : "Importar .nc original"}
          <input
            type="file"
            accept=".nc,.gcode,.tap,.cnc,.txt"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
        </label>
        <Button onClick={() => salvar.mutate()} disabled={Object.keys(templates).length === 0}>
          <Save className="mr-2 h-4 w-4" />Salvar templates
        </Button>
      </header>

      {!original && (
        <div className="m-4 rounded border border-dashed border-border bg-surface p-6 text-center text-sm text-muted-foreground">
          <FileSearch className="mx-auto mb-2 h-6 w-6" />
          Importe um arquivo <strong>.nc original</strong> da máquina para iniciar a comparação.
        </div>
      )}

      <nav className="flex gap-1 border-b border-border bg-panel px-4">
        {([
          ["diff", `Diff por linha (${totalDif})`],
          ["resumo", "Resumo técnico"],
          ["templates", "Ajustar templates"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            className={`border-b-2 px-3 py-2 text-xs font-medium ${
              aba === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {aba === "diff" && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2 text-xs">
            <span className="font-semibold">Filtro:</span>
            <label className="flex items-center gap-1">
              <input type="radio" checked={filtro === "diferentes"} onChange={() => setFiltro("diferentes")} />
              Somente diferenças
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={filtro === "todas"} onChange={() => setFiltro("todas")} />
              Todas as linhas
            </label>
            <span className="ml-auto text-muted-foreground">
              Total: {linhasDiff.length} · Diferenças: {totalDif}
            </span>
          </div>
          <div className="grid flex-1 grid-cols-[1fr_1fr] overflow-auto bg-surface font-mono text-xs">
            <div className="border-r border-border">
              <div className="sticky top-0 z-10 border-b border-border bg-panel px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Gerado pelo sistema
              </div>
              <ul>
                {linhasMostradas.map((l) => (
                  <li key={`g-${l.num}`} className={corLinha(l.tipo, "esq")}>
                    <span className="inline-block w-10 select-none pr-2 text-right text-muted-foreground">{l.num}</span>
                    <span className="whitespace-pre">{l.esquerda ?? ""}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="sticky top-0 z-10 border-b border-border bg-panel px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Original importado {nomeOriginal && `· ${nomeOriginal}`}
              </div>
              <ul>
                {linhasMostradas.map((l) => (
                  <li key={`o-${l.num}`} className={corLinha(l.tipo, "dir")}>
                    <span className="inline-block w-10 select-none pr-2 text-right text-muted-foreground">{l.num}</span>
                    <span className="whitespace-pre">{l.direita ?? ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {aba === "resumo" && (
        <div className="flex-1 overflow-auto p-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <ResumoCard titulo="Gerado pelo sistema" r={resumoGer} />
            <ResumoCard titulo={`Original ${nomeOriginal ? `(${nomeOriginal})` : ""}`} r={resumoOri} />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Section titulo={`Presentes no ORIGINAL e ausentes no GERADO (${soOriginal.length})`} cor="warning">
              {soOriginal.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum.</p>
              ) : (
                <ul className="space-y-0.5 font-mono text-xs">
                  {soOriginal.map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}
            </Section>
            <Section titulo={`Presentes no GERADO e ausentes no ORIGINAL (${soGerado.length})`} cor="destructive">
              {soGerado.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum.</p>
              ) : (
                <ul className="space-y-0.5 font-mono text-xs">
                  {soGerado.map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}
            </Section>
          </div>
        </div>
      )}

      {aba === "templates" && (
        <div className="flex-1 overflow-auto p-4">
          <p className="mb-4 text-xs text-muted-foreground">
            Edite os templates do pós-processador com base nas diferenças observadas. As mudanças refletem
            imediatamente na prévia comparada. Clique em <strong>Salvar templates</strong> para persistir.
            Placeholders: <code className="font-mono">{"{X} {Y} {Z} {Z_FINAL} {DEPTH} {FEED} {RPM} {TOOL_CODE} {TOOL_NAME} {TOOL_NUM} {ALTURA_SEGURA} {FACE}"}</code>
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {TEMPLATE_FIELDS.map((f) => {
              const valor = templates[f.key] ?? (maquina[f.key] as string);
              const alterado = templates[f.key] !== undefined && templates[f.key] !== maquina[f.key];
              return (
                <div key={String(f.key)}>
                  <Label className="text-xs">
                    {f.label} {alterado && <span className="ml-1 text-warning">(modificado)</span>}
                  </Label>
                  <Textarea
                    className="font-mono text-xs"
                    rows={5}
                    value={valor}
                    onChange={(e) => setTemplates({ ...templates, [f.key]: e.target.value })}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function corLinha(tipo: "igual" | "diferente" | "so_esquerda" | "so_direita", lado: "esq" | "dir"): string {
  const base = "block px-3 py-0.5 ";
  if (tipo === "igual") return base + "text-muted-foreground";
  if (tipo === "diferente") return base + "bg-warning/15 text-foreground";
  if (tipo === "so_esquerda") return base + (lado === "esq" ? "bg-destructive/15" : "bg-muted/30 text-muted-foreground italic");
  return base + (lado === "dir" ? "bg-success/15" : "bg-muted/30 text-muted-foreground italic");
}

function Section({ titulo, cor, children }: { titulo: string; cor: "warning" | "destructive"; children: React.ReactNode }) {
  const borda = cor === "warning" ? "border-warning" : "border-destructive";
  return (
    <section className={`rounded border-l-4 ${borda} bg-surface p-3`}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  );
}

function ResumoCard({ titulo, r }: { titulo: string; r: ReturnType<typeof analisar> }) {
  const fmtRange = (v: [number, number] | null) =>
    v ? `${v[0].toFixed(2)} → ${v[1].toFixed(2)} mm` : "—";
  const fmtCounts = (m: Record<string, number>) => {
    const keys = Object.keys(m).sort();
    if (!keys.length) return <span className="text-muted-foreground">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {keys.map((k) => (
          <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
            {k}<span className="ml-1 text-muted-foreground">×{m[k]}</span>
          </span>
        ))}
      </div>
    );
  };
  return (
    <section className="rounded border border-border bg-surface p-3">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</h3>
      <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-xs">
        <dt className="text-muted-foreground">Linhas</dt>
        <dd>{r.totalLinhas} ({r.linhasComentario} comentários)</dd>
        <dt className="text-muted-foreground">Ferramentas</dt>
        <dd className="font-mono">{r.ferramentas.length ? r.ferramentas.join(", ") : "—"}</dd>
        <dt className="text-muted-foreground">Range X</dt><dd className="font-mono">{fmtRange(r.rangeX)}</dd>
        <dt className="text-muted-foreground">Range Y</dt><dd className="font-mono">{fmtRange(r.rangeY)}</dd>
        <dt className="text-muted-foreground">Range Z</dt><dd className="font-mono">{fmtRange(r.rangeZ)}</dd>
        <dt className="text-muted-foreground">Avanços (F)</dt>
        <dd className="font-mono">{r.feeds.length ? r.feeds.join(", ") : "—"}</dd>
        <dt className="text-muted-foreground">Rotações (S)</dt>
        <dd className="font-mono">{r.rpms.length ? r.rpms.join(", ") : "—"}</dd>
        <dt className="text-muted-foreground">Comandos G</dt><dd>{fmtCounts(r.comandosG)}</dd>
        <dt className="text-muted-foreground">Comandos M</dt><dd>{fmtCounts(r.comandosM)}</dd>
      </dl>
    </section>
  );
}
