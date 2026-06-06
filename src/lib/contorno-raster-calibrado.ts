// Extração de contorno por RASTER calibrado.
//
// Renderiza a página do PDF em alta resolução via pdfjs/canvas, isola a região
// principal do desenho (descartando tabela à direita e carimbo embaixo),
// binariza as linhas, fecha pequenos gaps, identifica o interior da peça por
// flood-fill do fundo, faz tracing da borda do maior componente interior,
// simplifica (Douglas-Peucker) e snap ortogonal. Calibra a escala pela
// largura/altura reais (mm) conhecidas e devolve pontos em mm.
//
// Apenas browser. Sem OCR.

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;
async function loadPdfJs(): Promise<PdfJs> {
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

export type PontoMm = { x: number; y: number };

export type ContornoRasterResultado = {
  pontos: PontoMm[];
  tipo: "L" | "retangular" | "poligono_complexo";
  confianca: "alta" | "media" | "baixa";
  pendente: boolean;
  escala_mm_por_pixel: number;
  origem_pagina: number;
  diagnostico: string[];
  debug_imagem_base64?: string;
};

type Opts = { paginaPreferida?: number; debug?: boolean };

// ---------- utils geométricos ----------

function bbox(pts: PontoMm[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function polygonAreaAbs(pts: PontoMm[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]; const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function perpDist(p: PontoMm, a: PontoMm, b: PontoMm): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = p.x - a.x, ey = p.y - a.y;
    return Math.sqrt(ex * ex + ey * ey);
  }
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const cx = a.x + t * dx, cy = a.y + t * dy;
  const ex = p.x - cx, ey = p.y - cy;
  return Math.sqrt(ex * ex + ey * ey);
}

function douglasPeucker(pts: PontoMm[], eps: number): PontoMm[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx !== -1) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: PontoMm[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

// Snap pontos para grade ortogonal: garante que segmentos consecutivos sejam
// estritamente horizontais ou verticais (alterna eixos).
function snapOrtogonal(pts: PontoMm[]): PontoMm[] {
  if (pts.length < 3) return pts.slice();
  // Remove pontos colineares pequenos primeiro
  const cleaned: PontoMm[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (cleaned.length === 0 || Math.hypot(p.x - cleaned[cleaned.length - 1].x, p.y - cleaned[cleaned.length - 1].y) > 0.5) {
      cleaned.push(p);
    }
  }
  // Para cada aresta, decide se é H ou V conforme maior delta
  const out: PontoMm[] = [{ ...cleaned[0] }];
  for (let i = 0; i < cleaned.length; i++) {
    const a = out[out.length - 1];
    const b = cleaned[(i + 1) % cleaned.length];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx >= dy) {
      out.push({ x: b.x, y: a.y }); // horizontal
      if (Math.abs(b.y - a.y) > 0.5) out.push({ x: b.x, y: b.y }); // vertical para fechar
    } else {
      out.push({ x: a.x, y: b.y });
      if (Math.abs(b.x - a.x) > 0.5) out.push({ x: b.x, y: b.y });
    }
  }
  // Remove duplicados consecutivos
  const dedup: PontoMm[] = [];
  for (const p of out) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.1 || Math.abs(last.y - p.y) > 0.1) dedup.push(p);
  }
  // Fecha: remove último se igual ao primeiro
  if (dedup.length > 1) {
    const f = dedup[0], l = dedup[dedup.length - 1];
    if (Math.abs(f.x - l.x) < 0.1 && Math.abs(f.y - l.y) < 0.1) dedup.pop();
  }
  // Remove vértices colineares (3 colineares consecutivos)
  const final: PontoMm[] = [];
  for (let i = 0; i < dedup.length; i++) {
    const prev = dedup[(i - 1 + dedup.length) % dedup.length];
    const cur = dedup[i];
    const next = dedup[(i + 1) % dedup.length];
    const c1 = Math.abs(prev.x - cur.x) < 0.1 && Math.abs(cur.x - next.x) < 0.1;
    const c2 = Math.abs(prev.y - cur.y) < 0.1 && Math.abs(cur.y - next.y) < 0.1;
    if (!c1 && !c2) final.push(cur);
  }
  return final.length >= 3 ? final : dedup;
}

// ---------- raster pipeline ----------

// Flood fill iterativo (4-conexão). marca em `out` (1 byte) os pixels do
// fundo (que valem `bgVal` em `mask`) acessíveis a partir das bordas.
function floodFillBackground(mask: Uint8Array, W: number, H: number, bgVal: number): Uint8Array {
  const out = new Uint8Array(W * H);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (out[i] || mask[i] !== bgVal) return;
    out[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W, y = (i / W) | 0;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }
  return out;
}

// Connected components 4-conexão de pixels com valor `val`. Devolve labels e
// estatísticas por componente (área e bbox).
function connectedComponents(mask: Uint8Array, W: number, H: number, val: number) {
  const labels = new Int32Array(W * H);
  const stats: { area: number; minX: number; minY: number; maxX: number; maxY: number }[] = [];
  let nextLabel = 0;
  const stack: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (mask[i] !== val || labels[i]) continue;
      nextLabel++;
      let area = 0, minX = x, minY = y, maxX = x, maxY = y;
      stack.push(i);
      labels[i] = nextLabel;
      while (stack.length) {
        const j = stack.pop()!;
        const jx = j % W, jy = (j / W) | 0;
        area++;
        if (jx < minX) minX = jx; if (jx > maxX) maxX = jx;
        if (jy < minY) minY = jy; if (jy > maxY) maxY = jy;
        const neigh = [j - 1, j + 1, j - W, j + W];
        if (jx === 0) neigh[0] = -1;
        if (jx === W - 1) neigh[1] = -1;
        if (jy === 0) neigh[2] = -1;
        if (jy === H - 1) neigh[3] = -1;
        for (const n of neigh) {
          if (n < 0 || n >= W * H) continue;
          if (mask[n] === val && !labels[n]) {
            labels[n] = nextLabel;
            stack.push(n);
          }
        }
      }
      stats.push({ area, minX, minY, maxX, maxY });
    }
  }
  return { labels, stats };
}

// Moore-neighbor boundary tracing. Pega o contorno externo do componente
// `label` em pixels. Devolve sequência de pontos (x,y) em coordenadas de pixel.
function traceBoundary(labels: Int32Array, W: number, H: number, label: number): { x: number; y: number }[] {
  // Encontra ponto inicial (varredura por linhas)
  let start = -1;
  for (let i = 0; i < W * H; i++) if (labels[i] === label) { start = i; break; }
  if (start < 0) return [];
  const sx = start % W, sy = (start / W) | 0;
  const out: { x: number; y: number }[] = [{ x: sx, y: sy }];
  // Vizinhos 8-conexão em ordem horária começando de (0,-1) [norte]
  const dx = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1];
  let curX = sx, curY = sy;
  // Direção de entrada: viemos do "oeste" (varredura), então começamos
  // tentando o vizinho a partir de NW (índice 7) — convenção Moore.
  let dir = 7;
  const maxSteps = W * H * 4;
  for (let step = 0; step < maxSteps; step++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + k) % 8;
      const nx = curX + dx[d], ny = curY + dy[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (labels[ny * W + nx] === label) {
        curX = nx; curY = ny;
        out.push({ x: curX, y: curY });
        // Nova direção: voltar 2 passos no sentido anti-horário
        dir = (d + 6) % 8;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (curX === sx && curY === sy && out.length > 2) break;
  }
  return out;
}

function classificar(pts: PontoMm[]): "L" | "retangular" | "poligono_complexo" {
  if (pts.length === 4) return "retangular";
  if (pts.length === 6) return "L";
  return "poligono_complexo";
}

// ---------- API pública ----------

export async function extrairContornoRasterCalibrado(
  pdfBytes: ArrayBuffer,
  medidas: { largura: number; altura: number },
  opts: Opts = {},
): Promise<ContornoRasterResultado> {
  const diag: string[] = [];
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBytes.slice(0)) });
  const doc = await loadingTask.promise;

  const totalPages = doc.numPages;
  const ordem: number[] = [];
  if (opts.paginaPreferida && opts.paginaPreferida >= 1 && opts.paginaPreferida <= totalPages) {
    ordem.push(opts.paginaPreferida);
  }
  for (let p = 1; p <= totalPages; p++) if (!ordem.includes(p)) ordem.push(p);

  let melhor: ContornoRasterResultado | null = null;

  for (const pageNum of ordem) {
    try {
      const page = await doc.getPage(pageNum);
      const viewport1 = page.getViewport({ scale: 1 });
      // Mira ~1600px de maior lado
      const target = 1600;
      const scale = Math.min(4, Math.max(1.5, target / Math.max(viewport1.width, viewport1.height)));
      const viewport = page.getViewport({ scale });
      const Wfull = Math.ceil(viewport.width);
      const Hfull = Math.ceil(viewport.height);
      const canvas = document.createElement("canvas");
      canvas.width = Wfull;
      canvas.height = Hfull;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, Wfull, Hfull);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;

      // Crop: lado esquerdo (65%) e topo (75%)
      const cropW = Math.floor(Wfull * 0.65);
      const cropH = Math.floor(Hfull * 0.75);
      const img = ctx.getImageData(0, 0, cropW, cropH);
      const W = img.width, H = img.height;
      diag.push(`pagina=${pageNum} render=${Wfull}x${Hfull} crop=${W}x${H} scale=${scale.toFixed(2)}`);

      // Binarização: pixels escuros (< 120) viram 1, claros viram 0
      const bin = new Uint8Array(W * H);
      const d = img.data;
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
        bin[p] = lum < 120 ? 1 : 0;
      }

      // Dilatação leve 3x3 para fechar gaps em linhas pontilhadas / quebras
      const dil = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (bin[y * W + x]) { dil[y * W + x] = 1; continue; }
          let any = 0;
          for (let dy = -1; dy <= 1 && !any; dy++) {
            for (let dx = -1; dx <= 1 && !any; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              if (bin[ny * W + nx]) any = 1;
            }
          }
          dil[y * W + x] = any;
        }
      }

      // Flood fill do FUNDO (pixels 0) a partir das bordas → marca "exterior"
      const exterior = floodFillBackground(dil, W, H, 0);

      // Interior: pixels com dil=0 e exterior=0 → dentro de regiões fechadas
      const interior = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) interior[i] = (dil[i] === 0 && exterior[i] === 0) ? 1 : 0;

      // Componentes conectados do interior
      const { labels, stats } = connectedComponents(interior, W, H, 1);
      diag.push(`pagina=${pageNum} componentes_interior=${stats.length}`);
      if (stats.length === 0) continue;

      // Escolhe o maior componente cuja bbox toca razoavelmente o crop e cuja
      // proporção bate com a proporção real (medidas)
      const ratioReal = medidas.largura / medidas.altura;
      let bestIdx = -1, bestScore = 0;
      for (let i = 0; i < stats.length; i++) {
        const s = stats[i];
        const w = s.maxX - s.minX + 1, h = s.maxY - s.minY + 1;
        if (w < 50 || h < 50) continue;
        if (w > W * 0.95 && h > H * 0.95) continue; // descarta moldura
        const r = w / h;
        const ratioDiff = Math.abs(r - ratioReal) / ratioReal;
        // densidade do componente dentro do bbox
        const dens = s.area / (w * h);
        const score = s.area * (1 - Math.min(ratioDiff, 1)) * (0.5 + 0.5 * dens);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
      if (bestIdx < 0) {
        diag.push(`pagina=${pageNum} sem componente compatível`);
        continue;
      }
      const main = stats[bestIdx];
      const label = bestIdx + 1;
      const wPx = main.maxX - main.minX + 1, hPx = main.maxY - main.minY + 1;
      diag.push(`pagina=${pageNum} main_bbox=${wPx}x${hPx} area=${main.area} dens=${(main.area / (wPx * hPx)).toFixed(2)}`);

      // Trace boundary
      const border = traceBoundary(labels, W, H, label);
      if (border.length < 4) {
        diag.push(`pagina=${pageNum} tracing falhou (${border.length} pts)`);
        continue;
      }
      diag.push(`pagina=${pageNum} pontos_traced=${border.length}`);

      // Calibração isotrópica
      const escalaX = medidas.largura / wPx;
      const escalaY = medidas.altura / hPx;
      const escalaDiff = Math.abs(escalaX - escalaY) / Math.max(escalaX, escalaY);
      const escala = (escalaX + escalaY) / 2;
      diag.push(`escala_x=${escalaX.toFixed(4)} escala_y=${escalaY.toFixed(4)} diff=${(escalaDiff * 100).toFixed(2)}%`);

      // Converte para mm (origem no canto inferior-esquerdo do bbox)
      const pontosMm: PontoMm[] = border.map((p) => ({
        x: (p.x - main.minX) * escala,
        y: medidas.altura - (p.y - main.minY) * escala,
      }));

      // Simplifica
      const eps = Math.max(2, Math.min(medidas.largura, medidas.altura) * 0.01); // 1% ou 2mm
      const simpl = douglasPeucker(pontosMm, eps);
      diag.push(`simplificado: ${pontosMm.length} -> ${simpl.length} (eps=${eps.toFixed(1)}mm)`);

      // Snap ortogonal
      const snap = snapOrtogonal(simpl);
      diag.push(`snap_ortogonal: ${simpl.length} -> ${snap.length} pontos`);

      const tipo = classificar(snap);
      // Confiança
      let confianca: "alta" | "media" | "baixa" = "baixa";
      let pendente = true;
      if (escalaDiff <= 0.02 && snap.length >= 4 && snap.length <= 8) {
        confianca = "alta"; pendente = false;
      } else if (escalaDiff <= 0.05 && snap.length >= 4 && snap.length <= 12) {
        confianca = "media"; pendente = false;
      } else {
        diag.push(`pendente: escalaDiff=${(escalaDiff * 100).toFixed(2)}% pts=${snap.length}`);
      }

      // Verifica área coerente: área do polígono em mm² vs área da peça
      const areaPoly = polygonAreaAbs(snap);
      const areaPeca = medidas.largura * medidas.altura;
      const areaRatio = areaPoly / areaPeca;
      diag.push(`area_poly=${areaPoly.toFixed(0)} area_peca=${areaPeca.toFixed(0)} ratio=${areaRatio.toFixed(2)}`);
      if (areaRatio < 0.3 || areaRatio > 1.1) {
        pendente = true; confianca = "baixa";
        diag.push("pendente: área incoerente com peça");
      }

      const resultado: ContornoRasterResultado = {
        pontos: snap,
        tipo,
        confianca,
        pendente,
        escala_mm_por_pixel: escala,
        origem_pagina: pageNum,
        diagnostico: [...diag],
      };

      if (opts.debug) {
        try {
          // imagem de debug pequena (componente principal recortado)
          const dbg = document.createElement("canvas");
          const dW = wPx, dH = hPx;
          dbg.width = dW; dbg.height = dH;
          const dctx = dbg.getContext("2d")!;
          const dimg = dctx.createImageData(dW, dH);
          for (let y = 0; y < dH; y++) {
            for (let x = 0; x < dW; x++) {
              const srcI = (y + main.minY) * W + (x + main.minX);
              const isLabel = labels[srcI] === label;
              const isDark = dil[srcI] === 1;
              const o = (y * dW + x) * 4;
              if (isLabel) { dimg.data[o] = 200; dimg.data[o+1] = 220; dimg.data[o+2] = 255; }
              else if (isDark) { dimg.data[o] = 0; dimg.data[o+1] = 0; dimg.data[o+2] = 0; }
              else { dimg.data[o] = 255; dimg.data[o+1] = 255; dimg.data[o+2] = 255; }
              dimg.data[o+3] = 255;
            }
          }
          dctx.putImageData(dimg, 0, 0);
          resultado.debug_imagem_base64 = dbg.toDataURL("image/png");
        } catch { /* ignore */ }
      }

      // Aceita imediatamente se confiança não-baixa; senão guarda como melhor
      if (!pendente) return resultado;
      if (!melhor || (resultado.pontos.length > melhor.pontos.length)) melhor = resultado;
    } catch (e) {
      diag.push(`pagina=${pageNum} erro=${(e as Error).message}`);
    }
  }

  if (melhor) return melhor;
  return {
    pontos: [],
    tipo: "poligono_complexo",
    confianca: "baixa",
    pendente: true,
    escala_mm_por_pixel: 0,
    origem_pagina: 0,
    diagnostico: diag.length ? diag : ["nenhuma página produziu contorno"],
  };
}
