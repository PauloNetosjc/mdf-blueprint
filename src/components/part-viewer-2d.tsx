import { useMemo, useState } from "react";
import type { Operacao, Peca } from "@/lib/db";

type Props = {
  peca: Peca;
  operacoes: Operacao[];
  face: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/**
 * Visualizador 2D estilo CAD/CNC.
 * - Face 0: vista superior (largura X altura)
 * - Faces 1, 2: laterais (altura/profundidade X espessura)
 * - Faces 3, 4: frente/trás (largura X espessura)
 */
export function PartViewer2D({ peca, operacoes, face, selectedId, onSelect }: Props) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);

  const { partW, partH } = useMemo(() => {
    if (face === 0) return { partW: peca.largura, partH: peca.altura };
    if (face === 1 || face === 2) return { partW: peca.altura, partH: peca.espessura };
    return { partW: peca.largura, partH: peca.espessura };
  }, [face, peca]);

  // Margens em mm (no espaço do desenho)
  const margin = 60;
  const viewW = partW + margin * 2;
  const viewH = partH + margin * 2;

  // Escala base para caber na viewport
  const baseScale = Math.min(900 / viewW, 500 / viewH);
  const scale = baseScale * zoom;

  const ops = operacoes.filter((o) => o.numero_face === face);

  function fitToView() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-2 text-xs">
        <span className="font-mono text-muted-foreground">
          Face {face} — {partW} × {partH} mm
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button className="rounded border border-border bg-surface px-2 py-1 hover:bg-surface-2" onClick={() => setZoom((z) => z * 1.25)}>+</button>
          <span className="w-12 text-center font-mono">{(zoom * 100).toFixed(0)}%</span>
          <button className="rounded border border-border bg-surface px-2 py-1 hover:bg-surface-2" onClick={() => setZoom((z) => z / 1.25)}>−</button>
          <button className="ml-2 rounded border border-border bg-surface px-2 py-1 hover:bg-surface-2" onClick={fitToView}>
            Ajustar
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        className="cad-grid relative flex-1 overflow-hidden bg-surface-2"
        onMouseDown={(e) => setPan({ x: e.clientX - offset.x, y: e.clientY - offset.y })}
        onMouseUp={() => setPan(null)}
        onMouseLeave={() => setPan(null)}
        onMouseMove={(e) => {
          if (pan) setOffset({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${viewW} ${viewH}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        >
          {/* Réguas */}
          <g stroke="var(--color-grid-strong)" strokeWidth={0.3}>
            {Array.from({ length: Math.floor(partW / 50) + 1 }, (_, i) => i * 50).map((x) => (
              <g key={`gx${x}`}>
                <line x1={margin + x} y1={margin} x2={margin + x} y2={margin + partH} />
                <text x={margin + x} y={margin - 8} fontSize={6} fill="var(--color-muted-foreground)" textAnchor="middle">{x}</text>
              </g>
            ))}
            {Array.from({ length: Math.floor(partH / 50) + 1 }, (_, i) => i * 50).map((y) => (
              <g key={`gy${y}`}>
                <line x1={margin} y1={margin + y} x2={margin + partW} y2={margin + y} />
                <text x={margin - 8} y={margin + y + 2} fontSize={6} fill="var(--color-muted-foreground)" textAnchor="end">{y}</text>
              </g>
            ))}
          </g>

          {/* Peça */}
          <rect
            x={margin}
            y={margin}
            width={partW}
            height={partH}
            fill="var(--color-surface)"
            stroke="var(--color-foreground)"
            strokeWidth={0.8}
          />

          {/* Indicador face de alinhamento A (canto inferior esquerdo) */}
          {face === 0 && (
            <g>
              <circle cx={margin - 18} cy={margin + partH + 18} r={9} fill="var(--color-primary)" />
              <text x={margin - 18} y={margin + partH + 21} fontSize={9} fill="var(--color-primary-foreground)" textAnchor="middle" fontWeight="700">
                {peca.face_alinhamento}
              </text>
            </g>
          )}

          {/* Etiqueta de face nas bordas (vista superior) */}
          {face === 0 && (
            <g fill="var(--color-muted-foreground)" fontSize={7} fontFamily="monospace">
              <text x={margin + partW / 2} y={margin - 22} textAnchor="middle">FACE 4 (trás)</text>
              <text x={margin + partW / 2} y={margin + partH + 30} textAnchor="middle">FACE 3 (frente)</text>
              <text x={margin - 30} y={margin + partH / 2} textAnchor="middle" transform={`rotate(-90 ${margin - 30} ${margin + partH / 2})`}>FACE 1</text>
              <text x={margin + partW + 30} y={margin + partH / 2} textAnchor="middle" transform={`rotate(90 ${margin + partW + 30} ${margin + partH / 2})`}>FACE 2</text>
            </g>
          )}

          {/* Cotas */}
          <g stroke="var(--color-muted-foreground)" strokeWidth={0.3} fill="var(--color-muted-foreground)" fontSize={7} fontFamily="monospace">
            <line x1={margin} y1={margin + partH + 12} x2={margin + partW} y2={margin + partH + 12} />
            <text x={margin + partW / 2} y={margin + partH + 22} textAnchor="middle">{partW} mm</text>
            <line x1={margin + partW + 12} y1={margin} x2={margin + partW + 12} y2={margin + partH} />
            <text x={margin + partW + 18} y={margin + partH / 2} textAnchor="start" transform={`rotate(90 ${margin + partW + 18} ${margin + partH / 2})`}>{partH} mm</text>
          </g>

          {/* Eixos X/Y/Z */}
          <g strokeWidth={1.2}>
            <line x1={margin} y1={margin + partH} x2={margin + 40} y2={margin + partH} stroke="var(--color-axis-x)" />
            <text x={margin + 44} y={margin + partH + 3} fontSize={7} fill="var(--color-axis-x)" fontFamily="monospace">X</text>
            <line x1={margin} y1={margin + partH} x2={margin} y2={margin + partH - 40} stroke="var(--color-axis-y)" />
            <text x={margin + 3} y={margin + partH - 44} fontSize={7} fill="var(--color-axis-y)" fontFamily="monospace">Y</text>
            <circle cx={margin} cy={margin + partH} r={2} fill="var(--color-foreground)" />
            <text x={margin - 14} y={margin + partH + 10} fontSize={6} fill="var(--color-muted-foreground)" fontFamily="monospace">0,0</text>
          </g>

          {/* Operações */}
          {ops.map((op) => {
            // Y do desenho cresce para baixo, mas eixo Y da peça cresce para cima → inverter
            const cx = margin + op.x;
            const cy = margin + partH - op.y;
            const r = (op.diametro ?? 4) / 2;
            const selected = op.id === selectedId;
            return (
              <g key={op.id} onClick={() => onSelect(op.id)} style={{ cursor: "pointer" }}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={Math.max(r, 1.2)}
                  fill={selected ? "var(--color-primary)" : "var(--color-surface)"}
                  stroke={selected ? "var(--color-primary)" : "var(--color-foreground)"}
                  strokeWidth={selected ? 1.2 : 0.6}
                />
                <circle cx={cx} cy={cy} r={0.6} fill="var(--color-foreground)" />
                <text
                  x={cx + r + 1.5}
                  y={cy - r - 1}
                  fontSize={5}
                  fontFamily="monospace"
                  fill={selected ? "var(--color-primary)" : "var(--color-muted-foreground)"}
                >
                  #{op.ordem} Ø{op.diametro}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
