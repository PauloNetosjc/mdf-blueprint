import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tag, Printer, RefreshCw } from "lucide-react";
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

type EtiquetaItem = {
  id_tecnico: string;
  plano_corte_id: string;
  projeto_peca_id: string | null;
  chapa_index: number;
  peca_index_chapa: number;
  codigo: string | null;
  descricao: string | null;
  modulo: string | null;
  largura: number;
  altura: number;
  espessura: number;
  quantidade_index: number;
  x: number;
  y: number;
  rotacionada: boolean;
  fita_codigo: string | null;
  veio: boolean;
  observacao: string | null;
};

type EtiquetasJson = {
  plano_corte_id: string;
  projeto_id: string;
  gerado_em: string;
  total_etiquetas: number;
  etiquetas: EtiquetaItem[];
};

type EtiquetasRow = {
  id: string;
  plano_corte_id: string;
  etiquetas_json: EtiquetasJson;
  total_etiquetas: number;
  status: string;
  criado_em: string;
};

function pad2(n: number) { return String(n).padStart(2, "0"); }

function nomePlano(p: PlanoRow): string {
  const j = p.plano_corte_json;
  if (j && typeof j === "object" && typeof j.nome === "string") return j.nome;
  return `Plano v${p.versao}`;
}

function construirEtiquetas(plano: PlanoRow, projetoId: string): EtiquetasJson {
  const j = plano.plano_corte_json;
  const chapas: any[] = Array.isArray(j?.plano) ? j.plano : [];
  const etiquetas: EtiquetaItem[] = [];
  chapas.forEach((c, ci) => {
    const pecas: any[] = Array.isArray(c?.pecas) ? c.pecas : [];
    pecas.forEach((p, pi) => {
      etiquetas.push({
        id_tecnico: `CH${ci + 1}-P${pad2(pi + 1)}`,
        plano_corte_id: plano.id,
        projeto_peca_id: p.projeto_peca_id ?? null,
        chapa_index: ci + 1,
        peca_index_chapa: pi + 1,
        codigo: p.codigo ?? null,
        descricao: p.descricao ?? null,
        modulo: p.modulo ?? null,
        largura: Number(p.largura) || 0,
        altura: Number(p.altura) || 0,
        espessura: Number(p.espessura ?? c?.chapa?.espessura) || 0,
        quantidade_index: pi + 1,
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        rotacionada: !!p.rotacionada,
        fita_codigo: p.fita_codigo ?? null,
        veio: p.veio === true,
        observacao: p.observacao ?? null,
      });
    });
  });
  return {
    plano_corte_id: plano.id,
    projeto_id: projetoId,
    gerado_em: new Date().toISOString(),
    total_etiquetas: etiquetas.length,
    etiquetas,
  };
}

export function EtiquetasPlanoTab({ projetoId }: { projetoId: string }) {
  const qc = useQueryClient();
  const [planoSel, setPlanoSel] = useState<string | "">("");

  const { data: projeto } = useQuery({
    queryKey: ["projeto-min", projetoId],
    queryFn: async () => {
      const { data } = await supabase.from("projetos").select("id, nome, cliente").eq("id", projetoId).single();
      return data as { id: string; nome: string; cliente: string | null } | null;
    },
  });

  const { data: planos } = useQuery({
    queryKey: ["planos-corte-etq", projetoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("planos_corte")
        .select("id, versao, status, total_chapas, total_pecas, aproveitamento_percentual, plano_corte_json, created_at" as never)
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

  const { data: etqRow, refetch: refetchEtq } = useQuery({
    queryKey: ["etiquetas-pc", planoSel],
    enabled: !!planoSel,
    queryFn: async () => {
      const { data } = await supabase
        .from("etiquetas_planos_corte" as never)
        .select("*")
        .eq("plano_corte_id", planoSel)
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as unknown as EtiquetasRow | null;
    },
  });

  const gerar = useMutation({
    mutationFn: async () => {
      if (!planoAtual) throw new Error("Selecione um plano de corte.");
      const j = planoAtual.plano_corte_json;
      const chapas: any[] = Array.isArray(j?.plano) ? j.plano : [];
      const totalPecas = chapas.reduce((s, c) => s + (Array.isArray(c?.pecas) ? c.pecas.length : 0), 0);
      if (!j || chapas.length === 0 || totalPecas === 0) {
        throw new Error("Não foi possível gerar etiquetas: plano de corte vazio ou inválido.");
      }
      const etiquetas_json = construirEtiquetas(planoAtual, projetoId);
      if (etqRow) {
        const { error } = await supabase
          .from("etiquetas_planos_corte" as never)
          .update({
            etiquetas_json: etiquetas_json as any,
            total_etiquetas: etiquetas_json.total_etiquetas,
            status: "gerado",
            atualizado_em: new Date().toISOString(),
          } as any)
          .eq("id", etqRow.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("etiquetas_planos_corte" as never)
          .insert(({
            projeto_id: projetoId,
            plano_corte_id: planoAtual.id,
            etiquetas_json: etiquetas_json as any,
            total_etiquetas: etiquetas_json.total_etiquetas,
            status: "gerado",
          } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Etiquetas geradas");
      qc.invalidateQueries({ queryKey: ["etiquetas-pc", planoSel] });
      refetchEtq();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const etiquetas = etqRow?.etiquetas_json?.etiquetas ?? [];

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #area-etiquetas-print, #area-etiquetas-print * { visibility: visible !important; }
          #area-etiquetas-print { position: absolute; left: 0; top: 0; width: 100%; }
          .etiqueta-print { page-break-inside: avoid; break-inside: avoid; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div>
          <h2 className="text-lg font-semibold">Etiquetas do Plano de Corte</h2>
          <p className="text-xs text-muted-foreground">
            Gere e imprima etiquetas técnicas a partir do plano de corte salvo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={planoSel} onValueChange={setPlanoSel}>
            <SelectTrigger className="w-[260px]"><SelectValue placeholder="Selecione um plano" /></SelectTrigger>
            <SelectContent>
              {(planos ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {nomePlano(p)} · {p.total_chapas} ch / {p.total_pecas} pç
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => gerar.mutate()} disabled={!planoAtual || gerar.isPending}>
            <Tag className="mr-2 h-4 w-4" />
            {etqRow ? "Regerar etiquetas" : "Gerar etiquetas"}
          </Button>
          <Button
            variant="outline"
            onClick={() => window.print()}
            disabled={etiquetas.length === 0}
          >
            <Printer className="mr-2 h-4 w-4" />Imprimir etiquetas
          </Button>
          <Button variant="ghost" size="icon" onClick={() => refetchEtq()} title="Recarregar">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {planoAtual && (
        <div className="rounded border border-border bg-surface p-3 text-xs no-print">
          <div className="flex flex-wrap gap-4">
            <span><strong>Plano:</strong> {nomePlano(planoAtual)}</span>
            <span><strong>Chapas:</strong> {planoAtual.total_chapas}</span>
            <span><strong>Peças:</strong> {planoAtual.total_pecas}</span>
            <span><strong>Aproveitamento:</strong> {Math.round(planoAtual.aproveitamento_percentual || 0)}%</span>
            {etqRow && (
              <span>
                <strong>Etiquetas:</strong> {etqRow.total_etiquetas}{" "}
                <Badge variant="secondary" className="ml-1">{etqRow.status}</Badge>
              </span>
            )}
          </div>
        </div>
      )}

      {etiquetas.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-surface p-8 text-center text-sm text-muted-foreground no-print">
          {planoAtual
            ? 'Nenhuma etiqueta gerada ainda. Clique em "Gerar etiquetas".'
            : "Selecione um plano de corte."}
        </div>
      ) : (
        <div id="area-etiquetas-print" className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {etiquetas.map((e) => (
            <div
              key={e.id_tecnico}
              className="etiqueta-print flex flex-col justify-between border-2 border-black bg-white p-2 text-black"
              style={{ width: "100mm", height: "60mm", fontFamily: "Arial, sans-serif", fontSize: "9pt" }}
            >
              <div className="flex items-start justify-between border-b border-black pb-1">
                <div className="font-mono text-base font-black leading-none">{e.id_tecnico}</div>
                <div className="text-right text-[8pt] leading-tight">
                  <div className="font-semibold uppercase">{projeto?.nome ?? "Projeto"}</div>
                  {projeto?.cliente && <div className="opacity-70">{projeto.cliente}</div>}
                </div>
              </div>

              <div className="flex flex-1 flex-col justify-center gap-0.5">
                {e.codigo && <div className="font-mono text-[10pt] font-bold">{e.codigo}</div>}
                <div className="line-clamp-2 text-[9pt]">{e.descricao || "—"}</div>
                <div className="font-mono text-[10pt] font-bold">
                  {e.largura} × {e.altura} × {e.espessura} mm
                </div>
                <div className="flex flex-wrap gap-x-2 text-[7.5pt] opacity-80">
                  {e.modulo && <span>Mód: {e.modulo}</span>}
                  {e.fita_codigo && <span>Fita: {e.fita_codigo}</span>}
                  <span>Veio: {e.veio ? "Sim" : "Não"}</span>
                </div>
                {e.observacao && (
                  <div className="truncate text-[7.5pt] italic opacity-70">{e.observacao}</div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-black pt-1 text-[8pt]">
                <span><strong>Chapa {e.chapa_index}</strong></span>
                <span>X: {Math.round(e.x)}</span>
                <span>Y: {Math.round(e.y)}</span>
                <span>Rot: {e.rotacionada ? "Sim" : "Não"}</span>
                <span>#{e.peca_index_chapa}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
