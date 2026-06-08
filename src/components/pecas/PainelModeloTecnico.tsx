import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ModeloTecnicoJson } from "@/lib/peca-modelo-tecnico";
import { validarGeometriaModelo } from "@/lib/peca-modelo-tecnico";
import {
  validarModeloTecnico,
  validarParserBAS0485A,
  validarParserBAS1101A,
  validarParserBAS3520A,
  validarParserBAS4622A,
  calcularDetalhesModelo,
  type ModeloTecnicoLite,
} from "@/lib/validar-modelo-tecnico";
import {
  obterGeometriaRenderizavelDaFace,
  amostrarPontosDeOperacao,
} from "@/lib/geometria-renderizavel";
import { classificarPontoNoPoligono } from "@/lib/geometria-poligono";

type OperacaoRow = {
  tipo_operacao?: string | null;
  face?: string | number | null;
  x?: number | null;
  y?: number | null;
  diametro?: number | null;
  profundidade?: number | null;
};

export function PainelModeloTecnico({
  codigo,
  modelo,
  operacoes,
}: {
  codigo: string | null | undefined;
  modelo: ModeloTecnicoJson | null;
  operacoes: OperacaoRow[];
}) {
  // Monta uma view do modelo a partir do modelo_tecnico_json se existir, senão
  // usa as operações cruas do banco (que ainda assim refletem o parser).
  const lite: ModeloTecnicoLite = useMemo(() => {
    if (modelo) {
      return {
        codigo: modelo.codigo,
        geometria: {
          tipo: modelo.geometria.tipo,
          origem: modelo.geometria.origem,
          face_principal: modelo.geometria.face_principal,
          pontos_contorno: modelo.geometria.pontos_contorno,
        },
        faces_operacionais: (modelo.faces_operacionais ?? []).map((f) => Number(f.face)),
        faces_visuais: (modelo.faces_visuais ?? []).map((f) => Number(f.face)),
        face_alinhamento: modelo.face_alinhamento ?? null,
        medidas: {
          largura: modelo.medidas?.largura ?? null,
          altura: modelo.medidas?.altura ?? null,
          espessura: modelo.medidas?.espessura ?? null,
        },
        bordas: (modelo.bordas ?? []).map((b) => ({
          codigo_borda: b.codigo_borda ?? null,
          indicador_desenho: b.indicador_desenho ?? null,
          quantidade_m: b.quantidade_m ?? null,
        })),
        operacoes: (modelo.operacoes ?? []).map((o) => ({
          tipo: o.tipo,
          face: o.face,
          x: o.x,
          y: o.y,
            x1: o.x1,
            x2: o.x2,
            y1: o.y1,
            y2: o.y2,
          diametro: o.diametro,
          profundidade: o.profundidade,
        })),
      };
    }
    return {
      codigo: codigo ?? null,
      geometria: null,
      operacoes: operacoes.map((o) => ({
        tipo: o.tipo_operacao,
        face: o.face,
        x: o.x,
        y: o.y,
        diametro: o.diametro,
        profundidade: o.profundidade,
      })),
    };
  }, [modelo, operacoes, codigo]);

  const resultado = useMemo(() => {
    const cod = (codigo ?? "").toUpperCase();
    if (cod === "BAS0485A") return validarParserBAS0485A(lite);
    if (cod === "BAS1101A") return validarParserBAS1101A(lite);
    if (cod === "BAS3520A") return validarParserBAS3520A(lite);
    if (cod === "BAS4622A") return validarParserBAS4622A(lite);
    return validarModeloTecnico(lite);
  }, [lite, codigo]);

  const det = resultado.detalhes ?? calcularDetalhesModelo(lite);
  const facesOrdenadas = Object.keys(det.por_face).sort((a, b) => Number(a) - Number(b));
  const pontos = lite.geometria?.pontos_contorno ?? [];

  // Diagnóstico de renderização: usa a função ÚNICA também usada pelo
  // visualizador e pela validação geométrica.
  const validacaoGeom = useMemo(
    () => (modelo ? validarGeometriaModelo(modelo) : null),
    [modelo],
  );
  const renderizacaoOk = validacaoGeom?.ok ?? null;

  const [faceDiag, setFaceDiag] = useState<string>(
    String(modelo?.geometria?.face_principal ?? facesOrdenadas[0] ?? "0"),
  );
  const diagFaceLista = useMemo(() => {
    const todas = new Set<string>(facesOrdenadas);
    if (modelo?.geometria?.face_principal != null) todas.add(String(modelo.geometria.face_principal));
    return Array.from(todas).sort((a, b) => Number(a) - Number(b));
  }, [facesOrdenadas, modelo]);

  const diag = useMemo(() => {
    if (!modelo) return null;
    const geom = obterGeometriaRenderizavelDaFace(modelo, faceDiag);
    if (!geom) return null;
    const opsFace = (modelo.operacoes ?? []).filter((o) => String(o.face) === faceDiag);
    const TOL = 1.5;
    const opsTestadas = opsFace.map((op) => {
      const amostras = amostrarPontosDeOperacao(op);
      const resultados = amostras.map((p) => {
        const r = classificarPontoNoPoligono(p, geom.pontos_contorno, TOL);
        return { label: p.label, x: p.x, y: p.y, valido: r.valido, na_borda: r.na_borda, dentro: r.dentro, dist: r.distancia_borda };
      });
      return { op, resultados, ok: resultados.every((r) => r.valido) };
    });
    return { geom, opsTestadas };
  }, [modelo, faceDiag]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Modelo Técnico — Validador (Importador V2)</h3>
          <p className="text-xs text-muted-foreground">
            "Modelo OK" cobre parser/contagens. "Renderização OK" cobre se as operações ficam dentro do contorno técnico usado pelo visualizador.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {resultado.ok ? (
            <span className="inline-flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Modelo Técnico OK
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" /> Modelo inválido
            </span>
          )}
          {renderizacaoOk === true && (
            <span className="inline-flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Renderização OK
            </span>
          )}
          {renderizacaoOk === false && (
            <span className="inline-flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-sm font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" /> Renderização divergente ({validacaoGeom?.forasDoContorno.length ?? 0})
            </span>
          )}
        </div>
      </header>

      {resultado.ok && renderizacaoOk === false && (
        <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-300">
          Modelo técnico válido, mas renderização divergente — alguma operação está caindo fora do contorno usado pelo visualizador.
        </div>
      )}

      {/* Geometria */}
      <section className="rounded border border-border bg-surface p-3 text-sm">
        <div className="mb-2 font-medium">Geometria</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Tipo" value={lite.geometria?.tipo ?? "—"} />
          <Field label="Origem" value={lite.geometria?.origem ?? "—"} />
          <Field label="Pontos contorno" value={String(pontos.length)} />
          <Field
            label="Face principal"
            value={String(lite.geometria?.face_principal ?? "—")}
          />
        </div>
        {pontos.length > 0 && (
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">
            {pontos.map((p, i) => `${i + 1}. (${p.x}, ${p.y})`).join("\n")}
          </pre>
        )}
      </section>

      {/* Importação técnica: medidas, face A, bordas/fita */}
      <section className="rounded border border-border bg-surface p-3 text-sm">
        <div className="mb-2 font-medium">Importação técnica</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Largura" value={lite.medidas?.largura != null ? `${lite.medidas.largura} mm` : "—"} />
          <Field label="Altura" value={lite.medidas?.altura != null ? `${lite.medidas.altura} mm` : "—"} />
          <Field label="Espessura" value={lite.medidas?.espessura != null ? `${lite.medidas.espessura} mm` : "—"} />
          <Field label="Face de alinhamento" value={lite.face_alinhamento ?? "—"} />
        </div>
        {(lite.bordas ?? []).length > 0 && (
          <table className="mt-2 w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left">Marcador</th>
                <th className="text-left">Código da fita</th>
                <th className="text-right">Quantidade (m)</th>
              </tr>
            </thead>
            <tbody>
              {(lite.bordas ?? []).map((b, i) => (
                <tr key={i}>
                  <td>{b.indicador_desenho ?? "—"}</td>
                  <td className="font-mono">{b.codigo_borda ?? "—"}</td>
                  <td className="text-right">{b.quantidade_m != null ? b.quantidade_m.toFixed(3) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Segmentos de perfis (peças em L) */}
      {modelo?.faces_visuais_segmentadas && modelo.faces_visuais_segmentadas.length > 0 && (
        <section className="rounded border border-border bg-surface p-3 text-sm">
          <div className="mb-1 font-medium">Perfis segmentados (peça em L)</div>
          <p className="mb-2 text-xs text-muted-foreground">
            Uma mesma vista de perfil pode conter mais de uma face operacional,
            separadas por linha divisória derivada do recorte interno do L.
          </p>
          <div className="space-y-2">
            {modelo.faces_visuais_segmentadas.map((perfil, idx) => (
              <div key={idx} className="rounded bg-muted/30 p-2 text-xs">
                <div className="mb-1 font-mono">
                  Perfil {perfil.perfil} ({perfil.orientacao}) — total{" "}
                  {perfil.comprimento_total.toFixed(2)} mm
                  {perfil.divisao_em != null && (
                    <span className="ml-2 text-muted-foreground">
                      • divisão em {perfil.divisao_em.toFixed(2)} mm
                    </span>
                  )}
                </div>
                <table className="w-full">
                  <thead className="text-[10px] uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left">Face</th>
                      <th className="text-right">Início</th>
                      <th className="text-right">Fim</th>
                      <th className="text-right">Comprimento</th>
                      <th className="text-left">Origem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perfil.faces.map((seg) => (
                      <tr key={seg.face}>
                        <td className="font-mono">F{seg.face}</td>
                        <td className="text-right font-mono">{seg.inicio_mm.toFixed(2)}</td>
                        <td className="text-right font-mono">{seg.fim_mm.toFixed(2)}</td>
                        <td className="text-right font-mono">{seg.comprimento_mm.toFixed(2)}</td>
                        <td className="text-muted-foreground">{seg.origem_medida}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Por face */}
      <section className="rounded border border-border bg-surface p-3 text-sm">
        <div className="mb-2 font-medium">Operações por face</div>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left">Face</th>
              <th className="text-right">Furos</th>
              <th className="text-right">Rasgos</th>
              <th className="text-right">Usinagens</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {facesOrdenadas.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-center text-muted-foreground">
                  Nenhuma operação detectada.
                </td>
              </tr>
            )}
            {facesOrdenadas.map((f) => {
              const r = det.por_face[f];
              const face0Declarada = String(lite.geometria?.face_principal ?? "") === "0" ||
                (lite.faces_operacionais ?? []).map(String).includes("0") ||
                (lite.faces_visuais ?? []).map(String).includes("0");
              const danger = f === "0" && r.total > 0 && !face0Declarada;
              return (
                <tr key={f} className={danger ? "text-destructive" : ""}>
                  <td>Face {f}{danger ? " (não permitido)" : ""}</td>
                  <td className="text-right">{r.furos}</td>
                  <td className="text-right">{r.rasgos}</td>
                  <td className="text-right">{r.usinagens}</td>
                  <td className="text-right font-medium">{r.total}</td>
                </tr>
              );
            })}
            <tr className="border-t font-medium">
              <td>Totais</td>
              <td className="text-right">{det.furos_total}</td>
              <td className="text-right">{det.rasgos_total}</td>
              <td className="text-right">{det.usinagens_total}</td>
              <td className="text-right">{det.operacoes_total}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Erros */}
      {resultado.erros.length > 0 && (
        <section className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="mb-1 font-medium text-destructive">Divergências ({resultado.erros.length})</div>
          <ul className="ml-5 list-disc text-xs">
            {resultado.erros.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </section>
      )}
      {resultado.avisos.length > 0 && (
        <section className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <div className="mb-1 font-medium text-amber-700 dark:text-amber-400">Avisos</div>
          <ul className="ml-5 list-disc text-xs">
            {resultado.avisos.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}
