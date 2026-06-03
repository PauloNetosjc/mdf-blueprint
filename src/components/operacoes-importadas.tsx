import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wand2, FileCode2 } from "lucide-react";
import { toast } from "sonner";

type OpImp = {
  id: string;
  origem: string | null;
  tipo_operacao: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  profundidade: number | null;
  diametro: number | null;
  ferramenta: string | null;
  confianca_parser: string;
  convertida_operacao_id: string | null;
};

const TIPO_MAP: Record<string, string> = {
  furacao: "furacao",
  rasgo: "rasgo",
  corte: "corte",
  rebaixo: "rebaixo",
  contorno: "contorno",
};

export function OperacoesImportadas({ pecaId, nextOrdem }: { pecaId: string; nextOrdem: number }) {
  const qc = useQueryClient();

  const ops = useQuery({
    queryKey: ["op-imp", pecaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("peca_operacoes_importadas")
        .select("*")
        .eq("peca_id", pecaId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as unknown as OpImp[];
    },
  });

  const converter = useMutation({
    mutationFn: async (o: OpImp) => {
      if (!o.x || !o.y) throw new Error("Operação sem coordenadas X/Y");
      const tipo = TIPO_MAP[o.tipo_operacao ?? ""] ?? "furacao";
      const { data: novo, error } = await supabase.from("operacoes").insert({
        peca_id: pecaId,
        numero_face: 0,
        tipo,
        x: o.x,
        y: o.y,
        z: o.z,
        diametro: o.diametro ?? 8,
        profundidade: o.profundidade ?? 10,
        ordem: nextOrdem,
        observacao: `Importado (${o.origem ?? "técnico"})`,
      }).select("id").single();
      if (error) throw error;
      await supabase.from("peca_operacoes_importadas")
        .update({ convertida_operacao_id: novo.id })
        .eq("id", o.id);
    },
    onSuccess: () => {
      toast.success("Operação convertida");
      qc.invalidateQueries({ queryKey: ["op-imp", pecaId] });
      qc.invalidateQueries({ queryKey: ["peca", pecaId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!ops.data?.length) return null;

  return (
    <div className="border-t border-border p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <FileCode2 className="h-3 w-3" /> Operações importadas ({ops.data.length})
      </div>
      <div className="max-h-64 space-y-1 overflow-auto">
        {ops.data.map((o) => (
          <div key={o.id} className="rounded border border-border bg-surface p-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-mono">{o.tipo_operacao}</span>
              <Badge variant="outline" className="text-[9px]">{o.confianca_parser}</Badge>
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">
              X{o.x ?? "—"} Y{o.y ?? "—"} Z{o.z ?? "—"} Ø{o.diametro ?? "—"} P{o.profundidade ?? "—"} {o.ferramenta ?? ""}
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">{o.origem ?? "—"}</span>
              {o.convertida_operacao_id ? (
                <Badge variant="default" className="text-[9px]">convertida</Badge>
              ) : (
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => converter.mutate(o)}>
                  <Wand2 className="mr-1 h-3 w-3" /> Converter
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
