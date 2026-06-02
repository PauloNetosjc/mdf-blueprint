import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { gerarGCode } from "@/lib/gcode";
import { validarOperacoes, validarPecaMaquina } from "@/lib/validacoes";
import type { Ferramenta, Maquina, Operacao, Peca, PreviewCnc } from "@/lib/db";
import { ArrowLeft, Copy, Download, AlertTriangle, CheckCircle2, RefreshCw, GitCompare } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pecas/$id/cnc")({
  head: () => ({ meta: [{ title: "Prévia CNC — Visualizador CNC" }] }),
  component: PreviaCnc,
});

function PreviaCnc() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [validado, setValidado] = useState(false);
  const [aprovador, setAprovador] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  const { data } = useQuery({
    queryKey: ["cnc", id],
    queryFn: async () => {
      const [peca, ops, ferr, maq, prev] = await Promise.all([
        supabase.from("pecas").select("*").eq("id", id).single(),
        supabase.from("operacoes").select("*").eq("peca_id", id).order("ordem"),
        supabase.from("ferramentas").select("*"),
        supabase.from("maquinas").select("*").eq("ativa", true).limit(1).maybeSingle(),
        supabase.from("previews_cnc").select("*").eq("peca_id", id).order("versao", { ascending: false }),
      ]);
      return {
        peca: peca.data as Peca,
        operacoes: (ops.data ?? []) as Operacao[],
        ferramentas: (ferr.data ?? []) as Ferramenta[],
        maquina: maq.data as Maquina | null,
        previews: (prev.data ?? []) as PreviewCnc[],
      };
    },
  });

  const salvarVersao = useMutation({
    mutationFn: async () => {
      if (!data?.peca || !data.maquina) throw new Error("Peça ou máquina indisponível");
      const { codigo, nome_arquivo } = gerarGCode(data.peca, data.operacoes, data.maquina, data.ferramentas);
      const versao = (data.previews[0]?.versao ?? 0) + 1;
      const { error } = await supabase.from("previews_cnc").insert({
        peca_id: data.peca.id,
        maquina_id: data.maquina.id,
        versao,
        conteudo: codigo,
        nome_arquivo,
        validado: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cnc", id] });
      toast.success("Nova versão gerada");
    },
  });

  const confirmarExport = useMutation({
    mutationFn: async () => {
      if (!data?.previews[0]) throw new Error();
      const { error } = await supabase
        .from("previews_cnc")
        .update({ validado: true, aprovado_por: aprovador })
        .eq("id", data.previews[0].id);
      if (error) throw error;
      // Atualiza status da peça
      await supabase.from("pecas").update({ status: "aprovada" }).eq("id", id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cnc", id] });
      toast.success("Validação registrada. Você pode baixar o .nc.");
      setShowConfirm(false);
    },
  });

  if (!data?.peca) return <div className="p-6">Carregando...</div>;
  const { peca, operacoes, ferramentas, maquina, previews } = data;

  if (!maquina) {
    return (
      <div className="p-6">
        <p className="text-destructive">Cadastre uma máquina ativa antes de gerar G-code.</p>
        <Button asChild className="mt-4"><Link to="/maquina">Ir para Máquina</Link></Button>
      </div>
    );
  }

  // Gera prévia em tempo real (não salva ainda)
  const previewAtual = gerarGCode(peca, operacoes, maquina, ferramentas);
  const alertas = [...validarPecaMaquina(peca, maquina), ...validarOperacoes(peca, operacoes, ferramentas)];
  const temErro = alertas.some((a) => a.nivel === "erro");
  const ultimaSalva = previews[0];
  const podeExportar = ultimaSalva?.validado;

  function baixar() {
    if (!ultimaSalva) return;
    const blob = new Blob([ultimaSalva.conteudo], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ultimaSalva.nome_arquivo;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copiar() {
    navigator.clipboard.writeText(previewAtual.codigo);
    toast.success("Código copiado");
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/pecas/$id" params={{ id }}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Prévia CNC — <span className="font-mono">{peca.codigo}</span></h1>
          <div className="text-xs text-muted-foreground">
            Arquivo: <span className="font-mono">{previewAtual.nome_arquivo}</span> · Máquina: {maquina.nome}
          </div>
        </div>
        <Button variant="outline" onClick={copiar}><Copy className="mr-2 h-4 w-4" />Copiar</Button>
        <Button variant="outline" asChild>
          <Link to="/pecas/$id/comparar" params={{ id }}><GitCompare className="mr-2 h-4 w-4" />Comparar com .nc original</Link>
        </Button>
        <Button variant="outline" onClick={() => salvarVersao.mutate()}>
          <RefreshCw className="mr-2 h-4 w-4" />Gerar nova versão
        </Button>
        <Button disabled={!podeExportar} onClick={baixar} title={!podeExportar ? "Valide antes de exportar" : ""}>
          <Download className="mr-2 h-4 w-4" />Baixar .nc
        </Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Esquerda: operações + alertas */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-panel">
          <div className="border-b border-border p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Operações ({operacoes.length})</div>
            <ul className="max-h-64 overflow-auto text-xs">
              {operacoes.map((op) => {
                const f = ferramentas.find((x) => x.id === op.ferramenta_id);
                return (
                  <li key={op.id} className="flex justify-between border-b border-border py-1 font-mono">
                    <span>#{op.ordem} F{op.numero_face} {op.tipo}</span>
                    <span className="text-muted-foreground">{f?.codigo ?? "—"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="border-b border-border p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Validações</div>
            {alertas.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle2 className="h-4 w-4" /> Sem alertas
              </div>
            ) : (
              <ul className="space-y-1.5">
                {alertas.map((a, i) => (
                  <li key={i} className={`rounded border-l-2 px-2 py-1 text-xs ${a.nivel === "erro" ? "border-destructive bg-destructive/5 text-destructive" : "border-warning bg-warning/10"}`}>
                    {a.mensagem}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex-1 overflow-auto p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Histórico ({previews.length})</div>
            <ul className="space-y-1">
              {previews.map((p) => (
                <li key={p.id} className="rounded border border-border bg-surface px-2 py-1.5 text-xs">
                  <div className="flex items-center justify-between font-mono">
                    <span>v{p.versao}</span>
                    {p.validado ? (
                      <span className="text-success">validado</span>
                    ) : (
                      <span className="text-muted-foreground">rascunho</span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(p.created_at).toLocaleString("pt-BR")}
                    {p.aprovado_por && ` · ${p.aprovado_por}`}
                  </div>
                </li>
              ))}
              {!previews.length && <li className="text-xs text-muted-foreground">Sem versões salvas ainda.</li>}
            </ul>
          </div>
        </aside>

        {/* Código */}
        <section className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-border bg-warning/10 px-4 py-2 text-xs">
            <AlertTriangle className="mr-1 inline h-3 w-3 text-warning" />
            Prévia técnica. Confirme a validação antes de exportar e usar em máquina.
          </div>
          <pre className="flex-1 overflow-auto bg-surface p-4 font-mono text-xs leading-relaxed">
            {previewAtual.codigo}
          </pre>

          {/* Painel de confirmação */}
          <div className="border-t border-border bg-panel p-4">
            {ultimaSalva && !ultimaSalva.validado && !showConfirm && (
              <Button onClick={() => setShowConfirm(true)} disabled={temErro}>
                {temErro ? "Resolva os erros antes de validar" : "Validar e liberar exportação"}
              </Button>
            )}
            {!ultimaSalva && (
              <p className="text-sm text-muted-foreground">
                Gere uma versão clicando em <strong>Gerar nova versão</strong> para poder validar e exportar.
              </p>
            )}
            {ultimaSalva?.validado && (
              <p className="text-sm text-success">
                <CheckCircle2 className="mr-1 inline h-4 w-4" />
                Versão {ultimaSalva.versao} validada por <strong>{ultimaSalva.aprovado_por}</strong>. Download liberado.
              </p>
            )}
            {showConfirm && ultimaSalva && (
              <div className="space-y-3 rounded border border-warning bg-warning/10 p-3">
                <p className="text-xs leading-relaxed">
                  Confirmo que revisei o G-code, o pós-processador, a origem, as ferramentas, as faces,
                  os avanços, a rotação e os limites da máquina conforme o manual técnico.
                </p>
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    id="conf"
                    checked={validado}
                    onChange={(e) => setValidado(e.target.checked)}
                    className="mt-1"
                  />
                  <Label htmlFor="conf" className="text-xs">Marco esta versão como tecnicamente validada.</Label>
                </div>
                <div>
                  <Label className="text-xs">Nome do responsável</Label>
                  <Input value={aprovador} onChange={(e) => setAprovador(e.target.value)} placeholder="Operador responsável" />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => confirmarExport.mutate()}
                    disabled={!validado || !aprovador.trim()}
                  >
                    Confirmar validação
                  </Button>
                  <Button variant="outline" onClick={() => setShowConfirm(false)}>Cancelar</Button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
