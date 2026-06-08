import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Scissors } from "lucide-react";

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

export function ConfigurarPlanoCorteDialog({
  open, onOpenChange, projetoId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projetoId: string;
}) {
  const navigate = useNavigate();

  const { data: chapas } = useQuery({
    queryKey: ["chapas-config-plano"],
    queryFn: async () => {
      const { data } = await supabase
        .from("chapas").select("id, nome, codigo, espessura, largura, altura, veio, cor")
        .eq("ativa", true).order("nome");
      return (data ?? []) as ChapaRow[];
    },
  });

  const [chapaId, setChapaId] = useState<string>("__default__");
  const [largura, setLargura] = useState(2785);
  const [altura, setAltura] = useState(1850);
  const [espessura, setEspessura] = useState(15);
  const [possuiVeio, setPossuiVeio] = useState(false);
  const [margem, setMargem] = useState(10);
  const [espacamento, setEspacamento] = useState(6);
  const [permitirRotacao, setPermitirRotacao] = useState(true);
  const [maquinaDestino, setMaquinaDestino] = useState<"nesting" | "seccionadora">("nesting");

  useEffect(() => {
    if (chapaId === "__default__") {
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

  function gerar() {
    onOpenChange(false);
    navigate({
      to: "/projetos/$id/plano",
      params: { id: projetoId },
      search: {
        chapa: chapaId === "__default__" ? undefined : chapaId,
        larg: largura,
        alt: altura,
        esp: espessura,
        veio: possuiVeio ? 1 : 0,
        margem,
        gap: espacamento,
        rot: permitirRotacao ? 1 : 0,
        maq: maquinaDestino,
      } as Record<string, unknown>,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                <SelectItem value="__default__">Chapa padrão (2785 × 1850 × 15)</SelectItem>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={gerar}><Scissors className="mr-1 h-4 w-4" />Gerar plano de corte</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
