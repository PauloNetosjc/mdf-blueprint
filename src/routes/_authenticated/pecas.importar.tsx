import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Upload, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pecas/importar")({
  head: () => ({ meta: [{ title: "Importar PDF/Imagem — Visualizador CNC" }] }),
  component: ImportarPage,
});

type Furo = { face: number; x: number; y: number; diametro: number; profundidade: number };

function ImportarPage() {
  const navigate = useNavigate();
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isPdf, setIsPdf] = useState(false);

  const [dados, setDados] = useState({
    codigo: "",
    nome: "",
    cliente: "",
    ambiente: "",
    data_ficha: "",
    largura: 0,
    altura: 0,
    espessura: 0,
    face_alinhamento: "A",
  });

  const [furosTexto, setFurosTexto] = useState(
    `# Cole as furações no formato: face;x;y;diametro;profundidade\n# Exemplo:\n0;24;25;15;13\n0;24;70;15;13`,
  );

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setIsPdf(f.type === "application/pdf");
    setFileUrl(URL.createObjectURL(f));
    extrairDoNomeArquivo(f.name);
  }

  // Extração heurística simples a partir do nome do arquivo (fallback semi-automático)
  function extrairDoNomeArquivo(nome: string) {
    const matchCodigo = nome.match(/([A-Z]{1,3}\d{4,}[A-Z]?)/i);
    if (matchCodigo) setDados((d) => ({ ...d, codigo: matchCodigo[1].toUpperCase() }));
  }

  const criar = useMutation({
    mutationFn: async () => {
      const furos: Furo[] = [];
      for (const linha of furosTexto.split("\n")) {
        const l = linha.trim();
        if (!l || l.startsWith("#")) continue;
        const [face, x, y, d, p] = l.split(";").map((s) => s.trim());
        if (!face || !x || !y) continue;
        furos.push({ face: +face, x: +x, y: +y, diametro: +(d || 8), profundidade: +(p || 13) });
      }

      const { data: peca, error } = await supabase
        .from("pecas")
        .insert({
          codigo: dados.codigo,
          nome: dados.nome,
          cliente: dados.cliente || null,
          ambiente: dados.ambiente || null,
          largura: dados.largura,
          altura: dados.altura,
          espessura: dados.espessura,
          face_alinhamento: dados.face_alinhamento,
          arquivo_origem: fileName,
          data_ficha: dados.data_ficha || null,
          status: "rascunho",
        })
        .select()
        .single();
      if (error) throw error;

      await supabase.from("faces").insert(
        [0, 1, 2, 3, 4].map((n) => ({ peca_id: peca.id, numero_face: n, nome_face: n === 0 ? "Face Superior" : `Face ${n}` })),
      );

      if (furos.length) {
        await supabase.from("operacoes").insert(
          furos.map((f, i) => ({
            peca_id: peca.id,
            numero_face: f.face,
            tipo: "furacao",
            x: f.x,
            y: f.y,
            diametro: f.diametro,
            profundidade: f.profundidade,
            ordem: i + 1,
          })),
        );
      }

      return peca;
    },
    onSuccess: (peca) => {
      toast.success("Peça importada");
      navigate({ to: "/pecas/$id", params: { id: peca.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-3">
        <Button variant="ghost" size="sm" asChild><Link to="/pecas"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Importar peça</h1>
          <p className="text-xs text-muted-foreground">Importação semi-automática: visualize o arquivo ao lado e confira os campos antes de salvar.</p>
        </div>
        <Button onClick={() => criar.mutate()} disabled={!dados.codigo || !dados.nome || !dados.largura}>Criar peça</Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Preview do arquivo */}
        <section className="flex w-1/2 flex-col border-r border-border bg-surface-2">
          <div className="flex items-center justify-between border-b border-border bg-panel px-3 py-2 text-xs">
            <span className="text-muted-foreground">{fileName ?? "Nenhum arquivo carregado"}</span>
            <Label className="inline-flex cursor-pointer items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs hover:bg-surface-2">
              <Upload className="h-3 w-3" /> Escolher arquivo
              <input type="file" className="hidden" accept="application/pdf,image/*" onChange={handleFile} />
            </Label>
          </div>
          <div className="flex-1 overflow-auto">
            {!fileUrl ? (
              <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                <FileText className="mb-2 h-12 w-12 opacity-30" />
                <p className="text-sm">Envie um PDF ou imagem da ficha técnica.</p>
              </div>
            ) : isPdf ? (
              <iframe src={fileUrl} title="PDF" className="h-full w-full" />
            ) : (
              <img src={fileUrl} alt="Ficha" className="mx-auto max-w-full" />
            )}
          </div>
        </section>

        {/* Campos extraídos / edição manual */}
        <section className="flex w-1/2 flex-col overflow-auto bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Dados da peça</h2>
          <div className="grid grid-cols-2 gap-3">
            <F label="Código"><Input value={dados.codigo} onChange={(e) => setDados({ ...dados, codigo: e.target.value })} /></F>
            <F label="Nome"><Input value={dados.nome} onChange={(e) => setDados({ ...dados, nome: e.target.value })} /></F>
            <F label="Cliente"><Input value={dados.cliente} onChange={(e) => setDados({ ...dados, cliente: e.target.value })} /></F>
            <F label="Ambiente"><Input value={dados.ambiente} onChange={(e) => setDados({ ...dados, ambiente: e.target.value })} /></F>
            <F label="Data"><Input type="date" value={dados.data_ficha} onChange={(e) => setDados({ ...dados, data_ficha: e.target.value })} /></F>
            <F label="Face de alinhamento"><Input value={dados.face_alinhamento} onChange={(e) => setDados({ ...dados, face_alinhamento: e.target.value })} /></F>
            <F label="Largura (mm)"><Input type="number" value={dados.largura} onChange={(e) => setDados({ ...dados, largura: +e.target.value })} /></F>
            <F label="Altura/Profundidade (mm)"><Input type="number" value={dados.altura} onChange={(e) => setDados({ ...dados, altura: +e.target.value })} /></F>
            <F label="Espessura (mm)"><Input type="number" step="0.1" value={dados.espessura} onChange={(e) => setDados({ ...dados, espessura: +e.target.value })} /></F>
          </div>

          <h2 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Furações</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Uma furação por linha — <code className="font-mono">face;X;Y;diâmetro;profundidade</code>
          </p>
          <Textarea
            rows={12}
            className="font-mono text-xs"
            value={furosTexto}
            onChange={(e) => setFurosTexto(e.target.value)}
          />
        </section>
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs">{label}</Label>{children}</div>;
}
