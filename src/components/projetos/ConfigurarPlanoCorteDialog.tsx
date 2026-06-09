import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Scissors, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { calcularPlanoCorte, type Chapa as ChapaT, type PecaInput } from "@/lib/nesting";

type ChapaRow = {
  id: string;
  nome: string;
  codigo: string;
  espessura: number;
  largura: number;
  altura: number;
  veio: string;
  cor: string;
};

const CHAPA_DEFAULT_ID = "__default__";

export function ConfigurarPlanoCorteDialog({
  open, onOpenChange, projetoId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projetoId: string;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: chapas } = useQuery({
    queryKey: ["chapas-config-plano"],
    queryFn: async () => {
      const { data } = await supabase
        .from("chapas").select("id, nome, codigo, espessura, largura, altura, veio, cor")
        .eq("ativa", true).order("nome");
      return (data ?? []) as ChapaRow[];
    },
  });

  const [chapaId, setChapaId] = useState<string>(CHAPA_DEFAULT_ID);
  const [largura, setLargura] = useState(2785);
  const [altura, setAltura] = useState(1850);
  const [espessura, setEspessura] = useState(15);
  const [possuiVeio, setPossuiVeio] = useState(false);
  const [margem, setMargem] = useState(10);
  const [espacamento, setEspacamento] = useState(6);
  const [permitirRotacao, setPermitirRotacao] = useState(true);
  const [maquinaDestino, setMaquinaDestino] = useState<"nesting" | "seccionadora">("nesting");

  useEffect(() => {
    if (chapaId === CHAPA_DEFAULT_ID) {
      setLargura(2785); setAltura(1850); setEspessura(15); setPossuiVeio(false);
      return;
    }
    const c = chapas?.find((x) => x.id === chapaId);
    if (c) {
      setLargura(Number(c.largura));
      setAltura(Number(c.altura));
      setEspessura(Number(c.espessura));
      setPossuiVeio(c.veio !== "nenhum");
    }
  }, [chapaId, chapas]);

  const gerar = useMutation({
    mutationFn: async () => {
      // 1) buscar peças
      const { data: pecasRaw, error: e0 } = await supabase
        .from("projeto_pecas").select("*").eq("projeto_id", projetoId).order("ordem");
      if (e0) throw e0;

      const pecas = (pecasRaw ?? []) as Array<{
        id: string; descricao: string; codigo: string | null;
        quantidade: number; largura: number; altura: number;
        espessura: number; chapa_id: string | null; veio: boolean | null;
      }>;

      // 2) validar
      const validas = pecas.filter(
        (p) => (p.largura ?? 0) > 0 && (p.altura ?? 0) > 0 && (p.espessura ?? 0) > 0 && (p.quantidade ?? 0) > 0,
      );
      if (validas.length === 0) {
        throw new Error(
          "Não há peças válidas para gerar plano de corte. Cadastre peças com largura, altura, espessura e quantidade.",
        );
      }

      // 3) montar chapas para o cálculo
      const chapaSintetica: ChapaT = {
        id: CHAPA_DEFAULT_ID,
        nome: "Chapa padrão",
        codigo: "DEFAULT",
        cor: "#e8dcc4",
        espessura, largura, altura,
        permite_rotacao: !possuiVeio,
        veio: possuiVeio ? "horizontal" : "nenhum",
      };
      const chapaSelecionada = chapaId !== CHAPA_DEFAULT_ID
        ? chapas?.find((c) => c.id === chapaId)
        : null;
      const chapasParaCalc: ChapaT[] = chapaSelecionada
        ? [{
            id: chapaSelecionada.id,
            nome: chapaSelecionada.nome,
            codigo: chapaSelecionada.codigo,
            cor: chapaSelecionada.cor,
            espessura: Number(chapaSelecionada.espessura),
            largura: Number(chapaSelecionada.largura),
            altura: Number(chapaSelecionada.altura),
            permite_rotacao: chapaSelecionada.veio === "nenhum",
            veio: chapaSelecionada.veio,
          }]
        : [chapaSintetica];

      const fallbackId = chapasParaCalc[0].id;

      // Forçar todas as peças à chapa escolhida na configuração (1 chapa por plano nesta fase)
      const input: PecaInput[] = validas.map((p) => ({
        id: p.id,
        descricao: p.descricao,
        codigo: p.codigo,
        largura: Number(p.largura),
        altura: Number(p.altura),
        espessura: Number(p.espessura),
        chapa_id: fallbackId,
        quantidade: Number(p.quantidade) || 1,
        permite_rotacao_peca: !p.veio,
      }));

      // 4) calcular
      const resultado = calcularPlanoCorte(input, chapasParaCalc, {
        margem, espacamento, permitir_rotacao: permitirRotacao && !possuiVeio,
      });

      // 4.1) validar resultado — não salvar plano vazio
      if (resultado.chapas.length === 0 || resultado.total_pecas === 0) {
        const motivos = resultado.pecas_nao_encaixadas.slice(0, 3).map((p) => `• ${p.descricao}: ${p.motivo}`).join("\n");
        throw new Error(
          `Não foi possível gerar plano de corte: nenhuma peça foi posicionada.${motivos ? `\n${motivos}` : ""}`,
        );
      }

      // 5) descobrir próxima versão
      const { data: ultimo } = await supabase
        .from("planos_corte").select("versao")
        .eq("projeto_id", projetoId)
        .order("versao", { ascending: false }).limit(1).maybeSingle();
      const proximaVersao = (ultimo?.versao ?? 0) + 1;

      // 6) salvar planos_corte — fonte da verdade do plano fica em plano_corte_json
      const planoJsonObj = {
        nome: `Plano de corte ${proximaVersao}`,
        configuracao: {
          chapa_id: chapaId === CHAPA_DEFAULT_ID ? null : chapaId,
          largura_chapa: largura, altura_chapa: altura, espessura,
          margem, espacamento, possui_veio: possuiVeio,
          permitir_rotacao: permitirRotacao && !possuiVeio,
          maquina_destino: maquinaDestino,
        },
        plano: resultado.chapas.map((c) => ({
          indice: c.indice,
          chapa: { id: c.chapa.id, nome: c.chapa.nome, largura: c.chapa.largura, altura: c.chapa.altura, espessura: c.chapa.espessura },
          pecas: c.pecas,
          sobras: c.sobras,
          aproveitamento: c.aproveitamento,
          area_usada: c.area_usada,
        })),
        pecas_nao_encaixadas: resultado.pecas_nao_encaixadas,
        aproveitamento_percentual: (resultado.aproveitamento_medio ?? 0) * 100,
      };

      const aprovPct = (resultado.aproveitamento_medio ?? 0) * 100;
      const { data: plano, error: e1 } = await supabase.from("planos_corte").insert({
        projeto_id: projetoId,
        versao: proximaVersao,
        aproveitamento_medio: resultado.aproveitamento_medio,
        aproveitamento_percentual: aprovPct,
        total_chapas: resultado.total_chapas,
        total_pecas: resultado.total_pecas,
        status: "gerado",
        plano_corte_json: planoJsonObj,
      } as never).select().single();
      if (e1) throw e1;

      // 7) persistir chapas/peças apenas para chapas REAIS (com FK)
      for (const c of resultado.chapas) {
        if (c.chapa.id === CHAPA_DEFAULT_ID) continue;
        const { data: pc, error: e2 } = await supabase.from("plano_corte_chapas").insert({
          plano_id: plano.id, chapa_id: c.chapa.id, indice: c.indice,
          aproveitamento: c.aproveitamento, area_usada: c.area_usada,
        }).select().single();
        if (e2) throw e2;
        if (c.pecas.length > 0) {
          const { error: e3 } = await supabase.from("plano_corte_pecas").insert(
            c.pecas.map((p) => ({
              plano_chapa_id: pc.id, projeto_peca_id: p.projeto_peca_id,
              x: p.x, y: p.y, largura: p.largura, altura: p.altura, rotacionada: p.rotacionada,
            })),
          );
          if (e3) throw e3;
        }
        if (c.sobras.length > 0) {
          await supabase.from("sobras_chapa").insert(
            c.sobras.map((s) => ({ plano_chapa_id: pc.id, ...s })),
          );
        }
      }

      // 8) atualizar status do projeto
      await supabase.from("projetos").update({ status: "plano_corte_gerado" }).eq("id", projetoId);

      console.info("[plano-corte]", {
        pecas_carregadas: pecas.length,
        pecas_validas: validas.length,
        expandidas: input.reduce((s, p) => s + p.quantidade, 0),
        posicionadas: resultado.total_pecas,
        nao_encaixadas: resultado.pecas_nao_encaixadas.length,
        chapas: resultado.total_chapas,
        aproveitamento: resultado.aproveitamento_medio,
      });

      return { plano, resultado };
    },
    onSuccess: ({ resultado }) => {
      qc.invalidateQueries({ queryKey: ["planos-corte-list", projetoId] });
      qc.invalidateQueries({ queryKey: ["projeto", projetoId] });
      qc.invalidateQueries({ queryKey: ["projetos"] });
      const naoEnc = resultado.pecas_nao_encaixadas.length;
      toast.success(
        `Plano de corte gerado: ${resultado.total_chapas} chapa(s), ${resultado.total_pecas} peça(s), ${Math.round(resultado.aproveitamento_medio * 100)}% aprov.${naoEnc > 0 ? ` · ${naoEnc} não encaixada(s)` : ""}`,
      );
      onOpenChange(false);
      // abrir visualizador
      navigate({
        to: "/projetos/$id/plano",
        params: { id: projetoId },
        search: {
          chapa: chapaId === CHAPA_DEFAULT_ID ? undefined : chapaId,
          larg: largura, alt: altura, esp: espessura,
          veio: possuiVeio ? 1 : 0,
          margem, gap: espacamento,
          rot: permitirRotacao ? 1 : 0,
          maq: maquinaDestino,
        } as Record<string, unknown>,
      });
    },
    onError: (e: Error) => {
      console.error("[plano-corte] erro:", e);
      toast.error(e.message || "Falha ao gerar plano de corte");
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !gerar.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-4 w-4" />Configurar plano de corte
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">Chapa</Label>
            <Select value={chapaId} onValueChange={setChapaId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={CHAPA_DEFAULT_ID}>Chapa padrão (2785 × 1850 × 15)</SelectItem>
                {chapas?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome} · {c.largura}×{c.altura}×{c.espessura}mm
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Largura (mm)</Label>
              <Input type="number" value={largura} onChange={(e) => setLargura(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Altura (mm)</Label>
              <Input type="number" value={altura} onChange={(e) => setAltura(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Espessura (mm)</Label>
              <Input type="number" value={espessura} onChange={(e) => setEspessura(Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Margem (mm)</Label>
              <Input type="number" min={0} value={margem} onChange={(e) => setMargem(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Espaçamento entre peças (mm)</Label>
              <Input type="number" min={0} value={espacamento} onChange={(e) => setEspacamento(Number(e.target.value))} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded border border-border p-2">
            <Label className="text-xs">Chapa possui veio</Label>
            <Switch checked={possuiVeio} onCheckedChange={setPossuiVeio} />
          </div>

          <div className="flex items-center justify-between rounded border border-border p-2">
            <Label className="text-xs">
              Permitir rotação das peças
              {possuiVeio && <span className="ml-1 text-muted-foreground">(bloqueada por veio)</span>}
            </Label>
            <Switch
              checked={permitirRotacao && !possuiVeio}
              onCheckedChange={setPermitirRotacao}
              disabled={possuiVeio}
            />
          </div>

          <div>
            <Label className="text-xs">Máquina destino</Label>
            <Select value={maquinaDestino} onValueChange={(v) => setMaquinaDestino(v as "nesting" | "seccionadora")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nesting">Nesting / Router</SelectItem>
                <SelectItem value="seccionadora">Seccionadora</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={gerar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => gerar.mutate()} disabled={gerar.isPending}>
            {gerar.isPending
              ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Gerando…</>
              : <><Scissors className="mr-1 h-4 w-4" />Gerar plano de corte</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
