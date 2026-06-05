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

type ChapaImportada = {
  numero: number;
  material: string;
  cor: string;
  espessura: number;
  largura: number;
  altura: number;
  codigoMaterial: string | null;
  ncFile: string | null;
  cycFile: string | null;
  largePreview: string | null;
  smallPreview: string | null;
  aproveitamento: number | null;
};

type EtiquetaCyc = {
  chapaNumero: number | null;
  labelName: string;
  x: number | null;
  y: number | null;
  r: number | null;
};

function campoXml(cycle: Element, name: string): string | null {
  for (const field of Array.from(cycle.querySelectorAll("Field"))) {
    if ((field.getAttribute("Name") ?? "").toLowerCase() === name.toLowerCase()) {
      return field.getAttribute("Value") ?? field.getAttribute("value") ?? null;
    }
  }
  return null;
}

function numeroArquivoChapa(nome: string | null | undefined): number | null {
  const n = nome?.match(/^(\d{1,3})[\s_-]/)?.[1] ?? nome?.match(/Chapa\s+(\d+)/i)?.[1];
  return n ? Number(n) : null;
}

function parseListXml(texto: string): ChapaImportada[] {
  const doc = new DOMParser().parseFromString(texto, "text/xml");
  const ciclos = Array.from(doc.querySelectorAll("Cycle"));
  const out: ChapaImportada[] = [];
  for (const ciclo of ciclos) {
    const plateId = campoXml(ciclo, "PlateID");
    const labelName = campoXml(ciclo, "LabelName");
    if (!plateId && !labelName) continue;
    const numero = numeroArquivoChapa(plateId) ?? numeroArquivoChapa(labelName) ?? out.length + 1;
    const base = (plateId ?? labelName ?? "").replace(/\.[^.]+$/, "");
    const partes = base.split("_");
    const espessura = Number(campoXml(ciclo, "Thickness") ?? partes.at(-1) ?? 15);
    const material = partes[1] || "MDP";
    const cor = campoXml(ciclo, "Color") ?? (partes.slice(2, -1).join(" ") || "Importada");
    out.push({
      numero,
      material,
      cor,
      espessura: Number.isFinite(espessura) ? espessura : 15,
      largura: CHAPA_PADRAO_LARGURA,
      altura: CHAPA_PADRAO_ALTURA,
      codigoMaterial: null,
      ncFile: plateId,
      cycFile: labelName,
      largePreview: campoXml(ciclo, "LargeImage"),
      smallPreview: campoXml(ciclo, "SmallImage"),
      aproveitamento: null,
    });
  }
  return out.sort((a, b) => a.numero - b.numero);
}

function parseCycLabels(texto: string, arquivo: string): EtiquetaCyc[] {
  const doc = new DOMParser().parseFromString(texto, "text/xml");
  const chapaNumero = numeroArquivoChapa(arquivo);
  return Array.from(doc.querySelectorAll("Cycle"))
    .filter((c) => (c.getAttribute("Name") ?? "").toLowerCase().includes("label"))
    .map((c) => ({
      chapaNumero,
      labelName: campoXml(c, "LabelName") ?? "",
      x: campoXml(c, "X") ? Number(campoXml(c, "X")) : null,
      y: campoXml(c, "Y") ? Number(campoXml(c, "Y")) : null,
      r: campoXml(c, "R") ? Number(campoXml(c, "R")) : null,
    }))
    .filter((x) => x.labelName);
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
  const [logs, setLogs] = useState<string[]>([]);

  function aplicarEntries(novas: ImportFileEntry[], origem: "folder" | "zip", nomeOrigem: string) {
    setOrigemTipo(origem);
    setOrigemNome(nomeOrigem);
    setEntries(novas);
    setTamanhoTotal(novas.reduce((a, b) => a + b.size, 0));

    const lista = novas.map((e) => classificarArquivo(e.relativePath, e.size));
    setArquivos(lista);
    const resumoAtual = resumirArquivos(lista);
    setResumo(resumoAtual);
    setLogs([
      `${origem === "folder" ? "Pasta" : "ZIP"} lida com sucesso`,
      `Arquivos encontrados: ${novas.length}`,
      `List.xml encontrado: ${resumoAtual.tem_list ? "sim" : "não"}`,
      `ListaCorte.pdf encontrada: ${resumoAtual.tem_lista_corte ? "sim" : "não"}`,
      `PreviewCorte.pdf encontrado: ${resumoAtual.tem_preview_corte ? "sim" : "não"}`,
      `ListaCompra/Almoxarifado encontrado: ${resumoAtual.tem_almoxarifado ? "sim" : "não"}`,
      `NC de chapas encontrados: ${resumoAtual.por_categoria.nc_gcode ?? 0}`,
      `CYC de chapas encontrados: ${(resumoAtual.por_categoria.nc_cyc ?? 0) + (resumoAtual.por_categoria.xml_cyc ?? 0)}`,
      `Parts encontrados: ${(resumoAtual.por_categoria.parts_nc ?? 0) + (resumoAtual.por_categoria.parts_info ?? 0)}`,
      `Profile encontrados: ${(resumoAtual.por_categoria.profile_nc ?? 0) + (resumoAtual.por_categoria.profile_info ?? 0)}`,
    ]);

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
    setLogs((prev) => [...prev, "Iniciando validação essencial antes do upload"]);
    const erros: Array<{ msg: string }> = [];
    let importacaoIdCriada: string | null = null;
    let projetoIdCriado: string | null = null;
    const logsExec = [...logs, "Iniciando validação essencial antes do upload"];

    const addLog = (msg: string) => { logsExec.push(msg); setLogs((prev) => [...prev, msg]); };
    const PRIORIDADE: Record<string, 1 | 2 | 3> = {
      list: 1, lista_corte_pdf: 1, preview_corte_pdf: 1, almoxarifado_pdf: 1,
      autolabel_pdf: 1, autolabel_large_preview: 1, autolabel_small_preview: 1,
      xml_cyc: 1, nc_cyc: 1, nc_gcode: 1,
      parts_info: 2, parts_nc: 2, profile_info: 2, profile_nc: 2,
      autolabel_etiqueta: 3, nc_bmp: 3,
    };
    const pathSafe = (p: string) => p.replace(/[^a-zA-Z0-9._/-]/g, "_");
    const acharEntryPorArquivo = (a: ArquivoClassificado | null) =>
      a ? entries.find((e) => e.relativePath === a.caminho) ?? null : null;
    const acharEntry = (cat: string) => acharEntryPorArquivo(arquivos.find((a) => a.categoria === cat) ?? null);
    const insertBatch = async (tabela: string, rows: unknown[], label: string, lote = 200) => {
      if (!rows.length) return [] as any[];
      const inserted: any[] = [];
      for (let k = 0; k < rows.length; k += lote) {
        const { data, error } = await (supabase as any).from(tabela)
          .insert(rows.slice(k, k + lote) as never)
          .select();
        if (error) throw new Error(`${label}: ${error.message}`);
        inserted.push(...(data ?? []));
      }
      return inserted;
    };

    try {
      setProgresso("Identificando usuário...");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Usuário não autenticado");
      const userId = u.user.id;

      setProgresso("Lendo arquivos essenciais localmente...");
      addLog(`Arquivos encontrados: ${entries.length}`);
      const listCandidates = arquivos.filter((a) => a.categoria === "list");
      const listArquivo =
        listCandidates.find((a) => !/\/NC\//i.test(a.caminho) && /setup/i.test(a.caminho)) ??
        listCandidates.find((a) => !/\/NC\//i.test(a.caminho)) ??
        listCandidates[0] ?? null;
      const entryList = acharEntryPorArquivo(listArquivo);
      const entryListaCorte = acharEntry("lista_corte_pdf");
      const entryAlmox = acharEntry("almoxarifado_pdf");
      const entryPreviewCorte = acharEntry("preview_corte_pdf");
      addLog(`List.xml encontrado: ${entryList ? listArquivo?.caminho : "não"}`);
      addLog(`ListaCorte.pdf encontrada: ${entryListaCorte ? "sim" : "não"}`);
      addLog(`PreviewCorte.pdf encontrado: ${entryPreviewCorte ? "sim" : "não"}`);
      addLog(`ListaCompra.pdf encontrada: ${entryAlmox ? "sim" : "não"}`);

      let chapasBase: ChapaImportada[] = [];
      if (entryList) {
        try {
          const xml = await (await entryList.load()).text();
          chapasBase = parseListXml(xml);
          addLog(`Chapas detectadas no List.xml: ${chapasBase.length}`);
        } catch (e) {
          erros.push({ msg: `Erro parser List.xml: ${(e as Error).message}` });
          addLog(`Erro parser List.xml: ${(e as Error).message}`);
        }
      }
      if (!chapasBase.length) {
        chapasBase = resumo.chapas_detectadas.map((c) => ({
          numero: c.ordem,
          material: c.material,
          cor: c.cor,
          espessura: c.espessura,
          largura: CHAPA_PADRAO_LARGURA,
          altura: CHAPA_PADRAO_ALTURA,
          codigoMaterial: null,
          ncFile: null,
          cycFile: c.nome_arquivo,
          largePreview: null,
          smallPreview: null,
          aproveitamento: null,
        }));
        addLog(`Chapas detectadas por fallback CYC/XML: ${chapasBase.length}`);
      }

      if (!entryListaCorte) {
        throw new Error("ListaCorte.pdf não encontrada. A importação foi interrompida antes de criar projeto vazio.");
      }

      setProgresso("Interpretando ListaCorte.pdf por coordenadas...");
      const listaBlob = await entryListaCorte.load();
      const listaCoord = await parseListaCortePdfByCoordinates(listaBlob);
      listaCoord.logs.forEach(addLog);
      let pecasLista = listaCoord.pecas;
      if (!pecasLista.length) {
        addLog("Parser por coordenadas não detectou peças; tentando fallback textual controlado.");
        const paginas = await extrairTextoPdf(listaBlob);
        pecasLista = parseListaCorte(paginas);
        addLog(`Peças detectadas no fallback textual: ${pecasLista.length}`);
      }
      for (const chPdf of listaCoord.chapas) {
        const target = chapasBase.find((c) => c.numero === chPdf.numero);
        if (!target) continue;
        target.cor = chPdf.acabamento ?? target.cor;
        target.material = chPdf.material ?? target.material;
        target.codigoMaterial = chPdf.codigo_material ?? target.codigoMaterial;
        target.largura = chPdf.largura ?? target.largura;
        target.altura = chPdf.altura ?? target.altura;
        target.espessura = chPdf.espessura ?? target.espessura;
        target.aproveitamento = chPdf.aproveitamento ?? target.aproveitamento;
      }
      addLog(`Peças detectadas na ListaCorte: ${pecasLista.length}`);

      if (pecasLista.length === 0) {
        const mensagem = "ListaCorte.pdf encontrada, mas nenhuma peça foi criada. O parser da ListaCorte falhou.";
        const { data: impErro } = await supabase.from("importacoes").insert({
          nome_arquivo: origemNome ?? "(pasta)",
          tipo: origemTipo === "folder" ? "promob_pasta" : "promob_zip",
          status: "erro_parser_pecas",
          projeto_detectado: nomeProjeto,
          cliente_detectado: cliente || null,
          ambiente_detectado: ambiente || null,
          resumo_json: { ...resumo, logs_importacao: [...logs, mensagem], pecas_detectadas: 0 } as unknown as never,
          erros_json: [{ msg: mensagem }] as unknown as never,
        }).select("id").single();
        if (impErro?.id) importacaoIdCriada = impErro.id;
        setLogs((prev) => [...prev, mensagem]);
        toast.error(mensagem, { duration: 9000 });
        return;
      }
      if (!chapasBase.length) {
        throw new Error("Nenhuma chapa foi detectada no List.xml/CYC. A importação foi interrompida antes de criar projeto vazio.");
      }

      const moduloMaisComum = pecasLista.reduce<Record<string, number>>((acc, p) => {
        if (p.modulo) acc[p.modulo] = (acc[p.modulo] ?? 0) + 1;
        return acc;
      }, {});
      const ambienteDetectado = ambiente || (Object.entries(moduloMaisComum).sort((a, b) => b[1] - a[1])[0]?.[0] || null);
      addLog(`Projeto detectado: ${nomeProjeto}`);
      addLog(`Cliente detectado: ${cliente || "—"}`);
      addLog(`Ambiente detectado: ${ambienteDetectado || "—"}`);

      setProgresso("Lendo CYC de etiquetas localmente...");
      const etiquetasCyc: EtiquetaCyc[] = [];
      for (const cyc of arquivos.filter((a) => a.categoria === "nc_cyc" || a.categoria === "xml_cyc")) {
        const entry = acharEntryPorArquivo(cyc);
        if (!entry) continue;
        try {
          etiquetasCyc.push(...parseCycLabels(await (await entry.load()).text(), cyc.nome));
        } catch (e) {
          erros.push({ msg: `Erro parser CYC ${cyc.nome}: ${(e as Error).message}` });
        }
      }
      addLog(`Etiquetas detectadas em CYC: ${etiquetasCyc.length}`);

      setProgresso("Criando importação...");
      const resumoEssencial = {
        ...resumo,
        chapas_detectadas_list_xml: chapasBase.length,
        chapas_detectadas_lista_corte: listaCoord.chapas.length,
        pecas_detectadas: pecasLista.length,
        paginas_lista_corte: listaCoord.paginas_lidas,
        etiquetas_cyc_detectadas: etiquetasCyc.length,
        logs_importacao: logsExec,
      };
      const { data: imp, error: e0 } = await supabase
        .from("importacoes")
        .insert({
          nome_arquivo: origemNome ?? "(pasta)",
          tipo: origemTipo === "folder" ? "promob_pasta" : "promob_zip",
          status: "processando",
          projeto_detectado: nomeProjeto,
          cliente_detectado: cliente || null,
          ambiente_detectado: ambienteDetectado,
          resumo_json: resumoEssencial as unknown as never,
        })
        .select("id")
        .single();
      if (e0 || !imp) throw e0 ?? new Error("Falha criando importação");
      const importacaoId = imp.id;
      importacaoIdCriada = importacaoId;

      setProgresso("Criando projeto...");
      const { data: proj, error: e1 } = await supabase
        .from("projetos")
        .insert({
          nome: nomeProjeto,
          cliente: cliente || null,
          ambiente: ambienteDetectado,
          status: "ativo",
          observacao: `Importado de ${origemNome ?? "(pasta)"}`,
        })
        .select("id")
        .single();
      if (e1 || !proj) throw e1 ?? new Error("Erro ao criar projeto");
      const projetoId = proj.id;
      projetoIdCriado = projetoId;
      addLog("Projeto criado no banco");

      setProgresso("Criando chapas em lote...");
      const chapaRows = chapasBase.map((c) => ({
        nome: `${c.material} ${c.cor} ${c.espessura}mm (importada)`,
        codigo: `IMP${c.numero.toString().padStart(2, "0")}-${nomeProjeto.replace(/[^A-Z0-9]/gi, "").slice(0, 8).toUpperCase()}`,
        tipo: c.material || "MDP",
        cor: "#d6c6a8",
        espessura: c.espessura,
        largura: c.largura || CHAPA_PADRAO_LARGURA,
        altura: c.altura || CHAPA_PADRAO_ALTURA,
        estoque: 1,
      }));
      const chapasData = await insertBatch("chapas", chapaRows, "Erro ao inserir chapas");
      const chapasInseridas = new Map<number, { id: string; espessura: number; material: string; largura: number; altura: number }>();
      chapasBase.forEach((c, idx) => {
        const row = chapasData[idx];
        if (row?.id) chapasInseridas.set(c.numero, { id: row.id, espessura: c.espessura, material: c.material, largura: c.largura, altura: c.altura });
      });
      addLog(`Chapas criadas: ${chapasInseridas.size}`);

      setProgresso("Criando plano de corte importado...");
      const areaTotal = chapasBase.reduce((s, c) => s + c.largura * c.altura, 0);
      const areaUsada = pecasLista.reduce((s, p) => s + p.largura * p.altura, 0);
      const aproveitamentoMedio = areaTotal > 0 ? areaUsada / areaTotal : 0;
      const { data: plano, error: ePlano } = await supabase.from("planos_corte").insert({
        projeto_id: projetoId,
        versao: 1,
        total_chapas: chapasInseridas.size,
        total_pecas: pecasLista.length,
        aproveitamento_medio: aproveitamentoMedio,
        status: "importado_referencia_visual",
        origem_importacao: "Promob/Cut Pro/Nesting",
        observacao: "Plano importado com referência visual. As posições originais estão no PreviewCorte/LargePreview. Coordenadas estruturadas ainda não foram extraídas.",
      } as unknown as never).select("id").single();
      if (ePlano || !plano) throw ePlano ?? new Error("Erro ao criar plano de corte importado");

      const planoChapaRows = chapasBase.map((c) => {
        const chapa = chapasInseridas.get(c.numero);
        const areaChapaUsada = pecasLista.filter((p) => p.chapa_numero === c.numero).reduce((s, p) => s + p.largura * p.altura, 0);
        return {
          plano_id: plano.id,
          chapa_id: chapa?.id,
          indice: c.numero,
          area_usada: areaChapaUsada,
          aproveitamento: c.aproveitamento ?? (c.largura * c.altura ? areaChapaUsada / (c.largura * c.altura) : 0),
        };
      }).filter((r) => r.chapa_id);
      await insertBatch("plano_corte_chapas", planoChapaRows, "Erro ao inserir chapas do plano");
      addLog("Plano de corte importado criado");

      setProgresso("Criando peças em lote...");
      const pecaRows = pecasLista.map((p, idx) => {
        const chapa = p.chapa_numero ? chapasInseridas.get(p.chapa_numero) : undefined;
        return {
          projeto_id: projetoId,
          chapa_id: chapa?.id ?? null,
          descricao: p.descricao || `Peça ${idx + 1}`,
          codigo_peca: p.codigo,
          indice_peca: p.indice,
          quantidade: 1,
          largura: p.largura,
          altura: p.altura,
          espessura: chapa?.espessura ?? p.espessura ?? 15,
          fita_codigo: p.borda,
          modulo: p.modulo,
          observacao: `Origem ListaCorte${p.chapa_numero ? ` • Chapa ${p.chapa_numero}` : ""}`,
          ordem: idx + 1,
          origem_importacao: "ListaCorte",
        };
      });
      const pecasData = await insertBatch("projeto_pecas", pecaRows, "Erro ao inserir peças");
      if (pecasData.length === 0) throw new Error("Erro ao inserir peças: nenhum registro foi criado em projeto_pecas");
      addLog(`Peças criadas: ${pecasData.length}`);

      let itensAlmox = 0;
      if (entryAlmox) {
        try {
          setProgresso("Interpretando ListaCompra/Almoxarifado...");
          const paginas = await extrairTextoPdf(await entryAlmox.load());
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
            await insertBatch("projeto_almoxarifado_itens", rows, "Erro ao inserir almoxarifado");
            itensAlmox = rows.length;
          }
          addLog(`Itens de almoxarifado criados: ${itensAlmox}`);
        } catch (e) {
          erros.push({ msg: `Erro parser ListaCompra/Almoxarifado: ${(e as Error).message}` });
        }
      }

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
        projeto_peca_id?: string; pos_x?: number | null; pos_y?: number | null; rotacao?: number | null;
      };
      const arquivosImp: ImpArqRow[] = [];
      const arquivosTec: ArqTecRow[] = [];
      const previewsImp: PreviewRow[] = [];
      const etiquetasImp: EtiquetaRow[] = [];
      const codigoParaPecaId = new Map<string, string>();
      for (const pp of pecasData) if (pp.codigo_peca && pp.id) codigoParaPecaId.set(String(pp.codigo_peca), pp.id);
      const chapaPorArquivo = (a: ArquivoClassificado) => {
        const lowerNome = a.nome.toLowerCase();
        const byList = chapasBase.find((c) => [c.ncFile, c.cycFile, c.largePreview, c.smallPreview]
          .filter(Boolean).some((nome) => lowerNome === nome!.toLowerCase()));
        const num = byList?.numero ?? parseNomeChapa(a.nome)?.ordem ?? numeroArquivoChapa(a.nome);
        return num ? chapasInseridas.get(num)?.id ?? null : null;
      };

      for (const a of arquivos) {
        const storagePath = `${userId}/${importacaoId}/${pathSafe(a.caminho)}`;
        const isUploadable = a.categoria !== "ignorado";
        const chapaIdVinc = chapaPorArquivo(a);
        arquivosImp.push({
          importacao_id: importacaoId,
          nome_arquivo: a.nome,
          caminho_original: a.caminho,
          tipo_arquivo: a.extensao,
          origem_pasta: a.pasta || "raiz",
          status_leitura: isUploadable ? "pendente_upload" : "ignorado",
          storage_url: isUploadable ? storagePath : undefined,
          metadados_json: { categoria: a.categoria, tamanho: a.tamanho, prioridade: PRIORIDADE[a.categoria] ?? 3 },
        });
        if (!isUploadable) continue;
        arquivosTec.push({
          projeto_id: projetoId, chapa_id: chapaIdVinc,
          importacao_id: importacaoId, origem_pasta: a.pasta || "raiz",
          tipo_arquivo: a.categoria, nome_arquivo: a.nome,
          storage_url: storagePath,
          dados_extraidos_json: { categoria: a.categoria, tamanho: a.tamanho },
        });
        if (["autolabel_large_preview", "autolabel_small_preview"].includes(a.categoria)) {
          const numChapa = numeroArquivoChapa(a.nome);
          previewsImp.push({
            importacao_id: importacaoId, projeto_id: projetoId,
            chapa_id: chapaIdVinc, numero_chapa: numChapa,
            tipo_preview: a.categoria === "autolabel_large_preview" ? "large" : "small",
            arquivo_nome: a.nome, storage_url: storagePath,
            pagina_pdf: null, largura_chapa: null, altura_chapa: null,
            metadados_json: {},
          });
        }
        if (a.categoria === "autolabel_etiqueta" || a.categoria === "nc_bmp") {
          const info = parseNomeEtiqueta(a.nome);
          const pecaId = info?.codigo ? codigoParaPecaId.get(info.codigo) : undefined;
          etiquetasImp.push({
            importacao_id: importacaoId, projeto_id: projetoId, chapa_id: chapaIdVinc,
            nome_arquivo: a.nome,
            codigo_completo: info?.nome_base ?? a.nome.replace(/\.[^.]+$/, ""),
            referencia: info?.referencia ?? null,
            codigo_peca: info?.codigo ?? null,
            sufixo: info?.sufixo ?? null,
            duplicidade: info?.duplicidade ?? null,
            storage_url: storagePath,
            status_vinculo: pecaId ? "vinculado" : "pendente_vinculo",
            projeto_peca_id: pecaId,
          });
        }
      }
      for (const cy of etiquetasCyc) {
        const info = parseNomeEtiqueta(cy.labelName);
        const jaExiste = etiquetasImp.find((e) => e.nome_arquivo.toLowerCase() === cy.labelName.toLowerCase());
        const pecaId = info?.codigo ? codigoParaPecaId.get(info.codigo) : undefined;
        if (jaExiste) {
          jaExiste.pos_x = cy.x; jaExiste.pos_y = cy.y; jaExiste.rotacao = cy.r;
          jaExiste.chapa_id = jaExiste.chapa_id ?? (cy.chapaNumero ? chapasInseridas.get(cy.chapaNumero)?.id ?? null : null);
          if (pecaId) { jaExiste.projeto_peca_id = pecaId; jaExiste.status_vinculo = "vinculado"; }
        } else {
          etiquetasImp.push({
            importacao_id: importacaoId, projeto_id: projetoId,
            chapa_id: cy.chapaNumero ? chapasInseridas.get(cy.chapaNumero)?.id ?? null : null,
            nome_arquivo: cy.labelName,
            codigo_completo: info?.nome_base ?? cy.labelName.replace(/\.[^.]+$/, ""),
            referencia: info?.referencia ?? null,
            codigo_peca: info?.codigo ?? null,
            sufixo: info?.sufixo ?? null,
            duplicidade: info?.duplicidade ?? null,
            storage_url: null,
            status_vinculo: pecaId ? "vinculado" : "pendente_vinculo",
            projeto_peca_id: pecaId,
            pos_x: cy.x,
            pos_y: cy.y,
            rotacao: cy.r,
          });
        }
      }

      if (entryPreviewCorte) {
        try {
          const paginas = await extrairTextoPdf(await entryPreviewCorte.load());
          const storagePathPreview = `${userId}/${importacaoId}/${pathSafe(arquivos.find((a) => a.categoria === "preview_corte_pdf")?.caminho ?? "PreviewCorte.pdf")}`;
          for (const pg of paginas) {
            previewsImp.push({
              importacao_id: importacaoId, projeto_id: projetoId,
              chapa_id: chapasInseridas.get(pg.pagina)?.id ?? null,
              numero_chapa: pg.pagina,
              tipo_preview: "preview_corte_pdf",
              arquivo_nome: `PreviewCorte p.${pg.pagina}`,
              storage_url: storagePathPreview,
              pagina_pdf: pg.pagina,
              largura_chapa: null,
              altura_chapa: null,
              metadados_json: { linhas: pg.linhas.length },
            });
          }
        } catch (e) {
          erros.push({ msg: `Falha lendo PreviewCorte: ${(e as Error).message}` });
        }
      }

      await insertBatch("importacao_arquivos", arquivosImp, "Erro ao registrar arquivos");
      await insertBatch("arquivos_tecnicos", arquivosTec, "Erro ao registrar arquivos técnicos");
      await insertBatch("importacao_preview_chapas", previewsImp, "Erro ao registrar previews");
      await insertBatch("importacao_etiquetas", etiquetasImp, "Erro ao registrar etiquetas");
      addLog("Metadados técnicos registrados");

      // Vínculo automático com a biblioteca Peças Cadastradas
      setProgresso("Vinculando com Peças Cadastradas...");
      let logVinc: Awaited<ReturnType<typeof processarVinculosProjeto>> | null = null;
      try {
        logVinc = await processarVinculosProjeto(projetoId, { modo: "todos" });
        for (const m of logVinc.mensagens) addLog(m);
        for (const e of logVinc.erros) erros.push({ msg: e });
      } catch (e) {
        const msg = `Erro no vínculo com biblioteca: ${(e as Error).message}`;
        erros.push({ msg });
        addLog(msg);
      }

      const totalUploadaveis = arquivos.filter((a) => a.categoria !== "ignorado").length;
      const logsFinais = [
        ...logsExec,
        `Chapas detectadas no List.xml: ${chapasBase.length}`,
        `Peças detectadas na ListaCorte: ${pecasLista.length}`,
        `Peças criadas: ${pecasData.length}`,
        `PreviewCorte.pdf encontrado: ${entryPreviewCorte ? "sim" : "não"}`,
        `NC de chapas encontrados: ${resumo.por_categoria.nc_gcode ?? 0}`,
        `CYC de chapas encontrados: ${(resumo.por_categoria.nc_cyc ?? 0) + (resumo.por_categoria.xml_cyc ?? 0)}`,
        `Parts encontrados: ${(resumo.por_categoria.parts_nc ?? 0) + (resumo.por_categoria.parts_info ?? 0)}`,
        `Profile encontrados: ${(resumo.por_categoria.profile_nc ?? 0) + (resumo.por_categoria.profile_info ?? 0)}`,
        ...(logVinc?.mensagens ?? []),
      ];
      await supabase
        .from("importacoes")
        .update({
          projeto_id: projetoId,
          status: "concluido_com_upload_pendente",
          erros_json: erros as unknown as never,
          resumo_json: {
            ...resumoEssencial,
            logs_importacao: logsFinais,
            pecas_criadas: pecasData.length,
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
        `Projeto criado: ${chapasInseridas.size} chapas, ${pecasData.length} peças. Upload dos ${totalUploadaveis} arquivos rodando em segundo plano.`,
        { duration: 7000 },
      );
      qc.invalidateQueries({ queryKey: ["importacoes"] });
      qc.invalidateQueries({ queryKey: ["projetos"] });
      void uploadEmBackground({ importacaoId, userId, entries, arquivos, prioridade: PRIORIDADE, pathSafe });
      navigate({ to: "/projetos/importacoes/$id", params: { id: importacaoId } });
    } catch (e) {
      const msg = (e as Error).message;
      setLogs((prev) => [...prev, msg]);
      if (importacaoIdCriada) {
        await supabase.from("importacoes").update({
          status: msg.includes("ListaCorte") ? "erro_parser_pecas" : "erro",
          erros_json: [{ msg }] as unknown as never,
        }).eq("id", importacaoIdCriada);
      }
      if (projetoIdCriado) {
        await supabase.from("projetos").update({ status: "erro_importacao", observacao: `Erro de importação: ${msg}` }).eq("id", projetoIdCriado);
      }
      toast.error(`Erro: ${msg}`);
    } finally {
      setImportando(false);
      setProgresso("");
    }
  }

  function limpar() {
    setOrigemNome(null); setOrigemTipo(null); setEntries([]); setTamanhoTotal(0);
    setArquivos([]); setResumo(null);
    setNomeProjeto(""); setCliente(""); setAmbiente("");
    setLogs([]);
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
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Logs de leitura
            </div>
            <div className="max-h-44 overflow-auto rounded border border-border bg-surface-2 p-2 font-mono text-[11px] leading-relaxed">
              {logs.map((log, idx) => <div key={`${log}-${idx}`}>› {log}</div>)}
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
    concluido_com_upload_pendente: { label: "Upload pendente", variant: "secondary" },
    concluido_com_erros: { label: "Com erros", variant: "destructive" },
    erro_parser_pecas: { label: "Erro parser peças", variant: "destructive" },
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
        .in("status", ["concluido_com_erros", "erro", "erro_parser_pecas"])
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
