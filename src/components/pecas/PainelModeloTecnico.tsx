import { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ModeloTecnicoJson } from "@/lib/peca-modelo-tecnico";
import {
  validarModeloTecnico,
  validarParserBAS0485A,
  validarParserBAS1101A,
  validarParserBAS3520A,
  calcularDetalhesModelo,
  type ModeloTecnicoLite,
} from "@/lib/validar-modelo-tecnico";

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
    return validarModeloTecnico(lite);
  }, [lite, codigo]);

  const det = resultado.detalhes ?? calcularDetalhesModelo(lite);
  const facesOrdenadas = Object.keys(det.por_face).sort((a, b) => Number(a) - Number(b));
  const pontos = lite.geometria?.pontos_contorno ?? [];

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Modelo Técnico — Validador (Importador V2)</h3>
          <p className="text-xs text-muted-foreground">
            O visualizador só deve desenhar se este painel mostrar ✓ OK.
            {(codigo ?? "").toUpperCase() === "BAS0485A" && " Teste-fixture: BAS0485A."}
            {(codigo ?? "").toUpperCase() === "BAS1101A" && " Teste-fixture: BAS1101A."}
          </p>
        </div>
        {resultado.ok ? (
          <span className="inline-flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Modelo OK
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-sm font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" /> Modelo inválido
          </span>
        )}
      </header>

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
              const danger = f === "0" && r.total > 0;
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
