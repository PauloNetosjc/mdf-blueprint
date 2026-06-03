import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FileText, Upload, AlertTriangle, Loader2, Search, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import {
  parseTechnicalDrawingPdf,
  parseTechnicalPartCode,
  type ResultadoParserPDF,
} from "@/lib/pecas-cadastradas-parser";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const Route = createFileRoute("/_authenticated/pecas/cadastradas")({
  head: () => ({ meta: [{ title: "Peças Cadastradas — Biblioteca técnica" }] }),
  component: PecasCadastradasPage,
});

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

function PecasCadastradasPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [busca, setBusca] = useState("");
  const [progresso, setProgresso] = useState<null | { atual: number; total: number; nome: string; logs: string[] }>(null);

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
    mutationFn: async (files: File[]) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) throw new Error("Não autenticado");

      // Filtra apenas PDFs individuais de peças (nome bate com regex BAS7537A)
      const pdfs = files.filter((f) => {
        if (!f.name.toLowerCase().endsWith(".pdf")) return false;
        const name = f.name.split("/").pop()!;
        if (/projeto/i.test(name)) return false;
        return parseTechnicalPartCode(name) != null;
      });

      setProgresso({ atual: 0, total: pdfs.length, nome: "", logs: [`Encontrados ${pdfs.length} PDFs de peças`] });

      let ok = 0;
      let falhas = 0;
      const logsGerais: string[] = [];

      for (let i = 0; i < pdfs.length; i++) {
        const f = pdfs[i];
        const nomeArq = f.name.split("/").pop()!;
        setProgresso((p) => p && { ...p, atual: i, nome: nomeArq });

        try {
          // Módulo de origem = nome da pasta pai (se vier do webkitRelativePath)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const relPath = (f as any).webkitRelativePath || (f as any)._zipPath || "";
          const partes = String(relPath).split("/").filter(Boolean);
          const modulo = partes.length >= 2 ? partes[partes.length - 2] : null;

          const result: ResultadoParserPDF = await parseTechnicalDrawingPdf(f, nomeArq);
          if (!result.codigo) {
            falhas++;
            logsGerais.push(`✗ ${nomeArq}: sem código`);
            continue;
          }

          // upload PDF
          const storagePath = `${userId}/${result.codigo.codigo_completo}.pdf`;
          const { error: upErr } = await supabase.storage
            .from("pecas-cadastradas")
            .upload(storagePath, f, { upsert: true, contentType: "application/pdf" });
          if (upErr) logsGerais.push(`! upload falhou para ${nomeArq}: ${upErr.message}`);

          const status = result.erros.length > 0 ? "com_erros" : "ok";

          const { data: pecaIns, error: insErr } = await db
            .from("pecas_cadastradas")
            .upsert(
              {
                user_id: userId,
                codigo_completo: result.codigo.codigo_completo,
                prefixo: result.codigo.prefixo,
                codigo_principal: result.codigo.codigo_principal,
                sufixo: result.codigo.sufixo,
                nome_peca: result.nome_peca,
                tipo_peca: result.codigo.tipo_peca,
                modulo_origem: modulo,
                largura_ref: result.largura_ref,
                altura_ref: result.altura_ref,
                espessura_ref: result.espessura_ref,
                material_ref: result.material_ref,
                fita_ref: result.fita_ref,
                pdf_url: storagePath,
                pdf_nome_arquivo: nomeArq,
                status_parser: status,
                erros_parser: result.erros,
                logs_parser: result.logs,
                dados_brutos_json: result.dados_brutos,
              },
              { onConflict: "user_id,codigo_completo" },
            )
            .select("id")
            .single();
          if (insErr) throw insErr;

          // Limpa operações/bordas anteriores (reimportação)
          await db.from("peca_cadastrada_operacoes").delete().eq("peca_cadastrada_id", pecaIns.id);
          await db.from("peca_cadastrada_bordas").delete().eq("peca_cadastrada_id", pecaIns.id);

          if (result.operacoes.length) {
            const opsRows = result.operacoes.map((o) => ({
              user_id: userId,
              peca_cadastrada_id: pecaIns.id,
              tipo_operacao: o.tipo_operacao,
              face: o.face,
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
              confianca_parser: o.confianca_parser,
              dados_brutos_json: o.dados_brutos,
            }));
            const { error: opErr } = await db.from("peca_cadastrada_operacoes").insert(opsRows);
            if (opErr) logsGerais.push(`! ${nomeArq}: erro ops ${opErr.message}`);
          }
          if (result.bordas.length) {
            const bRows = result.bordas.map((b) => ({
              user_id: userId,
              peca_cadastrada_id: pecaIns.id,
              lado: b.lado,
              codigo_borda: b.codigo_borda,
              descricao_borda: b.descricao_borda,
              espessura: b.espessura,
              largura: b.largura,
              cor: b.cor,
              indicador_desenho: b.indicador_desenho,
              confianca_parser: b.confianca_parser,
            }));
            const { error: bErr } = await db.from("peca_cadastrada_bordas").insert(bRows);
            if (bErr) logsGerais.push(`! ${nomeArq}: erro bordas ${bErr.message}`);
          }

          ok++;
          logsGerais.push(
            `✓ ${result.codigo.codigo_completo} — ${result.operacoes.length} ops, ${result.bordas.length} bordas${
              result.erros.length ? ` (${result.erros.length} alertas)` : ""
            }`,
          );
        } catch (e) {
          falhas++;
          logsGerais.push(`✗ ${nomeArq}: ${(e as Error).message}`);
        }
        setProgresso((p) => p && { ...p, logs: [...logsGerais].slice(-50) });
      }

      setProgresso((p) => p && { ...p, atual: pdfs.length, logs: logsGerais });
      return { ok, falhas, total: pdfs.length };
    },
    onSuccess: (r) => {
      toast.success(`Importação concluída: ${r.ok} ok, ${r.falhas} falhas`);
      qc.invalidateQueries({ queryKey: ["pecas-cadastradas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
    importar.mutate(arquivos);
  }

  function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    importar.mutate(files);
    e.target.value = "";
  }

  function handleZipSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    handleZip(f);
    e.target.value = "";
  }

  const filtradas = (lista.data ?? []).filter((p) => {
    if (!busca) return true;
    const q = busca.toLowerCase();
    return (
      p.codigo_completo.toLowerCase().includes(q) ||
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

  return (
    <div className="p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Peças Cadastradas</h1>
          <p className="text-sm text-muted-foreground">
            Biblioteca técnica de peças com furação, rasgos, usinagens e fita de borda.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="ghost">
            <Link to="/pecas">← Voltar</Link>
          </Button>
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
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importar.isPending}>
            <Upload className="mr-2 h-4 w-4" />
            Importar ZIP
          </Button>
          <Button onClick={() => folderInputRef.current?.click()} disabled={importar.isPending}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Selecionar pasta
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
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            {importar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {importar.isPending ? `Importando ${progresso.atual}/${progresso.total}` : `Concluído ${progresso.atual}/${progresso.total}`}
            {progresso.nome && <span className="text-muted-foreground">— {progresso.nome}</span>}
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
