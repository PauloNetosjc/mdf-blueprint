// Extração de contorno visual calibrado por escala.
//
// Lê os operadores vetoriais do PDF (pdfjs.getOperatorList) e identifica o
// maior subcaminho fechado que representa o contorno externo da peça.
// Calibra a escala pelas medidas reais conhecidas (largura/altura em mm)
// e devolve `pontos_contorno` em milímetros.
//
// Estratégia:
//   - Para cada página, varremos a lista de operadores acompanhando CTM.
//   - Cada subpath (entre moveTo e o próximo moveTo/stroke/fill/endPath) é
//     coletado como uma polilinha. Subpaths terminados por closePath, fillStroke,
//     fill, closeStroke etc. são marcados como fechados.
//   - Rectangles (`re`) viram subpaths fechados de 4 pontos.
//   - Filtramos por tamanho (bbox >= 15% da diagonal da página) e escolhemos
//     o subpath com maior área entre os candidatos com proporção compatível
//     com largura/altura reais (tolerância 5%).
//   - A escala é ISOTRÓPICA: usamos a razão média (largura/bboxW + altura/bboxH)/2.
//
// Apenas vetorial. Não fazemos OCR/raster.

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

type Mat = [number, number, number, number, number, number];
const mIdentity = (): Mat => [1, 0, 0, 1, 0, 0];
const mMul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const mApply = (m: Mat, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

type Subpath = { pts: PontoMm[]; closed: boolean };

function bbox(pts: PontoMm[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function area(pts: PontoMm[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function simplificar(pts: PontoMm[], tol: number): PontoMm[] {
  if (pts.length < 3) return pts;
  // dedup consecutivos
  const ded: PontoMm[] = [];
  for (const p of pts) {
    const last = ded[ded.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > tol) ded.push(p);
  }
  if (ded.length > 2) {
    const a = ded[0];
    const b = ded[ded.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= tol) ded.pop();
  }
  if (ded.length < 3) return ded;
  // remove colineares
  const out: PontoMm[] = [];
  for (let i = 0; i < ded.length; i++) {
    const prev = ded[(i - 1 + ded.length) % ded.length];
    const cur = ded[i];
    const next = ded[(i + 1) % ded.length];
    const v1x = cur.x - prev.x;
    const v1y = cur.y - prev.y;
    const v2x = next.x - cur.x;
    const v2y = next.y - cur.y;
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < tol || len2 < tol) continue;
    const cross = Math.abs(v1x * v2y - v1y * v2x) / (len1 * len2);
    if (cross < 0.01) continue;
    out.push(cur);
  }
  return out.length >= 3 ? out : ded;
}

function classificar(pts: PontoMm[]): "retangular" | "L" | "poligono_complexo" {
  if (pts.length === 4) return "retangular";
  if (pts.length === 6) {
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
      if (l1 > 0 && l2 > 0 && Math.abs(dot / (l1 * l2)) < 0.15) rights++;
    }
    if (rights >= 5) return "L";
  }
  return "poligono_complexo";
}

function paraAntiHorario(pts: PontoMm[]): PontoMm[] {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += (q.x - p.x) * (q.y + p.y);
  }
  return a > 0 ? pts.slice().reverse() : pts;
}

async function extrairSubpaths(
  pdfjs: PdfJs,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
): Promise<{
  subpaths: Subpath[];
  pageW: number;
  pageH: number;
  opStats: Record<string, number>;
  totalOps: number;
}> {
  const viewport = page.getViewport({ scale: 1 });
  const opList = await page.getOperatorList();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OPS: Record<string, number> = (pdfjs as any).OPS;
  // Inverte OPS para nome humano
  const OP_NAME: Record<number, string> = {};
  for (const [k, v] of Object.entries(OPS)) OP_NAME[v] = k;

  const subpaths: Subpath[] = [];
  let ctm: Mat = mIdentity();
  const stack: Mat[] = [];

  // Pontos do subpath atual (em coordenadas do PDF, já transformadas).
  let cur: PontoMm[] = [];
  let curStart: PontoMm | null = null;
  let curClosed = false;
  let cx = 0;
  let cy = 0;

  const flush = () => {
    if (cur.length >= 2) {
      subpaths.push({ pts: cur, closed: curClosed });
    }
    cur = [];
    curStart = null;
    curClosed = false;
  };

  const addPoint = (x: number, y: number) => {
    const [tx, ty] = mApply(ctm, x, y);
    cur.push({ x: tx, y: ty });
  };

  const fnArray = opList.fnArray as number[];
  const argsArray = opList.argsArray as unknown[][];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as number[];
    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? mIdentity();
    } else if (fn === OPS.transform) {
      ctm = mMul(ctm, [args[0], args[1], args[2], args[3], args[4], args[5]]);
    } else if (fn === OPS.moveTo) {
      // novo subpath: flush o anterior
      if (cur.length >= 2) subpaths.push({ pts: cur, closed: curClosed });
      cur = [];
      curClosed = false;
      cx = args[0];
      cy = args[1];
      addPoint(cx, cy);
      curStart = cur[cur.length - 1];
    } else if (fn === OPS.lineTo) {
      cx = args[0];
      cy = args[1];
      addPoint(cx, cy);
    } else if (fn === OPS.rectangle) {
      // flush anterior, gera subpath fechado isolado
      if (cur.length >= 2) subpaths.push({ pts: cur, closed: curClosed });
      cur = [];
      const [rx, ry, rw, rh] = args;
      const corners: [number, number][] = [
        [rx, ry],
        [rx + rw, ry],
        [rx + rw, ry + rh],
        [rx, ry + rh],
      ];
      for (const [a, b] of corners) addPoint(a, b);
      curStart = cur[0];
      curClosed = true;
      subpaths.push({ pts: cur, closed: true });
      cur = [];
      curStart = null;
      curClosed = false;
      cx = rx;
      cy = ry;
    } else if (
      fn === OPS.curveTo ||
      fn === OPS.curveTo2 ||
      fn === OPS.curveTo3
    ) {
      // aproxima por linha até o endpoint final
      const ex = args[args.length - 2];
      const ey = args[args.length - 1];
      cx = ex;
      cy = ey;
      addPoint(ex, ey);
    } else if (fn === OPS.closePath) {
      if (curStart) {
        cur.push({ x: curStart.x, y: curStart.y });
        curClosed = true;
        cx = curStart.x;
        cy = curStart.y;
      }
    } else if (
      fn === OPS.stroke ||
      fn === OPS.closeStroke ||
      fn === OPS.fillStroke ||
      fn === OPS.eoFillStroke ||
      fn === OPS.closeFillStroke ||
      fn === OPS.closeEOFillStroke ||
      fn === OPS.fill ||
      fn === OPS.eoFill
    ) {
      if (
        fn === OPS.closeStroke ||
        fn === OPS.closeFillStroke ||
        fn === OPS.closeEOFillStroke ||
        fn === OPS.fill ||
        fn === OPS.eoFill ||
        fn === OPS.fillStroke ||
        fn === OPS.eoFillStroke
      ) {
        if (!curClosed && curStart && cur.length >= 2) {
          cur.push({ x: curStart.x, y: curStart.y });
          curClosed = true;
        }
      }
      flush();
    } else if (fn === OPS.endPath) {
      cur = [];
      curStart = null;
      curClosed = false;
    }
  }
  if (cur.length >= 2) subpaths.push({ pts: cur, closed: curClosed });

  return { subpaths, pageW: viewport.width, pageH: viewport.height };
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  try {
    pdfjs = await loadPdfJs();
    doc = await pdfjs.getDocument({ data: pdfBytes.slice(0) }).promise;
  } catch (e) {
    return falhar(`Falha ao abrir PDF: ${(e as Error).message}`);
  }

  type Candidato = {
    pagina: number;
    pts: PontoMm[];
    tipo: "retangular" | "L" | "poligono_complexo";
    escala: number;
    coerenciaEixos: number;
    razaoProporcao: number;
    bboxW: number;
    bboxH: number;
    area: number;
  };
  const candidatos: Candidato[] = [];
  const propAlvo = medidas.largura / medidas.altura;

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    try {
      const page = await doc.getPage(pageNum);
      const { subpaths, pageW, pageH } = await extrairSubpaths(pdfjs, page);
      const diagPg = Math.hypot(pageW, pageH);
      const minBB = diagPg * 0.1; // subpath precisa cobrir >10% da diagonal

      const closedBig = subpaths
        .filter((s) => s.closed && s.pts.length >= 4)
        .map((s) => {
          const bb = bbox(s.pts);
          return { s, bb };
        })
        .filter((x) => x.bb.w >= minBB && x.bb.h >= minBB);

      diag.push(
        `página ${pageNum}: ${subpaths.length} subpaths, ${closedBig.length} fechados grandes (>=${minBB.toFixed(0)} pt)`,
      );

      for (const { s, bb } of closedBig) {
        if (bb.w <= 0 || bb.h <= 0) continue;
        const escalaX = medidas.largura / bb.w;
        const escalaY = medidas.altura / bb.h;
        const coer = Math.abs(escalaX / escalaY - 1);
        const escala = (escalaX + escalaY) / 2;
        const prop = bb.w / bb.h;
        const razao = Math.abs(prop / propAlvo - 1);

        // normaliza para mm com escala isotrópica e origem inferior-esquerda
        const ptsBruto = s.pts.map((p) => ({
          x: (p.x - bb.minX) * escala,
          y: (p.y - bb.minY) * escala,
        }));
        const ptsSimples = simplificar(paraAntiHorario(ptsBruto), Math.max(1, escala));
        if (ptsSimples.length < 4) continue;
        const tipo = classificar(ptsSimples);
        const ar = area(ptsSimples);
        candidatos.push({
          pagina: pageNum,
          pts: ptsSimples,
          tipo,
          escala,
          coerenciaEixos: coer,
          razaoProporcao: razao,
          bboxW: bb.w,
          bboxH: bb.h,
          area: ar,
        });
      }
    } catch (e) {
      diag.push(`página ${pageNum}: erro ${(e as Error).message}`);
    }
  }

  try {
    if (doc.destroy) await doc.destroy();
  } catch {
    /* ignore */
  }

  if (candidatos.length === 0) {
    return falhar("Nenhum subpath fechado relevante encontrado no PDF.");
  }

  // Diagnóstico resumido de candidatos
  for (const c of candidatos.slice(0, 6)) {
    diag.push(
      `cand pg${c.pagina} tipo=${c.tipo} vértices=${c.pts.length} bbox=${c.bboxW.toFixed(1)}×${c.bboxH.toFixed(1)} pt escala≈${c.escala.toFixed(4)} prop_desvio=${(c.razaoProporcao * 100).toFixed(1)}% eixoX/Y_desvio=${(c.coerenciaEixos * 100).toFixed(1)}% área=${c.area.toFixed(0)}mm²`,
    );
  }

  // Filtra por proporção compatível com as medidas (tolerância 5%)
  const compativeis = candidatos.filter((c) => c.razaoProporcao <= 0.05);
  const pool = compativeis.length > 0 ? compativeis : candidatos;

  // Prioriza: L > poligono_complexo > retangular ; dentro disso maior área
  const ordem: Record<string, number> = { L: 0, poligono_complexo: 1, retangular: 2 };
  pool.sort((a, b) => {
    const d = ordem[a.tipo] - ordem[b.tipo];
    if (d !== 0) return d;
    return b.area - a.area;
  });
  const escolhido = pool[0];

  if (escolhido.coerenciaEixos > 0.05 || escolhido.razaoProporcao > 0.08) {
    diag.push(
      `Escala/proporção divergem (eixo=${(escolhido.coerenciaEixos * 100).toFixed(1)}%, proporção=${(escolhido.razaoProporcao * 100).toFixed(1)}%) — marcado como pendente.`,
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
    escolhido.coerenciaEixos < 0.01 && escolhido.razaoProporcao < 0.01 ? "alta" : "media";

  diag.push(
    `Aceito: pg${escolhido.pagina} tipo=${escolhido.tipo} vértices=${escolhido.pts.length} confiança=${confianca}.`,
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
