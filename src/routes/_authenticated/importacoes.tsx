import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
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
  Trash2, FolderOpen, Layers, Eye,
} from "lucide-react";
import {
  classificarArquivo, resumirArquivos, parseNomeChapa, parseNomeEtiqueta,
  extrairTextoPdf, parseListaCorte, parseAlmoxarifado, parseListaCortePdfByCoordinates,
  CHAPA_PADRAO_ALTURA, CHAPA_PADRAO_LARGURA, CATEGORIA_LABEL,
  type ArquivoClassificado, type ResumoImportacao,
} from "@/lib/importacao-promob";

export const Route = createFileRoute("/_authenticated/importacoes")({
  beforeLoad: () => {
    throw redirect({ to: "/projetos/importacoes" });
  },
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

export function ImportacoesPage() {
  const [tab, setTab] = useState("nova");

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="border-b border-border-strong bg-panel px-6 py-4">
        <div className="flex items-center gap-3">
          <FileArchive className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Criar projeto por importação</h1>
            <p className="text-xs text-muted-foreground">
              Importe um ZIP gerado pelo Promob/Nesting/Cut Pro para criar automaticamente projeto, chapas, peças, etiquetas, almoxarifado e arquivos técnicos.
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
type ImportFileEntry = {
  name: string;
  relativePath: string;
  folder: string;
  extension: string;
  size: number;
  /** Loader devolve o blob sob demanda (zip extrai async; pasta retorna o File). */
  load: () => Promise<Blob>;
  source: "folder" | "zip";
};

/** Extrai "PV-XXX-NNNN" + cliente do nome da pasta/zip raiz. */
function extrairProjetoCliente(rootName: string): { projeto: string; cliente: string } {
  const limpo = rootName.replace(/\.zip$/i, "").trim();
  const m = limpo.match(/^([A-Z]{2,4}-[A-Z0-9]+-?\d+)\s*[-–—]\s*(.+)$/i);
  if (m) return { projeto: m[1].toUpperCase(), cliente: m[2].trim() };
  return { projeto: limpo, cliente: "" };
}

/** Acha o nome da pasta raiz comum entre todos os caminhos. */
function detectarPastaRaiz(paths: string[]): string {
  if (!paths.length) return "";
  const primeiros = paths.map((p) => p.split("/")[0]).filter(Boolean);
  if (!primeiros.length) return "";
  const ref = primeiros[0];
  return primeiros.every((x) => x === ref) ? ref : "";
}

// ============================================================
// Fila de upload em segundo plano (concorrência limitada)
// ============================================================
type UploadCtx = {
  importacaoId: string;
  userId: string;
  entries: ImportFileEntry[];
  arquivos: ArquivoClassificado[];
  prioridade: Record<string, 1 | 2 | 3>;
  pathSafe: (p: string) => string;
};

async function uploadEmBackground(ctx: UploadCtx) {
  const { importacaoId, userId, entries, arquivos, prioridade, pathSafe } = ctx;
  const fila = arquivos
    .filter((a) => a.categoria !== "ignorado")
    .map((a) => ({
      a,
      entry: entries.find((e) => e.relativePath === a.caminho) ?? null,
      prio: prioridade[a.categoria] ?? 3,
    }))
    .filter((x) => x.entry)
    .sort((x, y) => x.prio - y.prio);

  const total = fila.length;
  let enviados = 0;
  let falhas = 0;
  const CONCURRENCY = 4;
  const toastId = `up-${importacaoId}`;
  toast.loading(`Enviando arquivos... 0/${total}`, { id: toastId });

  async function atualizaResumo() {
    // Atualiza contador no resumo_json (best-effort, sem race-condition perfeita)
    if (enviados % 25 === 0 || enviados + falhas === total) {
      const { data } = await supabase
        .from("importacoes").select("resumo_json").eq("id", importacaoId).single();
      const resumoAtual = (data?.resumo_json ?? {}) as Record<string, unknown>;
      await supabase.from("importacoes").update({
        resumo_json: {
          ...resumoAtual,
          upload_enviados: enviados,
          upload_erros: falhas,
        } as unknown as never,
        status: enviados + falhas === total
          ? (falhas ? "concluido_com_erros" : "concluido")
          : "concluido_com_upload_pendente",
      }).eq("id", importacaoId);
    }
  }

  async function processaUm(item: { a: ArquivoClassificado; entry: ImportFileEntry | null }) {
    const { a, entry } = item;
    if (!entry) return;
    const storagePath = `${userId}/${importacaoId}/${pathSafe(a.caminho)}`;
    try {
      const blob = await entry.load();
      const { error } = await supabase.storage
        .from("importacoes")
        .upload(storagePath, blob, { upsert: true });
      if (error) throw error;
      enviados += 1;
      await supabase.from("importacao_arquivos")
        .update({ status_leitura: "lido" })
        .eq("importacao_id", importacaoId)
        .eq("caminho_original", a.caminho);
    } catch (e) {
      falhas += 1;
      await supabase.from("importacao_arquivos")
        .update({
          status_leitura: "erro",
          metadados_json: { erro: (e as Error).message, categoria: a.categoria },
        })
        .eq("importacao_id", importacaoId)
        .eq("caminho_original", a.caminho);
    } finally {
      toast.loading(`Enviando arquivos... ${enviados + falhas}/${total}${falhas ? ` (${falhas} falhas)` : ""}`, { id: toastId });
      await atualizaResumo();
    }
  }

  // Workers em paralelo consumindo a mesma fila
  let idx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < fila.length) {
      const myIdx = idx++;
      await processaUm(fila[myIdx]);
    }
  });
  await Promise.all(workers);

  if (falhas === 0) {
    toast.success(`Upload concluído: ${enviados}/${total} arquivos enviados.`, { id: toastId, duration: 5000 });
  } else {
    toast.warning(`Upload finalizado com ${falhas} falhas de ${total}. Você pode reenviar pela tela da importação.`, { id: toastId, duration: 8000 });
  }
}

function NovaImportacao() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [origemNome, setOrigemNome] = useState<string | null>(null);
  const [origemTipo, setOrigemTipo] = useState<"folder" | "zip" | null>(null);
  const [tamanhoTotal, setTamanhoTotal] = useState(0);
  const [entries, setEntries] = useState<ImportFileEntry[]>([]);
  const [arquivos, setArquivos] = useState<ArquivoClassificado[]>([]);
  const [resumo, setResumo] = useState<ResumoImportacao | null>(null);
  const [nomeProjeto, setNomeProjeto] = useState("");
  const [cliente, setCliente] = useState("");
  const [ambiente, setAmbiente] = useState("");
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState("");

  function aplicarEntries(novas: ImportFileEntry[], origem: "folder" | "zip", nomeOrigem: string) {
    setOrigemTipo(origem);
    setOrigemNome(nomeOrigem);
    setEntries(novas);
    setTamanhoTotal(novas.reduce((a, b) => a + b.size, 0));

    const lista = novas.map((e) => classificarArquivo(e.relativePath, e.size));
    setArquivos(lista);
    setResumo(resumirArquivos(lista));

    // Nome do projeto = pasta raiz comum, com fallback para nome do arquivo
    const raiz = detectarPastaRaiz(novas.map((e) => e.relativePath)) || nomeOrigem;
    const { projeto, cliente: cli } = extrairProjetoCliente(raiz);
    setNomeProjeto(projeto);
    if (cli) setCliente(cli);

    toast.success(`${novas.length} arquivos encontrados (${origem === "folder" ? "pasta" : "ZIP"})`);
  }

  async function lerZip(f: File) {
    try {
      const z = await JSZip.loadAsync(f);
      const novas: ImportFileEntry[] = [];
      z.forEach((path, entry) => {
        if (entry.dir) return;
        const nome = path.split("/").pop() ?? path;
        const ext = nome.includes(".") ? nome.split(".").pop()!.toLowerCase() : "";
        // @ts-expect-error - _data exists in JSZip internals for size
        const size = entry?._data?.uncompressedSize ?? 0;
        novas.push({
          name: nome,
          relativePath: path,
          folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
          extension: ext,
          size,
          load: () => entry.async("blob"),
          source: "zip",
        });
      });
      aplicarEntries(novas, "zip", f.name);
    } catch (e) {
      toast.error(`Falha ao ler ZIP: ${(e as Error).message}`);
    }
  }

  function lerPasta(fileList: FileList) {
    const novas: ImportFileEntry[] = [];
    for (const f of Array.from(fileList)) {
      // webkitRelativePath inclui a pasta raiz (ex: "PV-JAC-3086 - LUIS/.../List.xml")
      const rel =
        (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "";
      novas.push({
        name: f.name,
        relativePath: rel,
        folder: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "",
        extension: ext,
        size: f.size,
        load: async () => f,
        source: "folder",
      });
    }
    if (!novas.length) {
      toast.error("Nenhum arquivo encontrado na pasta");
      return;
    }
    const raiz = detectarPastaRaiz(novas.map((e) => e.relativePath)) || "pasta";
    aplicarEntries(novas, "folder", raiz);
  }

  async function confirmarImportacao() {
    if (!entries.length || !resumo) return;
    if (!nomeProjeto.trim()) {
      toast.error("Informe o nome do projeto");
      return;
    }
    setImportando(true);
    const erros: Array<{ msg: string }> = [];

    // ---- helpers (escopo local) ----
    const PRIORIDADE: Record<string, 1 | 2 | 3> = {
      list: 1, lista_corte_pdf: 1, preview_corte_pdf: 1, almoxarifado_pdf: 1,
      autolabel_pdf: 1, autolabel_large_preview: 1, autolabel_small_preview: 1,
      xml_cyc: 1, nc_cyc: 1, nc_gcode: 1,
      parts_info: 2, parts_nc: 2, profile_info: 2, profile_nc: 2,
      autolabel_etiqueta: 3, nc_bmp: 3,
    };
    const pathSafe = (p: string) => p.replace(/[^a-zA-Z0-9._/-]/g, "_");

    try {
      setProgresso("Identificando usuário...");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Usuário não autenticado");
      const userId = u.user.id;

      setProgresso("Criando importação...");
      const { data: imp, error: e0 } = await supabase
        .from("importacoes")
        .insert({
          nome_arquivo: origemNome ?? "(pasta)",
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
          observacao: `Importado de ${origemNome ?? "(pasta)"}`,
        })
        .select("id")
        .single();
      if (e1 || !proj) throw e1 ?? new Error("Falha criando projeto");
      const projetoId = proj.id;

      setProgresso("Criando chapas...");
      const chapasInseridas = new Map<number, { id: string; espessura: number; material: string }>();
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
        if (ec) erros.push({ msg: `Chapa ${c.nome_arquivo}: ${ec.message}` });
        else if (ch) chapasInseridas.set(c.ordem, { id: ch.id, espessura: c.espessura, material: c.material });
      }

      // -------- Fase A.2: Ler localmente os PDFs essenciais (sem upload) --------
      setProgresso("Lendo PDFs essenciais (local)...");
      const acharEntry = (cat: string) => {
        const arq = arquivos.find((a) => a.categoria === cat);
        if (!arq) return null;
        return entries.find((e) => e.relativePath === arq.caminho) ?? null;
      };
      const entryListaCorte = acharEntry("lista_corte_pdf");
      const entryAlmox = acharEntry("almoxarifado_pdf");
      const entryPreviewCorte = acharEntry("preview_corte_pdf");

      // -------- Parse ListaCorte → peças --------
      let pecasCriadas = 0;
      if (entryListaCorte) {
        try {
          setProgresso("Interpretando ListaCorte.pdf...");
          const blob = await entryListaCorte.load();
          const paginas = await extrairTextoPdf(blob);
          const pecas = parseListaCorte(paginas);
          if (pecas.length) {
            const rows = pecas.map((p, idx) => {
              const chapa = p.chapa_numero ? chapasInseridas.get(p.chapa_numero) : undefined;
              return {
                projeto_id: projetoId,
                descricao: p.descricao || `Peça ${idx + 1}`,
                quantidade: 1,
                largura: p.largura,
                altura: p.altura,
                espessura: chapa?.espessura ?? 15,
                chapa_id: chapa?.id ?? null,
                fita_codigo: p.borda,
                modulo: p.modulo,
                observacao: p.indice ? `Índice ${p.indice} • Código ${p.codigo ?? "—"}` : (p.codigo ?? null),
                ordem: idx,
              };
            });
            for (let k = 0; k < rows.length; k += 200) {
              const { error: ep } = await supabase.from("projeto_pecas").insert(rows.slice(k, k + 200) as unknown as never);
              if (ep) erros.push({ msg: `Peças (lote ${k}): ${ep.message}` });
            }
            pecasCriadas = rows.length;
          } else {
            erros.push({ msg: "ListaCorte: nenhuma peça reconhecida automaticamente." });
          }
        } catch (e) {
          erros.push({ msg: `Falha lendo ListaCorte: ${(e as Error).message}` });
        }
      }

      // -------- Parse Almoxarifado --------
      let itensAlmox = 0;
      if (entryAlmox) {
        try {
          setProgresso("Interpretando Almoxarifado.pdf...");
          const blob = await entryAlmox.load();
          const paginas = await extrairTextoPdf(blob);
          const itens = parseAlmoxarifado(paginas);
          if (itens.length) {
            const rows = itens.map((it) => ({
              projeto_id: projetoId,
              descricao: it.descricao,
              referencia: it.referencia,
              quantidade: it.quantidade,
              unidade: it.unidade,
              categoria: "ferragem",
              origem: "importacao_promob",
              status: "pendente",
            }));
            const { error: ea } = await supabase.from("projeto_almoxarifado_itens").insert(rows as unknown as never);
            if (ea) erros.push({ msg: `Almoxarifado: ${ea.message}` });
            else itensAlmox = rows.length;
          }
        } catch (e) {
          erros.push({ msg: `Falha lendo Almoxarifado: ${(e as Error).message}` });
        }
      }

      // -------- Pre-insere TODOS os registros (metadados) com storage_url previsto --------
      setProgresso("Registrando metadados de arquivos...");
      type ImpArqRow = {
        importacao_id: string; nome_arquivo: string; caminho_original: string;
        tipo_arquivo: string | null; origem_pasta: string | null;
        status_leitura: string; storage_url?: string;
        metadados_json: Record<string, unknown>;
      };
      type ArqTecRow = {
        projeto_id: string; chapa_id: string | null; importacao_id: string;
        origem_pasta: string; tipo_arquivo: string; nome_arquivo: string;
        storage_url: string; dados_extraidos_json: Record<string, unknown>;
      };
      type PreviewRow = {
        importacao_id: string; projeto_id: string; chapa_id: string | null;
        numero_chapa: number | null; tipo_preview: string; arquivo_nome: string;
        storage_url: string; pagina_pdf: number | null;
        largura_chapa: number | null; altura_chapa: number | null;
        metadados_json: Record<string, unknown>;
      };
      type EtiquetaRow = {
        importacao_id: string; projeto_id: string; chapa_id: string | null;
        nome_arquivo: string; codigo_completo: string | null;
        referencia: string | null; codigo_peca: string | null;
        sufixo: string | null; duplicidade: number | null;
        storage_url: string | null; status_vinculo: string;
      };
      const arquivosImp: ImpArqRow[] = [];
      const arquivosTec: ArqTecRow[] = [];
      const previewsImp: PreviewRow[] = [];
      const etiquetasImp: EtiquetaRow[] = [];

      for (const a of arquivos) {
        const storagePath = `${userId}/${importacaoId}/${pathSafe(a.caminho)}`;
        const isUploadable = a.categoria !== "ignorado";
        arquivosImp.push({
          importacao_id: importacaoId,
          nome_arquivo: a.nome,
          caminho_original: a.caminho,
          tipo_arquivo: a.extensao,
          origem_pasta: a.pasta || "raiz",
          status_leitura: isUploadable ? "pendente_upload" : "ignorado",
          storage_url: isUploadable ? storagePath : undefined,
          metadados_json: {
            categoria: a.categoria,
            tamanho: a.tamanho,
            prioridade: PRIORIDADE[a.categoria] ?? 3,
          },
        });
        if (!isUploadable) continue;

        const chapaInfo = parseNomeChapa(a.nome);
        const chapaIdVinc = chapaInfo ? chapasInseridas.get(chapaInfo.ordem)?.id ?? null : null;

        arquivosTec.push({
          projeto_id: projetoId, chapa_id: chapaIdVinc,
          importacao_id: importacaoId, origem_pasta: a.pasta || "raiz",
          tipo_arquivo: a.categoria, nome_arquivo: a.nome,
          storage_url: storagePath,
          dados_extraidos_json: { categoria: a.categoria, tamanho: a.tamanho },
        });

        if (a.categoria === "autolabel_large_preview" || a.categoria === "autolabel_small_preview") {
          const mNum = a.nome.match(/(\d+)/);
          const numChapa = mNum ? Number(mNum[1]) : null;
          const chapaIdPrev = numChapa ? chapasInseridas.get(numChapa)?.id ?? null : null;
          previewsImp.push({
            importacao_id: importacaoId, projeto_id: projetoId,
            chapa_id: chapaIdPrev, numero_chapa: numChapa,
            tipo_preview: a.categoria === "autolabel_large_preview" ? "large" : "small",
            arquivo_nome: a.nome, storage_url: storagePath,
            pagina_pdf: null, largura_chapa: null, altura_chapa: null,
            metadados_json: {},
          });
        }

        if (a.categoria === "autolabel_etiqueta" || a.categoria === "nc_bmp") {
          const info = parseNomeEtiqueta(a.nome);
          etiquetasImp.push({
            importacao_id: importacaoId, projeto_id: projetoId,
            chapa_id: chapaIdVinc,
            nome_arquivo: a.nome,
            codigo_completo: info?.nome_base ?? a.nome.replace(/\.[^.]+$/, ""),
            referencia: info?.referencia ?? null,
            codigo_peca: info?.codigo ?? null,
            sufixo: info?.sufixo ?? null,
            duplicidade: info?.duplicidade ?? null,
            storage_url: storagePath,
            status_vinculo: "pendente_vinculo",
          });
        }
      }

      // PreviewCorte → 1 página = 1 chapa (lê local, não bloqueia upload)
      if (entryPreviewCorte) {
        try {
          const blob = await entryPreviewCorte.load();
          const paginas = await extrairTextoPdf(blob);
          const storagePathPreview = `${userId}/${importacaoId}/${pathSafe(
            arquivos.find((a) => a.categoria === "preview_corte_pdf")?.caminho ?? "PreviewCorte.pdf",
          )}`;
          for (const pg of paginas) {
            const chapa = chapasInseridas.get(pg.pagina);
            previewsImp.push({
              importacao_id: importacaoId, projeto_id: projetoId,
              chapa_id: chapa?.id ?? null, numero_chapa: pg.pagina,
              tipo_preview: "preview_corte_pdf",
              arquivo_nome: `PreviewCorte p.${pg.pagina}`,
              storage_url: storagePathPreview,
              pagina_pdf: pg.pagina,
              largura_chapa: null, altura_chapa: null,
              metadados_json: { linhas: pg.linhas.length },
            });
          }
        } catch (e) {
          erros.push({ msg: `Falha lendo PreviewCorte: ${(e as Error).message}` });
        }
      }

      // Vínculo etiqueta → peça por código
      if (etiquetasImp.length && pecasCriadas > 0) {
        const { data: pjPecas } = await supabase
          .from("projeto_pecas")
          .select("id, observacao")
          .eq("projeto_id", projetoId);
        const mapaCodigo = new Map<string, string>();
        for (const pp of pjPecas ?? []) {
          const m = (pp as { observacao: string | null }).observacao?.match(/Código\s+(\d{3,6})/);
          if (m) mapaCodigo.set(m[1], (pp as { id: string }).id);
        }
        for (const et of etiquetasImp) {
          if (et.codigo_peca && mapaCodigo.has(et.codigo_peca)) {
            (et as unknown as { projeto_peca_id: string }).projeto_peca_id = mapaCodigo.get(et.codigo_peca)!;
            et.status_vinculo = "vinculado";
          }
        }
      }

      setProgresso("Salvando registros...");
      const lote = 200;
      for (let k = 0; k < arquivosImp.length; k += lote) {
        await supabase.from("importacao_arquivos").insert(arquivosImp.slice(k, k + lote) as unknown as never);
      }
      for (let k = 0; k < arquivosTec.length; k += lote) {
        await supabase.from("arquivos_tecnicos").insert(arquivosTec.slice(k, k + lote) as unknown as never);
      }
      for (let k = 0; k < previewsImp.length; k += lote) {
        await supabase.from("importacao_preview_chapas").insert(previewsImp.slice(k, k + lote) as unknown as never);
      }
      for (let k = 0; k < etiquetasImp.length; k += lote) {
        await supabase.from("importacao_etiquetas").insert(etiquetasImp.slice(k, k + lote) as unknown as never);
      }

      // Marca importação como "projeto pronto, upload pendente"
      const totalUploadaveis = arquivos.filter((a) => a.categoria !== "ignorado").length;
      await supabase
        .from("importacoes")
        .update({
          projeto_id: projetoId,
          status: "concluido_com_upload_pendente",
          erros_json: erros as unknown as never,
          resumo_json: {
            ...resumo,
            pecas_criadas: pecasCriadas,
            itens_almoxarifado: itensAlmox,
            etiquetas_importadas: etiquetasImp.length,
            previews_importados: previewsImp.length,
            upload_total: totalUploadaveis,
            upload_enviados: 0,
            upload_erros: 0,
          } as unknown as never,
        })
        .eq("id", importacaoId);

      toast.success(
        `Projeto criado: ${chapasInseridas.size} chapas, ${pecasCriadas} peças. Upload dos ${totalUploadaveis} arquivos rodando em segundo plano.`,
        { duration: 6000 },
      );
      qc.invalidateQueries({ queryKey: ["importacoes"] });
      qc.invalidateQueries({ queryKey: ["projetos"] });

      // -------- Fase C: upload em segundo plano (não-bloqueante) --------
      void uploadEmBackground({
        importacaoId,
        userId,
        entries,
        arquivos,
        prioridade: PRIORIDADE,
        pathSafe,
      });

      navigate({ to: "/projetos/importacoes/$id", params: { id: importacaoId } });
    } catch (e) {
      toast.error(`Erro: ${(e as Error).message}`);
    } finally {
      setImportando(false);
      setProgresso("");
    }
  }

  function limpar() {
    setOrigemNome(null); setOrigemTipo(null); setEntries([]); setTamanhoTotal(0);
    setArquivos([]); setResumo(null);
    setNomeProjeto(""); setCliente(""); setAmbiente("");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {!origemNome && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border-2 border-dashed border-border bg-surface p-8 text-center">
            <FolderOpen className="mx-auto mb-3 h-10 w-10 text-primary" />
            <p className="mb-1 text-sm font-medium">Selecionar pasta do projeto</p>
            <p className="mb-4 text-xs text-muted-foreground">
              Use no computador da fábrica, apontando direto para a pasta gerada pelo Cut Pro/Nesting (ex.: <code>PV-XXX - CLIENTE</code>).
            </p>
            <input
              id="folder-input"
              type="file"
              className="hidden"
              // @ts-expect-error - atributos não tipados no React mas suportados nos browsers
              webkitdirectory=""
              directory=""
              multiple
              onChange={(e) => e.target.files && lerPasta(e.target.files)}
            />
            <Button onClick={() => document.getElementById("folder-input")?.click()}>
              <FolderOpen className="mr-2 h-4 w-4" /> Selecionar pasta
            </Button>
          </div>

          <div className="rounded-lg border-2 border-dashed border-border bg-surface p-8 text-center">
            <FileArchive className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="mb-1 text-sm font-medium">Enviar ZIP da pasta</p>
            <p className="mb-4 text-xs text-muted-foreground">
              Use quando a pasta foi compactada para envio ou backup. O conteúdo interno é igual ao da pasta original.
            </p>
            <input id="zip-input" type="file" accept=".zip" className="hidden"
              onChange={(e) => e.target.files?.[0] && lerZip(e.target.files[0])} />
            <Button variant="outline" onClick={() => document.getElementById("zip-input")?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Selecionar ZIP
            </Button>
          </div>
        </div>
      )}

      {origemNome && resumo && (
        <>
          <div className="flex items-center justify-between rounded border border-border bg-surface p-3">
            <div className="flex items-center gap-2">
              {origemTipo === "folder" ? <FolderOpen className="h-5 w-5 text-primary" /> : <FileArchive className="h-5 w-5 text-primary" />}
              <span className="font-medium">{origemNome}</span>
              <Badge variant="secondary">{entries.length} arquivos</Badge>
              <Badge variant="outline">{(tamanhoTotal / 1024 / 1024).toFixed(2)} MB</Badge>
              <Badge>{origemTipo === "folder" ? "Pasta" : "ZIP"}</Badge>
            </div>
            <Button size="sm" variant="ghost" onClick={limpar} disabled={importando}>
              <X className="mr-1 h-4 w-4" /> Trocar origem
            </Button>
          </div>

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

          <div className="rounded border border-border bg-surface p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Dados do projeto
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div><Label>Nome do projeto</Label><Input value={nomeProjeto} onChange={(e) => setNomeProjeto(e.target.value)} /></div>
              <div><Label>Cliente</Label><Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Opcional" /></div>
              <div><Label>Ambiente</Label><Input value={ambiente} onChange={(e) => setAmbiente(e.target.value)} placeholder="Opcional" /></div>
            </div>
          </div>

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
              {progresso || "Pronto: cria projeto, chapas, peças (ListaCorte), etiquetas (AutoLabel/NC), almoxarifado e previews."}
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
        .from("importacoes").select("*").order("criado_em", { ascending: false }).limit(200);
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
              <td className="p-2"><StatusBadge status={i.status} /></td>
              <td className="p-2 text-right">
                <Link to="/projetos/importacoes/$id" params={{ id: i.id }}>
                  <Button size="sm" variant="ghost"><Eye className="h-4 w-4" /></Button>
                </Link>
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

function ErrosImportacoes() {
  const { data } = useQuery({
    queryKey: ["importacoes-erros"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("importacoes").select("*")
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

function ArquivosTecnicos() {
  const [filtro, setFiltro] = useState("todos");
  const { data: arquivos } = useQuery({
    queryKey: ["arquivos-tecnicos", filtro],
    queryFn: async () => {
      let q = supabase.from("arquivos_tecnicos").select("*").order("criado_em", { ascending: false }).limit(500);
      if (filtro !== "todos") q = q.eq("origem_pasta", filtro);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ArquivoTecnico[];
    },
  });

  async function baixar(path: string, nome: string) {
    const { data, error } = await supabase.storage.from("importacoes").createSignedUrl(path, 300);
    if (error || !data) { toast.error(error?.message ?? "Falha ao gerar link"); return; }
    const a = document.createElement("a");
    a.href = data.signedUrl; a.download = nome; a.click();
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
