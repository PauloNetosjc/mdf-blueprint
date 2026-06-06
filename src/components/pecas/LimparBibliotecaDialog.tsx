import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const FRASE_CONFIRMACAO = "APAGAR BIBLIOTECA";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLimpezaConcluida?: () => void;
};

type Resumo = {
  pecas: number;
  operacoes: number;
  bordas: number;
  vinculos: number;
  arquivosRemovidos: number;
  arquivosFalhos: number;
};

export function LimparBibliotecaDialog({ open, onOpenChange, onLimpezaConcluida }: Props) {
  const [texto, setTexto] = useState("");
  const [executando, setExecutando] = useState(false);
  const [resumo, setResumo] = useState<Resumo | null>(null);

  const habilitado = texto.trim() === FRASE_CONFIRMACAO;

  const handleClose = (next: boolean) => {
    if (executando) return;
    if (!next) {
      setTexto("");
      setResumo(null);
    }
    onOpenChange(next);
  };

  const executarLimpeza = async () => {
    if (!habilitado || executando) return;
    setExecutando(true);
    const resultado: Resumo = {
      pecas: 0,
      operacoes: 0,
      bordas: 0,
      vinculos: 0,
      arquivosRemovidos: 0,
      arquivosFalhos: 0,
    };

    try {
      const userResp = await supabase.auth.getUser();
      const userId = userResp.data.user?.id;
      if (!userId) throw new Error("Sessão expirada. Faça login novamente.");

      // 1) Listar peças do usuário
      const { data: pecas, error: errPecas } = await db
        .from("pecas_cadastradas")
        .select("id, pdf_url")
        .eq("user_id", userId);
      if (errPecas) throw errPecas;

      const ids: string[] = (pecas ?? []).map((p: { id: string }) => p.id);
      const caminhosStorage: string[] = (pecas ?? [])
        .map((p: { pdf_url: string | null }) => extrairCaminhoStorage(p.pdf_url))
        .filter((c: string | null): c is string => Boolean(c));

      if (ids.length === 0) {
        setResumo(resultado);
        toast.info("Biblioteca já está vazia.");
        return;
      }

      // 2) Contar e deletar operações
      const { count: countOps } = await db
        .from("peca_cadastrada_operacoes")
        .select("id", { count: "exact", head: true })
        .in("peca_cadastrada_id", ids);
      resultado.operacoes = countOps ?? 0;
      const { error: errOps } = await db
        .from("peca_cadastrada_operacoes")
        .delete()
        .in("peca_cadastrada_id", ids);
      if (errOps) throw errOps;

      // 3) Contar e deletar bordas
      const { count: countBordas } = await db
        .from("peca_cadastrada_bordas")
        .select("id", { count: "exact", head: true })
        .in("peca_cadastrada_id", ids);
      resultado.bordas = countBordas ?? 0;
      const { error: errBordas } = await db
        .from("peca_cadastrada_bordas")
        .delete()
        .in("peca_cadastrada_id", ids);
      if (errBordas) throw errBordas;

      // 4) Desvincular (preservando projeto_pecas)
      const { count: countVinc } = await db
        .from("vinculos_peca_cadastrada")
        .select("id", { count: "exact", head: true })
        .in("peca_cadastrada_id", ids);
      resultado.vinculos = countVinc ?? 0;
      if (resultado.vinculos > 0) {
        const { error: errVinc } = await db
          .from("vinculos_peca_cadastrada")
          .update({ peca_cadastrada_id: null, status: "desvinculado" })
          .in("peca_cadastrada_id", ids);
        if (errVinc) throw errVinc;
      }

      // 5) Deletar peças
      const { error: errDel } = await db.from("pecas_cadastradas").delete().in("id", ids);
      if (errDel) throw errDel;
      resultado.pecas = ids.length;

      // 6) Arquivos do bucket (best-effort, em lotes de 100)
      if (caminhosStorage.length > 0) {
        for (let i = 0; i < caminhosStorage.length; i += 100) {
          const lote = caminhosStorage.slice(i, i + 100);
          const { data: removidos, error: errStorage } = await supabase.storage
            .from("pecas-cadastradas")
            .remove(lote);
          if (errStorage) {
            resultado.arquivosFalhos += lote.length;
          } else {
            resultado.arquivosRemovidos += removidos?.length ?? 0;
            resultado.arquivosFalhos += lote.length - (removidos?.length ?? 0);
          }
        }
      }

      setResumo(resultado);
      toast.success(`Biblioteca apagada: ${resultado.pecas} peças removidas.`);
      onLimpezaConcluida?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Falha ao limpar biblioteca: ${msg}`);
    } finally {
      setExecutando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Limpar biblioteca de peças cadastradas
          </DialogTitle>
          <DialogDescription>
            Esta ação irá apagar todas as peças cadastradas, operações, bordas, geometrias e arquivos
            da biblioteca técnica. Projetos já importados não serão apagados. Deseja continuar?
          </DialogDescription>
        </DialogHeader>

        {resumo ? (
          <div className="space-y-2 text-sm">
            <p className="font-medium">Limpeza concluída.</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
              <li>Peças apagadas: <span className="text-foreground">{resumo.pecas}</span></li>
              <li>Operações apagadas: <span className="text-foreground">{resumo.operacoes}</span></li>
              <li>Bordas apagadas: <span className="text-foreground">{resumo.bordas}</span></li>
              <li>Vínculos desfeitos: <span className="text-foreground">{resumo.vinculos}</span></li>
              <li>Arquivos removidos: <span className="text-foreground">{resumo.arquivosRemovidos}</span></li>
              <li>Arquivos não removidos: <span className="text-foreground">{resumo.arquivosFalhos}</span></li>
            </ul>
          </div>
        ) : (
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Ação irreversível</AlertTitle>
              <AlertDescription>
                Os dados da biblioteca técnica serão removidos permanentemente. Projetos, planos de
                corte, importações, ferramentas, máquinas, chapas, fitas, homologações e previews CNC
                <strong> não </strong> serão tocados.
              </AlertDescription>
            </Alert>
            <div className="space-y-1">
              <Label htmlFor="confirma-apagar">
                Para liberar a ação, digite <code className="rounded bg-muted px-1">APAGAR BIBLIOTECA</code>
              </Label>
              <Input
                id="confirma-apagar"
                autoComplete="off"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="APAGAR BIBLIOTECA"
                disabled={executando}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {resumo ? (
            <Button onClick={() => handleClose(false)}>Fechar</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => handleClose(false)} disabled={executando}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={executarLimpeza} disabled={!habilitado || executando}>
                {executando ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Apagando…</>
                ) : (
                  <><Trash2 className="mr-2 h-4 w-4" /> Apagar biblioteca</>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function extrairCaminhoStorage(pdfUrl: string | null): string | null {
  if (!pdfUrl) return null;
  // URLs públicas/assinadas do Supabase storage seguem .../object/(public|sign)/<bucket>/<path>
  const marcador = "/pecas-cadastradas/";
  const idx = pdfUrl.indexOf(marcador);
  if (idx >= 0) {
    const resto = pdfUrl.slice(idx + marcador.length);
    return resto.split("?")[0] || null;
  }
  // Caso já seja só o caminho relativo
  if (!pdfUrl.startsWith("http")) return pdfUrl.replace(/^\/+/, "");
  return null;
}
