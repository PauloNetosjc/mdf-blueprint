import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type ReactNode, memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
import { FileText, Upload, AlertTriangle, Loader2, Search, FolderOpen, RefreshCw, Shapes, Trash2, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { ReprocessarGeometriaDialog } from "@/components/pecas/ReprocessarGeometriaDialog";
import { ReprocessarParserErrosDialog } from "@/components/pecas/ReprocessarParserErrosDialog";
import { LimparBibliotecaDialog } from "@/components/pecas/LimparBibliotecaDialog";
import { AuditarBibliotecaDialog } from "@/components/pecas/AuditarBibliotecaDialog";
import { statusGeometria, type GeometriaStatus } from "@/lib/geometria-reprocess";
import {
  parseTechnicalDrawingPdf,
  parseTechnicalPartCode,
  getTipoPecaPorPrefixo,
  classificarStatusParser,
  type ResultadoParserPDF,
} from "@/lib/pecas-cadastradas-parser";
import { gerarFacesLayoutAutomatico } from "@/lib/faces-layout-gerador";
import {
  gerarContornoExternoDeOperacoes,
  gerarContornoRetangular,
  type VisualizadorOperacao,
} from "@/components/pecas/VisualizadorTecnicoPecaCadastrada";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const PARSER_CONCURRENCY = 4;
const UPLOAD_CONCURRENCY = 4;
const PECA_BATCH_SIZE = 80;
const INSERT_BATCH_SIZE = 500;

export const Route = createFileRoute("/_authenticated/pecas/cadastradas/")({
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
  motivo_status: string | null;
  erros_parser: unknown[];
  parser_alertas_json: unknown[];
  resumo_parser_json: Record<string, unknown> | null;
  pdf_url: string | null;
  pdf_nome_arquivo: string | null;
  atualizado_em: string;
  dados_brutos_json: Record<string, unknown> | null;
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
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<string>("todas");
  const [modoImportacao, setModoImportacao] = useState<ImportMode>("novas");
  const [arquivosComErro, setArquivosComErro] = useState<File[]>([]);
  const [progresso, setProgresso] = useState<ImportProgress | null>(null);
  const [ultimoDebug, setUltimoDebug] = useState<unknown | null>(null);
  const [mostrarModulos, setMostrarModulos] = useState(false);
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [reprocessParserOpen, setReprocessParserOpen] = useState(false);
  const [limparOpen, setLimparOpen] = useState(false);

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

  const contadores = useQuery({
    queryKey: ["pecas-cadastradas-contadores"],
    queryFn: async () => {
      const [{ data: ops }, { data: brds }] = await Promise.all([
        db.from("peca_cadastrada_operacoes").select("peca_cadastrada_id,tipo,face"),
        db.from("peca_cadastrada_bordas").select("peca_cadastrada_id"),
      ]);
      const mapa = new Map<
        string,
        { furos: number; rasgos: number; usinagens: number; bordas: number; face5: boolean }
      >();
      const get = (id: string) => {
        let v = mapa.get(id);
        if (!v) { v = { furos: 0, rasgos: 0, usinagens: 0, bordas: 0, face5: false }; mapa.set(id, v); }
        return v;
      };
      for (const o of (ops ?? []) as { peca_cadastrada_id: string; tipo: string; face: number }[]) {
        const v = get(o.peca_cadastrada_id);
        if (o.tipo === "furo") v.furos++;
        else if (o.tipo === "rasgo") v.rasgos++;
        else if (o.tipo === "usinagem_parametrica" || o.tipo === "contorno" || o.tipo === "usinagem") v.usinagens++;
        if (Number(o.face) === 5) v.face5 = true;
      }
      for (const b of (brds ?? []) as { peca_cadastrada_id: string }[]) {
        get(b.peca_cadastrada_id).bordas++;
      }
      return mapa;
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
        const { status, motivo } = classificarStatusParser(result);
        const ehPecaIndividual = result.classificacao.classificacao === "peca_individual";

        // Auto-geração de faces_layout_json e contorno_externo_json para peças individuais.
        // Garante que a biblioteca nasça correta no upload, sem edição manual.
        let dadosBrutosFinal: Record<string, unknown> = { ...result.dados_brutos };
        if (ehPecaIndividual && result.largura_ref && result.altura_ref) {
          const facesPresentes = Array.from(
            new Set(
              result.operacoes
                .map((o) => o.face)
                .filter((f): f is string => f != null && f !== ""),
            ),
          );
          const facesLayout = gerarFacesLayoutAutomatico({
            largura: result.largura_ref,
            altura: result.altura_ref,
            espessura: result.espessura_ref,
            prefixo: result.codigo.prefixo,
            tipo: result.codigo.tipo_peca,
            facesPresentes,
          });

          // Contorno externo: usa pontos das usinagens quando houver; senão retangular.
          const opsParaContorno: VisualizadorOperacao[] = result.operacoes.map((o) => ({
            id: "",
            tipo_operacao: o.tipo_operacao,
            nome_operacao: o.nome_operacao,
            face: o.face != null ? Number(o.face) : 0,
            x: o.x,
            y: o.y,
            diametro: o.diametro,
            profundidade: o.profundidade,
            largura: o.largura,
            comprimento: o.comprimento,
            x1: o.x1,
            x2: o.x2,
            y1: o.y1,
            y2: o.y2,
            ancora_x: o.ancora_x,
            ancora_y: o.ancora_y,
            offset_x: o.offset_x,
            offset_y: o.offset_y,
            pontos_json: o.pontos as unknown as VisualizadorOperacao["pontos_json"],
            confianca_parser: o.confianca_parser,
            ordem: o.ordem,
          }));
          const contornoGerado =
            gerarContornoExternoDeOperacoes(result.largura_ref, result.altura_ref, opsParaContorno)
            ?? gerarContornoRetangular(result.largura_ref, result.altura_ref);
          const usouFallback = (contornoGerado.recuos ?? []).some((r) => r.origem === "fallback");

          dadosBrutosFinal = {
            ...dadosBrutosFinal,
            faces_layout_json: facesLayout,
            contorno_externo_json: contornoGerado,
            diagnostico_geometria: {
              origem: contornoGerado.origem,
              pontos: contornoGerado.pontos.length,
              recuos: contornoGerado.recuos?.length ?? 0,
              presets: contornoGerado.presets_aplicados ?? [],
              acao: usouFallback ? "atualizado_fallback" : "atualizado_parser",
              atualizado_em: new Date().toISOString(),
            },
          };
        }

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
          motivo_status: motivo,
          erros_parser: result.erros,
          parser_alertas_json: result.alertas,
          resumo_parser_json: {
            ...result.resumo,
            classificacao: result.classificacao.classificacao,
            classificacao_motivo: result.classificacao.motivo,
            classificacao_confianca: result.classificacao.confianca,
            classificacao_sinais: result.classificacao.sinais,
          },
          logs_parser: result.logs,
          metadados_json: {
            modo_importacao: modo,
            modulo_origem: modulo,
            classificacao: result.classificacao.classificacao,
          },
          dados_brutos_json: dadosBrutosFinal,
        };
      });

      // Quantos foram classificados como módulo/desconhecido — não viram peças "ativas"
      const ignoradosModulo = parsed.filter((p) => p.result.classificacao.classificacao === "modulo_explodido").length;
      const pendentesClass = parsed.filter((p) => p.result.classificacao.classificacao === "desconhecido").length;
      if (ignoradosModulo > 0) appendLog(logsGerais, `↷ ${ignoradosModulo} PDFs ignorados como módulo/explodido`);
      if (pendentesClass > 0) appendLog(logsGerais, `? ${pendentesClass} PDFs pendentes de classificação manual`);



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
        if (result.classificacao.classificacao !== "peca_individual") return [];
        const pecaId = pecaIdByCodigo.get(result.codigo.codigo_completo);
        if (!pecaId) return [];
        if (!pecaId) return [];
        return result.operacoes.map((o) => ({
          user_id: userId,
          peca_cadastrada_id: pecaId,
          tipo: o.tipo_operacao,
          tipo_operacao: o.tipo_operacao,
          nome_operacao: o.nome_operacao,
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
          pontos_json: o.pontos ?? [],
          confianca: o.confianca_parser,
          confianca_parser: o.confianca_parser,
          dados_brutos: { ...(o.dados_brutos ?? {}), origem: "parser" },
          dados_brutos_json: { ...(o.dados_brutos ?? {}), origem: "parser" },
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
        if (result.classificacao.classificacao !== "peca_individual") return [];
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

      setUltimoDebug({
        modo,
        total: candidatos.length,
        ok: pecaIdByCodigo.size,
        falhasParser,
        falhasBanco,
        puladas,
        pecas: parsed.map((p) => ({
          codigo: p.result.codigo.codigo_completo,
          nome: p.result.nome_peca,
          tipo: p.result.codigo.tipo_peca,
          modulo: p.modulo,
          operacoes: p.result.operacoes,
          bordas: p.result.bordas,
          erros: p.result.erros,
          logs: p.result.logs,
        })),
        erros_arquivos: failedFiles.map((f) => getFileName(f)),
      });

      const pecasIndividuais = parsed.filter((p) => p.result.classificacao.classificacao === "peca_individual").length;
      return {
        ok: pecaIdByCodigo.size,
        falhas: falhasParser + falhasBanco,
        puladas,
        total: candidatos.length,
        uploads: uploads.length,
        pecas_individuais: pecasIndividuais,
        ignorados_modulo: ignoradosModulo,
        pendentes_class: pendentesClass,
      };
    },
    onSuccess: (r) => {
      toast.success(
        `Importação: ${r.pecas_individuais} peças individuais, ${r.ignorados_modulo} módulos ignorados, ${r.pendentes_class} pendentes, ${r.puladas} puladas, ${r.falhas} falhas.`,
      );
      qc.invalidateQueries({ queryKey: ["pecas-cadastradas"] });
      qc.invalidateQueries({ queryKey: ["pecas-cadastradas-contadores"] });
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
    qc.invalidateQueries({ queryKey: ["pecas-cadastradas-contadores"] });
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

  const cont = contadores.data;
  const getCont = (id: string) =>
    cont?.get(id) ?? { furos: 0, rasgos: 0, usinagens: 0, bordas: 0, face5: false };

  // Dedup defensivo por codigo_completo (mantém a última entrada por atualizado_em)
  // para evitar linhas duplicadas mesmo se a query retornar múltiplos registros.
  const pecas = useMemo(() => {
    const raw = lista.data ?? [];
    const mapa = new Map<string, PecaRow>();
    for (const p of raw) {
      const key = p.codigo_completo ?? p.id;
      const existente = mapa.get(key);
      if (!existente) {
        mapa.set(key, p);
        continue;
      }
      const aDate = new Date((p as any).atualizado_em ?? (p as any).criado_em ?? 0).getTime();
      const bDate = new Date((existente as any).atualizado_em ?? (existente as any).criado_em ?? 0).getTime();
      if (aDate >= bDate) mapa.set(key, p);
    }
    return Array.from(mapa.values());
  }, [lista.data]);

  // Debounce busca (~200ms) via useDeferredValue para não travar a digitação.
  const buscaDeferred = useDeferredValue(busca);

  // Status que NÃO devem aparecer na visão padrão (peças ativas).
  const STATUS_INATIVOS = new Set(["ignorado_modulo", "pendente_classificacao"]);
  // Prefixos que representam módulo/armário/explosão — não são peça individual.
  const MODULE_PREFIXES = new Set(["ARM", "CAN", "BAL", "RET", "SEQ", "SIS"]);
  const isModulo = (p: PecaRow) =>
    STATUS_INATIVOS.has(p.status_parser) || (p.prefixo ? MODULE_PREFIXES.has(p.prefixo) : false);

  const filtradas = useMemo(() => {
    const q = buscaDeferred.trim().toLowerCase();
    const filtrosDeModulo = new Set(["ignorado_modulo", "pendente_classificacao"]);
    return pecas.filter((p) => {
      const c = getCont(p.id);
      // Visão padrão esconde módulos (status ignorado_modulo/pendente_classificacao
      // ou prefixo ARM/CAN/BAL/RET/SEQ/SIS). Toggle ou filtro dedicado revela.
      if (!mostrarModulos && !filtrosDeModulo.has(filtro) && isModulo(p)) return false;

      if (filtro === "divisorias" && p.prefixo !== "DIV") return false;
      if (filtro === "com_fita" && !p.fita_ref) return false;
      if (filtro === "com_furos" && c.furos === 0) return false;
      if (filtro === "com_rasgos" && c.rasgos === 0) return false;
      if (filtro === "face5" && !c.face5) return false;
      if (filtro === "sem_nome" && p.nome_peca) return false;
      if (filtro === "sem_operacoes" && (c.furos > 0 || c.rasgos > 0 || c.usinagens > 0)) return false;
      if (filtro === "com_usinagens" && c.usinagens === 0) return false;
      if (filtro === "sem_bordas" && c.bordas > 0) return false;
      if (filtro === "com_erro" && p.status_parser !== "com_erros") return false;
      if (filtro === "com_alerta" && p.status_parser !== "com_alertas") return false;
      if (filtro === "pendente_revisao" && p.status_parser !== "pendente_revisao") return false;
      if (filtro === "ignorado_modulo" && !isModulo(p)) return false;
      if (filtro === "pendente_classificacao" && p.status_parser !== "pendente_classificacao") return false;
      if (filtro === "ok" && p.status_parser !== "ok") return false;
      if (filtro.startsWith("geo_")) {
        const g = statusGeometria(p.dados_brutos_json);
        if (filtro === "geo_pendente" && g !== "pendente") return false;
        if (filtro === "geo_retangular" && g !== "retangular") return false;
        if (filtro === "geo_contorno" && g !== "contorno_pdf") return false;
        if (filtro === "geo_fallback" && g !== "fallback") return false;
        if (filtro === "geo_manual" && g !== "manual" && g !== "misto") return false;
      }
      if (!q) return true;
      return (
        (p.codigo_completo ?? "").toLowerCase().includes(q) ||
        (p.codigo_principal ?? "").toLowerCase().includes(q) ||
        (p.nome_peca ?? "").toLowerCase().includes(q) ||
        (p.tipo_peca ?? "").toLowerCase().includes(q) ||
        (p.modulo_origem ?? "").toLowerCase().includes(q) ||
        (p.fita_ref ?? "").toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pecas, cont, buscaDeferred, filtro, mostrarModulos]);

  const stats = useMemo(() => ({
    total: pecas.length,
    ativas: pecas.filter((p) => !isModulo(p)).length,
    ok: pecas.filter((p) => p.status_parser === "ok" && !isModulo(p)).length,
    com_alerta: pecas.filter((p) => p.status_parser === "com_alertas").length,
    com_erro: pecas.filter((p) => p.status_parser === "com_erros").length,
    pendente_revisao: pecas.filter((p) => p.status_parser === "pendente_revisao").length,
    ignorado_modulo: pecas.filter((p) => isModulo(p)).length,
    pendente_classificacao: pecas.filter((p) => p.status_parser === "pendente_classificacao").length,
    divisorias: pecas.filter((p) => p.prefixo === "DIV" && !isModulo(p)).length,
    com_fita: pecas.filter((p) => p.fita_ref && !isModulo(p)).length,
    face5: pecas.filter((p) => getCont(p.id).face5 && !isModulo(p)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [pecas, cont]);

  // Paginação simples no client: renderiza em blocos para listas grandes.
  const PAGE_SIZE = 200;
  const [visiveis, setVisiveis] = useState(PAGE_SIZE);
  useEffect(() => { setVisiveis(PAGE_SIZE); }, [buscaDeferred, filtro]);
  const exibidas = filtradas.slice(0, visiveis);
  const importando = importar.isPending || Boolean(progresso?.ativo);
  const progressoPct = progresso?.total ? Math.round((progresso.atual / progresso.total) * 100) : 0;

  function baixarDebugJson() {
    if (!ultimoDebug) return;
    const blob = new Blob([JSON.stringify(ultimoDebug, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pecas-cadastradas-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
          <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={handleZipSelect} />
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
            <Upload className="mr-2 h-4 w-4" /> Importar ZIP
          </Button>
          <Button onClick={() => folderInputRef.current?.click()} disabled={importando}>
            <FolderOpen className="mr-2 h-4 w-4" /> Selecionar pasta
          </Button>
          <Button variant="outline" onClick={handleReprocessarErros} disabled={importando || !arquivosComErro.length}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reprocessar erros{arquivosComErro.length ? ` (${arquivosComErro.length})` : ""}
          </Button>
          <Button variant="outline" onClick={() => setReprocessParserOpen(true)} disabled={importando}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reprocessar erros do parser
          </Button>
          <Button variant="outline" onClick={() => setReprocessOpen(true)} disabled={importando}>
            <Shapes className="mr-2 h-4 w-4" />
            Reprocessar geometria
          </Button>
          <Button variant="destructive" onClick={() => setLimparOpen(true)} disabled={importando}>
            <Trash2 className="mr-2 h-4 w-4" />
            Limpar biblioteca
          </Button>
          {ultimoDebug != null ? (
            <Button variant="ghost" size="sm" onClick={baixarDebugJson}>
              Baixar JSON de debug
            </Button>
          ) : null}
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        <StatCard label="Peças ativas" value={stats.ativas} />
        <StatCard label="OK" value={stats.ok} tone={stats.ok ? "ok" : undefined} />
        <StatCard label="Com alertas" value={stats.com_alerta} tone={stats.com_alerta ? "warn" : undefined} />
        <StatCard label="Pendente revisão" value={stats.pendente_revisao} tone={stats.pendente_revisao ? "warn" : undefined} />
        <StatCard label="Com erros" value={stats.com_erro} tone={stats.com_erro ? "error" : undefined} />
        <StatCard label="Módulos ignorados" value={stats.ignorado_modulo} tone={stats.ignorado_modulo ? "warn" : undefined} />
        <StatCard label="Pendente classif." value={stats.pendente_classificacao} tone={stats.pendente_classificacao ? "warn" : undefined} />
        <StatCard label="Divisórias" value={stats.divisorias} />
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

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar código, nome, tipo, módulo ou fita..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-sm"
        />
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="divisorias">Divisórias</SelectItem>
            <SelectItem value="com_furos">Com furos</SelectItem>
            <SelectItem value="com_rasgos">Com rasgos</SelectItem>
            <SelectItem value="com_fita">Com fita</SelectItem>
            <SelectItem value="face5">Com Face 5</SelectItem>
            <SelectItem value="ok">Status: OK</SelectItem>
            <SelectItem value="com_alerta">Com alertas</SelectItem>
            <SelectItem value="pendente_revisao">Pendente revisão</SelectItem>
            <SelectItem value="com_erro">Com erro</SelectItem>
            <SelectItem value="ignorado_modulo">Módulos ignorados</SelectItem>
            <SelectItem value="pendente_classificacao">Pendente classificação</SelectItem>
            <SelectItem value="sem_nome">Sem nome</SelectItem>
            <SelectItem value="com_usinagens">Com usinagens</SelectItem>
            <SelectItem value="sem_operacoes">Sem operações</SelectItem>
            <SelectItem value="sem_bordas">Sem bordas</SelectItem>
            <SelectItem value="geo_contorno">Geometria: contorno detectado</SelectItem>
            <SelectItem value="geo_retangular">Geometria: retangular</SelectItem>
            <SelectItem value="geo_fallback">Geometria: fallback 65×40</SelectItem>
            <SelectItem value="geo_manual">Geometria: manual / mista</SelectItem>
            <SelectItem value="geo_pendente">Geometria: pendente</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{filtradas.length} / {pecas.length}</span>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={mostrarModulos}
            onChange={(e) => setMostrarModulos(e.target.checked)}
          />
          Mostrar módulos ignorados {stats.ignorado_modulo ? `(${stats.ignorado_modulo})` : ""}
        </label>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Clique em uma peça para abrir o visualizador técnico. Módulos (ARM/CAN/BAL/RET/SEQ/SIS) ficam ocultos por padrão.
      </p>

      <div className="overflow-auto rounded border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Código</th>
              <th className="px-3 py-2 text-left">Nome</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Prefixo</th>
              <th className="px-3 py-2 text-left">Módulo</th>
              <th className="px-3 py-2 text-right">L × A × E</th>
              <th className="px-3 py-2 text-left">Fita</th>
              <th className="px-3 py-2 text-center">Furos</th>
              <th className="px-3 py-2 text-center">Rasgos</th>
              <th className="px-3 py-2 text-center">Usinag.</th>
              <th className="px-3 py-2 text-center">Bordas</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Geometria</th>
              <th className="px-3 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {exibidas.map((p) => {
              const c = getCont(p.id);
              const tipoAmigavel = p.tipo_peca || getTipoPecaPorPrefixo(p.prefixo);
              const nome = p.nome_peca || (p.prefixo ? `${tipoAmigavel} ${p.codigo_principal ?? ""}${p.sufixo ?? ""}` : "—");
              const abrir = () => navigate({ to: "/pecas/cadastradas/$id", params: { id: p.id } });
              return (
                <tr
                  key={p.id}
                  className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
                  onClick={abrir}
                  onMouseEnter={() => qc.prefetchQuery({ queryKey: ["peca-cadastrada", p.id] }).catch(() => {})}
                >
                  <td className="px-3 py-2 font-mono font-semibold">
                    <Link
                      to="/pecas/cadastradas/$id"
                      params={{ id: p.id }}
                      preload="intent"
                      className="hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {p.codigo_completo}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{nome}</td>
                  <td className="px-3 py-2">
                    {p.prefixo === "DIV" ? (
                      <Badge>Divisória</Badge>
                    ) : (
                      <span>{tipoAmigavel}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.prefixo ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.modulo_origem ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {p.largura_ref ?? "—"} × {p.altura_ref ?? "—"} × {p.espessura_ref ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{p.fita_ref ?? "—"}</td>
                  <td className="px-3 py-2 text-center">{c.furos || <span className="text-muted-foreground">0</span>}</td>
                  <td className="px-3 py-2 text-center">{c.rasgos || <span className="text-muted-foreground">0</span>}</td>
                  <td className="px-3 py-2 text-center">{c.usinagens || <span className="text-muted-foreground">0</span>}</td>
                  <td className="px-3 py-2 text-center">{c.bordas || <span className="text-muted-foreground">0</span>}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge peca={p} />
                      {c.face5 && <Badge variant="secondary" className="text-[10px]">Face 5</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <GeometriaBadge status={statusGeometria(p.dados_brutos_json)} />
                  </td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/pecas/cadastradas/$id" params={{ id: p.id }} preload="intent">
                        Abrir
                      </Link>
                    </Button>
                  </td>
                </tr>
              );
            })}
            {!filtradas.length && (
              <tr>
                <td colSpan={14} className="px-3 py-10 text-center text-muted-foreground">
                  <FileText className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  Nenhuma peça encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filtradas.length > exibidas.length && (
          <div className="flex items-center justify-center gap-3 border-t border-border p-3 text-sm text-muted-foreground">
            <span>Mostrando {exibidas.length} de {filtradas.length}</span>
            <Button size="sm" variant="outline" onClick={() => setVisiveis((n) => n + PAGE_SIZE)}>
              Carregar mais {Math.min(PAGE_SIZE, filtradas.length - exibidas.length)}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setVisiveis(filtradas.length)}>
              Mostrar todas
            </Button>
          </div>
        )}
      </div>

      <ReprocessarGeometriaDialog
        open={reprocessOpen}
        onOpenChange={setReprocessOpen}
        pecaIds={pecas.filter((p) => !isModulo(p) && p.largura_ref && p.altura_ref).map((p) => p.id)}
        onConcluido={() => {
          qc.invalidateQueries({ queryKey: ["pecas-cadastradas"] });
        }}
      />
      <ReprocessarParserErrosDialog
        open={reprocessParserOpen}
        onOpenChange={setReprocessParserOpen}
        onConcluido={() => {
          qc.invalidateQueries({ queryKey: ["pecas-cadastradas"] });
          qc.invalidateQueries({ queryKey: ["pecas-cadastradas-contadores"] });
        }}
      />
      <LimparBibliotecaDialog
        open={limparOpen}
        onOpenChange={setLimparOpen}
        onLimpezaConcluida={() => {
          qc.invalidateQueries({ queryKey: ["pecas-cadastradas"] });
          qc.invalidateQueries({ queryKey: ["pecas-cadastradas-contadores"] });
        }}
      />

    </div>
  );
}

const GEO_VARIANT: Record<GeometriaStatus, { label: string; cls: string }> = {
  contorno_pdf: { label: "Contorno detectado", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  retangular: { label: "Retangular", cls: "border-border bg-surface-2 text-muted-foreground" },
  fallback: { label: "Fallback 65×40", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  manual: { label: "Manual", cls: "border-primary/40 bg-primary/10 text-primary" },
  misto: { label: "Misto", cls: "border-primary/40 bg-primary/10 text-primary" },
  pendente: { label: "Geometria pendente", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
};

function GeometriaBadge({ status }: { status: GeometriaStatus }) {
  const v = GEO_VARIANT[status];
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium ${v.cls}`}>
      {v.label}
    </span>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "warn" | "ok" | "error" }) {
  const border =
    tone === "warn" ? "border-amber-500/40"
    : tone === "error" ? "border-destructive/50"
    : tone === "ok" ? "border-emerald-500/40"
    : "";
  return (
    <div className={`rounded border border-border bg-surface p-3 ${border}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

const STATUS_VARIANT: Record<string, { label: string; cls: string; icon: ReactNode }> = {
  ok: { label: "OK", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", icon: null },
  com_alertas: { label: "Alertas", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400", icon: <AlertTriangle className="h-3 w-3" /> },
  pendente_revisao: { label: "Revisão", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400", icon: <AlertTriangle className="h-3 w-3" /> },
  com_erros: { label: "Erro", cls: "border-destructive/50 bg-destructive/10 text-destructive", icon: <AlertTriangle className="h-3 w-3" /> },
  ignorado_modulo: { label: "Módulo", cls: "border-muted-foreground/30 bg-muted/40 text-muted-foreground", icon: <AlertTriangle className="h-3 w-3" /> },
  pendente_classificacao: { label: "Classif.?", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400", icon: <AlertTriangle className="h-3 w-3" /> },
};

const StatusBadge = memo(function StatusBadge({ peca }: { peca: PecaRow }) {
  const status = peca.status_parser || "ok";
  const v = STATUS_VARIANT[status] ?? STATUS_VARIANT.ok;
  const erros = Array.isArray(peca.erros_parser) ? (peca.erros_parser as string[]) : [];
  const alertas = Array.isArray(peca.parser_alertas_json) ? (peca.parser_alertas_json as string[]) : [];
  const resumo = (peca.resumo_parser_json ?? {}) as Record<string, unknown>;
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex cursor-help items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${v.cls}`}>
            {v.icon}
            {v.label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-sm space-y-2 text-xs">
          {peca.motivo_status && <div className="font-medium">{peca.motivo_status}</div>}
          {erros.length > 0 && (
            <div>
              <div className="font-semibold text-destructive">Erros</div>
              <ul className="list-disc pl-4">{erros.slice(0, 5).map((e, i) => <li key={i}>{String(e)}</li>)}</ul>
            </div>
          )}
          {alertas.length > 0 && (
            <div>
              <div className="font-semibold text-amber-500">Alertas</div>
              <ul className="list-disc pl-4">{alertas.slice(0, 5).map((a, i) => <li key={i}>{String(a)}</li>)}</ul>
            </div>
          )}
          {Object.keys(resumo).length > 0 && (
            <div className="border-t border-border pt-1 font-mono text-[10px] text-muted-foreground">
              furos {String(resumo.furos_detectados ?? 0)} · rasgos {String(resumo.rasgos_detectados ?? 0)} · bordas {String(resumo.bordas_detectadas ?? 0)}
              {resumo.face_5_detectada ? " · Face 5" : ""}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
