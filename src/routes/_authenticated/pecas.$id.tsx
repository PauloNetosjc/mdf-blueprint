import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PartViewer2D } from "@/components/part-viewer-2d";
import { OperationDialog } from "@/components/operation-dialog";
import { TIPOS_OPERACAO, type Ferramenta, type Maquina, type Operacao, type Peca } from "@/lib/db";
import { validarPecaMaquina, validarOperacoes } from "@/lib/validacoes";
import { ArrowLeft, FileCode2, Plus, Trash2, Pencil, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { OperacoesImportadas } from "@/components/operacoes-importadas";
import { EngenhariaCadastradaBox } from "@/components/vinculo-biblioteca-tab";

export const Route = createFileRoute("/_authenticated/pecas/$id")({
  head: () => ({ meta: [{ title: "Editor da peça — Visualizador CNC" }] }),
  component: EditorPeca,
});

function EditorPeca() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [face, setFace] = useState(0);
  const [selectedOp, setSelectedOp] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Operacao | null>(null);

  const { data } = useQuery({
    queryKey: ["peca", id],
    queryFn: async () => {
      const [peca, ops, ferr, maq] = await Promise.all([
        supabase.from("pecas").select("*").eq("id", id).single(),
        supabase.from("operacoes").select("*").eq("peca_id", id).order("ordem"),
        supabase.from("ferramentas").select("*"),
        supabase.from("maquinas").select("*").eq("ativa", true).limit(1).maybeSingle(),
      ]);
      return {
        peca: peca.data as Peca,
        operacoes: (ops.data ?? []) as Operacao[],
        ferramentas: (ferr.data ?? []) as Ferramenta[],
        maquina: maq.data as Maquina | null,
      };
    },
  });

  const del = useMutation({
    mutationFn: async (opId: string) => {
      const { error } = await supabase.from("operacoes").delete().eq("id", opId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["peca", id] });
      toast.success("Operação removida");
    },
  });

  if (!data?.peca) return <div className="p-6 text-muted-foreground">Carregando...</div>;
  const { peca, operacoes, ferramentas, maquina } = data;

  const alertasPeca = maquina ? validarPecaMaquina(peca, maquina) : [];
  const alertasOps = maquina ? validarOperacoes(peca, operacoes, ferramentas) : [];
  const todosAlertas = [...alertasPeca, ...alertasOps];
  const temErro = todosAlertas.some((a) => a.nivel === "erro");

  const opsDaFace = operacoes.filter((o) => o.numero_face === face);
  const opSelecionada = operacoes.find((o) => o.id === selectedOp) ?? null;
  const ferrSelecionada = ferramentas.find((f) => f.id === opSelecionada?.ferramenta_id);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/pecas"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-baseline gap-3">
            <h1 className="font-mono text-lg font-semibold">{peca.codigo}</h1>
            <span className="text-sm text-muted-foreground">{peca.nome}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {peca.cliente} · {peca.ambiente} · {peca.largura} × {peca.altura} × {peca.espessura} mm · Face A: {peca.face_alinhamento}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {temErro ? (
            <span className="flex items-center gap-1 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3" /> {todosAlertas.length} alerta(s)
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded bg-success/10 px-2 py-1 text-xs text-success">
              <CheckCircle2 className="h-3 w-3" /> Sem erros
            </span>
          )}
          <Button variant="outline" asChild>
            <Link to="/comparador" search={{ peca_id: id }}>
              <FileCode2 className="mr-2 h-4 w-4" /> Comparar com NC original
            </Link>
          </Button>
          <Button onClick={() => navigate({ to: "/pecas/$id/cnc", params: { id } })}>
            <FileCode2 className="mr-2 h-4 w-4" /> Gerar prévia CNC
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Esquerda: faces + operações */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-panel">
          <div className="border-b border-border p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Faces</div>
            <div className="grid grid-cols-5 gap-1">
              {[0, 1, 2, 3, 4].map((n) => {
                const count = operacoes.filter((o) => o.numero_face === n).length;
                return (
                  <button
                    key={n}
                    onClick={() => setFace(n)}
                    className={`rounded border px-2 py-1.5 text-xs font-mono ${face === n ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-surface-2"}`}
                  >
                    F{n}
                    <div className="text-[10px] opacity-75">{count}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Operações face {face}</div>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex-1 overflow-auto">
            {opsDaFace.map((op) => {
              const ferr = ferramentas.find((f) => f.id === op.ferramenta_id);
              const tipoLabel = TIPOS_OPERACAO.find((t) => t.value === op.tipo)?.label ?? op.tipo;
              const sel = op.id === selectedOp;
              return (
                <button
                  key={op.id}
                  onClick={() => setSelectedOp(op.id)}
                  className={`block w-full border-b border-border px-3 py-2 text-left text-xs hover:bg-surface-2 ${sel ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                >
                  <div className="flex items-center justify-between font-mono">
                    <span>#{op.ordem} {tipoLabel}</span>
                    <span className="text-muted-foreground">{ferr?.codigo ?? "—"}</span>
                  </div>
                  <div className="text-muted-foreground">
                    X{op.x} Y{op.y} Ø{op.diametro} P{op.profundidade}
                  </div>
                </button>
              );
            })}
            {opsDaFace.length === 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground">Sem operações nesta face.</div>
            )}
          </div>

          <EngenhariaCadastradaBoxByPeca pecaId={id} />
          <OperacoesImportadas pecaId={id} nextOrdem={operacoes.length + 1} />
        </aside>

        {/* Centro: viewer */}
        <section className="flex flex-1 flex-col overflow-hidden">
          <PartViewer2D
            peca={peca}
            operacoes={operacoes}
            face={face}
            selectedId={selectedOp}
            onSelect={setSelectedOp}
          />
        </section>

        {/* Direita: detalhes da operação + alertas */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-panel">
          <div className="border-b border-border p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Detalhes</div>
            {opSelecionada ? (
              <div className="space-y-2 text-xs">
                <Row label="Tipo" value={TIPOS_OPERACAO.find((t) => t.value === opSelecionada.tipo)?.label ?? opSelecionada.tipo} />
                <Row label="Face" value={`Face ${opSelecionada.numero_face}`} />
                <Row label="Ferramenta" value={ferrSelecionada ? `${ferrSelecionada.codigo} · ${ferrSelecionada.nome}` : "—"} />
                <Row label="X" value={`${opSelecionada.x} mm`} mono />
                <Row label="Y" value={`${opSelecionada.y} mm`} mono />
                <Row label="Diâmetro" value={`Ø${opSelecionada.diametro} mm`} mono />
                <Row label="Profundidade" value={`${opSelecionada.profundidade} mm`} mono />
                <Row label="Ordem" value={`#${opSelecionada.ordem}`} mono />
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => { setEditing(opSelecionada); setDialogOpen(true); }}>
                    <Pencil className="mr-1 h-3 w-3" /> Editar
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => del.mutate(opSelecionada.id)}>
                    <Trash2 className="mr-1 h-3 w-3" /> Apagar
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Clique em uma operação para ver os detalhes.</p>
            )}
          </div>

          <div className="flex-1 overflow-auto p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Alertas</div>
            {todosAlertas.length === 0 ? (
              <p className="text-xs text-success">Tudo certo. Nenhum alerta.</p>
            ) : (
              <ul className="space-y-1.5">
                {todosAlertas.map((a, i) => (
                  <li
                    key={i}
                    className={`rounded border-l-2 px-2 py-1.5 text-xs ${
                      a.nivel === "erro"
                        ? "border-destructive bg-destructive/5 text-destructive"
                        : "border-warning bg-warning/10 text-warning-foreground"
                    }`}
                  >
                    {a.mensagem}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {dialogOpen && (
        <OperationDialog
          open={dialogOpen}
          onClose={() => { setDialogOpen(false); setEditing(null); }}
          pecaId={id}
          face={face}
          ferramentas={ferramentas}
          nextOrdem={operacoes.length + 1}
          edit={editing}
        />
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}
