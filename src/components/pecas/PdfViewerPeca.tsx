import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, FileText, RefreshCw, AlertTriangle } from "lucide-react";

type Props = {
  pecaId: string;
  storagePath: string;
  nomeArquivo?: string | null;
};

export function PdfViewerPeca({ pecaId, storagePath, nomeArquivo }: Props) {
  const signed = useQuery({
    queryKey: ["peca-cadastrada-pdf-url", pecaId, storagePath],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("pecas-cadastradas")
        .createSignedUrl(storagePath, 3600);
      if (error) throw error;
      if (import.meta.env.DEV) console.log("[PDF] signed URL", data?.signedUrl);
      return data?.signedUrl ?? null;
    },
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  const url = signed.data ?? null;

  // Blob strategy: fetch and create object URL — avoids Chrome blocking signed-URL iframes.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobError, setBlobError] = useState<string | null>(null);
  const [loadingBlob, setLoadingBlob] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const lastBlobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancel = false;
    setLoadingBlob(true);
    setBlobError(null);
    (async () => {
      try {
        const res = await fetch(url);
        const ct = res.headers.get("content-type");
        if (import.meta.env.DEV) console.log("[PDF] fetch status", res.status, "content-type", ct);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const pdfBlob =
          blob.type === "application/pdf"
            ? blob
            : new Blob([blob], { type: "application/pdf" });
        const obj = URL.createObjectURL(pdfBlob);
        if (cancel) {
          URL.revokeObjectURL(obj);
          return;
        }
        if (lastBlobRef.current) URL.revokeObjectURL(lastBlobRef.current);
        lastBlobRef.current = obj;
        setBlobUrl(obj);
      } catch (e) {
        if (!cancel) setBlobError((e as Error).message);
      } finally {
        if (!cancel) setLoadingBlob(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [url, reloadKey]);

  useEffect(() => {
    return () => {
      if (lastBlobRef.current) {
        URL.revokeObjectURL(lastBlobRef.current);
        lastBlobRef.current = null;
      }
    };
  }, []);

  const abrirNovaAba = () => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const baixar = async () => {
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = nomeArquivo || `${pecaId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(obj);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const recarregar = () => {
    setBlobUrl(null);
    setReloadKey((k) => k + 1);
    signed.refetch();
  };

  const exibicao = useMemo(() => {
    if (signed.isLoading || loadingBlob) return "carregando";
    if (blobUrl) return "blob";
    if (blobError && url) return "erro-com-url";
    if (url) return "object-direto";
    return "indisponivel";
  }, [signed.isLoading, loadingBlob, blobUrl, blobError, url]);

  useEffect(() => {
    if (import.meta.env.DEV) console.log("[PDF] modo de exibição:", exibicao);
  }, [exibicao]);

  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-2 text-sm">
        <span className="flex items-center gap-2">
          <FileText className="h-4 w-4" /> {nomeArquivo ?? "PDF original"}
        </span>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={recarregar} disabled={!url && !signed.isError}>
            <RefreshCw className="mr-1 h-3 w-3" /> Recarregar
          </Button>
          <Button size="sm" variant="ghost" onClick={abrirNovaAba} disabled={!url}>
            <ExternalLink className="mr-1 h-3 w-3" /> Abrir em nova aba
          </Button>
          <Button size="sm" variant="ghost" onClick={baixar} disabled={!url}>
            <Download className="mr-1 h-3 w-3" /> Baixar PDF
          </Button>
        </div>
      </div>
      <div className="h-[720px] bg-surface-2">
        {exibicao === "carregando" && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Carregando PDF...
          </div>
        )}
        {exibicao === "indisponivel" && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Não foi possível gerar o link do PDF.
          </div>
        )}
        {exibicao === "blob" && blobUrl && (
          <object data={blobUrl} type="application/pdf" className="h-full w-full">
            <FallbackBloqueado abrir={abrirNovaAba} baixar={baixar} />
          </object>
        )}
        {exibicao === "object-direto" && url && (
          <object data={url} type="application/pdf" className="h-full w-full">
            <FallbackBloqueado abrir={abrirNovaAba} baixar={baixar} />
          </object>
        )}
        {exibicao === "erro-com-url" && (
          <FallbackBloqueado abrir={abrirNovaAba} baixar={baixar} detalhe={blobError ?? undefined} />
        )}
      </div>
    </div>
  );
}

function FallbackBloqueado({
  abrir,
  baixar,
  detalhe,
}: {
  abrir: () => void;
  baixar: () => void;
  detalhe?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
      <AlertTriangle className="h-6 w-6 text-amber-500" />
      <p className="max-w-md text-muted-foreground">
        O Chrome bloqueou a visualização embutida deste PDF. Use Abrir em nova aba ou Baixar PDF.
      </p>
      {detalhe && <p className="text-[10px] text-muted-foreground">Detalhe: {detalhe}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={abrir}>
          <ExternalLink className="mr-1 h-3 w-3" /> Abrir em nova aba
        </Button>
        <Button size="sm" onClick={baixar}>
          <Download className="mr-1 h-3 w-3" /> Baixar PDF
        </Button>
      </div>
    </div>
  );
}
