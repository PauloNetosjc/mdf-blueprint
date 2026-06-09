import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Boxes, Printer, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type PlanoRow = {
  id: string;
  versao: number;
  status: string;
  total_chapas: number;
  total_pecas: number;
  aproveitamento_percentual: number;
  plano_corte_json: any | null;
  created_at: string;
};

type PecaSep = {
  id_tecnico: string;
  chapa_index: number;
  peca_index_chapa: number;
  codigo: string | null;
  descricao: string | null;
  modulo: string | null;
  largura: number;
  altura: number;
  espessura: number;
  x: number;
  y: number;
  rotacionada: boolean;
  fita_codigo: string | null;
  veio: boolean;
  observacao: string | null;
};

type ChapaSep = {
  chapa_index: number;
  nome: string;
  largura: number;
  altura: number;
  espessura: number;
  total_pecas: number;
  pecas: PecaSep[];
};

type ModuloSep = { nome: string; total_pecas: number; pecas: PecaSep[] };
type FitaSep = { fita_codigo: string; total_pecas: number; pecas: PecaSep[] };

type AlmoxJson = {
  projeto_id: string;
  plano_corte_id: string;
  gerado_em: string;
  resumo: {
    total_chapas: number;
    total_pecas: number;
    aproveitamento_percentual: number;
    total_modulos: number;
    total_fitas: number;
    pecas_nao_encaixadas: number;
  };
  chapas: ChapaSep[];
  modulos: ModuloSep[];
  fitas: FitaSep[];
  pecas_nao_encaixadas: any[];
};

type AlmoxRow = {
  id: string;
  plano_corte_id: string;
  almoxarifado_json: AlmoxJson;
  status: string;
  criado_em: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function nomePlano(p: PlanoRow): string {
  const j = p.plano_corte_json;
  if (j && typeof j === "object" && typeof j.nome === "string") return j.nome;
  return `Plano v${p.versao}`;
}

function construirAlmoxarifado(plano: PlanoRow, projetoId: string): AlmoxJson {
  const j = plano.plano_corte_json ?? {};
  const chapasJson: any[] = Array.isArray(j?.plano) ? j.plano : [];

  const chapas: ChapaSep[] = chapasJson.map((c, ci) => {
    const pecasRaw: any[] = Array.isArray(c?.pecas) ? c.pecas : [];
    const pecas: PecaSep[] = pecasRaw.map((p, pi) => ({
      id_tecnico: `CH${ci + 1}-P${pad2(pi + 1)}`,
      chapa_index: ci + 1,
      peca_index_chapa: pi + 1,
      codigo: p.codigo ?? null,
      descricao: p.descricao ?? null,
      modulo: p.modulo ?? null,
      largura: Number(p.largura) || 0,
      altura: Number(p.altura) || 0,
      espessura: Number(p.espessura ?? c?.chapa?.espessura) || 0,
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      rotacionada: !!p.rotacionada,
      fita_codigo: p.fita_codigo ?? null,
      veio: p.veio === true,
      observacao: p.observacao ?? null,
    }));
    return {
      chapa_index: ci + 1,
      nome: c?.chapa?.nome ?? `Chapa ${ci + 1}`,
      largura: Number(c?.chapa?.largura) || 0,
      altura: Number(c?.chapa?.altura) || 0,
      espessura: Number(c?.chapa?.espessura) || 0,
      total_pecas: pecas.length,
      pecas,
    };
  });

  const todas = chapas.flatMap((c) => c.pecas);

  const moduloMap = new Map<string, PecaSep[]>();
  for (const p of todas) {
    const k = (p.modulo ?? "").trim() || "Sem módulo informado";
    if (!moduloMap.has(k)) moduloMap.set(k, []);
    moduloMap.get(k)!.push(p);
  }
  const modulos: ModuloSep[] = Array.from(moduloMap.entries())
    .map(([nome, pecas]) => ({ nome, total_pecas: pecas.length, pecas }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const fitaMap = new Map<string, PecaSep[]>();
  for (const p of todas) {
    const k = (p.fita_codigo ?? "").trim() || "Sem fita informada";
    if (!fitaMap.has(k)) fitaMap.set(k, []);
    fitaMap.get(k)!.push(p);
  }
  const fitas: FitaSep[] = Array.from(fitaMap.entries())
    .map(([fita_codigo, pecas]) => ({ fita_codigo, total_pecas: pecas.length, pecas }))
    .sort((a, b) => a.fita_codigo.localeCompare(b.fita_codigo));

  const naoEnc: any[] = Array.isArray(j?.pecas_nao_encaixadas) ? j.pecas_nao_encaixadas : [];

  return {
    projeto_id: projetoId,
    plano_corte_id: plano.id,
    gerado_em: new Date().toISOString(),
    resumo: {
      total_chapas: chapas.length,
      total_pecas: todas.length,
      aproveitamento_percentual: Math.round(plano.aproveitamento_percentual || 0),
      total_modulos: modulos.length,
      total_fitas: fitas.length,
      pecas_nao_encaixadas: naoEnc.length,
    },
    chapas,
    modulos,
    fitas,
    pecas_nao_encaixadas: naoEnc,
  };
}

export function AlmoxarifadoSeparacaoTab({ projetoId }: { projetoId: string }) {
  const qc = useQueryClient();
  const [planoSel, setPlanoSel] = useState<string | "">("");

  const { data: projeto } = useQuery({
    queryKey: ["projeto-min-almox", projetoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("projetos")
        .select("id, nome, cliente")
        .eq("id", projetoId)
        .single();
      return data as { id: string; nome: string; cliente: string | null } | null;
    },
  });

  const { data: planos } = useQuery({
    queryKey: ["planos-corte-almox", projetoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("planos_corte")
        .select(
          "id, versao, status, total_chapas, total_pecas, aproveitamento_percentual, plano_corte_json, created_at" as never,
        )
        .eq("projeto_id", projetoId)
        .order("created_at", { ascending: false });
      const rows = (data ?? []) as unknown as PlanoRow[];
      if (rows.length && !planoSel) setPlanoSel(rows[0].id);
      return rows;
    },
  });

  const planoAtual = useMemo(
    () => planos?.find((p) => p.id === planoSel) ?? null,
    [planos, planoSel],
  );

  const { data: almoxRow, refetch } = useQuery({
    queryKey: ["almox-sep", planoSel],
    enabled: !!planoSel,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("almoxarifado_separacoes")
        .select("*")
        .eq("plano_corte_id", planoSel)
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as AlmoxRow | null;
    },
  });

  const gerar = useMutation({
    mutationFn: async () => {
      if (!planoAtual) throw new Error("Selecione um plano de corte.");
      const j = planoAtual.plano_corte_json;
      const chapas: any[] = Array.isArray(j?.plano) ? j.plano : [];
      const totalPecas = chapas.reduce(
        (s, c) => s + (Array.isArray(c?.pecas) ? c.pecas.length : 0),
        0,
      );
      if (!j || chapas.length === 0 || totalPecas === 0) {
        throw new Error("Não foi possível gerar separação: plano de corte vazio ou inválido.");
      }
      const almoxarifado_json = construirAlmoxarifado(planoAtual, projetoId);
      const sb: any = supabase;
      if (almoxRow) {
        const { error } = await sb
          .from("almoxarifado_separacoes")
          .update({
            almoxarifado_json,
            status: "gerado",
            atualizado_em: new Date().toISOString(),
          })
          .eq("id", almoxRow.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("almoxarifado_separacoes").insert({
          projeto_id: projetoId,
          plano_corte_id: planoAtual.id,
          almoxarifado_json,
          status: "gerado",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Separação gerada");
      qc.invalidateQueries({ queryKey: ["almox-sep", planoSel] });
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const almox = almoxRow?.almoxarifado_json ?? null;

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #area-almox-print, #area-almox-print * { visibility: visible !important; }
          #area-almox-print { position: absolute; left: 0; top: 0; width: 100%; padding: 12mm; color: #000; background: #fff; }
          .no-print { display: none !important; }
          .almox-section { page-break-inside: avoid; break-inside: avoid; margin-bottom: 12pt; }
          .almox-section table { border-collapse: collapse; width: 100%; font-size: 9pt; }
          .almox-section th, .almox-section td { border: 1px solid #000; padding: 3px 5px; text-align: left; }
        }
      `}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div>
          <h2 className="text-lg font-semibold">Almoxarifado · Separação de Materiais</h2>
          <p className="text-xs text-muted-foreground">
            Gere um relatório de separação a partir do plano de corte salvo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={planoSel} onValueChange={setPlanoSel}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Selecione um plano" />
            </SelectTrigger>
            <SelectContent>
              {(planos ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {nomePlano(p)} · {p.total_chapas} ch / {p.total_pecas} pç ·{" "}
                  {Math.round(p.aproveitamento_percentual || 0)}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => gerar.mutate()} disabled={!planoAtual || gerar.isPending}>
            <Boxes className="mr-2 h-4 w-4" />
            {almoxRow ? "Regerar separação" : "Gerar separação"}
          </Button>
          <Button variant="outline" onClick={() => window.print()} disabled={!almox}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimir separação
          </Button>
          <Button variant="ghost" size="icon" onClick={() => refetch()} title="Recarregar">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!planoAtual && (
        <div className="rounded border border-dashed border-border bg-surface p-8 text-center text-sm text-muted-foreground no-print">
          Selecione um plano de corte.
        </div>
      )}

      {planoAtual && !almox && (
        <div className="rounded border border-dashed border-border bg-surface p-8 text-center text-sm text-muted-foreground no-print">
          Nenhuma separação gerada ainda. Clique em "Gerar separação".
        </div>
      )}

      {almox && (
        <div id="area-almox-print" className="space-y-6">
          {/* Cabeçalho de impressão */}
          <div className="hidden print:block">
            <h1 style={{ fontSize: "16pt", fontWeight: "bold", margin: 0 }}>
              Separação de Materiais
            </h1>
            <div style={{ fontSize: "10pt" }}>
              <strong>Projeto:</strong> {projeto?.nome ?? "—"}
              {projeto?.cliente ? ` · Cliente: ${projeto.cliente}` : ""}
            </div>
            <div style={{ fontSize: "10pt" }}>
              <strong>Plano:</strong> {planoAtual ? nomePlano(planoAtual) : "—"} · Gerado em{" "}
              {new Date(almox.gerado_em).toLocaleString()}
            </div>
            <hr style={{ margin: "8pt 0" }} />
          </div>

          {/* Resumo */}
          <section className="almox-section">
            <h3 className="mb-2 text-sm font-semibold">Resumo</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <ResumoCard label="Chapas" value={almox.resumo.total_chapas} />
              <ResumoCard label="Peças" value={almox.resumo.total_pecas} />
              <ResumoCard label="Aproveitamento" value={`${almox.resumo.aproveitamento_percentual}%`} />
              <ResumoCard label="Módulos" value={almox.resumo.total_modulos} />
              <ResumoCard label="Fitas" value={almox.resumo.total_fitas} />
              <ResumoCard
                label="Não encaixadas"
                value={almox.resumo.pecas_nao_encaixadas}
                alerta={almox.resumo.pecas_nao_encaixadas > 0}
              />
            </div>
            <div className="mt-2 text-xs text-muted-foreground no-print">
              Status:{" "}
              <Badge variant="secondary">{almoxRow?.status}</Badge> · Gerado em{" "}
              {new Date(almox.gerado_em).toLocaleString()}
            </div>
          </section>

          {/* Separação por chapa */}
          <section className="almox-section">
            <h3 className="mb-2 text-sm font-semibold">Separação por Chapa</h3>
            <div className="space-y-3">
              {almox.chapas.map((c) => (
                <div key={c.chapa_index} className="rounded border border-border">
                  <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-medium">
                    Chapa {c.chapa_index} · {c.nome} · {c.largura} × {c.altura} × {c.espessura} mm
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({c.total_pecas} peças)
                    </span>
                  </div>
                  <TabelaPecas pecas={c.pecas} mostrarChapa={false} />
                </div>
              ))}
            </div>
          </section>

          {/* Separação por módulo */}
          <section className="almox-section">
            <h3 className="mb-2 text-sm font-semibold">Separação por Ambiente / Módulo</h3>
            <div className="space-y-3">
              {almox.modulos.map((m) => (
                <div key={m.nome} className="rounded border border-border">
                  <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-medium">
                    {m.nome}{" "}
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({m.total_pecas} peças)
                    </span>
                  </div>
                  <TabelaPecas pecas={m.pecas} mostrarChapa />
                </div>
              ))}
            </div>
          </section>

          {/* Fitas */}
          <section className="almox-section">
            <h3 className="mb-2 text-sm font-semibold">Fitas de borda</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Comprimento de fita ainda não calculado por face.
            </p>
            <div className="space-y-3">
              {almox.fitas.map((f) => (
                <div key={f.fita_codigo} className="rounded border border-border">
                  <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-medium">
                    {f.fita_codigo}{" "}
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({f.total_pecas} peças)
                    </span>
                  </div>
                  <TabelaPecas pecas={f.pecas} mostrarChapa colunasReduzidas />
                </div>
              ))}
            </div>
          </section>

          {/* Não encaixadas */}
          <section className="almox-section">
            <h3 className="mb-2 text-sm font-semibold">Peças não encaixadas</h3>
            {almox.pecas_nao_encaixadas.length === 0 ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Todas as peças foram encaixadas.</AlertTitle>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  {almox.pecas_nao_encaixadas.length} peça(s) não encaixadas
                </AlertTitle>
                <AlertDescription>
                  <div className="mt-2 overflow-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="px-2 py-1 text-left">Código</th>
                          <th className="px-2 py-1 text-left">Descrição</th>
                          <th className="px-2 py-1 text-left">Medidas</th>
                          <th className="px-2 py-1 text-left">Módulo</th>
                          <th className="px-2 py-1 text-left">Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {almox.pecas_nao_encaixadas.map((p: any, i: number) => (
                          <tr key={i} className="border-b">
                            <td className="px-2 py-1">{p.codigo ?? "—"}</td>
                            <td className="px-2 py-1">{p.descricao ?? "—"}</td>
                            <td className="px-2 py-1">
                              {p.largura ?? "?"} × {p.altura ?? "?"} × {p.espessura ?? "?"}
                            </td>
                            <td className="px-2 py-1">{p.modulo ?? "—"}</td>
                            <td className="px-2 py-1">{p.motivo ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ResumoCard({
  label,
  value,
  alerta,
}: {
  label: string;
  value: number | string;
  alerta?: boolean;
}) {
  return (
    <div
      className={`rounded border p-3 ${
        alerta ? "border-destructive/50 bg-destructive/5" : "border-border bg-surface"
      }`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function TabelaPecas({
  pecas,
  mostrarChapa,
  colunasReduzidas,
}: {
  pecas: PecaSep[];
  mostrarChapa: boolean;
  colunasReduzidas?: boolean;
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/20">
            <th className="px-2 py-1 text-left">ID</th>
            <th className="px-2 py-1 text-left">Código</th>
            <th className="px-2 py-1 text-left">Descrição</th>
            <th className="px-2 py-1 text-left">Medidas (mm)</th>
            {!colunasReduzidas && <th className="px-2 py-1 text-left">Módulo</th>}
            {mostrarChapa && <th className="px-2 py-1 text-left">Chapa</th>}
            {!colunasReduzidas && <th className="px-2 py-1 text-left">Fita</th>}
            {!colunasReduzidas && <th className="px-2 py-1 text-left">Veio</th>}
            {!colunasReduzidas && <th className="px-2 py-1 text-left">Rot</th>}
            {!colunasReduzidas && <th className="px-2 py-1 text-left">X/Y</th>}
          </tr>
        </thead>
        <tbody>
          {pecas.map((p) => (
            <tr key={`${p.chapa_index}-${p.peca_index_chapa}`} className="border-b">
              <td className="px-2 py-1 font-mono">{p.id_tecnico}</td>
              <td className="px-2 py-1 font-mono">{p.codigo ?? "—"}</td>
              <td className="px-2 py-1">{p.descricao ?? "—"}</td>
              <td className="px-2 py-1 font-mono">
                {p.largura} × {p.altura} × {p.espessura}
              </td>
              {!colunasReduzidas && <td className="px-2 py-1">{p.modulo ?? "—"}</td>}
              {mostrarChapa && <td className="px-2 py-1">CH{p.chapa_index}</td>}
              {!colunasReduzidas && <td className="px-2 py-1">{p.fita_codigo ?? "—"}</td>}
              {!colunasReduzidas && <td className="px-2 py-1">{p.veio ? "Sim" : "Não"}</td>}
              {!colunasReduzidas && <td className="px-2 py-1">{p.rotacionada ? "Sim" : "Não"}</td>}
              {!colunasReduzidas && (
                <td className="px-2 py-1 font-mono">
                  {Math.round(p.x)} / {Math.round(p.y)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
