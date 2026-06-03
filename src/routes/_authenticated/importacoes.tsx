import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Upload, FileArchive, Check, X, AlertTriangle, FileText, Download,
  RefreshCw, Trash2, FolderOpen, Layers,
} from "lucide-react";
import {
  classificarArquivo, resumirArquivos, parseNomeChapa,
  CHAPA_PADRAO_ALTURA, CHAPA_PADRAO_LARGURA, CATEGORIA_LABEL,
  type ArquivoClassificado, type ResumoImportacao,
} from "@/lib/importacao-promob";

export const Route = createFileRoute("/_authenticated/importacoes")({
  head: () => ({ meta: [{ title: "Importações Promob — Visualizador CNC" }] }),
  component: ImportacoesPage,
});

type Importacao = {
  id: string;
  projeto_id: string | null;
  nome_arquivo: string;
  tipo: string;
  status: string;
  cliente_detectado: string | null;
  projeto_detectado: string | null;
  ambiente_detectado: string | null;
  resumo_json: ResumoImportacao | Record<string, unknown>;
  erros_json: Array<{ msg: string }>;
  criado_em: string;
};

type ArquivoTecnico = {
  id: string;
  projeto_id: string | null;
  importacao_id: string | null;
  origem_pasta: string | null;
  tipo_arquivo: string | null;
  nome_arquivo: string;
  storage_url: string | null;
  criado_em: string;
};

function ImportacoesPage() {
  const [tab, setTab] = useState("nova");

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="border-b border-border-strong bg-panel px-6 py-4">
        <div className="flex items-center gap-3">
          <FileArchive className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Importações Promob / Nesting / Cut Pro</h1>
            <p className="text-xs text-muted-foreground">
              Faça upload do pacote ZIP exportado e gere projeto, chapas, peças e arquivos técnicos automaticamente.
            </p>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col">
        <TabsList className="mx-6 mt-3 self-start">
          <TabsTrigger value="nova"><Upload className="mr-2 h-4 w-4" />Nova Importação</TabsTrigger>
          <TabsTrigger value="lista"><FolderOpen className="mr-2 h-4 w-4" />Realizadas</TabsTrigger>
          <TabsTrigger value="erros"><AlertTriangle className="mr-2 h-4 w-4" />Erros/Pendências</TabsTrigger>
          <TabsTrigger value="arquivos"><FileText className="mr-2 h-4 w-4" />Arquivos técnicos</TabsTrigger>
        </TabsList>

        <TabsContent value="nova" className="flex-1 overflow-auto p-6 pt-3"><NovaImportacao /></TabsContent>
        <TabsContent value="lista" className="flex-1 overflow-auto p-6 pt-3"><ListaImportacoes /></TabsContent>
        <TabsContent value="erros" className="flex-1 overflow-auto p-6 pt-3"><ErrosImportacoes /></TabsContent>
        <TabsContent value="arquivos" className="flex-1 overflow-auto p-6 pt-3"><ArquivosTecnicos /></TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// Nova Importação
// ============================================================
function NovaImportacao() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [zip, setZip] = useState<JSZip | null>(null);
  const [arquivos, setArquivos] = useState<ArquivoClassificado[]>([]);
  const [resumo, setResumo] = useState<ResumoImportacao | null>(null);
  const [nomeProjeto, setNomeProjeto] = useState("");
  const [cliente, setCliente] = useState("");
  const [ambiente, setAmbiente] = useState("");
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState("");

  async function lerZip(f: File) {
    setArquivo(f);
    setNomeProjeto(f.name.replace(/\.zip$/i, ""));
    try {
      const z = await JSZip.loadAsync(f);
      setZip(z);
      const lista: ArquivoClassificado[] = [];
      z.forEach((path, entry) => {
        if (entry.dir) return;
        // @ts-expect-error - _data exists in JSZip internals for size
        const size = entry?._data?.uncompressedSize ?? 0;
        lista.push(classificarArquivo(path, size));
      });
      setArquivos(lista);
      setResumo(resumirArquivos(lista));
      toast.success(`${lista.length} arquivos encontrados`);
    } catch (e) {
      toast.error(`Falha ao ler ZIP: ${(e as Error).message}`);
    }
  }

  async function confirmarImportacao() {
    if (!zip || !arquivo || !resumo) return;
    if (!nomeProjeto.trim()) {
      toast.error("Informe o nome do projeto");
      return;
    }
    setImportando(true);
    const erros: Array<{ msg: string }> = [];

    try {
      setProgresso("Identificando usuário...");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Usuário não autenticado");
      const userId = u.user.id;

      setProgresso("Criando importação...");
      const { data: imp, error: e0 } = await supabase
        .from("importacoes")
        .insert({
          nome_arquivo: arquivo.name,
          tipo: "promob_zip",
          status: "processando",
          projeto_detectado: nomeProjeto,
          cliente_detectado: cliente || null,
          ambiente_detectado: ambiente || null,
          resumo_json: resumo as unknown as never,
        })
        .select("id")
        .single();
      if (e0 || !imp) throw e0 ?? new Error("Falha criando importação");
      const importacaoId = imp.id;

      setProgresso("Criando projeto...");
      const { data: proj, error: e1 } = await supabase
        .from("projetos")
        .insert({
          nome: nomeProjeto,
          cliente: cliente || null,
          ambiente: ambiente || null,
          status: "ativo",
          observacao: `Importado de ${arquivo.name}`,
        })
        .select("id")
        .single();
      if (e1 || !proj) throw e1 ?? new Error("Falha criando projeto");
      const projetoId = proj.id;

      setProgresso("Criando chapas...");
      const chapasInseridas = new Map<number, string>();
      for (const c of resumo.chapas_detectadas) {
        const { data: ch, error: ec } = await supabase
          .from("chapas")
          .insert({
            nome: `${c.material} ${c.cor} ${c.espessura}mm (importada)`,
            codigo: `IMP${c.ordem.toString().padStart(2, "0")}-${nomeProjeto.slice(0, 6).toUpperCase()}`,
            tipo: c.material,
            cor: "#d6c6a8",
            espessura: c.espessura,
            largura: CHAPA_PADRAO_LARGURA,
            altura: CHAPA_PADRAO_ALTURA,
            estoque: 1,
          })
          .select("id")
          .single();
        if (ec) {
          erros.push({ msg: `Chapa ${c.nome_arquivo}: ${ec.message}` });
        } else if (ch) {
          chapasInseridas.set(c.ordem, ch.id);
        }
      }

      // Faz upload dos arquivos e registra metadados
      setProgresso("Enviando arquivos técnicos...");
      const arquivosImp: any[] = [];
      const arquivosTec: any[] = [];
      let i = 0;
      for (const a of arquivos) {
        i += 1;
        if ((i % 25) === 0) setProgresso(`Enviando ${i}/${arquivos.length}...`);
        if (a.categoria === "ignorado") {
          arquivosImp.push({
            importacao_id: importacaoId,
            nome_arquivo: a.nome,
            caminho_original: a.caminho,
            tipo_arquivo: a.extensao,
            origem_pasta: a.pasta || "raiz",
            status_leitura: "ignorado",
            metadados_json: { categoria: a.categoria },
          });
          continue;
        }
        try {
          const entry = zip.file(a.caminho);
          if (!entry) continue;
          const blob = await entry.async("blob");
          const safe = a.caminho.replace(/[^a-zA-Z0-9._/-]/g, "_");
          const storagePath = `${userId}/${importacaoId}/${safe}`;
          const { error: eu } = await supabase.storage
            .from("importacoes")
            .upload(storagePath, blob, { upsert: true });
          if (eu) {
            erros.push({ msg: `Upload ${a.nome}: ${eu.message}` });
            arquivosImp.push({
              importacao_id: importacaoId,
              nome_arquivo: a.nome,
              caminho_original: a.caminho,
              tipo_arquivo: a.extensao,
              origem_pasta: a.pasta || "raiz",
              status_leitura: "erro",
              metadados_json: { categoria: a.categoria, erro: eu.message },
            });
            continue;
          }
          arquivosImp.push({
            importacao_id: importacaoId,
            nome_arquivo: a.nome,
            caminho_original: a.caminho,
            tipo_arquivo: a.extensao,
            origem_pasta: a.pasta || "raiz",
            status_leitura: "lido",
            storage_url: storagePath,
            metadados_json: { categoria: a.categoria, tamanho: a.tamanho },
          });

          // Vincula chapa quando aplicável (xml_cyc, nc_*)
          let chapaIdVinc: string | null = null;
          const chapaInfo = parseNomeChapa(a.nome);
          if (chapaInfo) chapaIdVinc = chapasInseridas.get(chapaInfo.ordem) ?? null;
          // NC: 13_MDP_Cerrado_Bold_25.nc — mesma regra
          if (!chapaIdVinc && (a.categoria === "nc_gcode" || a.categoria === "nc_cyc")) {
            const ci = parseNomeChapa(a.nome);
            if (ci) chapaIdVinc = chapasInseridas.get(ci.ordem) ?? null;
          }

          arquivosTec.push({
            projeto_id: projetoId,
            chapa_id: chapaIdVinc,
            importacao_id: importacaoId,
            origem_pasta: a.pasta || "raiz",
            tipo_arquivo: a.categoria,
            nome_arquivo: a.nome,
            storage_url: storagePath,
            dados_extraidos_json: { categoria: a.categoria, tamanho: a.tamanho },
          });
        } catch (e) {
          erros.push({ msg: `${a.nome}: ${(e as Error).message}` });
        }
      }

      setProgresso("Salvando registros...");
      // Insere em lotes para evitar payload gigante
      const lote = 200;
      for (let k = 0; k < arquivosImp.length; k += lote) {
        await supabase.from("importacao_arquivos").insert(arquivosImp.slice(k, k + lote));
      }
      for (let k = 0; k < arquivosTec.length; k += lote) {
        await supabase.from("arquivos_tecnicos").insert(arquivosTec.slice(k, k + lote));
      }

      setProgresso("Finalizando...");
      await supabase
        .from("importacoes")
        .update({
          projeto_id: projetoId,
          status: erros.length ? "concluido_com_erros" : "concluido",
          erros_json: erros,
        })
        .eq("id", importacaoId);

      toast.success(`Importação concluída: projeto criado com ${chapasInseridas.size} chapas`);
      qc.invalidateQueries({ queryKey: ["importacoes"] });
      qc.invalidateQueries({ queryKey: ["projetos"] });
      navigate({ to: "/projetos/$id", params: { id: projetoId } });
    } catch (e) {
      toast.error(`Erro: ${(e as Error).message}`);
    } finally {
      setImportando(false);
      setProgresso("");
    }
  }

  function limpar() {
    setArquivo(null);
    setZip(null);
    setArquivos([]);
    setResumo(null);
    setNomeProjeto("");
    setCliente("");
    setAmbiente("");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {!arquivo && (
        <div className="rounded-lg border-2 border-dashed border-border bg-surface p-12 text-center">
          <FileArchive className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
          <p className="mb-4 text-sm text-muted-foreground">
            Selecione o ZIP exportado pelo Promob/Nesting/Cut Pro.
          </p>
          <input
            id="zip-input"
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && lerZip(e.target.files[0])}
          />
          <Button onClick={() => document.getElementById("zip-input")?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Selecionar ZIP
          </Button>
        </div>
      )}

      {arquivo && resumo && (
        <>
          <div className="flex items-center justify-between rounded border border-border bg-surface p-3">
            <div className="flex items-center gap-2">
              <FileArchive className="h-5 w-5 text-primary" />
              <span className="font-medium">{arquivo.name}</span>
              <Badge variant="secondary">{(arquivo.size / 1024 / 1024).toFixed(2)} MB</Badge>
            </div>
            <Button size="sm" variant="ghost" onClick={limpar} disabled={importando}>
              <X className="mr-1 h-4 w-4" /> Trocar arquivo
            </Button>
          </div>

          {/* Estrutura encontrada */}
          <div className="rounded border border-border bg-surface p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Estrutura encontrada
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
              <Estatus ok={resumo.tem_list} label="Arquivo List" />
              <Estatus ok={(resumo.por_categoria["xml_cyc"] ?? 0) > 0} label={`Pasta xml (${resumo.por_categoria["xml_cyc"] ?? 0})`} />
              <Estatus ok={resumo.tem_lista_corte} label="ListaCorte.pdf" />
              <Estatus ok={resumo.tem_preview_corte} label="PreviewCorte.pdf" />
              <Estatus ok={resumo.tem_almoxarifado} label="Almoxarifado.pdf" />
              <Estatus ok={(resumo.por_categoria["autolabel_etiqueta"] ?? 0) > 0}
                label={`AutoLabel (${resumo.por_categoria["autolabel_etiqueta"] ?? 0})`} />
              <Estatus ok={(resumo.por_categoria["nc_gcode"] ?? 0) > 0}
                label={`NC G-code (${resumo.por_categoria["nc_gcode"] ?? 0})`} />
              <Estatus ok={(resumo.por_categoria["parts_nc"] ?? 0) + (resumo.por_categoria["parts_info"] ?? 0) > 0}
                label={`Parts (${(resumo.por_categoria["parts_nc"] ?? 0) + (resumo.por_categoria["parts_info"] ?? 0)})`} />
              <Estatus ok={(resumo.por_categoria["profile_nc"] ?? 0) + (resumo.por_categoria["profile_info"] ?? 0) > 0}
                label={`Profile (${(resumo.por_categoria["profile_nc"] ?? 0) + (resumo.por_categoria["profile_info"] ?? 0)})`} />
            </div>
          </div>

          {/* Chapas detectadas */}
          <div className="rounded border border-border bg-surface p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Layers className="h-4 w-4" />
              Chapas detectadas ({resumo.chapas_detectadas.length})
            </div>
            {resumo.chapas_detectadas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma chapa detectada na pasta xml.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {resumo.chapas_detectadas.map((c) => (
                  <div key={c.ordem} className="flex items-center gap-2 rounded border border-border bg-surface-2 p-2 text-sm">
                    <Badge variant="outline" className="font-mono">#{c.ordem}</Badge>
                    <span className="flex-1">{c.material} {c.cor} {c.espessura}mm</span>
                    <span className="text-xs text-muted-foreground">{CHAPA_PADRAO_LARGURA}×{CHAPA_PADRAO_ALTURA}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Conferência manual */}
          <div className="rounded border border-border bg-surface p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Dados do projeto
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <Label>Nome do projeto</Label>
                <Input value={nomeProjeto} onChange={(e) => setNomeProjeto(e.target.value)} />
              </div>
              <div>
                <Label>Cliente</Label>
                <Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Opcional" />
              </div>
              <div>
                <Label>Ambiente</Label>
                <Input value={ambiente} onChange={(e) => setAmbiente(e.target.value)} placeholder="Opcional" />
              </div>
            </div>
          </div>

          {/* Lista detalhada (resumida) */}
          <details className="rounded border border-border bg-surface p-3 text-sm">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ver todos os arquivos ({arquivos.length})
            </summary>
            <div className="mt-2 max-h-72 overflow-auto rounded border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-muted-foreground">
                  <tr><th className="p-1 text-left">Caminho</th><th className="p-1">Categoria</th></tr>
                </thead>
                <tbody>
                  {arquivos.map((a) => (
                    <tr key={a.caminho} className="border-t border-border">
                      <td className="p-1 font-mono">{a.caminho}</td>
                      <td className="p-1 text-center">
                        <Badge variant={a.categoria === "ignorado" ? "outline" : "secondary"} className="text-[10px]">
                          {CATEGORIA_LABEL[a.categoria]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              {progresso || "Pronto para criar o projeto, chapas e armazenar os arquivos técnicos."}
            </p>
            <Button size="lg" onClick={confirmarImportacao} disabled={importando}>
              <Check className="mr-2 h-5 w-5" />
              {importando ? "Importando..." : "Confirmar e criar projeto"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Estatus({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? <Check className="h-4 w-4 text-success" /> : <X className="h-4 w-4 text-muted-foreground" />}
      <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

// ============================================================
// Lista de importações realizadas
// ============================================================
function ListaImportacoes() {
  const qc = useQueryClient();
  const { data: importacoes } = useQuery({
    queryKey: ["importacoes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("importacoes")
        .select("*")
        .order("criado_em", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as Importacao[];
    },
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("importacoes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Importação removida (projeto preservado)");
      qc.invalidateQueries({ queryKey: ["importacoes"] });
    },
  });

  return (
    <div className="overflow-x-auto rounded border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="p-2 text-left">Data</th>
            <th className="p-2 text-left">Arquivo</th>
            <th className="p-2 text-left">Projeto</th>
            <th className="p-2 text-left">Cliente</th>
            <th className="p-2 text-left">Status</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {(importacoes ?? []).map((i) => (
            <tr key={i.id} className="border-t border-border">
              <td className="p-2 text-xs text-muted-foreground">{new Date(i.criado_em).toLocaleString("pt-BR")}</td>
              <td className="p-2 font-mono text-xs">{i.nome_arquivo}</td>
              <td className="p-2">
                {i.projeto_id ? (
                  <Link to="/projetos/$id" params={{ id: i.projeto_id }} className="text-primary hover:underline">
                    {i.projeto_detectado ?? "Abrir projeto"}
                  </Link>
                ) : (i.projeto_detectado ?? "—")}
              </td>
              <td className="p-2 text-xs">{i.cliente_detectado ?? "—"}</td>
              <td className="p-2">
                <StatusBadge status={i.status} />
              </td>
              <td className="p-2 text-right">
                <Button size="sm" variant="ghost" onClick={() => { if (confirm("Excluir importação? O projeto será preservado.")) remover.mutate(i.id); }}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </td>
            </tr>
          ))}
          {(importacoes ?? []).length === 0 && (
            <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Nenhuma importação ainda.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pendente: { label: "Pendente", variant: "outline" },
    processando: { label: "Processando", variant: "secondary" },
    concluido: { label: "Concluído", variant: "default" },
    concluido_com_erros: { label: "Com erros", variant: "destructive" },
    erro: { label: "Erro", variant: "destructive" },
  };
  const m = map[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

// ============================================================
// Erros e pendências
// ============================================================
function ErrosImportacoes() {
  const { data } = useQuery({
    queryKey: ["importacoes-erros"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("importacoes")
        .select("*")
        .in("status", ["concluido_com_erros", "erro"])
        .order("criado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Importacao[];
    },
  });

  return (
    <div className="space-y-3">
      {(data ?? []).map((i) => (
        <div key={i.id} className="rounded border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">{i.projeto_detectado ?? i.nome_arquivo}</div>
              <div className="text-xs text-muted-foreground">{new Date(i.criado_em).toLocaleString("pt-BR")}</div>
            </div>
            <StatusBadge status={i.status} />
          </div>
          <ul className="mt-2 list-inside list-disc text-xs text-destructive">
            {(i.erros_json ?? []).map((e, idx) => <li key={idx}>{e.msg}</li>)}
          </ul>
        </div>
      ))}
      {(data ?? []).length === 0 && (
        <div className="rounded border border-dashed border-border bg-surface p-12 text-center text-muted-foreground">
          Nenhum erro registrado.
        </div>
      )}
    </div>
  );
}

// ============================================================
// Arquivos técnicos
// ============================================================
function ArquivosTecnicos() {
  const [filtro, setFiltro] = useState("todos");
  const { data: arquivos } = useQuery({
    queryKey: ["arquivos-tecnicos", filtro],
    queryFn: async () => {
      let q = supabase
        .from("arquivos_tecnicos")
        .select("*")
        .order("criado_em", { ascending: false })
        .limit(500);
      if (filtro !== "todos") q = q.eq("origem_pasta", filtro);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ArquivoTecnico[];
    },
  });

  async function baixar(path: string, nome: string) {
    const { data, error } = await supabase.storage.from("importacoes").createSignedUrl(path, 300);
    if (error || !data) {
      toast.error(error?.message ?? "Falha ao gerar link");
      return;
    }
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = nome;
    a.click();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <div>
          <Label className="text-xs">Pasta de origem</Label>
          <Select value={filtro} onValueChange={setFiltro}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas</SelectItem>
              <SelectItem value="autolabel">AutoLabel</SelectItem>
              <SelectItem value="nc">NC</SelectItem>
              <SelectItem value="parts">Parts</SelectItem>
              <SelectItem value="profile">Profile</SelectItem>
              <SelectItem value="xml">xml</SelectItem>
              <SelectItem value="raiz">Raiz</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Arquivo</th>
              <th className="p-2 text-left">Pasta</th>
              <th className="p-2 text-left">Tipo</th>
              <th className="p-2 text-left">Data</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {(arquivos ?? []).map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="p-2 font-mono text-xs">{a.nome_arquivo}</td>
                <td className="p-2 text-xs">{a.origem_pasta}</td>
                <td className="p-2 text-xs text-muted-foreground">{a.tipo_arquivo}</td>
                <td className="p-2 text-xs text-muted-foreground">{new Date(a.criado_em).toLocaleString("pt-BR")}</td>
                <td className="p-2 text-right">
                  {a.storage_url && (
                    <Button size="sm" variant="ghost" onClick={() => baixar(a.storage_url!, a.nome_arquivo)}>
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {(arquivos ?? []).length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Nenhum arquivo técnico armazenado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
