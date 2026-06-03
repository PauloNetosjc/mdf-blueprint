import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import type { CamposVisiveis, ConteudoEtiqueta } from "@/lib/etiquetas";

type Props = {
  conteudo: ConteudoEtiqueta;
  codigo_barras: string;
  largura_mm: number;
  altura_mm: number;
  campos: CamposVisiveis;
  status?: string;
};

export function EtiquetaPreview({ conteudo, codigo_barras, largura_mm, altura_mm, campos, status }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const qrRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (svgRef.current && campos.codigo_barras) {
      try {
        JsBarcode(svgRef.current, codigo_barras, {
          format: "CODE128",
          width: 1.4,
          height: 32,
          fontSize: 9,
          margin: 0,
          displayValue: true,
        });
      } catch (_) { /* ignore */ }
    }
  }, [codigo_barras, campos.codigo_barras]);

  useEffect(() => {
    if (qrRef.current && campos.qr_code) {
      QRCode.toCanvas(qrRef.current, codigo_barras, { width: 60, margin: 0 }).catch(() => {});
    }
  }, [codigo_barras, campos.qr_code]);

  const m = conteudo.mini_mapa;

  return (
    <div
      className="relative flex flex-col overflow-hidden border-2 border-foreground bg-white text-black"
      style={{ width: `${largura_mm}mm`, height: `${altura_mm}mm`, fontFamily: "Arial, sans-serif" }}
    >
      {status === "impressa" && (
        <span className="absolute right-0 top-0 bg-success px-1 text-[7px] font-bold uppercase text-white">Impressa</span>
      )}
      {/* Topo: cliente / projeto */}
      <div className="border-b border-black bg-black px-1.5 py-0.5 text-white">
        {campos.cliente && <div className="text-[8px] uppercase leading-tight opacity-80">{conteudo.cliente || "—"}</div>}
        {campos.projeto && <div className="truncate text-[10px] font-bold leading-tight">{conteudo.projeto}</div>}
      </div>

      <div className="flex flex-1 gap-1 px-1.5 py-1">
        {/* Esquerda: dados */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[8px] leading-tight">
          {campos.numero_peca && (
            <div className="flex items-baseline gap-1">
              <span className="text-[7px] uppercase opacity-60">Nº</span>
              <span className="text-[14px] font-black">{conteudo.numero_peca}</span>
              {campos.chapa && <span className="text-[7px] opacity-70">/ Chapa {conteudo.numero_chapa}</span>}
            </div>
          )}
          {campos.peca && (
            <div className="truncate">
              {campos.codigo_item && conteudo.peca_codigo && <span className="font-mono font-bold">{conteudo.peca_codigo} · </span>}
              <span>{conteudo.peca_descricao}</span>
            </div>
          )}
          {campos.modulo && conteudo.modulo && (
            <div className="truncate text-[7px] uppercase opacity-70">Módulo: {conteudo.modulo}</div>
          )}
          {campos.ambiente && conteudo.ambiente && (
            <div className="truncate text-[7px] uppercase opacity-70">Amb: {conteudo.ambiente}</div>
          )}
          {campos.dimensoes && (
            <div className="font-mono text-[9px] font-bold">
              {conteudo.largura} × {conteudo.altura} × {conteudo.espessura} mm
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {campos.chapa && (
              <span className="inline-flex items-center gap-1 rounded border border-black px-1 text-[7px]">
                <span className="inline-block h-2 w-2 border border-black" style={{ background: conteudo.cor_chapa }} />
                {conteudo.material}
              </span>
            )}
            {campos.fita && conteudo.fita && (
              <span className="rounded bg-foreground px-1 text-[7px] font-bold text-background">Fita {conteudo.fita}</span>
            )}
          </div>
          {campos.observacao && conteudo.observacao && (
            <div className="truncate text-[7px] italic opacity-70">{conteudo.observacao}</div>
          )}
        </div>

        {/* Direita: mini mapa */}
        {campos.mini_mapa && m && (
          <div className="flex w-[28%] shrink-0 flex-col items-center justify-center">
            <svg
              viewBox={`0 0 ${m.chapa_largura} ${m.chapa_altura}`}
              className="h-auto w-full border border-black"
              preserveAspectRatio="xMidYMid meet"
              style={{ maxHeight: "60%" }}
            >
              <rect x={0} y={0} width={m.chapa_largura} height={m.chapa_altura} fill="#f5f5f5" />
              {m.pecas.map((p, i) => (
                <rect
                  key={i}
                  x={p.x}
                  y={p.y}
                  width={p.w}
                  height={p.h}
                  fill={p.destaque ? "#b91c1c" : "#d4d4d4"}
                  stroke="#000"
                  strokeWidth={4}
                />
              ))}
            </svg>
            <div className="mt-0.5 text-[7px] font-bold">CH {conteudo.numero_chapa}</div>
          </div>
        )}
      </div>

      {/* Rodapé: barcode */}
      <div className="flex items-end gap-1 border-t border-black px-1.5 pb-0.5 pt-0.5">
        {campos.codigo_barras && (
          <svg ref={svgRef} className="h-9 max-w-full" />
        )}
        {campos.qr_code && (
          <canvas ref={qrRef} className="h-9 w-9" />
        )}
      </div>
    </div>
  );
}
