import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, FileText, RefreshCw, AlertTriangle } from "lucide-react";

type Props = {
  pecaId: string;
  storagePath: string;
  nomeArquivo?: string | null;
  heightClassName?: string;
};

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export function PdfViewerPeca({ pecaId, storagePath, nomeArquivo, heightClassName = "h-[720px]" }: Props) {
  const signed = useQuery({
    queryKey: ["peca-cadastrada-pdf-url", pecaId, storagePath],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("pecas-cadastradas")
        .createSignedUrl(storagePath, 3600);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  const url = signed.data ?? null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderSeq = useRef(0);
  const panState = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pdfBytesRef = useRef<ArrayBuffer | null>(null);
  const pageSizeRef = useRef<{ w: number; h: number } | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const pageW = pageSize?.w ?? 1;
  const pageH = pageSize?.h ?? 1;

  const fitToView = useCallback((size?: { w: number; h: number } | null) => {
    const el = containerRef.current;
    const targetSize = size ?? pageSizeRef.current;
    if (!el || !targetSize) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const z = Math.min(cw / targetSize.w, ch / targetSize.h) * 0.95;
    const newZoom = Math.max(z, 0.05);
    setZoom(newZoom);
    setPan({ x: (cw - targetSize.w * newZoom) / 2, y: (ch - targetSize.h * newZoom) / 2 });
  }, []);

  useEffect(() => {
    if (!url) return;
    let cancel = false;
    const seq = ++renderSeq.current;
    setLoading(true);
    setRenderError(null);
    setPageSize(null);
    pageSizeRef.current = null;
    pdfBytesRef.current = null;

    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        if (cancel || seq !== renderSeq.current) return;
        pdfBytesRef.current = bytes.slice(0);

        const pdfjs = await loadPdfJs();
        const loadingTask = pdfjs.getDocument({ data: bytes.slice(0) });
        const doc = await loadingTask.promise;
        const page = await doc.getPage(1);
        const viewportBase = page.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const renderScale = Math.max(2, dpr * 2);
        const viewport = page.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        if (!canvas || cancel || seq !== renderSeq.current) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas indisponível");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${viewportBase.width}px`;
        canvas.style.height = `${viewportBase.height}px`;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (cancel || seq !== renderSeq.current) return;
        const size = { w: viewportBase.width, h: viewportBase.height };
        pageSizeRef.current = size;
        setPageSize(size);
        requestAnimationFrame(() => fitToView(size));
        await loadingTask.destroy();
      } catch (e) {
        if (!cancel) setRenderError((e as Error).message);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [url, reloadKey, fitToView]);

  const abrirNovaAba = () => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const baixar = async () => {
    if (!url) return;
    try {
      const blob = pdfBytesRef.current
        ? new Blob([pdfBytesRef.current], { type: "application/pdf" })
        : await (await fetch(url)).blob();
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
    setReloadKey((k) => k + 1);
    signed.refetch();
  };

  function zoomBy(factor: number) {
    const el = containerRef.current;
    const cw = el?.clientWidth ?? 600;
    const ch = el?.clientHeight ?? 400;
    const mx = cw / 2;
    const my = ch / 2;
    const newZoom = Math.max(0.05, Math.min(12, zoom * factor));
    setPan({ x: mx - ((mx - pan.x) * newZoom) / zoom, y: my - ((my - pan.y) * newZoom) / zoom });
    setZoom(newZoom);
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(0.05, Math.min(12, zoom * factor));
    setPan({ x: mx - ((mx - pan.x) * newZoom) / zoom, y: my - ((my - pan.y) * newZoom) / zoom });
    setZoom(newZoom);
  }

  const exibicao = useMemo(() => {
    if (signed.isLoading || loading) return "carregando";
    if (renderError) return "erro";
    if (pageSize) return "canvas";
    if (!url) return "indisponivel";
    return "carregando";
  }, [signed.isLoading, loading, renderError, pageSize, url]);

  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-2 text-sm">
        <span className="flex items-center gap-2">
          <FileText className="h-4 w-4" /> {nomeArquivo ?? "PDF original"}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {pageSize && <span className="px-2 font-mono text-[11px] text-muted-foreground">{(zoom * 100).toFixed(0)}%</span>}
          <Button size="sm" variant="ghost" onClick={() => zoomBy(1.25)} disabled={!pageSize}>+</Button>
          <Button size="sm" variant="ghost" onClick={() => zoomBy(1 / 1.25)} disabled={!pageSize}>−</Button>
          <Button size="sm" variant="ghost" onClick={() => fitToView()} disabled={!pageSize}>Ajustar</Button>
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
      <div
        ref={containerRef}
        className={`${heightClassName} relative overflow-hidden bg-surface-2`}
        onWheel={pageSize ? handleWheel : undefined}
        onMouseDown={(e) => { panState.current = { x: e.clientX, y: e.clientY, ox: pan.x, oy: pan.y }; }}
        onMouseMove={(e) => {
          if (!panState.current) return;
          setPan({ x: panState.current.ox + e.clientX - panState.current.x, y: panState.current.oy + e.clientY - panState.current.y });
        }}
        onMouseUp={() => { panState.current = null; }}
        onMouseLeave={() => { panState.current = null; }}
        style={{ cursor: pageSize ? (panState.current ? "grabbing" : "grab") : "default" }}
      >
        {exibicao === "carregando" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Renderizando PDF...
          </div>
        )}
        {exibicao === "indisponivel" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Não foi possível gerar o link do PDF.
          </div>
        )}
        {exibicao === "erro" && (
          <FallbackRenderizacao abrir={abrirNovaAba} baixar={baixar} detalhe={renderError ?? undefined} />
        )}
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0 bg-background shadow-lg"
          style={{
            display: pageSize ? "block" : "none",
            width: pageW,
            height: pageH,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        />
      </div>
    </div>
  );
}

function FallbackRenderizacao({
  abrir,
  baixar,
  detalhe,
}: {
  abrir: () => void;
  baixar: () => void;
  detalhe?: string;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm">
      <AlertTriangle className="h-6 w-6 text-amber-500" />
      <p className="max-w-md text-muted-foreground">
        Não foi possível renderizar o PDF. Use Abrir em nova aba ou Baixar PDF.
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