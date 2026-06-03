import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Play, Eye, Link2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  parseGcode,
  parsePartsProfile,
  inferirCodigoPecaDoArquivo,
  type GcodeLinha,
  type OperacaoInferida,
} from "@/lib/gcode-parser";

type ArquivoTecnico = {
  id: string;
  nome_arquivo: string;
  tipo_arquivo: string;
  origem_pasta: string | null;
  storage_url: string | null;
  chapa_id: string | null;
  peca_id: string | null;
  projeto_id: string | null;
  status_analise: string;
  analise_resumo_json: Record<string, unknown>;
};

const TIPO_GCODE = new Set(["nc_gcode", "parts_nc", "profile_nc"]);
const TIPO_PARTS = new Set(["parts_info", "profile_info"]);

export function AnaliseTecnicaTab({ importacaoId, projetoId }: { importacaoId: string; projetoId: string | null }) {
  const qc = useQueryClient();
  const [verArquivo, setVerArquivo] = useState<{ arq: ArquivoTecnico; conteudo: string } | null>(null);

  const arquivos = useQuery({
    queryKey: ["analise", importacaoId, "arquivos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("arquivos_tecnicos")
        .select("*")
        .eq("importacao_id", importacaoId)
        .in("tipo_arquivo", ["nc_gcode", "parts_nc", "parts_info", "profile_nc", "profile_info", "nc_cyc"])
        .order("origem_pasta");
      if (error) throw error;
      return (data ?? []) as ArquivoTecnico[];
    },
  });

  const pecas = useQuery({
    queryKey: ["analise", importacaoId, "pecas"],
    enabled: !!projetoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projeto_pecas")
        .select("id, descricao, observacao")
        .eq("projeto_id", projetoId!);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; descricao: string; observacao: string | null }>;
    },
  });

  const baixarConteudo = async (path: string) => {
    const { data, error } = await supabase.storage.from("importacoes").download(path);
    if (error || !data) throw error ?? new Error("Falha download");
    return await data.text();
  };

  // Tenta vincular um arquivo a uma peça pelo código no nome.
  const acharPecaPorNome = (nome: string): string | null => {
    const ext = inferirCodigoPecaDoArquivo(nome);
    if (!ext.codigo || !pecas.data) return null;
    const alvo = ext.codigo;
    const p = pecas.data.find((p) => {
      const t = `${p.descricao} ${p.observacao ?? ""}`;
      return t.includes(alvo);
    });
    return p?.id ?? null;
  };

  const analisar = useMutation({
    mutationFn: async (arq: ArquivoTecnico) => {
      if (!arq.storage_url) throw new Error("Sem arquivo no storage");
      const conteudo = await baixarConteudo(arq.storage_url);

      let operacoes: OperacaoInferida[] = [];
      let resumo: Record<string, unknown> = {};

      if (TIPO_GCODE.has(arq.tipo_arquivo)) {
        const r = parseGcode(conteudo);
        operacoes = r.operacoes;
        resumo = {
          total_comandos: r.total_comandos,
          ferramentas: r.ferramentas_usadas,
          operacoes_inferidas: r.operacoes.length,
        };
      } else if (TIPO_PARTS.has(arq.tipo_arquivo)) {
        const r = parsePartsProfile(conteudo);
        operacoes = r.operacoes;
        resumo = { formato: r.formato, operacoes_inferidas: r.operacoes.length };
      } else {
        resumo = { aviso: "Tipo sem parser específico, conteúdo armazenado." };
      }

      // Vincular peça
      const pecaId = arq.peca_id ?? acharPecaPorNome(arq.nome_arquivo);
      const status_vinculo = pecaId ? "vinculado" : "pendente_vinculo";

      // Limpar operações anteriores deste arquivo
      await supabase.from("peca_operacoes_importadas").delete().eq("arquivo_tecnico_id", arq.id);

      const origem =
        arq.tipo_arquivo === "nc_gcode"
          ? "chapa_nc"
          : arq.tipo_arquivo === "parts_nc"
          ? "parts_nc"
          : arq.tipo_arquivo === "profile_nc"
          ? "profile_nc"
          : arq.tipo_arquivo === "nc_cyc"
          ? "cyc"
          : "parts_config";

      if (operacoes.length) {
        const rows = operacoes.map((o) => ({
          projeto_id: projetoId,
          peca_id: pecaId,
          arquivo_tecnico_id: arq.id,
          origem,
          tipo_operacao: o.tipo,
          x: o.x,
          y: o.y,
          z: o.z,
          diametro: o.diametro,
          profundidade: o.profundidade,
          ferramenta: o.ferramenta,
          ordem: o.ordem,
          confianca_parser: o.confianca,
          status_vinculo,
          dados_brutos: { origem_linha: o.origem_linha },
        }));
        const { error } = await supabase.from("peca_operacoes_importadas").insert(rows);
        if (error) throw error;
      }

      // Atualizar status do arquivo + vínculo de peça
      const status_analise = operacoes.length ? "analisado" : "parcialmente_analisado";
      const upd: Record<string, unknown> = {
        status_analise,
        analise_resumo_json: resumo,
        analisado_em: new Date().toISOString(),
      };
      if (pecaId) upd.peca_id = pecaId;
      await supabase.from("arquivos_tecnicos").update(upd).eq("id", arq.id);

      return { count: operacoes.length, status_analise };
    },
    onSuccess: (r, arq) => {
      toast.success(`${arq.nome_arquivo}: ${r.count} operação(ões)`);
      qc.invalidateQueries({ queryKey: ["analise", importacaoId] });
    },
    onError: (e: Error, arq) => toast.error(`${arq.nome_arquivo}: ${e.message}`),
  });

  const analisarTodos = async () => {
    const lista = (arquivos.data ?? []).filter((a) => a.status_analise === "nao_analisado");
    for (const a of lista) {
      await analisar.mutateAsync(a);
    }
    toast.success(`${lista.length} arquivo(s) analisado(s)`);
  };

  const visualizar = async (arq: ArquivoTecnico) => {
    if (!arq.storage_url) return;
    try {
      const c = await baixarConteudo(arq.storage_url);
      setVerArquivo({ arq, conteudo: c });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {arquivos.data?.length ?? 0} arquivo(s) técnico(s). Clique em <em>Analisar</em> para extrair operações.
        </p>
        <Button size="sm" onClick={analisarTodos} disabled={analisar.isPending}>
          <Play className="mr-1 h-3 w-3" /> Analisar todos
        </Button>
      </div>

      <div className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Pasta</th>
              <th className="p-2 text-left">Tipo</th>
              <th className="p-2 text-left">Arquivo</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Peça</th>
              <th className="p-2 text-left">Resumo</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {(arquivos.data ?? []).map((a) => {
              const resumo = a.analise_resumo_json as { operacoes_inferidas?: number; total_comandos?: number };
              return (
                <tr key={a.id} className="border-t border-border">
                  <td className="p-2 text-xs">{a.origem_pasta ?? "—"}</td>
                  <td className="p-2 text-xs">{a.tipo_arquivo}</td>
                  <td className="p-2 font-mono text-xs">{a.nome_arquivo}</td>
                  <td className="p-2">
                    <Badge variant={a.status_analise === "analisado" ? "default" : "outline"} className="text-[10px]">
                      {a.status_analise}
                    </Badge>
                  </td>
                  <td className="p-2 text-xs">
                    {a.peca_id ? (
                      <Badge variant="secondary" className="text-[10px]"><Link2 className="mr-1 h-2 w-2" />vinc.</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]"><AlertTriangle className="mr-1 h-2 w-2" />pendente</Badge>
                    )}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {resumo?.operacoes_inferidas != null
                      ? `${resumo.operacoes_inferidas} op${resumo.total_comandos ? ` / ${resumo.total_comandos} cmd` : ""}`
                      : "—"}
                  </td>
                  <td className="p-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => visualizar(a)}>
                      <Eye className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => analisar.mutate(a)}
                      disabled={analisar.isPending}
                    >
                      <Play className="mr-1 h-3 w-3" /> Analisar
                    </Button>
                  </td>
                </tr>
              );
            })}
            {(arquivos.data ?? []).length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Nenhum arquivo técnico.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {verArquivo && (
        <VisualizadorGcode
          arq={verArquivo.arq}
          conteudo={verArquivo.conteudo}
          onClose={() => setVerArquivo(null)}
        />
      )}
    </div>
  );
}

function VisualizadorGcode({
  arq,
  conteudo,
  onClose,
}: {
  arq: ArquivoTecnico;
  conteudo: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"comandos" | "bruto" | "percurso">("comandos");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [filtroFerr, setFiltroFerr] = useState<string>("todos");

  const isGcode = TIPO_GCODE.has(arq.tipo_arquivo);

  const parsed = isGcode ? parseGcode(conteudo) : null;
  const linhas: GcodeLinha[] = parsed?.linhas ?? [];
  const ferramentas = parsed?.ferramentas_usadas ?? [];

  const tipos = [...new Set(linhas.map((l) => l.tipo_inferido))];
  const filtradas = linhas.filter((l) => {
    if (filtroTipo !== "todos" && l.tipo_inferido !== filtroTipo) return false;
    if (filtroFerr !== "todos" && l.ferramenta !== filtroFerr) return false;
    return true;
  });

  // mini preview 2D
  const cortes = linhas.filter((l) => l.x !== null && l.y !== null);
  const xs = cortes.map((l) => l.x!).filter((v) => isFinite(v));
  const ys = cortes.map((l) => l.y!).filter((v) => isFinite(v));
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 100;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 100;
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const escala = 400 / Math.max(w, h);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{arq.nome_arquivo}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 border-b border-border pb-2">
          <Button size="sm" variant={tab === "comandos" ? "default" : "ghost"} onClick={() => setTab("comandos")}>Comandos</Button>
          <Button size="sm" variant={tab === "bruto" ? "default" : "ghost"} onClick={() => setTab("bruto")}>Bruto</Button>
          {isGcode && <Button size="sm" variant={tab === "percurso" ? "default" : "ghost"} onClick={() => setTab("percurso")}>Percurso</Button>}
        </div>

        {tab === "comandos" && (
          <div className="space-y-2">
            {isGcode && (
              <div className="flex gap-2 text-xs">
                <select className="rounded border border-border bg-surface px-2 py-1" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                  <option value="todos">Todos os tipos</option>
                  {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select className="rounded border border-border bg-surface px-2 py-1" value={filtroFerr} onChange={(e) => setFiltroFerr(e.target.value)}>
                  <option value="todos">Todas ferramentas</option>
                  {ferramentas.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <span className="ml-auto text-muted-foreground">{filtradas.length} de {linhas.length}</span>
              </div>
            )}
            <div className="max-h-[60vh] overflow-auto rounded border border-border">
              <table className="w-full text-xs font-mono">
                <thead className="sticky top-0 bg-surface-2 text-[10px] uppercase">
                  <tr>
                    <th className="p-1 text-left">#</th>
                    <th className="p-1 text-left">Cmd</th>
                    <th className="p-1 text-left">Tipo</th>
                    <th className="p-1 text-left">T</th>
                    <th className="p-1 text-left">X</th>
                    <th className="p-1 text-left">Y</th>
                    <th className="p-1 text-left">Z</th>
                    <th className="p-1 text-left">F</th>
                    <th className="p-1 text-left">Coment.</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.slice(0, 1000).map((l) => (
                    <tr key={l.linha} className={`border-t border-border ${l.tipo_inferido === "furacao" ? "bg-primary/5" : ""}`}>
                      <td className="p-1">{l.linha}</td>
                      <td className="p-1">{l.comando ?? "—"}</td>
                      <td className="p-1 text-[10px]">{l.tipo_inferido}</td>
                      <td className="p-1">{l.ferramenta ?? "—"}</td>
                      <td className="p-1">{l.x ?? "—"}</td>
                      <td className="p-1">{l.y ?? "—"}</td>
                      <td className="p-1">{l.z ?? "—"}</td>
                      <td className="p-1">{l.avanco ?? "—"}</td>
                      <td className="p-1 text-muted-foreground">{l.comentario ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtradas.length > 1000 && (
                <div className="border-t border-border p-2 text-center text-xs text-muted-foreground">
                  Exibindo primeiras 1000 linhas de {filtradas.length}.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "bruto" && (
          <pre className="max-h-[60vh] overflow-auto rounded border border-border bg-surface p-3 text-xs font-mono">{conteudo}</pre>
        )}

        {tab === "percurso" && isGcode && (
          <div className="flex justify-center rounded border border-border bg-surface p-3">
            <svg width={w * escala + 20} height={h * escala + 20} className="bg-surface-2">
              {linhas.map((l, i) => {
                const prev = linhas[i - 1];
                if (!prev || prev.x === null || prev.y === null || l.x === null || l.y === null) return null;
                const isFur = l.tipo_inferido === "furacao";
                const isRap = l.tipo_inferido === "movimento_rapido";
                return (
                  <line
                    key={i}
                    x1={(prev.x - minX) * escala + 10}
                    y1={(h - (prev.y - minY)) * escala + 10}
                    x2={(l.x - minX) * escala + 10}
                    y2={(h - (l.y - minY)) * escala + 10}
                    stroke={isFur ? "var(--primary)" : isRap ? "var(--muted-foreground)" : "var(--foreground)"}
                    strokeWidth={isFur ? 3 : 1}
                    strokeDasharray={isRap ? "2 2" : undefined}
                    opacity={isRap ? 0.4 : 1}
                  />
                );
              })}
              {linhas.filter((l) => l.tipo_inferido === "furacao").map((l, i) => (
                <circle
                  key={`f${i}`}
                  cx={(l.x! - minX) * escala + 10}
                  cy={(h - (l.y! - minY)) * escala + 10}
                  r={3}
                  fill="var(--primary)"
                />
              ))}
            </svg>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PendenciasTab({ importacaoId, projetoId }: { importacaoId: string; projetoId: string | null }) {
  const qc = useQueryClient();

  const arquivosPend = useQuery({
    queryKey: ["pend", importacaoId, "arq"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("arquivos_tecnicos")
        .select("*")
        .eq("importacao_id", importacaoId)
        .is("peca_id", null);
      if (error) throw error;
      return (data ?? []) as ArquivoTecnico[];
    },
  });

  const etiquetasPend = useQuery({
    queryKey: ["pend", importacaoId, "etiq"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("importacao_etiquetas")
        .select("*")
        .eq("importacao_id", importacaoId)
        .eq("status_vinculo", "pendente_vinculo");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome_arquivo: string; codigo_peca: string | null }>;
    },
  });

  const pecas = useQuery({
    queryKey: ["pend", importacaoId, "pecas"],
    enabled: !!projetoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projeto_pecas").select("id, descricao").eq("projeto_id", projetoId!);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; descricao: string }>;
    },
  });

  const vincularArquivo = async (arqId: string, pecaId: string) => {
    await supabase.from("arquivos_tecnicos").update({ peca_id: pecaId }).eq("id", arqId);
    await supabase.from("peca_operacoes_importadas")
      .update({ peca_id: pecaId, status_vinculo: "vinculado" })
      .eq("arquivo_tecnico_id", arqId);
    toast.success("Vinculado");
    qc.invalidateQueries({ queryKey: ["pend", importacaoId] });
    qc.invalidateQueries({ queryKey: ["analise", importacaoId] });
  };

  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-2 text-sm font-semibold">Arquivos técnicos sem peça ({arquivosPend.data?.length ?? 0})</h3>
        <div className="overflow-x-auto rounded border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase text-muted-foreground">
              <tr><th className="p-2 text-left">Arquivo</th><th className="p-2 text-left">Tipo</th><th className="p-2 text-left">Vincular a</th></tr>
            </thead>
            <tbody>
              {(arquivosPend.data ?? []).map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="p-2 font-mono text-xs">{a.nome_arquivo}</td>
                  <td className="p-2 text-xs">{a.tipo_arquivo}</td>
                  <td className="p-2">
                    <select
                      className="rounded border border-border bg-surface px-2 py-1 text-xs"
                      defaultValue=""
                      onChange={(e) => e.target.value && vincularArquivo(a.id, e.target.value)}
                    >
                      <option value="">— selecione —</option>
                      {(pecas.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.descricao}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {(arquivosPend.data ?? []).length === 0 && (
                <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">Nenhuma pendência.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Etiquetas sem peça ({etiquetasPend.data?.length ?? 0})</h3>
        <ul className="space-y-1 text-xs">
          {(etiquetasPend.data ?? []).map((e) => (
            <li key={e.id} className="rounded border border-border bg-surface px-2 py-1 font-mono">
              {e.nome_arquivo} {e.codigo_peca ? `(cod ${e.codigo_peca})` : ""}
            </li>
          ))}
          {(etiquetasPend.data ?? []).length === 0 && (
            <li className="text-muted-foreground">Sem pendências.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
