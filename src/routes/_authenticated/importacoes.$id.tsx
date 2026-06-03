import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, FileText, Layers, Package, Tag, Wrench, AlertTriangle, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { CATEGORIA_LABEL, type CategoriaArquivo } from "@/lib/importacao-promob";

export const Route = createFileRoute("/_authenticated/importacoes/$id")({
  head: () => ({ meta: [{ title: "Importação — Visualizador CNC" }] }),
  component: ImportacaoDetalhe,
});

async function baixar(path: string, nome: string) {
  const { data, error } = await supabase.storage.from("importacoes").createSignedUrl(path, 300);
  if (error || !data) { toast.error(error?.message ?? "Falha ao gerar link"); return; }
  const a = document.createElement("a");
  a.href = data.signedUrl; a.download = nome; a.click();
}

async function abrir(path: string) {
  const { data, error } = await supabase.storage.from("importacoes").createSignedUrl(path, 300);
  if (error || !data) { toast.error(error?.message ?? "Falha"); return; }
  window.open(data.signedUrl, "_blank");
}

function ImportacaoDetalhe() {
  const { id } = Route.useParams();

  const { data: imp } = useQuery({
    queryKey: ["importacao", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("importacoes").select("*").eq("id", id).single();
      if (error) throw error;
      return data as unknown as {
        id: string; projeto_id: string | null; nome_arquivo: string;
        status: string; projeto_detectado: string | null; cliente_detectado: string | null;
        resumo_json: Record<string, unknown>; erros_json: Array<{ msg: string }>;
        criado_em: string;
      };
    },
  });

  const projetoId = imp?.projeto_id ?? null;

  const chapas = useQuery({
    queryKey: ["imp", id, "chapas"],
    enabled: !!projetoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("arquivos_tecnicos")
        .select("chapa_id, nome_arquivo")
        .eq("importacao_id", id)
        .eq("tipo_arquivo", "xml_cyc");
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((x) => (x as { chapa_id: string }).chapa_id).filter(Boolean))];
      if (!ids.length) return [];
      const { data: ch } = await supabase.from("chapas").select("*").in("id", ids);
      return (ch ?? []) as Array<{ id: string; nome: string; codigo: string; tipo: string; espessura: number; largura: number; altura: number }>;
    },
  });

  const pecas = useQuery({
    queryKey: ["imp", id, "pecas"],
    enabled: !!projetoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projeto_pecas").select("*").eq("projeto_id", projetoId!).order("ordem");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; descricao: string; quantidade: number; largura: number; altura: number;
        espessura: number; chapa_id: string | null; fita_codigo: string | null;
        modulo: string | null; observacao: string | null;
      }>;
    },
  });

  const etiquetas = useQuery({
    queryKey: ["imp", id, "etiquetas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("importacao_etiquetas")
        .select("*").eq("importacao_id", id).order("nome_arquivo").limit(500);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; nome_arquivo: string; codigo_completo: string | null;
        referencia: string | null; codigo_peca: string | null; sufixo: string | null;
        duplicidade: number | null; chapa_id: string | null; storage_url: string | null;
        status_vinculo: string;
      }>;
    },
  });

  const arquivosCnc = useQuery({
    queryKey: ["imp", id, "cnc"],
    queryFn: async () => {
      const { data, error } = await supabase.from("arquivos_tecnicos")
        .select("*").eq("importacao_id", id)
        .in("tipo_arquivo", ["nc_gcode", "nc_cyc", "parts_nc", "parts_info", "profile_nc", "profile_info"])
        .order("origem_pasta");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; nome_arquivo: string; tipo_arquivo: string;
        origem_pasta: string; storage_url: string; chapa_id: string | null;
      }>;
    },
  });

  const previews = useQuery({
    queryKey: ["imp", id, "previews"],
    queryFn: async () => {
      const { data, error } = await supabase.from("importacao_preview_chapas")
        .select("*").eq("importacao_id", id).order("numero_chapa");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; arquivo_nome: string; tipo_preview: string;
        storage_url: string | null; numero_chapa: number | null; chapa_id: string | null;
      }>;
    },
  });

  const almox = useQuery({
    queryKey: ["imp", id, "almox"],
    enabled: !!projetoId,
    queryFn: async () => {
      const { data, error } = await supabase.from("projeto_almoxarifado_itens")
        .select("*").eq("projeto_id", projetoId!).eq("origem", "importacao_promob");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; descricao: string; referencia: string | null;
        quantidade: number; unidade: string; status: string;
      }>;
    },
  });

  if (!imp) return <div className="p-6 text-sm text-muted-foreground">Carregando importação...</div>;

  const resumo = imp.resumo_json as Record<string, unknown>;
  const porCat = (resumo?.por_categoria as Record<string, number>) ?? {};

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="border-b border-border-strong bg-panel px-6 py-4">
        <div className="flex items-center gap-3">
          <Link to="/importacoes"><Button size="icon" variant="ghost"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">{imp.projeto_detectado ?? imp.nome_arquivo}</h1>
            <p className="text-xs text-muted-foreground">
              {imp.cliente_detectado ?? "—"} • {new Date(imp.criado_em).toLocaleString("pt-BR")} • {imp.nome_arquivo}
            </p>
          </div>
          {projetoId && (
            <Link to="/projetos/$id" params={{ id: projetoId }}>
              <Button variant="outline">Abrir projeto</Button>
            </Link>
          )}
        </div>
      </header>

      <Tabs defaultValue="resumo" className="flex flex-1 flex-col">
        <TabsList className="mx-6 mt-3 self-start">
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="chapas"><Layers className="mr-1 h-3 w-3" />Chapas ({chapas.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="pecas"><Package className="mr-1 h-3 w-3" />Peças ({pecas.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="etiquetas"><Tag className="mr-1 h-3 w-3" />Etiquetas ({etiquetas.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="cnc"><Wrench className="mr-1 h-3 w-3" />Arquivos CNC ({arquivosCnc.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="previews"><ImageIcon className="mr-1 h-3 w-3" />Previews ({previews.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="almox">Almoxarifado ({almox.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="erros"><AlertTriangle className="mr-1 h-3 w-3" />Erros ({imp.erros_json?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="flex-1 overflow-auto p-6 pt-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Object.entries(porCat).map(([k, v]) => (
              <div key={k} className="rounded border border-border bg-surface p-3">
                <div className="text-xs text-muted-foreground">{CATEGORIA_LABEL[k as CategoriaArquivo] ?? k}</div>
                <div className="text-2xl font-bold">{v}</div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="chapas" className="flex-1 overflow-auto p-6 pt-3">
          <Tabela cols={["Código", "Nome", "Tipo", "Espessura", "Dimensões"]}
            rows={(chapas.data ?? []).map((c) => [c.codigo, c.nome, c.tipo, `${c.espessura}mm`, `${c.largura}×${c.altura}`])} />
        </TabsContent>

        <TabsContent value="pecas" className="flex-1 overflow-auto p-6 pt-3">
          <Tabela cols={["Descrição", "Qtd", "Largura", "Altura", "Espessura", "Chapa", "Borda", "Obs."]}
            rows={(pecas.data ?? []).map((p) => [
              p.descricao, p.quantidade, p.largura, p.altura, p.espessura,
              p.chapa_id ? "✓" : "—", p.fita_codigo ?? "—", p.observacao ?? "—",
            ])} />
        </TabsContent>

        <TabsContent value="etiquetas" className="flex-1 overflow-auto p-6 pt-3">
          <div className="overflow-x-auto rounded border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2 text-left">Arquivo</th>
                  <th className="p-2 text-left">Ref.</th>
                  <th className="p-2 text-left">Código</th>
                  <th className="p-2 text-left">Suf.</th>
                  <th className="p-2 text-left">Dup.</th>
                  <th className="p-2 text-left">Vínculo</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {(etiquetas.data ?? []).map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="p-2 font-mono text-xs">{e.nome_arquivo}</td>
                    <td className="p-2">{e.referencia ?? "—"}</td>
                    <td className="p-2 font-mono">{e.codigo_peca ?? "—"}</td>
                    <td className="p-2">{e.sufixo ?? "—"}</td>
                    <td className="p-2">{e.duplicidade ?? "—"}</td>
                    <td className="p-2">
                      <Badge variant={e.status_vinculo === "vinculado" ? "default" : "outline"}>
                        {e.status_vinculo}
                      </Badge>
                    </td>
                    <td className="p-2 text-right">
                      {e.storage_url && (
                        <Button size="sm" variant="ghost" onClick={() => abrir(e.storage_url!)}><ImageIcon className="h-4 w-4" /></Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="cnc" className="flex-1 overflow-auto p-6 pt-3">
          <div className="overflow-x-auto rounded border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-muted-foreground">
                <tr><th className="p-2 text-left">Pasta</th><th className="p-2 text-left">Tipo</th><th className="p-2 text-left">Arquivo</th><th className="p-2 text-left">Chapa</th><th className="p-2"></th></tr>
              </thead>
              <tbody>
                {(arquivosCnc.data ?? []).map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="p-2 text-xs">{a.origem_pasta}</td>
                    <td className="p-2 text-xs">{CATEGORIA_LABEL[a.tipo_arquivo as CategoriaArquivo] ?? a.tipo_arquivo}</td>
                    <td className="p-2 font-mono text-xs">{a.nome_arquivo}</td>
                    <td className="p-2 text-xs">{a.chapa_id ? "✓" : "—"}</td>
                    <td className="p-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => baixar(a.storage_url, a.nome_arquivo)}>
                        <Download className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="previews" className="flex-1 overflow-auto p-6 pt-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(previews.data ?? []).map((p) => (
              <div key={p.id} className="rounded border border-border bg-surface p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Badge variant="outline">Chapa {p.numero_chapa ?? "?"}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{p.tipo_preview}</Badge>
                </div>
                <div className="truncate font-mono text-xs">{p.arquivo_nome}</div>
                {p.storage_url && (
                  <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => abrir(p.storage_url!)}>
                    <ImageIcon className="mr-1 h-3 w-3" /> Abrir
                  </Button>
                )}
              </div>
            ))}
            {(previews.data ?? []).length === 0 && (
              <div className="col-span-full rounded border border-dashed border-border p-12 text-center text-muted-foreground">
                Nenhum preview encontrado.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="almox" className="flex-1 overflow-auto p-6 pt-3">
          <Tabela cols={["Ref.", "Descrição", "Qtd", "Un.", "Status"]}
            rows={(almox.data ?? []).map((a) => [a.referencia ?? "—", a.descricao, a.quantidade, a.unidade, a.status])} />
        </TabsContent>

        <TabsContent value="erros" className="flex-1 overflow-auto p-6 pt-3">
          {(imp.erros_json ?? []).length === 0 ? (
            <div className="rounded border border-dashed p-12 text-center text-muted-foreground">Nenhum erro.</div>
          ) : (
            <ul className="space-y-1 text-sm">
              {imp.erros_json.map((e, i) => (
                <li key={i} className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
                  <FileText className="mr-1 inline h-3 w-3" /> {e.msg}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Tabela({ cols, rows }: { cols: string[]; rows: Array<Array<string | number | null>> }) {
  return (
    <div className="overflow-x-auto rounded border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs uppercase text-muted-foreground">
          <tr>{cols.map((c) => <th key={c} className="p-2 text-left">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((v, j) => <td key={j} className="p-2 text-xs">{v ?? "—"}</td>)}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={cols.length} className="p-6 text-center text-muted-foreground">Nenhum registro.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
