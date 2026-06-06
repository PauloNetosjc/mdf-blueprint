// Extração de contorno visual calibrado por escala.
//
// Lê os operadores vetoriais do PDF (pdfjs.getOperatorList) e identifica o
// maior polígono fechado (ou quase fechado) que representa o contorno externo
// da peça. Calibra a escala pelas medidas reais conhecidas (largura/altura em
// mm) e devolve `pontos_contorno` em milímetros, prontos para serem gravados
// em `modelo_tecnico_json.geometria`.
//
// Princípios:
//   - Apenas vetorial. Não fazemos OCR/raster.
//   - Mesma escala para X e Y (nunca anisotrópica).
//   - Se a extração não for segura → `pendente: true`, `confianca: "baixa"`,
//     e o caller deve bloquear geração de G-code.

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

export type ContornoVisualResultado = {
  pontos: PontoMm[];
  tipo: "L" | "retangular" | "poligono_complexo";
  confianca: "alta" | "media" | "baixa";
  pendente: boolean;
  escala_mm_por_unidade: number | null;
  origem_pagina: number | null;
  diagnostico: string[];
};

type Seg = { x1: number; y1: number; x2: number; y2: number };
type Mat = [number, number, number, number, number, number]; // a,b,c,d,e,f

function mIdentity(): Mat {
  return [1, 0, 0, 1, 0, 0];
}
function mMul(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function mApply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

// Extrai todos os segmentos retos de uma página em coordenadas do PDF.
async function extrairSegmentos(
  pdfjs: PdfJs,
  page: Awaited<ReturnType<PdfJs["getDocument"]>["promise"]> extends infer D
    ? D extends { getPage(n: number): Promise<infer P> }
      ? P
      : never
    : never,
): Promise<{ segs: Seg[]; pageW: number; pageH: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = page;
  const viewport = p.getViewport({ scale: 1 });
  const opList = await p.getOperatorList();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OPS: Record<string, number> = (pdfjs as any).OPS;

  const segs: Seg[] = [];
  let ctm: Mat = mIdentity();
  const stack: Mat[] = [];
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  // pdfjs builds the path then "stroke/fill" consumes it
  type Cmd = { op: "m" | "l" | "re" | "c" | "h"; args: number[] };
  let path: Cmd[] = [];

  const flushPath = (closed: boolean) => {
    let curX = 0;
    let curY = 0;
    let sX = 0;
    let sY = 0;
    let hasStart = false;
    for (const c of path) {
      if (c.op === "m") {
        curX = c.args[0];
        curY = c.args[1];
        sX = curX;
        sY = curY;
        hasStart = true;
      } else if (c.op === "l") {
        const nx = c.args[0];
        const ny = c.args[1];
        const [x1, y1] = mApply(ctm, curX, curY);
        const [x2, y2] = mApply(ctm, nx, ny);
        segs.push({ x1, y1, x2, y2 });
        curX = nx;
        curY = ny;
        if (!hasStart) {
          sX = nx;
          sY = ny;
          hasStart = true;
        }
      } else if (c.op === "re") {
        const [rx, ry, rw, rh] = c.args;
        const corners: [number, number][] = [
          [rx, ry],
          [rx + rw, ry],
          [rx + rw, ry + rh],
          [rx, ry + rh],
        ];
        for (let i = 0; i < 4; i++) {
          const [a, b] = corners[i];
          const [c2, d2] = corners[(i + 1) % 4];
          const [x1, y1] = mApply(ctm, a, b);
          const [x2, y2] = mApply(ctm, c2, d2);
          segs.push({ x1, y1, x2, y2 });
        }
        curX = rx;
        curY = ry;
        sX = rx;
        sY = ry;
        hasStart = true;
      } else if (c.op === "c") {
        // Bezier: aproximamos como linha do current ao endpoint final (suficiente
        // para detectar bounding box; curvas raramente compõem contorno externo
        // de painéis retos/recortados).
        const ex = c.args[4];
        const ey = c.args[5];
        const [x1, y1] = mApply(ctm, curX, curY);
        const [x2, y2] = mApply(ctm, ex, ey);
        segs.push({ x1, y1, x2, y2 });
        curX = ex;
        curY = ey;
      } else if (c.op === "h") {
        if (hasStart) {
          const [x1, y1] = mApply(ctm, curX, curY);
          const [x2, y2] = mApply(ctm, sX, sY);
          segs.push({ x1, y1, x2, y2 });
          curX = sX;
          curY = sY;
        }
      }
    }
    if (closed && hasStart) {
      const [x1, y1] = mApply(ctm, curX, curY);
      const [x2, y2] = mApply(ctm, sX, sY);
      if (!(approx(x1, x2, 0.001) && approv0(y1, y2))) {
        // already closed if equal
        segs.push({ x1, y1, x2, y2 });
      }
    }
    path = [];
  };
  // small helper to avoid TS unused warning
  function approv0(a: number, b: number) {
    return approx(a, b, 0.001);
  }

  const fnArray = opList.fnArray as number[];
  const argsArray = opList.argsArray as unknown[][];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    switch (fn) {
      case OPS.save:
        stack.push(ctm);
        break;
      case OPS.restore:
        ctm = stack.pop() ?? mIdentity();
        break;
      case OPS.transform: {
        const t = args as unknown as Mat;
        ctm = mMul(ctm, [t[0], t[1], t[2], t[3], t[4], t[5]]);
        break;
      }
      case OPS.moveTo:
        cx = args[0] as number;
        cy = args[1] as number;
        startX = cx;
        startY = cy;
        path.push({ op: "m", args: [cx, cy] });
        break;
      case OPS.lineTo:
        cx = args[0] as number;
        cy = args[1] as number;
        path.push({ op: "l", args: [cx, cy] });
        break;
      case OPS.rectangle: {
        const [rx, ry, rw, rh] = args as number[];
        path.push({ op: "re", args: [rx, ry, rw, rh] });
        cx = rx;
        cy = ry;
        startX = rx;
        startY = ry;
        break;
      }
      case OPS.curveTo:
      case OPS.curveTo2:
      case OPS.curveTo3:
        path.push({ op: "c", args: args as number[] });
        cx = (args as number[])[(args as number[]).length - 2];
        cy = (args as number[])[(args as number[]).length - 1];
        break;
      case OPS.closePath:
        path.push({ op: "h", args: [] });
        cx = startX;
        cy = startY;
        break;
      case OPS.stroke:
      case OPS.closeStroke:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
      case OPS.fill:
      case OPS.eoFill:
        flushPath(
          fn === OPS.closeStroke ||
            fn === OPS.closeFillStroke ||
            fn === OPS.closeEOFillStroke,
        );
        break;
      case OPS.endPath:
        path = [];
        break;
      default:
        break;
    }
  }

  return { segs, pageW: viewport.width, pageH: viewport.height };
}

// Filtra micro-segmentos (cotas, setas, hachuras, textos vetorizados).
function filtrarSegmentos(segs: Seg[], diag: number): Seg[] {
  const minLen = diag * 0.02;
  return segs.filter((s) => {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    return len >= minLen;
  });
}

// Mantém apenas segmentos quase-axiais (horizontais/verticais), que é o que
// compõe contornos retos/recortados em desenhos técnicos de painéis.
function manterAxiais(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const dx = Math.abs(s.x2 - s.x1);
    const dy = Math.abs(s.y2 - s.y1);
    if (dx < 0.5 && dy >= 1) out.push({ x1: s.x1, y1: s.y1, x2: s.x1, y2: s.y2 });
    else if (dy < 0.5 && dx >= 1) out.push({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y1 });
  }
  return out;
}

// Bounding box de um conjunto de segmentos.
function bboxSegs(segs: Seg[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of segs) {
    if (s.x1 < minX) minX = s.x1;
    if (s.y1 < minY) minY = s.y1;
    if (s.x2 < minX) minX = s.x2;
    if (s.y2 < minY) minY = s.y2;
    if (s.x1 > maxX) maxX = s.x1;
    if (s.y1 > maxY) maxY = s.y1;
    if (s.x2 > maxX) maxX = s.x2;
    if (s.y2 > maxY) maxY = s.y2;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// Agrupa segmentos em clusters por proximidade (union-find baseado em snap).
function clusterizarSegmentos(segs: Seg[], snap: number): Seg[][] {
  // Cada ponto-chave mapeia para um índice de cluster
  const parent: number[] = segs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // Bucket grid p/ achar vizinhos rapidamente
  const cell = snap * 4;
  const map = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.round(x / cell)}:${Math.round(y / cell)}`;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (const [x, y] of [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ]) {
      const k = key(x, y);
      let arr = map.get(k);
      if (!arr) {
        arr = [];
        map.set(k, arr);
      }
      arr.push(i);
    }
  }
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (const [x, y] of [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ]) {
      const kx = Math.round(x / cell);
      const ky = Math.round(y / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const arr = map.get(`${kx + dx}:${ky + dy}`);
          if (!arr) continue;
          for (const j of arr) {
            if (j === i) continue;
            const t = segs[j];
            const dists = [
              Math.hypot(x - t.x1, y - t.y1),
              Math.hypot(x - t.x2, y - t.y2),
            ];
            if (Math.min(...dists) <= snap) union(i, j);
          }
        }
      }
    }
  }

  const groups = new Map<number, Seg[]>();
  for (let i = 0; i < segs.length; i++) {
    const r = find(i);
    let arr = groups.get(r);
    if (!arr) {
      arr = [];
      groups.set(r, arr);
    }
    arr.push(segs[i]);
  }
  return Array.from(groups.values());
}

// Simplifica polilinha colinear: junta segmentos consecutivos com mesma direção.
function simplificarPoligono(pts: PontoMm[], tolMm: number): PontoMm[] {
  if (pts.length < 4) return pts;
  const out: PontoMm[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = out[out.length - 1] ?? pts[(i - 1 + pts.length) % pts.length];
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    const v1x = cur.x - prev.x;
    const v1y = cur.y - prev.y;
    const v2x = next.x - cur.x;
    const v2y = next.y - cur.y;
    const cross = Math.abs(v1x * v2y - v1y * v2x);
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    // Se o ponto é praticamente colinear com vizinhos, descarta.
    if (len1 > 0 && len2 > 0 && cross / (len1 * len2) < 0.01 && len1 > tolMm) {
      continue;
    }
    out.push(cur);
  }
  // Remove vértices duplicados
  const dedup: PontoMm[] = [];
  for (const p of out) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > tolMm) dedup.push(p);
  }
  // Fecha verifica primeiro/último
  if (dedup.length > 2) {
    const a = dedup[0];
    const b = dedup[dedup.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= tolMm) dedup.pop();
  }
  return dedup;
}

// Reconstrói o polígono ordenado a partir do conjunto de segmentos axiais de
// um cluster. Estratégia: faz "snap" das coordenadas a uma grade, gera grafo
// de adjacência e percorre buscando o ciclo de maior área.
function reconstruirPoligono(segs: Seg[], snap: number): PontoMm[] | null {
  if (segs.length < 4) return null;
  const snapVal = (v: number) => Math.round(v / snap) * snap;
  const key = (x: number, y: number) => `${snapVal(x)}|${snapVal(y)}`;
  const nodes = new Map<string, PontoMm>();
  const adj = new Map<string, Set<string>>();
  for (const s of segs) {
    const k1 = key(s.x1, s.y1);
    const k2 = key(s.x2, s.y2);
    if (k1 === k2) continue;
    if (!nodes.has(k1)) nodes.set(k1, { x: snapVal(s.x1), y: snapVal(s.y1) });
    if (!nodes.has(k2)) nodes.set(k2, { x: snapVal(s.x2), y: snapVal(s.y2) });
    if (!adj.has(k1)) adj.set(k1, new Set());
    if (!adj.has(k2)) adj.set(k2, new Set());
    adj.get(k1)!.add(k2);
    adj.get(k2)!.add(k1);
  }
  if (nodes.size < 4) return null;

  // Acha o ciclo de maior área usando heurística: escolhe o vértice mais
  // inferior-esquerdo e caminha sempre virando à direita ("convex hull-like
  // boundary walk" sobre um grafo axial).
  const startK = Array.from(nodes.keys()).reduce((best, k) => {
    const p = nodes.get(k)!;
    const pb = nodes.get(best)!;
    if (p.y < pb.y || (p.y === pb.y && p.x < pb.x)) return k;
    return best;
  });

  const visited = new Set<string>();
  const path: string[] = [startK];
  visited.add(startK);
  let prevK: string | null = null;
  let curK = startK;
  // limite p/ evitar loop em grafos malformados
  const maxSteps = nodes.size + 4;
  for (let step = 0; step < maxSteps; step++) {
    const neigh = Array.from(adj.get(curK) ?? []).filter((k) => k !== prevK);
    if (neigh.length === 0) return null;
    const cur = nodes.get(curK)!;
    const prev = prevK ? nodes.get(prevK)! : { x: cur.x - 1, y: cur.y };
    const inDx = cur.x - prev.x;
    const inDy = cur.y - prev.y;
    // escolhe vizinho com maior "virada à direita" (menor ângulo no sentido horário)
    let best: string | null = null;
    let bestAng = Infinity;
    for (const nk of neigh) {
      const np = nodes.get(nk)!;
      const dx = np.x - cur.x;
      const dy = np.y - cur.y;
      let ang = Math.atan2(inDx * dy - inDy * dx, inDx * dx + inDy * dy);
      // virada à direita = ângulo negativo; queremos o menor ângulo absoluto à direita
      if (ang > 0) ang -= 2 * Math.PI;
      if (ang < bestAng) {
        bestAng = ang;
        best = nk;
      }
    }
    if (!best) return null;
    if (best === startK) {
      // ciclo fechado
      return path.map((k) => nodes.get(k)!);
    }
    if (visited.has(best)) return null;
    visited.add(best);
    path.push(best);
    prevK = curK;
    curK = best;
  }
  return null;
}

function areaPoligono(pts: PontoMm[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function classificarPoligono(pts: PontoMm[]): "retangular" | "L" | "poligono_complexo" {
  if (pts.length === 4) return "retangular";
  if (pts.length === 6) {
    // Conta ângulos retos
    let rights = 0;
    for (let i = 0; i < 6; i++) {
      const a = pts[(i + 5) % 6];
      const b = pts[i];
      const c = pts[(i + 1) % 6];
      const v1x = a.x - b.x;
      const v1y = a.y - b.y;
      const v2x = c.x - b.x;
      const v2y = c.y - b.y;
      const dot = v1x * v2x + v1y * v2y;
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      if (l1 > 0 && l2 > 0 && Math.abs(dot / (l1 * l2)) < 0.1) rights++;
    }
    if (rights >= 5) return "L";
  }
  return "poligono_complexo";
}

// Garante orientação anti-horária (Y para cima).
function paraAntiHorario(pts: PontoMm[]): PontoMm[] {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += (q.x - p.x) * (q.y + p.y);
  }
  // a>0 → horário em Y-cresce-pra-cima; invertemos
  return a > 0 ? pts.slice().reverse() : pts;
}

export async function extrairContornoVisualCalibrado(
  pdfBytes: ArrayBuffer,
  medidas: { largura: number; altura: number },
): Promise<ContornoVisualResultado> {
  const diag: string[] = [];
  const falhar = (msg: string): ContornoVisualResultado => {
    diag.push(msg);
    return {
      pontos: [],
      tipo: "poligono_complexo",
      confianca: "baixa",
      pendente: true,
      escala_mm_por_unidade: null,
      origem_pagina: null,
      diagnostico: diag,
    };
  };

  if (!medidas.largura || !medidas.altura) {
    return falhar("Medidas reais ausentes; não é possível calibrar escala.");
  }

  let pdfjs: PdfJs;
  let doc: Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
  try {
    pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument({ data: pdfBytes.slice(0) });
    doc = await loadingTask.promise;
  } catch (e) {
    return falhar(`Falha ao abrir PDF: ${(e as Error).message}`);
  }

  // Analisa cada página, escolhe a com maior cluster de contorno candidato.
  type Candidato = {
    pagina: number;
    pts: PontoMm[];
    tipo: "retangular" | "L" | "poligono_complexo";
    escala: number;
    coerenciaEixos: number; // |escalaX/escalaY - 1|
  };
  const candidatos: Candidato[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    try {
      const page = await doc.getPage(pageNum);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { segs, pageW, pageH } = await extrairSegmentos(pdfjs, page as any);
      const diagPg = Math.hypot(pageW, pageH);
      const segsAxiais = manterAxiais(filtrarSegmentos(segs, diagPg));
      if (segsAxiais.length < 4) continue;

      // Clusters
      const snap = diagPg * 0.003;
      const clusters = clusterizarSegmentos(segsAxiais, snap);
      if (clusters.length === 0) continue;

      // Para cada cluster grande, tenta reconstruir polígono
      const clustersGrandes = clusters
        .map((c) => ({ c, bb: bboxSegs(c) }))
        .filter((x) => x.bb.w > diagPg * 0.15 && x.bb.h > diagPg * 0.15)
        .sort((a, b) => b.bb.w * b.bb.h - a.bb.w * a.bb.h);

      for (const { c, bb } of clustersGrandes.slice(0, 3)) {
        const poly = reconstruirPoligono(c, snap);
        if (!poly || poly.length < 4) continue;

        // Calibra escala usando bbox do polígono (não o bbox bruto do cluster)
        const polyBB = bboxSegs(
          poly.map((p, i) => {
            const n = poly[(i + 1) % poly.length];
            return { x1: p.x, y1: p.y, x2: n.x, y2: n.y };
          }),
        );
        if (polyBB.w <= 0 || polyBB.h <= 0) continue;
        const escalaX = medidas.largura / polyBB.w;
        const escalaY = medidas.altura / polyBB.h;
        const coer = Math.abs(escalaX / escalaY - 1);
        const escala = (escalaX + escalaY) / 2;

        // Converte para mm com escala isotrópica + origem inferior-esquerda
        const ptsMm: PontoMm[] = poly.map((p) => ({
          x: (p.x - polyBB.minX) * escala,
          y: (p.y - polyBB.minY) * escala,
        }));
        const simpl = simplificarPoligono(paraAntiHorario(ptsMm), 1);
        const tipo = classificarPoligono(simpl);
        candidatos.push({
          pagina: pageNum,
          pts: simpl,
          tipo,
          escala,
          coerenciaEixos: coer,
        });
        diag.push(
          `página ${pageNum}: candidato ${tipo} com ${simpl.length} vértices, bbox=${polyBB.w.toFixed(1)}×${polyBB.h.toFixed(1)} pt, escalaX/Y desvio=${(coer * 100).toFixed(1)}%`,
        );
        void bb;
      }
    } catch (e) {
      diag.push(`página ${pageNum}: ${(e as Error).message}`);
    }
  }

  try {
    await doc.destroy();
  } catch {
    /* ignore */
  }

  if (candidatos.length === 0) {
    return falhar(
      "Nenhum contorno vetorial fechado pôde ser reconstruído a partir do PDF.",
    );
  }

  // Prioriza L > retangular > poligono_complexo, e dentro disso menor desvio de escala
  const ordem: Record<string, number> = { L: 0, retangular: 1, poligono_complexo: 2 };
  candidatos.sort((a, b) => {
    const da = ordem[a.tipo] - ordem[b.tipo];
    if (da !== 0) return da;
    return a.coerenciaEixos - b.coerenciaEixos;
  });
  const escolhido = candidatos[0];

  if (escolhido.coerenciaEixos > 0.05) {
    diag.push(
      `Escala X/Y diverge ${(escolhido.coerenciaEixos * 100).toFixed(1)}% — contorno marcado como pendente.`,
    );
    return {
      pontos: escolhido.pts,
      tipo: escolhido.tipo,
      confianca: "baixa",
      pendente: true,
      escala_mm_por_unidade: escolhido.escala,
      origem_pagina: escolhido.pagina,
      diagnostico: diag,
    };
  }

  const confianca: "alta" | "media" =
    escolhido.tipo === "retangular" || escolhido.coerenciaEixos < 0.01 ? "alta" : "media";

  diag.push(
    `Contorno aceito: tipo=${escolhido.tipo}, página=${escolhido.pagina}, confiança=${confianca}.`,
  );

  return {
    pontos: escolhido.pts,
    tipo: escolhido.tipo,
    confianca,
    pendente: false,
    escala_mm_por_unidade: escolhido.escala,
    origem_pagina: escolhido.pagina,
    diagnostico: diag,
  };
}
