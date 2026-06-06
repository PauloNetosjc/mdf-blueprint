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
  sugestao: string;
};

type Linha = {
  peca_id: string;
  codigo: string;
  nome: string | null;
  pdf_nome: string | null;
  status_parser: string;
  furos: number;
  rasgos: number;
  usinagens: number;
  bordas: number;
  erros_parser: string[];
  alertas_parser: string[];
  achados: Achado[];
};

const MODULE_PREFIXES = new Set(["ARM", "CAN", "BAL", "RET", "SEQ", "SIS"]);
// Prefixos que costumam ser peças retangulares simples (lisas, sem operação técnica).
const PREFIXOS_PECA_SIMPLES = new Set(["FUN", "TRA", "PRA", "TAM", "TAB"]);

type FaceLayout = {
  face: string;
  largura_visual?: number | null;
  altura_visual?: number | null;
};

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
          "id,codigo_completo,nome_peca,tipo_peca,prefixo,status_parser,erros_parser,parser_alertas_json,resumo_parser_json,dados_brutos_json,largura_ref,altura_ref,espessura_ref,material_ref,pdf_nome_arquivo,pdf_nome",
        )
        .order("codigo_completo", { ascending: true });
      if (ePecas) throw ePecas;

      const ids = (pecas ?? []).map((p: { id: string }) => p.id);
      const safeIds = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];

      const [{ data: ops, error: eOps }, { data: brds, error: eBrds }] = await Promise.all([
        db
          .from("peca_cadastrada_operacoes")
          .select("peca_cadastrada_id,tipo,face,x,y,diametro,x1,x2,largura,profundidade")
          .in("peca_cadastrada_id", safeIds),
        db
          .from("peca_cadastrada_bordas")
          .select("peca_cadastrada_id")
          .in("peca_cadastrada_id", safeIds),
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
        nome_peca: string | null;
        tipo_peca: string | null;
        prefixo: string | null;
        status_parser: string;
        erros_parser: unknown[] | null;
        parser_alertas_json: unknown[] | null;
        resumo_parser_json: Record<string, unknown> | null;
        dados_brutos_json: Record<string, unknown> | null;
        largura_ref: number | null;
        altura_ref: number | null;
        espessura_ref: number | null;
        material_ref: string | null;
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
        const ehPecaIndividual =
          classificacao === "peca_individual" ||
          (!ehModulo && classificacao !== "modulo_explodido");

        // Detecção fraca vs forte. secoes_com_dados é a forte (parser nova).
        const secoesDet = (resumo.secoes_detectadas ?? {}) as {
          furacao?: boolean;
          rasgos?: boolean;
          usinagens?: boolean;
        };
        const secoesComDados = (resumo.secoes_com_dados ?? null) as null | {
          furacao?: boolean;
          rasgos?: boolean;
          usinagens?: boolean;
        };
        const facesLayout = ((dados.faces_layout_json as { faces?: FaceLayout[] } | undefined)
          ?.faces ?? []) as FaceLayout[];
        const temContorno = Boolean(dados.contorno_externo_json);
        const contornoOrigem = String(
          (dados.contorno_externo_json as { origem?: string } | undefined)?.origem ?? "",
        );

        // ─── 1/2/3. Seção detectada mas operação não extraída ───────────────
        // Só conta como ERRO REAL quando há evidência forte (linha numérica).
        // Quando há apenas a palavra solta, vira ALERTA leve.
        const furacaoForte = secoesComDados?.furacao === true;
        const furacaoFraca = secoesDet.furacao === true || (resumo.furos_detectados as number) > 0;
        if (furacaoFraca && furos.length === 0 && !ehModulo) {
          if (furacaoForte) {
            achados.push({
              tipo: "furacao_detectada_sem_furos",
              severidade: "erro",
              detalhe: "Tabela de Furação com linhas numéricas, mas 0 furos extraídos.",
              sugestao: "Investigar parser de furação — há candidato real no PDF.",
            });
          } else if (secoesComDados !== null) {
            // Parser novo já analisou e disse que não há tabela real → ignora.
          } else {
            // Peça antiga: degrada para alerta até reprocessar.
            achados.push({
              tipo: "furacao_palavra_sem_tabela",
              severidade: "alerta",
              detalhe: "Palavra 'Furação' aparece no PDF, mas pode ser legenda/índice.",
              sugestao: "Reprocessar com parser novo para confirmar.",
            });
          }
        }

        const rasgosForte = secoesComDados?.rasgos === true;
        const rasgosFraca = secoesDet.rasgos === true || (resumo.rasgos_detectados as number) > 0;
        if (rasgosFraca && rasgos.length === 0 && !ehModulo) {
          if (rasgosForte) {
            achados.push({
              tipo: "rasgos_detectados_sem_rasgos",
              severidade: "erro",
              detalhe: "Tabela de Rasgos com linha numérica, mas 0 rasgos extraídos.",
              sugestao: "Investigar parser de rasgos — linha de 5 números não foi lida.",
            });
          } else if (secoesComDados !== null) {
            // ignora — sem evidência
          } else {
            achados.push({
              tipo: "rasgos_palavra_sem_tabela",
              severidade: "alerta",
              detalhe: "Palavra 'Rasgos' aparece no PDF, mas pode ser legenda/índice.",
              sugestao: "Reprocessar com parser novo para confirmar.",
            });
          }
        }

        const usinForte = secoesComDados?.usinagens === true;
        const usinFraca =
          secoesDet.usinagens === true || (resumo.usinagens_detectadas as number) > 0;
        if (usinFraca && usinagens.length === 0 && !ehModulo) {
          if (usinForte) {
            achados.push({
              tipo: "usinagens_detectadas_sem_usinagens",
              severidade: "erro",
              detalhe: "Tabela de Usinagens com linhas numéricas, mas 0 usinagens extraídas.",
              sugestao: "Investigar parser de usinagens.",
            });
          } else if (secoesComDados !== null) {
            // ignora
          } else {
            achados.push({
              tipo: "usinagens_palavra_sem_tabela",
              severidade: "alerta",
              detalhe: "Palavra 'Usinagens' aparece no PDF, mas pode ser legenda/índice.",
              sugestao: "Reprocessar com parser novo para confirmar.",
            });
          }
        }

        // ─── 4. Furos suspeitos (diâmetro / X/Y por face) ────────────────────
        for (const f of furos) {
          if ((f.diametro ?? 0) > 50) {
            achados.push({
              tipo: "furo_diametro_suspeito",
              severidade: "alerta",
              detalhe: `Furo Ø${f.diametro}mm > 50mm (face ${f.face ?? "?"}).`,
              sugestao: "Verificar se parser confundiu rasgo/usinagem com furo.",
            });
            break;
          }
        }
        // Y/X por face usando faces_layout_json quando disponível.
        const tolerancia = 1;
        for (const f of furos) {
          const dimsFace = dimensoesDaFace(facesLayout, f.face, {
            largura: p.largura_ref,
            altura: p.altura_ref,
            espessura: p.espessura_ref,
          });
          if (!dimsFace) continue;
          const Yv = Number(f.y ?? 0);
          const Xv = Number(f.x ?? 0);
          if (Yv > dimsFace.altura + tolerancia) {
            // Possível orientação invertida: Y cabe na largura.
            if (Yv <= dimsFace.largura + tolerancia) {
              achados.push({
                tipo: "face_orientacao_possivel_invertida",
                severidade: "alerta",
                detalhe: `Furo Y=${Yv} > altura ${dimsFace.altura} da face ${f.face}, mas cabe na largura ${dimsFace.largura}.`,
                sugestao: "Possível inversão de orientação da face. Validar faces_layout_json.",
              });
            } else {
              achados.push({
                tipo: "furo_y_fora_face",
                severidade: "alerta",
                detalhe: `Furo Y=${Yv} fora da face ${f.face} (altura ${dimsFace.altura}).`,
                sugestao: "Investigar coordenadas do furo ou layout da face.",
              });
            }
            break;
          }
          if (Xv > dimsFace.largura + tolerancia) {
            achados.push({
              tipo: "furo_x_fora_face",
              severidade: "alerta",
              detalhe: `Furo X=${Xv} fora da face ${f.face} (largura ${dimsFace.largura}).`,
              sugestao: "Investigar coordenadas do furo ou layout da face.",
            });
            break;
          }
        }

        // ─── 5. Rasgos suspeitos ─────────────────────────────────────────────
        for (const r of rasgos) {
          const x1 = r.x1 ?? 0;
          const x2 = r.x2 ?? 0;
          if (x2 <= x1) {
            achados.push({
              tipo: "rasgo_x2_menor_x1",
              severidade: "erro",
              detalhe: `Rasgo X2(${x2}) <= X1(${x1}).`,
              sugestao: "Reprocessar peça — parser novo descarta rasgos com X2<=X1.",
            });
          }
          if (!r.largura || Number(r.largura) === 0) {
            achados.push({
              tipo: "rasgo_largura_zerada",
              severidade: "erro",
              detalhe: "Rasgo com largura zerada.",
              sugestao: "Reprocessar — parser novo exige largura > 0.",
            });
          }
          if (!r.profundidade || Number(r.profundidade) === 0) {
            achados.push({
              tipo: "rasgo_profundidade_zerada",
              severidade: "alerta",
              detalhe: "Rasgo com profundidade zerada.",
              sugestao: "Reprocessar peça.",
            });
          }
        }

        // ─── 6. Sem faces_layout_json ───────────────────────────────────────
        if (ehPecaIndividual && !dados.faces_layout_json) {
          achados.push({
            tipo: "peca_sem_faces_layout",
            severidade: "erro",
            detalhe: "Peça individual sem faces_layout_json.",
            sugestao: "Reprocessar peça (parser gera layout automaticamente).",
          });
        }

        // ─── 7. Sem contorno_externo_json ───────────────────────────────────
        const geometriaComplexa = Boolean(dados.geometria_complexa);
        const motivosComplexa = Array.isArray(dados.geometria_complexa_motivos)
          ? (dados.geometria_complexa_motivos as string[])
          : [];
        if (geometriaComplexa) {
          achados.push({
            tipo: "geometria_complexa",
            severidade: "alerta",
            detalhe: `Peça com geometria complexa (não-retangular)${motivosComplexa.length ? ": " + motivosComplexa.join("; ") : ""}.`,
            sugestao: "Usar modo 'Desenho original do PDF' no visualizador. Não validar como retângulo simples.",
          });
        }
        if (ehPecaIndividual && !temContorno && !geometriaComplexa) {
          achados.push({
            tipo: "peca_sem_contorno_externo",
            severidade: "erro",
            detalhe: "Peça individual sem contorno_externo_json.",
            sugestao: "Reprocessar peça ou usar 'Reprocessar geometria'.",
          });
        }

        // ─── 8. B1 sem fita ─────────────────────────────────────────────────
        const temB1 =
          Boolean(dados.tem_b1) ||
          Boolean(dados.b1_multiplos_lados) ||
          (Array.isArray(dados.indicadores_borda) &&
            (dados.indicadores_borda as string[]).includes("B1"));
        if (temB1 && bordas === 0) {
          achados.push({
            tipo: "b1_sem_fita",
            severidade: "alerta",
            detalhe: "Marcador B1 detectado mas nenhuma borda/fita associada.",
            sugestao: "Verificar tabela de fita no PDF.",
          });
        }

        // ─── 9. status_parser = com_erros ───────────────────────────────────
        if (p.status_parser === "com_erros") {
          const errs = Array.isArray(p.erros_parser) ? (p.erros_parser as unknown[]) : [];
          achados.push({
            tipo: "status_com_erros",
            severidade: "erro",
            detalhe: `status_parser=com_erros (${errs.length} mensagem).`,
            sugestao: "Reprocessar peça com parser atual.",
          });
        }

        // ─── 10. peça individual sem ops e sem bordas ───────────────────────
        // NOVA REGRA: peças simples (FUN/Fundo etc) com cadastro válido viram OK.
        const semOps =
          ehPecaIndividual &&
          !ehModulo &&
          furos.length === 0 &&
          rasgos.length === 0 &&
          usinagens.length === 0 &&
          bordas === 0;
        if (semOps) {
          const tipoTxt = (p.tipo_peca ?? "").toLowerCase();
          const ehPecaSimples =
            (p.prefixo && PREFIXOS_PECA_SIMPLES.has(p.prefixo)) || tipoTxt.includes("fundo");
          const cadastroValido =
            Boolean(p.largura_ref) &&
            Boolean(p.altura_ref) &&
            Boolean(p.espessura_ref) &&
            Boolean(p.material_ref) &&
            temContorno &&
            (contornoOrigem === "retangular" || contornoOrigem === "");
          if (ehPecaSimples && cadastroValido) {
            achados.push({
              tipo: "peca_simples_sem_operacoes",
              severidade: "alerta",
              detalhe: "Peça retangular simples sem operações técnicas (esperado para Fundo/etc).",
              sugestao: "Nenhuma ação. Considerar como OK.",
            });
          } else {
            achados.push({
              tipo: "peca_individual_sem_dados",
              severidade: "erro",
              detalhe:
                `Peça individual sem operações, bordas e/ou cadastro incompleto ` +
                `(largura:${p.largura_ref ?? "—"}, altura:${p.altura_ref ?? "—"}, ` +
                `espessura:${p.espessura_ref ?? "—"}, material:${p.material_ref ?? "—"}, ` +
                `contorno:${temContorno ? "sim" : "não"}).`,
              sugestao: "Verificar PDF original — pode ser módulo classificado errado.",
            });
          }
        }

        // ─── 11. Módulo com operações ───────────────────────────────────────
        if (
          (ehModulo || classificacao === "modulo_explodido") &&
          (furos.length > 0 || rasgos.length > 0 || usinagens.length > 0)
        ) {
          achados.push({
            tipo: "modulo_com_operacoes",
            severidade: "erro",
            detalhe: `Módulo/explodido com operações indevidas (${furos.length}f/${rasgos.length}r/${usinagens.length}u).`,
            sugestao: "Reclassificar como módulo e descartar operações.",
          });
        }

        if (achados.length) {
          resultado.push({
            peca_id: p.id,
            codigo: p.codigo_completo,
            nome: p.nome_peca,
            pdf_nome: p.pdf_nome_arquivo ?? p.pdf_nome ?? null,
            status_parser: p.status_parser,
            furos: furos.length,
            rasgos: rasgos.length,
            usinagens: usinagens.length,
            bordas,
            erros_parser: (Array.isArray(p.erros_parser) ? p.erros_parser : []).map((x) =>
              typeof x === "string" ? x : JSON.stringify(x),
            ),
            alertas_parser: (Array.isArray(p.parser_alertas_json) ? p.parser_alertas_json : []).map(
              (x) => (typeof x === "string" ? x : JSON.stringify(x)),
            ),
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
      const temErro = l.achados.some((a) => a.severidade === "erro");
      if (temErro) pecasComErro++;
      else pecasComAlerta++;
      for (const a of l.achados) porTipo.set(a.tipo, (porTipo.get(a.tipo) ?? 0) + 1);
    }
    const ok = totalAuditadas - (linhas?.length ?? 0);
    return { porTipo, pecasComErro, pecasComAlerta, ok };
  }, [linhas, totalAuditadas]);

  function exportarCSV() {
    if (!linhas) return;
    const out: string[] = [];
    out.push(
      [
        "codigo",
        "nome",
        "pdf_nome",
        "status_parser",
        "furos",
        "rasgos",
        "usinagens",
        "bordas",
        "tipo_achado",
        "severidade",
        "detalhe",
        "sugestao",
        "erros_parser",
        "alertas_parser",
      ].join(";"),
    );
    for (const l of linhas) {
      for (const a of l.achados) {
        out.push(
          [
            csvEscape(l.codigo),
            csvEscape(l.nome ?? ""),
            csvEscape(l.pdf_nome ?? ""),
            csvEscape(l.status_parser),
            String(l.furos),
            String(l.rasgos),
            String(l.usinagens),
            String(l.bordas),
            csvEscape(a.tipo),
            csvEscape(a.severidade),
            csvEscape(a.detalhe),
            csvEscape(a.sugestao),
            csvEscape(l.erros_parser.join(" | ")),
            csvEscape(l.alertas_parser.join(" | ")),
          ].join(";"),
        );
      }
    }
    const blob = new Blob(["\ufeff" + out.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditoria-biblioteca-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Auditar biblioteca de peças cadastradas</DialogTitle>
          <DialogDescription className="text-xs">
            Análise somente-leitura. Diferencia erro real do parser, alerta de revisão,
            peça simples sem operação, módulo ignorado e possível orientação invertida.
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
                  Achados agrupados por tipo
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
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                        <span className="font-semibold text-foreground">{l.codigo}</span>
                        <span className="text-muted-foreground">{l.nome ?? ""}</span>
                        <span className="ml-auto text-muted-foreground">
                          {l.status_parser} · {l.furos}f/{l.rasgos}r/{l.usinagens}u/{l.bordas}b
                        </span>
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
                            {a.detalhe}{" "}
                            <span className="italic text-muted-foreground">→ {a.sugestao}</span>
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

function dimensoesDaFace(
  faces: FaceLayout[],
  faceNum: number | null,
  ref: { largura: number | null; altura: number | null; espessura: number | null },
): { largura: number; altura: number } | null {
  if (faceNum == null) return null;
  const f = faces.find((x) => String(x.face) === String(faceNum));
  if (f && f.largura_visual != null && f.altura_visual != null) {
    return { largura: Number(f.largura_visual), altura: Number(f.altura_visual) };
  }
  // Fallback por face padrão Promob quando layout não está cadastrado.
  const L = Number(ref.largura ?? 0);
  const A = Number(ref.altura ?? 0);
  const E = Number(ref.espessura ?? 0);
  if (!L || !A) return null;
  switch (Number(faceNum)) {
    case 0:
    case 5:
      return { largura: L, altura: A };
    case 1:
    case 3:
      return { largura: E || 15, altura: A };
    case 2:
    case 4:
      return { largura: L, altura: E || 15 };
    default:
      return { largura: L, altura: A };
  }
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
