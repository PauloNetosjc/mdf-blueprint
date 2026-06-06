import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Download, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

type Achado = {
  tipo: string;
  severidade: "erro" | "alerta";
  detalhe: string;
};

type Linha = {
  peca_id: string;
  codigo: string;
  pdf_nome: string | null;
  status_parser: string;
  achados: Achado[];
};

const MODULE_PREFIXES = new Set(["ARM", "CAN", "BAL", "RET", "SEQ", "SIS"]);

const TIPOS_ERRO = new Set([
  "furacao_detectada_sem_furos",
  "rasgos_detectados_sem_rasgos",
  "usinagens_detectadas_sem_usinagens",
  "peca_sem_faces_layout",
  "peca_sem_contorno_externo",
  "peca_individual_sem_dados",
  "modulo_com_operacoes",
  "status_com_erros",
]);

export function AuditarBibliotecaDialog({ open, onOpenChange }: Props) {
  const [rodando, setRodando] = useState(false);
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [totalAuditadas, setTotalAuditadas] = useState(0);

  useEffect(() => {
    if (open) {
      void rodarAuditoria();
    } else {
      setLinhas(null);
      setTotalAuditadas(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function rodarAuditoria() {
    setRodando(true);
    try {
      const { data: pecas, error: ePecas } = await db
        .from("pecas_cadastradas")
        .select(
          "id,codigo_completo,prefixo,status_parser,erros_parser,parser_alertas_json,resumo_parser_json,dados_brutos_json,largura_ref,altura_ref,pdf_nome_arquivo,pdf_nome",
        )
        .order("codigo_completo", { ascending: true });
      if (ePecas) throw ePecas;

      const ids = (pecas ?? []).map((p: { id: string }) => p.id);

      const [{ data: ops, error: eOps }, { data: brds, error: eBrds }] = await Promise.all([
        db
          .from("peca_cadastrada_operacoes")
          .select("peca_cadastrada_id,tipo,face,x,y,diametro,x1,x2,largura,profundidade")
          .in("peca_cadastrada_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
        db
          .from("peca_cadastrada_bordas")
          .select("peca_cadastrada_id")
          .in("peca_cadastrada_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      ]);
      if (eOps) throw eOps;
      if (eBrds) throw eBrds;

      type Op = {
        peca_cadastrada_id: string;
        tipo: string;
        face: number | null;
        x: number | null;
        y: number | null;
        diametro: number | null;
        x1: number | null;
        x2: number | null;
        largura: number | null;
        profundidade: number | null;
      };
      const opsPorPeca = new Map<string, Op[]>();
      for (const o of (ops ?? []) as Op[]) {
        const arr = opsPorPeca.get(o.peca_cadastrada_id) ?? [];
        arr.push(o);
        opsPorPeca.set(o.peca_cadastrada_id, arr);
      }
      const bordasPorPeca = new Map<string, number>();
      for (const b of (brds ?? []) as { peca_cadastrada_id: string }[]) {
        bordasPorPeca.set(b.peca_cadastrada_id, (bordasPorPeca.get(b.peca_cadastrada_id) ?? 0) + 1);
      }

      const resultado: Linha[] = [];

      for (const p of (pecas ?? []) as Array<{
        id: string;
        codigo_completo: string;
        prefixo: string | null;
        status_parser: string;
        erros_parser: unknown[] | null;
        parser_alertas_json: unknown[] | null;
        resumo_parser_json: Record<string, unknown> | null;
        dados_brutos_json: Record<string, unknown> | null;
        largura_ref: number | null;
        altura_ref: number | null;
        pdf_nome_arquivo: string | null;
        pdf_nome: string | null;
      }>) {
        const achados: Achado[] = [];
        const pecaOps = opsPorPeca.get(p.id) ?? [];
        const furos = pecaOps.filter((o) => o.tipo === "furo");
        const rasgos = pecaOps.filter((o) => o.tipo === "rasgo");
        const usinagens = pecaOps.filter(
          (o) => o.tipo === "usinagem_parametrica" || o.tipo === "usinagem" || o.tipo === "contorno",
        );
        const bordas = bordasPorPeca.get(p.id) ?? 0;

        const resumo = (p.resumo_parser_json ?? {}) as Record<string, unknown>;
        const dados = (p.dados_brutos_json ?? {}) as Record<string, unknown>;
        const ehModulo =
          p.status_parser === "ignorado_modulo" ||
          (p.prefixo ? MODULE_PREFIXES.has(p.prefixo) : false);
        const classificacao = String(resumo.classificacao ?? "");
        const ehPecaIndividual = classificacao === "peca_individual" || (!ehModulo && classificacao !== "modulo_explodido");

        // 1. Seção Furação detectada mas 0 furos
        const furacaoDetectada =
          Number(resumo.furos_detectados ?? 0) > 0 ||
          Boolean(dados.furacao_detectada) ||
          (Array.isArray(dados.secoes_detectadas) && (dados.secoes_detectadas as string[]).includes("furacao"));
        if (furacaoDetectada && furos.length === 0 && !ehModulo) {
          achados.push({
            tipo: "furacao_detectada_sem_furos",
            severidade: "erro",
            detalhe: "Seção Furação detectada mas 0 furos extraídos.",
          });
        }

        // 2. Seção Rasgos detectada mas 0 rasgos
        const rasgosDetectados =
          Number(resumo.rasgos_detectados ?? 0) > 0 ||
          Boolean(dados.rasgos_detectados) ||
          (Array.isArray(dados.secoes_detectadas) && (dados.secoes_detectadas as string[]).includes("rasgos"));
        if (rasgosDetectados && rasgos.length === 0 && !ehModulo) {
          achados.push({
            tipo: "rasgos_detectados_sem_rasgos",
            severidade: "erro",
            detalhe: "Seção Rasgos detectada mas 0 rasgos extraídos.",
          });
        }

        // 3. Seção Usinagens detectada mas 0 usinagens
        const usinDetectadas =
          Number(resumo.usinagens_detectadas ?? 0) > 0 ||
          (Array.isArray(dados.secoes_detectadas) && (dados.secoes_detectadas as string[]).includes("usinagens"));
        if (usinDetectadas && usinagens.length === 0 && !ehModulo) {
          achados.push({
            tipo: "usinagens_detectadas_sem_usinagens",
            severidade: "erro",
            detalhe: "Seção Usinagens detectada mas 0 usinagens extraídas.",
          });
        }

        // 4. Furos suspeitos
        const largura = p.largura_ref ?? 0;
        const altura = p.altura_ref ?? 0;
        for (const f of furos) {
          if ((f.diametro ?? 0) > 50) {
            achados.push({
              tipo: "furo_diametro_suspeito",
              severidade: "alerta",
              detalhe: `Furo Ø${f.diametro}mm > 50mm (face ${f.face ?? "?"}).`,
            });
            break;
          }
        }
        if (largura > 0 && altura > 0) {
          for (const f of furos) {
            if ((f.y ?? 0) > altura + 1) {
              achados.push({
                tipo: "furo_y_fora_face",
                severidade: "alerta",
                detalhe: `Furo Y=${f.y} > altura ${altura}.`,
              });
              break;
            }
          }
          for (const f of furos) {
            if ((f.x ?? 0) > largura + 1) {
              achados.push({
                tipo: "furo_x_fora_face",
                severidade: "alerta",
                detalhe: `Furo X=${f.x} > largura ${largura}.`,
              });
              break;
            }
          }
        }

        // 5. Rasgos suspeitos
        for (const r of rasgos) {
          const x1 = r.x1 ?? 0;
          const x2 = r.x2 ?? 0;
          if (x2 <= x1) {
            achados.push({
              tipo: "rasgo_x2_menor_x1",
              severidade: "erro",
              detalhe: `Rasgo X2(${x2}) <= X1(${x1}).`,
            });
          }
          if (!r.largura || r.largura === 0) {
            achados.push({
              tipo: "rasgo_largura_zerada",
              severidade: "erro",
              detalhe: "Rasgo com largura zerada.",
            });
          }
          if (!r.profundidade || r.profundidade === 0) {
            achados.push({
              tipo: "rasgo_profundidade_zerada",
              severidade: "alerta",
              detalhe: "Rasgo com profundidade zerada.",
            });
          }
          if (largura > 0 && x2 > largura + 5) {
            achados.push({
              tipo: "rasgo_x2_fora_face",
              severidade: "alerta",
              detalhe: `Rasgo X2=${x2} > largura ${largura} (tolerância 5mm).`,
            });
          }
        }

        // 6. Sem faces_layout_json
        if (ehPecaIndividual && !dados.faces_layout_json) {
          achados.push({
            tipo: "peca_sem_faces_layout",
            severidade: "erro",
            detalhe: "Peça individual sem faces_layout_json.",
          });
        }

        // 7. Sem contorno_externo_json
        if (ehPecaIndividual && !dados.contorno_externo_json) {
          achados.push({
            tipo: "peca_sem_contorno_externo",
            severidade: "erro",
            detalhe: "Peça individual sem contorno_externo_json.",
          });
        }

        // 8. B1 detectado mas sem fita associada
        const temB1 =
          Boolean(dados.tem_b1) ||
          Boolean(resumo.b1_detectado) ||
          (Array.isArray(dados.marcadores) && (dados.marcadores as string[]).includes("B1"));
        if (temB1 && bordas === 0) {
          achados.push({
            tipo: "b1_sem_fita",
            severidade: "alerta",
            detalhe: "Marcador B1 detectado mas nenhuma borda/fita associada.",
          });
        }

        // 9. status_parser = com_erros
        if (p.status_parser === "com_erros") {
          const errs = Array.isArray(p.erros_parser) ? (p.erros_parser as unknown[]) : [];
          achados.push({
            tipo: "status_com_erros",
            severidade: "erro",
            detalhe: `status_parser=com_erros (${errs.length} mensagem(s)).`,
          });
        }

        // 10. peca_individual sem operações e sem bordas
        if (
          ehPecaIndividual &&
          !ehModulo &&
          furos.length === 0 &&
          rasgos.length === 0 &&
          usinagens.length === 0 &&
          bordas === 0
        ) {
          achados.push({
            tipo: "peca_individual_sem_dados",
            severidade: "erro",
            detalhe: "Peça individual sem operações e sem bordas.",
          });
        }

        // 11. Módulo/explodido que criou operações
        if (
          (ehModulo || classificacao === "modulo_explodido") &&
          (furos.length > 0 || rasgos.length > 0 || usinagens.length > 0)
        ) {
          achados.push({
            tipo: "modulo_com_operacoes",
            severidade: "erro",
            detalhe: `Módulo/explodido com operações indevidas (${furos.length}f/${rasgos.length}r/${usinagens.length}u).`,
          });
        }

        if (achados.length) {
          resultado.push({
            peca_id: p.id,
            codigo: p.codigo_completo,
            pdf_nome: p.pdf_nome_arquivo ?? p.pdf_nome ?? null,
            status_parser: p.status_parser,
            achados,
          });
        }
      }

      setTotalAuditadas((pecas ?? []).length);
      setLinhas(resultado);
    } catch (e) {
      toast.error(`Falha na auditoria: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRodando(false);
    }
  }

  const stats = useMemo(() => {
    const porTipo = new Map<string, number>();
    let pecasComErro = 0;
    let pecasComAlerta = 0;
    for (const l of linhas ?? []) {
      const temErro = l.achados.some((a) => a.severidade === "erro" || TIPOS_ERRO.has(a.tipo));
      if (temErro) pecasComErro++;
      else pecasComAlerta++;
      for (const a of l.achados) porTipo.set(a.tipo, (porTipo.get(a.tipo) ?? 0) + 1);
    }
    const ok = totalAuditadas - (linhas?.length ?? 0);
    return { porTipo, pecasComErro, pecasComAlerta, ok };
  }, [linhas, totalAuditadas]);

  function exportarCSV() {
    if (!linhas) return;
    const linhasCsv: string[] = [];
    linhasCsv.push(["codigo", "pdf_nome", "status_parser", "tipo_achado", "severidade", "detalhe"].join(";"));
    for (const l of linhas) {
      for (const a of l.achados) {
        linhasCsv.push(
          [
            csvEscape(l.codigo),
            csvEscape(l.pdf_nome ?? ""),
            csvEscape(l.status_parser),
            csvEscape(a.tipo),
            csvEscape(a.severidade),
            csvEscape(a.detalhe),
          ].join(";"),
        );
      }
    }
    const blob = new Blob(["\ufeff" + linhasCsv.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditoria-biblioteca-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Auditar biblioteca de peças cadastradas</DialogTitle>
          <DialogDescription className="text-xs">
            Análise somente-leitura. Nenhuma peça é alterada. Verifica padrões de
            erro restantes no parser antes da reimportação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {rodando && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Analisando biblioteca…
            </div>
          )}

          {!rodando && linhas && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Card rotulo="Total auditadas" valor={totalAuditadas} />
                <Card rotulo="OK" valor={stats.ok} tone="ok" />
                <Card rotulo="Com erro real" valor={stats.pecasComErro} tone="erro" />
                <Card rotulo="Com alerta" valor={stats.pecasComAlerta} tone="alerta" />
              </div>

              <div className="rounded border border-border bg-surface-2 p-2">
                <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                  Erros agrupados por tipo
                </div>
                {stats.porTipo.size === 0 ? (
                  <div className="text-xs text-muted-foreground">Nenhum achado.</div>
                ) : (
                  <ul className="grid grid-cols-1 gap-0.5 text-xs sm:grid-cols-2">
                    {Array.from(stats.porTipo.entries())
                      .sort((a, b) => b[1] - a[1])
                      .map(([tipo, n]) => (
                        <li key={tipo} className="flex justify-between font-mono">
                          <span>{tipo}</span>
                          <span className="font-semibold">{n}</span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              <div className="max-h-72 overflow-auto rounded border border-border bg-surface-2 p-2 font-mono text-[11px]">
                {linhas.length === 0 ? (
                  <div className="p-3 text-center text-muted-foreground">
                    🎉 Nenhuma peça com achados. Biblioteca limpa.
                  </div>
                ) : (
                  linhas.map((l) => (
                    <div key={l.peca_id} className="border-b border-border/40 py-1">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                        <span className="font-semibold text-foreground">{l.codigo}</span>
                        <span className="text-muted-foreground">{l.pdf_nome ?? ""}</span>
                        <span className="ml-auto text-muted-foreground">{l.status_parser}</span>
                      </div>
                      <ul className="ml-5 list-disc text-[10px] text-muted-foreground">
                        {l.achados.map((a, i) => (
                          <li key={i}>
                            <span
                              className={
                                a.severidade === "erro" ? "text-destructive" : "text-amber-500"
                              }
                            >
                              [{a.tipo}]
                            </span>{" "}
                            {a.detalhe}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={rodando}>
            Fechar
          </Button>
          <Button variant="outline" onClick={() => void rodarAuditoria()} disabled={rodando}>
            Reexecutar
          </Button>
          <Button onClick={exportarCSV} disabled={rodando || !linhas || linhas.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function csvEscape(v: string): string {
  if (/[;\n"]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function Card({
  rotulo,
  valor,
  tone,
}: {
  rotulo: string;
  valor: number;
  tone?: "ok" | "erro" | "alerta";
}) {
  const border =
    tone === "erro"
      ? "border-destructive/50"
      : tone === "alerta"
        ? "border-amber-500/40"
        : tone === "ok"
          ? "border-emerald-500/40"
          : "";
  return (
    <div className={`rounded border border-border bg-surface p-2 ${border}`}>
      <div className="text-[10px] uppercase text-muted-foreground">{rotulo}</div>
      <div className="text-xl font-semibold">{valor}</div>
    </div>
  );
}
