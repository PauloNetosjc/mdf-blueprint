import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  validarParserBAS0485A,
  validarParserBAS1101A,
  validarParserBAS3520A,
  type ResultadoValidacao,
  type ModeloTecnicoLite,
} from "@/lib/validar-modelo-tecnico";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

const FIXTURES = [
  { codigo: "BAS1101A", esperado: "retangular", validar: validarParserBAS1101A },
  { codigo: "BAS3520A", esperado: "retangular", validar: validarParserBAS3520A },
  { codigo: "BAS0485A", esperado: "L", validar: validarParserBAS0485A },
] as const;

type Linha = {
  codigo: string;
  esperado: string;
  encontrado: boolean;
  resultado: ResultadoValidacao | null;
  msg?: string;
};

function modeloParaLite(modelo: Record<string, unknown> | null, codigo: string): ModeloTecnicoLite | null {
  if (!modelo) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = modelo as any;
  return {
    codigo,
    geometria: m.geometria ?? null,
    faces_operacionais: (m.faces_operacionais ?? []).map((f: { face: string }) => Number(f.face)),
    faces_visuais: (m.faces_visuais ?? []).map((f: { face: string }) => Number(f.face)),
    face_alinhamento: m.face_alinhamento ?? null,
    medidas: m.medidas ?? {},
    bordas: (m.bordas ?? []).map((b: Record<string, unknown>) => ({
      codigo_borda: (b.codigo_borda as string | null) ?? null,
      indicador_desenho: (b.indicador_desenho as string | null) ?? null,
      quantidade_m: (b.quantidade_m as number | null) ?? null,
    })),
    operacoes: (m.operacoes ?? []).map((o: Record<string, unknown>) => ({
      tipo: o.tipo as string,
      face: o.face as string | number | null,
      x: (o.x as number | null) ?? null,
      y: (o.y as number | null) ?? null,
      diametro: (o.diametro as number | null) ?? null,
      profundidade: (o.profundidade as number | null) ?? null,
    })),
  };
}

export function ValidarFixturesDialog({ open, onOpenChange }: Props) {
  const [rodando, setRodando] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([]);

  useEffect(() => {
    if (!open) {
      setLinhas([]);
      return;
    }
    void rodar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function rodar() {
    setRodando(true);
    const out: Linha[] = [];
    for (const f of FIXTURES) {
      const { data, error } = await db
        .from("pecas_cadastradas")
        .select("dados_brutos_json")
        .eq("codigo_completo", f.codigo)
        .maybeSingle();
      if (error || !data) {
        out.push({ codigo: f.codigo, esperado: f.esperado, encontrado: false, resultado: null, msg: error?.message ?? "peça não cadastrada" });
        continue;
      }
      const dados = (data as { dados_brutos_json: Record<string, unknown> | null }).dados_brutos_json ?? {};
      const modelo = (dados.modelo_tecnico_json ?? null) as Record<string, unknown> | null;
      const lite = modeloParaLite(modelo, f.codigo);
      if (!lite) {
        out.push({ codigo: f.codigo, esperado: f.esperado, encontrado: true, resultado: null, msg: "modelo_tecnico_json ausente" });
        continue;
      }
      out.push({ codigo: f.codigo, esperado: f.esperado, encontrado: true, resultado: f.validar(lite) });
    }
    setLinhas(out);
    setRodando(false);
  }

  const todosOk = linhas.length === FIXTURES.length && linhas.every((l) => l.resultado?.ok === true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Validar importador com fixtures</DialogTitle>
          <DialogDescription>
            Testa BAS1101A (retangular), BAS3520A (retangular) e BAS0485A (L) contra o modelo técnico salvo.
            Só recomendar reimportação em massa quando todos passarem.
          </DialogDescription>
        </DialogHeader>

        {rodando ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Rodando fixtures…
          </div>
        ) : (
          <div className="space-y-3">
            {linhas.map((l) => {
              const ok = l.resultado?.ok === true;
              return (
                <div key={l.codigo} className="rounded border p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    {ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                    )}
                    {l.codigo} — esperado: <span className="text-muted-foreground">{l.esperado}</span>{" "}
                    {ok ? <span className="text-emerald-700">OK</span> : <span className="text-amber-700">com falhas</span>}
                  </div>
                  {!l.encontrado && (
                    <div className="text-xs text-muted-foreground mt-1">Peça não encontrada na biblioteca: {l.msg}</div>
                  )}
                  {l.msg && l.encontrado && (
                    <div className="text-xs text-muted-foreground mt-1">{l.msg}</div>
                  )}
                  {l.resultado?.erros?.length ? (
                    <ul className="mt-2 list-disc pl-5 text-xs text-amber-800 space-y-0.5">
                      {l.resultado.erros.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  ) : null}
                  {l.resultado?.avisos?.length ? (
                    <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
                      {l.resultado.avisos.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}

            {linhas.length > 0 && (
              <div
                className={`rounded p-3 text-sm font-medium ${
                  todosOk ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
                }`}
              >
                {todosOk
                  ? "✅ Importador V2 aprovado — reimportação em massa liberada."
                  : "⚠️ Importador V2 com falhas — corrigir antes de reimportar a biblioteca."}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button onClick={() => void rodar()} disabled={rodando}>Rodar novamente</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
