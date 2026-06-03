import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ShieldCheck, ShieldX, Eye, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import {
  CHECKLIST_HOMOLOGACAO, checklistCompleto, registrarAuditoria,
  STATUS_HOMOLOGACAO_LABELS, type Checklist,
} from "@/lib/auditoria";

export const Route = createFileRoute("/_authenticated/homologacao")({
  head: () => ({ meta: [{ title: "Homologação — Visualizador CNC" }] }),
  component: HomologacaoPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Não encontrado.</div>,
});

type Versao = {
  id: string;
  nome_arquivo: string;
  status: string;
  status_homologacao: string;
  versao: number;
  criado_em: string;
  validado_por: string | null;
  validado_em: string | null;
  aprovado_por: string | null;
  aprovado_em: string | null;
  reprovado_por: string | null;
  exportado_por: string | null;
  exportado_em: string | null;
  enviado_maquina_por: string | null;
  enviado_maquina_em: string | null;
  observacao_homologacao: string | null;
  projeto_id: string | null;
  chapa_id: string | null;
  plano_chapa_id: string | null;
  parametros_json: unknown;
  validacoes_json: unknown;
  checklist_json: Checklist;
  conteudo: string;
};

function HomologacaoPage() {
  const [tab, setTab] = useState("pendentes");
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border bg-panel px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold">Homologação</h1>
          <p className="text-[11px] text-muted-foreground">
            Aprovação, exportação e auditoria de G-codes
          </p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex-1 overflow-hidden">
        <TabsList className="m-3">
          <TabsTrigger value="pendentes">Pendentes</TabsTrigger>
          <TabsTrigger value="aprovados">Aprovados</TabsTrigger>
          <TabsTrigger value="reprovados">Reprovados</TabsTrigger>
          <TabsTrigger value="exportacoes">Exportações</TabsTrigger>
          <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
          <TabsTrigger value="criticas">Alterações críticas</TabsTrigger>
        </TabsList>

        <div className="h-[calc(100%-60px)] overflow-auto px-3 pb-6">
          <TabsContent value="pendentes"><VersoesList filtros={["rascunho", "gerado", "em_analise", "comparado", "precisa_ajuste"]} /></TabsContent>
          <TabsContent value="aprovados"><VersoesList filtros={["aprovado", "exportado", "enviado_maquina"]} /></TabsContent>
          <TabsContent value="reprovados"><VersoesList filtros={["reprovado", "cancelado"]} /></TabsContent>
          <TabsContent value="exportacoes"><ExportacoesList /></TabsContent>
          <TabsContent value="auditoria"><AuditoriaList /></TabsContent>
          <TabsContent value="criticas"><AuditoriaList acoes={["pos_processador_alterado", "ferramenta_alterada", "maquina_alterada", "gcode_reprovado"]} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function VersoesList({ filtros }: { filtros: string[] }) {
  const { data: versoes } = useQuery({
    queryKey: ["homolog-versoes", filtros.join(",")],
    queryFn: async () => {
      const { data } = await supabase
        .from("previews_cnc_chapas")
        .select("*")
        .in("status_homologacao", filtros)
        .order("criado_em", { ascending: false });
      return (data ?? []) as Versao[];
    },
  });

  const projetoIds = Array.from(new Set((versoes ?? []).map((v) => v.projeto_id).filter(Boolean) as string[]));
  const { data: projetos } = useQuery({
    queryKey: ["projetos-by-ids", projetoIds.join(",")],
    enabled: projetoIds.length > 0,
    queryFn: async () => (await supabase.from("projetos").select("id,nome,cliente").in("id", projetoIds)).data ?? [],
  });

  const [aberta, setAberta] = useState<Versao | null>(null);

  if (!versoes?.length) {
    return <Card className="p-6 text-center text-sm text-muted-foreground">Nenhuma versão encontrada.</Card>;
  }

  return (
    <>
      <Card className="overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Arquivo</th>
              <th className="px-3 py-2 text-left">Projeto</th>
              <th className="px-3 py-2 text-left">Versão</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Responsável</th>
              <th className="px-3 py-2 text-left">Data</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {versoes.map((v) => {
              const proj = projetos?.find((p) => p.id === v.projeto_id);
              return (
                <tr key={v.id} className="border-t border-border/40 hover:bg-surface-2/40">
                  <td className="px-3 py-2 font-mono">{v.nome_arquivo}</td>
                  <td className="px-3 py-2">{proj?.nome ?? "—"}</td>
                  <td className="px-3 py-2">v{v.versao}</td>
                  <td className="px-3 py-2"><Badge variant="outline">{STATUS_HOMOLOGACAO_LABELS[v.status_homologacao] ?? v.status_homologacao}</Badge></td>
                  <td className="px-3 py-2">{v.aprovado_por ?? v.validado_por ?? v.reprovado_por ?? "—"}</td>
                  <td className="px-3 py-2">{new Date(v.criado_em).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setAberta(v)}>
                      <Eye className="mr-1 h-3 w-3" />Abrir
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {aberta && <HomologacaoDialog versao={aberta} onClose={() => setAberta(null)} />}
    </>
  );
}

function HomologacaoDialog({ versao, onClose }: { versao: Versao; onClose: () => void }) {
  const qc = useQueryClient();
  const [responsavel, setResponsavel] = useState("");
  const [observacao, setObservacao] = useState(versao.observacao_homologacao ?? "");
  const [checklist, setChecklist] = useState<Checklist>(versao.checklist_json ?? {});

  const aprovar = useMutation({
    mutationFn: async () => {
      if (!responsavel.trim()) throw new Error("Informe o responsável");
      if (!checklistCompleto(checklist)) throw new Error("Complete o checklist");
      const now = new Date().toISOString();
      const { error } = await supabase.from("previews_cnc_chapas").update({
        status_homologacao: "aprovado", status: "aprovado",
        aprovado_por: responsavel, aprovado_em: now,
        observacao_homologacao: observacao, checklist_json: checklist as never,
      }).eq("id", versao.id);
      if (error) throw error;
      await registrarAuditoria({
        acao: "gcode_aprovado", entidade_tipo: "previews_cnc_chapas", entidade_id: versao.id,
        projeto_id: versao.projeto_id, chapa_id: versao.chapa_id, operador: responsavel,
        observacao, dados_depois: { status: "aprovado" },
      });
    },
    onSuccess: () => { toast.success("Aprovado"); qc.invalidateQueries({ queryKey: ["homolog-versoes"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reprovar = useMutation({
    mutationFn: async () => {
      if (!responsavel.trim()) throw new Error("Informe o responsável");
      if (!observacao.trim()) throw new Error("Informe o motivo da reprovação");
      const now = new Date().toISOString();
      const { error } = await supabase.from("previews_cnc_chapas").update({
        status_homologacao: "reprovado", status: "reprovado",
        reprovado_por: responsavel, reprovado_em: now,
        observacao_homologacao: observacao, checklist_json: checklist as never,
      }).eq("id", versao.id);
      if (error) throw error;
      await registrarAuditoria({
        acao: "gcode_reprovado", entidade_tipo: "previews_cnc_chapas", entidade_id: versao.id,
        projeto_id: versao.projeto_id, chapa_id: versao.chapa_id, operador: responsavel,
        observacao,
      });
    },
    onSuccess: () => { toast.success("Reprovado"); qc.invalidateQueries({ queryKey: ["homolog-versoes"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportar = useMutation({
    mutationFn: async () => {
      if (versao.status_homologacao !== "aprovado") throw new Error("Versão precisa estar aprovada");
      if (!responsavel.trim()) throw new Error("Informe o responsável pela exportação");
      const blob = new Blob([versao.conteudo], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = versao.nome_arquivo; a.click();
      URL.revokeObjectURL(url);
      const now = new Date().toISOString();
      await supabase.from("previews_cnc_chapas").update({
        status_homologacao: "exportado", status: "exportado",
        exportado_por: responsavel, exportado_em: now,
      }).eq("id", versao.id);
      await registrarAuditoria({
        acao: "gcode_exportado", entidade_tipo: "previews_cnc_chapas", entidade_id: versao.id,
        projeto_id: versao.projeto_id, chapa_id: versao.chapa_id, operador: responsavel,
      });
    },
    onSuccess: () => { toast.success("Exportado"); qc.invalidateQueries({ queryKey: ["homolog-versoes"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const enviarMaquina = useMutation({
    mutationFn: async () => {
      if (!["aprovado", "exportado"].includes(versao.status_homologacao))
        throw new Error("Apenas versões aprovadas podem ser enviadas");
      if (!responsavel.trim()) throw new Error("Informe o responsável");
      const now = new Date().toISOString();
      await supabase.from("previews_cnc_chapas").update({
        status_homologacao: "enviado_maquina", status: "enviado_maquina",
        enviado_maquina_por: responsavel, enviado_maquina_em: now,
      }).eq("id", versao.id);
      await registrarAuditoria({
        acao: "gcode_enviado_maquina", entidade_tipo: "previews_cnc_chapas", entidade_id: versao.id,
        projeto_id: versao.projeto_id, chapa_id: versao.chapa_id, operador: responsavel,
      });
    },
    onSuccess: () => { toast.success("Marcado como enviado"); qc.invalidateQueries({ queryKey: ["homolog-versoes"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const podeAprovar = versao.status_homologacao !== "aprovado" && versao.status_homologacao !== "exportado" && versao.status_homologacao !== "enviado_maquina";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {versao.nome_arquivo}
            <Badge variant="outline" className="ml-2">v{versao.versao}</Badge>
            <Badge variant="outline" className="ml-1">{STATUS_HOMOLOGACAO_LABELS[versao.status_homologacao]}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <Label className="text-[11px]">Responsável técnico</Label>
            <Input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className="h-8" />
            <Label className="mt-2 text-[11px]">Observação</Label>
            <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} className="text-xs" />

            <h4 className="mt-3 text-[11px] font-semibold uppercase text-muted-foreground">Checklist técnico</h4>
            <div className="space-y-1">
              {CHECKLIST_HOMOLOGACAO.map((item) => (
                <label key={item.key} className="flex items-start gap-2 cursor-pointer">
                  <Checkbox
                    checked={!!checklist[item.key]}
                    onCheckedChange={(v) => setChecklist((c) => ({ ...c, [item.key]: !!v }))}
                    disabled={!podeAprovar}
                  />
                  <span className="text-[11px]">{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-[11px] font-semibold uppercase text-muted-foreground">G-code</h4>
            <pre className="max-h-80 overflow-auto rounded bg-surface p-2 font-mono text-[10px]">
              {versao.conteudo.slice(0, 5000)}{versao.conteudo.length > 5000 && "\n..."}
            </pre>
            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
              {versao.aprovado_por && <div>Aprovado por <b>{versao.aprovado_por}</b> em {new Date(versao.aprovado_em!).toLocaleString()}</div>}
              {versao.exportado_por && <div>Exportado por <b>{versao.exportado_por}</b> em {new Date(versao.exportado_em!).toLocaleString()}</div>}
              {versao.enviado_maquina_por && <div>Enviado por <b>{versao.enviado_maquina_por}</b> em {new Date(versao.enviado_maquina_em!).toLocaleString()}</div>}
              {versao.reprovado_por && <div className="text-destructive">Reprovado por <b>{versao.reprovado_por}</b></div>}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {podeAprovar && (
            <>
              <Button variant="outline" onClick={() => reprovar.mutate()} disabled={reprovar.isPending}>
                <ShieldX className="mr-1 h-4 w-4" />Reprovar
              </Button>
              <Button onClick={() => aprovar.mutate()} disabled={aprovar.isPending || !checklistCompleto(checklist)}>
                <ShieldCheck className="mr-1 h-4 w-4" />Aprovar
              </Button>
            </>
          )}
          {versao.status_homologacao === "aprovado" && (
            <Button onClick={() => exportar.mutate()} disabled={exportar.isPending}>
              <Download className="mr-1 h-4 w-4" />Exportar .nc
            </Button>
          )}
          {["aprovado", "exportado"].includes(versao.status_homologacao) && (
            <Button variant="outline" onClick={() => enviarMaquina.mutate()} disabled={enviarMaquina.isPending}>
              <FileText className="mr-1 h-4 w-4" />Marcar como enviado p/ máquina
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExportacoesList() {
  const { data } = useQuery({
    queryKey: ["exportacoes"],
    queryFn: async () => {
      const { data } = await supabase
        .from("previews_cnc_chapas")
        .select("*")
        .in("status_homologacao", ["exportado", "enviado_maquina"])
        .order("exportado_em", { ascending: false });
      return (data ?? []) as Versao[];
    },
  });

  if (!data?.length) return <Card className="p-6 text-center text-sm text-muted-foreground">Nenhuma exportação registrada.</Card>;

  const baixar = (v: Versao) => {
    const blob = new Blob([v.conteudo], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = v.nome_arquivo; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-surface-2 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Arquivo</th>
            <th className="px-3 py-2 text-left">Versão</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Responsável</th>
            <th className="px-3 py-2 text-left">Data</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {data.map((v) => (
            <tr key={v.id} className="border-t border-border/40">
              <td className="px-3 py-2 font-mono">{v.nome_arquivo}</td>
              <td className="px-3 py-2">v{v.versao}</td>
              <td className="px-3 py-2"><Badge variant="outline">{STATUS_HOMOLOGACAO_LABELS[v.status_homologacao]}</Badge></td>
              <td className="px-3 py-2">{v.exportado_por ?? "—"}</td>
              <td className="px-3 py-2">{v.exportado_em ? new Date(v.exportado_em).toLocaleString() : "—"}</td>
              <td className="px-3 py-2 text-right">
                <Button size="sm" variant="ghost" onClick={() => baixar(v)}>
                  <Download className="mr-1 h-3 w-3" />Baixar
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function AuditoriaList({ acoes }: { acoes?: string[] }) {
  const { data } = useQuery({
    queryKey: ["auditoria", acoes?.join(",") ?? "all"],
    queryFn: async () => {
      let q = supabase.from("auditoria_eventos").select("*").order("criado_em", { ascending: false }).limit(200);
      if (acoes) q = q.in("acao", acoes);
      const { data } = await q;
      return data ?? [];
    },
  });

  if (!data?.length) return <Card className="p-6 text-center text-sm text-muted-foreground">Sem eventos registrados.</Card>;

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-surface-2 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Data</th>
            <th className="px-3 py-2 text-left">Ação</th>
            <th className="px-3 py-2 text-left">Entidade</th>
            <th className="px-3 py-2 text-left">Operador</th>
            <th className="px-3 py-2 text-left">Observação</th>
          </tr>
        </thead>
        <tbody>
          {data.map((e) => (
            <tr key={e.id} className="border-t border-border/40">
              <td className="px-3 py-2">{new Date(e.criado_em).toLocaleString()}</td>
              <td className="px-3 py-2 font-mono">{e.acao}</td>
              <td className="px-3 py-2">{e.entidade_tipo}</td>
              <td className="px-3 py-2">{e.operador ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{e.observacao ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

