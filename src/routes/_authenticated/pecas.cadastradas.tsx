import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useRef, useState } from "react";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Upload, AlertTriangle, Loader2, Search, FolderOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  parseTechnicalDrawingPdf,
  parseTechnicalPartCode,
  getTipoPecaPorPrefixo,
  type ResultadoParserPDF,
} from "@/lib/pecas-cadastradas-parser";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const PARSER_CONCURRENCY = 4;
const UPLOAD_CONCURRENCY = 4;
const PECA_BATCH_SIZE = 80;
const INSERT_BATCH_SIZE = 500;

export const Route = createFileRoute("/_authenticated/pecas/cadastradas")({
  head: () => ({ meta: [{ title: "Peças Cadastradas — Biblioteca técnica" }] }),
  component: PecasCadastradasPage,
});

type ImportMode = "novas" | "atualizar" | "reprocessar";

type PecaRow = {
  id: string;
  codigo_completo: string;
  prefixo: string | null;
  codigo_principal: string | null;
  sufixo: string | null;
  nome_peca: string | null;
  tipo_peca: string | null;
  modulo_origem: string | null;
  largura_ref: number | null;
  altura_ref: number | null;
  espessura_ref: number | null;
  fita_ref: string | null;
  status_parser: string;
  erros_parser: unknown[];
  pdf_url: string | null;
  pdf_nome_arquivo: string | null;
  atualizado_em: string;
};

type ImportProgress = {
  etapa: "Processando PDFs" | "Salvando peças" | "Salvando operações" | "Salvando bordas" | "Enviando PDFs" | "Concluído";
  atual: number;
  total: number;
  detalhe: string;
  logs: string[];
  ativo: boolean;
};

type ParsedImportItem = {
  file: File;
  fileName: string;
  storagePath: string;
  modulo: string | null;
  result: ResultadoParserPDF & { codigo: NonNullable<ResultadoParserPDF["codigo"]> };
};

type ImportMutationInput = {
  files: File[];
  modo: ImportMode;
};

const IMPORT_MODE_LABELS: Record<ImportMode, string> = {
  novas: "Importar apenas novas",
  atualizar: "Atualizar existentes",
  reprocessar: "Reprocessar tudo",
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function getRelativePath(file: File): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return String((file as any).webkitRelativePath || (file as any)._zipPath || file.name || "");
}

function getFileName(file: File): string {
  return getRelativePath(file).split("/").filter(Boolean).pop() || file.name;
}

function getModuloOrigem(file: File): string | null {
  const parts = getRelativePath(file).split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

function faceToNumber(face: string | number | null | undefined): number {
  const n = Number(face ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function yieldToBrowser() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function appendLog(logs: string[], line: string) {
  logs.push(line);
  return logs.slice(-80);
}

async function buscarCodigosExistentes(userId: string, codigos: string[]): Promise<Set<string>> {
  const existentes = new Set<string>();
  const unicos = Array.from(new Set(codigos));
  for (const lote of chunkArray(unicos, 300)) {
    const { data, error } = await db
      .from("pecas_cadastradas")
      .select("codigo_completo")
      .eq("user_id", userId)
      .in("codigo_completo", lote);
    if (error) throw error;
    for (const row of data ?? []) existentes.add(row.codigo_completo);
  }
  return existentes;
}

function PecasCadastradasPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [busca, setBusca] = useState("");
  const [modoImportacao, setModoImportacao] = useState<ImportMode>("novas");
  const [arquivosComErro, setArquivosComErro] = useState<File[]>([]);
  const [progresso, setProgresso] = useState<ImportProgress | null>(null);

  const lista = useQuery({
    queryKey: ["pecas-cadastradas"],
    queryFn: async () => {
      const { data, error } = await db
        .from("pecas_cadastradas")
        .select("*")
        .order("codigo_completo", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PecaRow[];
    },
  });

  const importar = useMutation({
    mutationFn: async ({ files, modo }: ImportMutationInput) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) throw new Error("Não autenticado");

      const candidatos = files.filter((f) => {
        const nome = getFileName(f);
        if (!nome.toLowerCase().endsWith(".pdf")) return false;
        if (/projeto/i.test(nome)) return false;
        return parseTechnicalPartCode(nome) != null;
      });

      const codigosCandidatos = candidatos
        .map((f) => parseTechnicalPartCode(getFileName(f))?.codigo_completo)
        .filter((v): v is string => Boolean(v));

      const logsGerais: string[] = [];
      let pdfs = candidatos;
      let puladas = 0;

      if (modo === "novas" && codigosCandidatos.length) {
        setProgresso({
          etapa: "Processando PDFs",
          atual: 0,
          total: Math.max(1, Math.ceil(candidatos.length / PARSER_CONCURRENCY)),
          detalhe: "Verificando peças já cadastradas",
          logs: appendLog(logsGerais, `Encontrados ${candidatos.length} PDFs de peças`),
          ativo: true,
        });
        const existentes = await buscarCodigosExistentes(userId, codigosCandidatos);
        pdfs = candidatos.filter((f) => {
          const codigo = parseTechnicalPartCode(getFileName(f))?.codigo_completo;
          return codigo ? !existentes.has(codigo) : true;
        });
        puladas = candidatos.length - pdfs.length;
        if (puladas) appendLog(logsGerais, `↷ ${puladas} peças já cadastradas foram puladas`);
      }

      const parseBatches = chunkArray(pdfs, PARSER_CONCURRENCY);
      const parsed: ParsedImportItem[] = [];
      const failedFiles: File[] = [];
      let falhasParser = 0;

      for (let batchIndex = 0; batchIndex < parseBatches.length; batchIndex++) {
        const batch = parseBatches[batchIndex];
        setProgresso({
          etapa: "Processando PDFs",
          atual: batchIndex + 1,
          total: Math.max(1, parseBatches.length),
          detalhe: `Lote ${batchIndex + 1}/${Math.max(1, parseBatches.length)} — até ${PARSER_CONCURRENCY} PDFs por vez`,
          logs: logsGerais.slice(-80),
          ativo: true,
        });

        const results = await Promise.allSettled(
          batch.map(async (file) => {
            const fileName = getFileName(file);
            const result = await parseTechnicalDrawingPdf(file, fileName);
            if (!result.codigo) throw new Error("Código da peça não identificado");
            return {
              file,
              fileName,
              storagePath: `${userId}/${result.codigo.codigo_completo}.pdf`,
              modulo: getModuloOrigem(file),
              result: result as ParsedImportItem["result"],
            };
          }),
        );

        results.forEach((res, index) => {
          const file = batch[index];
          if (res.status === "fulfilled") {
            parsed.push(res.value);
            appendLog(
              logsGerais,
              `✓ ${res.value.result.codigo.codigo_completo} — ${res.value.result.operacoes.length} ops, ${res.value.result.bordas.length} bordas`,
            );
          } else {
            falhasParser++;
            failedFiles.push(file);
            appendLog(logsGerais, `✗ ${getFileName(file)}: ${(res.reason as Error).message}`);
          }
        });
        await yieldToBrowser();
      }

      setArquivosComErro(failedFiles);

      const pecaRows = parsed.map(({ result, fileName, storagePath, modulo }) => {
        const status = result.erros.length > 0 ? "com_erros" : "ok";
        return {
          user_id: userId,
          codigo: result.codigo.codigo_completo,
          codigo_completo: result.codigo.codigo_completo,
          prefixo: result.codigo.prefixo,
          codigo_principal: result.codigo.codigo_principal,
          sufixo: result.codigo.sufixo,
          nome: result.nome_peca ?? result.codigo.tipo_peca,
          nome_peca: result.nome_peca,
          tipo_peca: result.codigo.tipo_peca,
          modulo_origem: modulo,
          largura_ref: result.largura_ref,
          altura_ref: result.altura_ref,
          espessura_ref: result.espessura_ref,
          material_ref: result.material_ref,
          fita_ref: result.fita_ref,
          pdf_url: storagePath,
          pdf_nome: fileName,
          pdf_nome_arquivo: fileName,
          origem: "TECNICO FURACOES CADASTRO",
          status_parser: status,
          erros_parser: result.erros,
          logs_parser: result.logs,
          metadados_json: { modo_importacao: modo, modulo_origem: modulo },
          dados_brutos_json: result.dados_brutos,
        };
      });

      const pecaIdByCodigo = new Map<string, string>();
      const pecaBatches = chunkArray(pecaRows, PECA_BATCH_SIZE);
      let falhasBanco = 0;

      for (let batchIndex = 0; batchIndex < pecaBatches.length; batchIndex++) {
        const batch = pecaBatches[batchIndex];
        setProgresso({
          etapa: "Salvando peças",
          atual: batchIndex + 1,
          total: Math.max(1, pecaBatches.length),
          detalhe: `Lote ${batchIndex + 1}/${Math.max(1, pecaBatches.length)} — ${batch.length} peças`,
          logs: logsGerais.slice(-80),
          ativo: true,
        });
        const { data, error } = await db
          .from("pecas_cadastradas")
          .upsert(batch, { onConflict: "user_id,codigo_completo" })
          .select("id,codigo_completo");
        if (error) {
          falhasBanco += batch.length;
          appendLog(logsGerais, `✗ Falha ao salvar lote de peças: ${error.message}`);
        } else {
          for (const row of data ?? []) pecaIdByCodigo.set(row.codigo_completo, row.id);
        }
        await yieldToBrowser();
      }

      const idsSalvos = Array.from(pecaIdByCodigo.values());
      for (const idBatch of chunkArray(idsSalvos, 300)) {
        await db.from("peca_cadastrada_operacoes").delete().in("peca_cadastrada_id", idBatch);
        await db.from("peca_cadastrada_bordas").delete().in("peca_cadastrada_id", idBatch);
      }

      const opsRows = parsed.flatMap(({ result }) => {
        const pecaId = pecaIdByCodigo.get(result.codigo.codigo_completo);
        if (!pecaId) return [];
        return result.operacoes.map((o) => ({
          user_id: userId,
          peca_cadastrada_id: pecaId,
          tipo: o.tipo_operacao,
          tipo_operacao: o.tipo_operacao,
          face: faceToNumber(o.face),
          x: o.x,
          y: o.y,
          z: o.z,
          diametro: o.diametro,
          profundidade: o.profundidade,
          largura: o.largura,
          comprimento: o.comprimento,
          x1: o.x1,
          x2: o.x2,
          y1: o.y1,
          y2: o.y2,
          ordem: o.ordem,
          ancora_x: o.ancora_x,
          ancora_y: o.ancora_y,
          offset_x: o.offset_x,
          offset_y: o.offset_y,
          confianca: o.confianca_parser,
          confianca_parser: o.confianca_parser,
          dados_brutos: o.dados_brutos,
          dados_brutos_json: o.dados_brutos,
        }));
      });

      const opsBatches = chunkArray(opsRows, INSERT_BATCH_SIZE);
      for (let batchIndex = 0; batchIndex < opsBatches.length; batchIndex++) {
        const batch = opsBatches[batchIndex];
        setProgresso({
          etapa: "Salvando operações",
          atual: batchIndex + 1,
          total: Math.max(1, opsBatches.length),
          detalhe: `Lote ${batchIndex + 1}/${Math.max(1, opsBatches.length)} — ${batch.length} operações`,
          logs: logsGerais.slice(-80),
          ativo: true,
        });
        const { error } = await db.from("peca_cadastrada_operacoes").insert(batch);
        if (error) appendLog(logsGerais, `✗ Falha ao salvar operações: ${error.message}`);
        await yieldToBrowser();
      }

      const bordaRows = parsed.flatMap(({ result }) => {
        const pecaId = pecaIdByCodigo.get(result.codigo.codigo_completo);
        if (!pecaId) return [];
        return result.bordas.map((b) => ({
          user_id: userId,
          peca_cadastrada_id: pecaId,
          lado: b.lado,
          tem_fita: true,
          fita_codigo: b.codigo_borda,
          fita_descricao: b.descricao_borda,
          codigo_borda: b.codigo_borda,
          descricao_borda: b.descricao_borda,
          espessura: b.espessura,
          largura: b.largura,
          cor: b.cor,
          indicador_desenho: b.indicador_desenho,
          confianca_parser: b.confianca_parser,
        }));
      });

      const bordaBatches = chunkArray(bordaRows, INSERT_BATCH_SIZE);
      for (let batchIndex = 0; batchIndex < bordaBatches.length; batchIndex++) {
        const batch = bordaBatches[batchIndex];
        setProgresso({
          etapa: "Salvando bordas",
          atual: batchIndex + 1,
          total: Math.max(1, bordaBatches.length),
          detalhe: `Lote ${batchIndex + 1}/${Math.max(1, bordaBatches.length)} — ${batch.length} bordas`,
          logs: logsGerais.slice(-80),
          ativo: true,
        });
        const { error } = await db.from("peca_cadastrada_bordas").insert(batch);
        if (error) appendLog(logsGerais, `✗ Falha ao salvar bordas: ${error.message}`);
        await yieldToBrowser();
      }

      const uploads = parsed.filter(({ result }) => pecaIdByCodigo.has(result.codigo.codigo_completo));
      void uploadPdfsEmSegundoPlano(uploads, logsGerais);

      return {
        ok: pecaIdByCodigo.size,
        falhas: falhasParser + falhasBanco,
        puladas,
        total: candidatos.length,
        uploads: uploads.length,
      };
    },
    onSuccess: (r) => {
      toast.success(`Dados salvos: ${r.ok} peças, ${r.puladas} puladas, ${r.falhas} falhas. PDFs em envio separado.`);
      qc.invalidateQueries({ queryKey: ["pecas-cadastradas"] });
    },
    onError: (e: Error) => {
      setProgresso((p) => p && { ...p, ativo: false, etapa: "Concluído", logs: appendLog([...p.logs], `✗ ${e.message}`) });
      toast.error(e.message);
    },
  });

  async function uploadPdfsEmSegundoPlano(items: ParsedImportItem[], logsGerais: string[]) {
    if (!items.length) {
      setProgresso((p) => p && { ...p, etapa: "Concluído", atual: p.total, detalhe: "Nenhum PDF para enviar", ativo: false });
      return;
    }

    let falhasUpload = 0;
    const batches = chunkArray(items, UPLOAD_CONCURRENCY);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      setProgresso({
        etapa: "Enviando PDFs",
        atual: batchIndex + 1,
        total: batches.length,
        detalhe: `Lote ${batchIndex + 1}/${batches.length} — até ${UPLOAD_CONCURRENCY} PDFs por vez`,
        logs: logsGerais.slice(-80),
        ativo: true,
      });

      const results = await Promise.allSettled(
        batch.map(async ({ file, storagePath }) => {
          const { error } = await supabase.storage
            .from("pecas-cadastradas")
            .upload(storagePath, file, { upsert: true, contentType: "application/pdf" });
          if (error) throw error;
        }),
      );

      results.forEach((res, index) => {
        if (res.status === "rejected") {
          falhasUpload++;
          appendLog(logsGerais, `! upload falhou para ${batch[index].fileName}: ${(res.reason as Error).message}`);
        }
      });
      await yieldToBrowser();
    }

    setProgresso({
      etapa: "Concluído",
      atual: batches.length,
      total: batches.length,
      detalhe: falhasUpload ? `${falhasUpload} PDFs falharam no envio` : "PDFs enviados",
      logs: logsGerais.slice(-80),
      ativo: false,
    });
    if (falhasUpload) toast.warning(`${falhasUpload} PDFs não foram enviados, mas os dados estruturados foram salvos.`);
    else toast.success("PDFs enviados em segundo plano.");
    qc.invalidateQueries({ queryKey: ["pecas-cadastradas"] });
  }

  async function handleZip(zipFile: File) {
    const zip = await JSZip.loadAsync(zipFile);
    const arquivos: File[] = [];
    const entries = Object.values(zip.files);
    for (const entry of entries) {
      if (entry.dir) continue;
      if (!entry.name.toLowerCase().endsWith(".pdf")) continue;
      const blob = await entry.async("blob");
      const f = new File([blob], entry.name.split("/").pop()!, { type: "application/pdf" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (f as any)._zipPath = entry.name;
      arquivos.push(f);
    }
    importar.mutate({ files: arquivos, modo: modoImportacao });
  }

  function handleFolderSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    importar.mutate({ files, modo: modoImportacao });
    e.target.value = "";
  }

  function handleZipSelect(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    handleZip(f);
    e.target.value = "";
  }

  function handleReprocessarErros() {
    if (!arquivosComErro.length) return;
    importar.mutate({ files: arquivosComErro, modo: "reprocessar" });
  }

  const filtradas = (lista.data ?? []).filter((p) => {
    if (!busca) return true;
    const q = busca.toLowerCase();
    return (
      (p.codigo_completo ?? "").toLowerCase().includes(q) ||
      (p.nome_peca ?? "").toLowerCase().includes(q) ||
      (p.tipo_peca ?? "").toLowerCase().includes(q) ||
      (p.modulo_origem ?? "").toLowerCase().includes(q)
    );
  });

  const stats = {
    total: lista.data?.length ?? 0,
    com_erro: lista.data?.filter((p) => p.status_parser === "com_erros").length ?? 0,
    divisorias: lista.data?.filter((p) => p.prefixo === "DIV").length ?? 0,
    com_fita: lista.data?.filter((p) => p.fita_ref).length ?? 0,
  };
  const importando = importar.isPending || Boolean(progresso?.ativo);
  const progressoPct = progresso?.total ? Math.round((progresso.atual / progresso.total) * 100) : 0;

  return (
    <div className="p-6">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Peças Cadastradas</h1>
          <p className="text-sm text-muted-foreground">
            Biblioteca técnica de peças com furação, rasgos, usinagens e fita de borda.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost">
            <Link to="/pecas">← Voltar</Link>
          </Button>
          <Select value={modoImportacao} onValueChange={(v) => setModoImportacao(v as ImportMode)} disabled={importando}>
            <SelectTrigger className="w-[210px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="novas">Importar apenas novas</SelectItem>
              <SelectItem value="atualizar">Atualizar existentes</SelectItem>
              <SelectItem value="reprocessar">Reprocessar tudo</SelectItem>
            </SelectContent>
          </Select>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleZipSelect}
          />
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            // @ts-expect-error webkitdirectory não está no tipo
            webkitdirectory=""
            directory=""
            multiple
            onChange={handleFolderSelect}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importando}>
            <Upload className="mr-2 h-4 w-4" />
            Importar ZIP
          </Button>
          <Button onClick={() => folderInputRef.current?.click()} disabled={importando}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Selecionar pasta
          </Button>
          <Button variant="outline" onClick={handleReprocessarErros} disabled={importando || !arquivosComErro.length}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reprocessar erros{arquivosComErro.length ? ` (${arquivosComErro.length})` : ""}
          </Button>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Peças cadastradas" value={stats.total} />
        <StatCard label="Divisórias" value={stats.divisorias} />
        <StatCard label="Com fita de borda" value={stats.com_fita} />
        <StatCard label="Com alertas do parser" value={stats.com_erro} tone={stats.com_erro ? "warn" : undefined} />
      </div>

      {progresso && (
        <div className="mb-4 rounded border border-border bg-surface p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
            {progresso.ativo && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{progresso.etapa}</span>
            <Badge variant="outline">{IMPORT_MODE_LABELS[modoImportacao]}</Badge>
            <span className="text-muted-foreground">
              {progresso.atual}/{progresso.total} lotes
            </span>
            {progresso.detalhe && <span className="text-muted-foreground">— {progresso.detalhe}</span>}
          </div>
          <div className="mb-2 h-2 overflow-hidden rounded bg-surface-2">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, progressoPct)}%` }} />
          </div>
          <div className="max-h-40 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px] text-muted-foreground">
            {progresso.logs.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por código, nome, tipo ou módulo..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-md"
        />
      </div>

      <div className="overflow-hidden rounded border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Código</th>
              <th className="px-3 py-2 text-left">Nome</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Módulo</th>
              <th className="px-3 py-2 text-right">L × A × E</th>
              <th className="px-3 py-2 text-left">Fita</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((p) => (
              <tr key={p.id} className="border-t border-border hover:bg-surface-2">
                <td className="px-3 py-2 font-mono font-semibold">
                  <Link to="/pecas/cadastradas/$id" params={{ id: p.id }} className="hover:underline">
                    {p.codigo_completo}
                  </Link>
                </td>
                <td className="px-3 py-2">{p.nome_peca ?? "—"}</td>
                <td className="px-3 py-2">
                  {p.prefixo === "DIV" ? (
                    <Badge variant="default">Divisória</Badge>
                  ) : (
                    <span className="text-muted-foreground">{p.tipo_peca ?? "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{p.modulo_origem ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {p.largura_ref ?? "—"} × {p.altura_ref ?? "—"} × {p.espessura_ref ?? "—"}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{p.fita_ref ?? "—"}</td>
                <td className="px-3 py-2">
                  {p.status_parser === "ok" ? (
                    <Badge variant="outline">ok</Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" /> {p.status_parser}
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
            {!filtradas.length && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  <FileText className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  Nenhuma peça cadastrada. Importe a pasta <strong>TECNICO FURAÇÕES CADASTRO</strong>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className={`rounded border border-border bg-surface p-3 ${tone === "warn" ? "border-amber-500/40" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
