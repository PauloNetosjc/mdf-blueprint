// Parser de PDFs técnicos da biblioteca de Peças Cadastradas.
// Lê o PDF com pdfjs-dist por coordenadas (X/Y) e extrai:
// - identificação da peça pelo nome do arquivo (BAS7537A, DIV1234A...)
// - medidas de referência (largura x altura x espessura)
// - tabelas de Furação por Face (incl. Face 5 para Divisórias)
// - tabelas de Rasgos por Face
// - fita de borda (FTABS...)
// - inferência de âncora X/Y (esquerda/direita/centro/absoluto)

let _pdfjs: typeof import("pdfjs-dist") | null = null;
async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  _pdfjs = pdfjs;
  return pdfjs;
}

// ---------- Identificação pelo nome do arquivo ----------

export type CodigoPecaTecnica = {
  codigo_completo: string;
  prefixo: string;
  codigo_principal: string;
  sufixo: string;
  tipo_peca: string;
};

const PREFIXO_TIPO: Record<string, string> = {
  AFA: "Afastador",
  ARM: "Armário / Módulo",
  BAS: "Base",
  CAB: "Cabeceira",
  COS: "Costa",
  DIV: "Divisória",
  FRE: "Frente",
  FRT: "Frente",
  FUN: "Fundo",
  GAV: "Gaveta",
  LAT: "Lateral",
  PAI: "Painel",
  PIL: "Pilar",
  POR: "Porta",
  PRA: "Prateleira",
  PRF: "Perfil",
  PRT: "Porta",
  REF: "Reforço",
  REG: "Régua",
  RIP: "Ripado",
  ROD: "Rodapé",
  SUP: "Suporte",
  TAM: "Tampo",
  TES: "Testeira",
  TRA: "Travessa",
  ZOC: "Zócalo",
};

export function getTipoPecaPorPrefixo(prefixo: string | null | undefined): string {
  if (!prefixo) return "Outro";
  return PREFIXO_TIPO[prefixo.toUpperCase()] ?? "Outro";
}

export function parseTechnicalPartCode(fileName: string): CodigoPecaTecnica | null {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  const m = base.match(/^([A-Za-z]+)(\d+)([A-Za-z]*)$/);
  if (!m) return null;
  const prefixo = m[1].toUpperCase();
  const codigo_principal = m[2];
  const sufixo = (m[3] || "").toUpperCase();
  const tipo_peca = getTipoPecaPorPrefixo(prefixo);
  return {
    codigo_completo: `${prefixo}${codigo_principal}${sufixo}`,
    prefixo,
    codigo_principal,
    sufixo,
    tipo_peca,
  };
}

export function ehDivisoria(prefixo: string | null | undefined): boolean {
  if (!prefixo) return false;
  const p = prefixo.toUpperCase();
  return p === "DIV" || p === "DIVISORIA" || p === "DIVISÓRIA";
}

// ---------- Modelo de saída do parser ----------

export type FaceLabel = { face: string; nome: string };

export const FACE_LABELS: Record<string, string> = {
  "0": "Padrão",
  "1": "Topo Frontal",
  "2": "Topo Direito",
  "3": "Topo Traseiro",
  "4": "Topo Esquerdo",
  "5": "Fundo",
};

export function nomeFace(face: string | null | undefined): string {
  if (!face) return "—";
  return FACE_LABELS[String(face)] ?? `Face ${face}`;
}

export type OperacaoExtraida = {
  tipo_operacao: "furo" | "rasgo" | "rebaixo" | "usinagem" | "outro";
  face: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  diametro: number | null;
  profundidade: number | null;
  largura: number | null;
  comprimento: number | null;
  x1: number | null;
  x2: number | null;
  y1: number | null;
  y2: number | null;
  ordem: number;
  ancora_x: "esquerda" | "direita" | "centro" | "absoluto" | null;
  ancora_y: "inferior" | "superior" | "centro" | "absoluto" | null;
  offset_x: number | null;
  offset_y: number | null;
  confianca_parser: "alta" | "media" | "baixa";
  dados_brutos: Record<string, unknown>;
};

export type BordaExtraida = {
  lado: "superior" | "inferior" | "esquerda" | "direita" | "frente" | "traseira" | "desconhecido";
  codigo_borda: string | null;
  descricao_borda: string | null;
  espessura: number | null;
  largura: number | null;
  cor: string | null;
  indicador_desenho: string | null;
  confianca_parser: "alta" | "media" | "baixa";
};

export type ResultadoParserPDF = {
  codigo: CodigoPecaTecnica | null;
  nome_peca: string | null;
  modulo_origem: string | null;
  largura_ref: number | null;
  altura_ref: number | null;
  espessura_ref: number | null;
  material_ref: string | null;
  fita_ref: string | null;
  operacoes: OperacaoExtraida[];
  bordas: BordaExtraida[];
  logs: string[];
  erros: string[];
  dados_brutos: Record<string, unknown>;
};

// ---------- Inferência de âncora ----------

const TOLERANCIA_BORDA = 60; // mm — distância até borda considerada "âncora de borda"
const TOLERANCIA_CENTRO = 30; // mm — distância até o meio considerada "âncora central"

function inferirAncoraEixo(
  v: number,
  ref: number | null,
): { ancora: "esquerda" | "direita" | "centro" | "absoluto"; offset: number } {
  if (!ref || ref <= 0) return { ancora: "absoluto", offset: v };
  if (v <= TOLERANCIA_BORDA) return { ancora: "esquerda", offset: v };
  if (ref - v <= TOLERANCIA_BORDA) return { ancora: "direita", offset: ref - v };
  if (Math.abs(v - ref / 2) <= TOLERANCIA_CENTRO) return { ancora: "centro", offset: v - ref / 2 };
  return { ancora: "absoluto", offset: v };
}

export function inferOperationAnchors(
  op: OperacaoExtraida,
  largura_ref: number | null,
  altura_ref: number | null,
): OperacaoExtraida {
  const out = { ...op };
  if (op.x != null) {
    const a = inferirAncoraEixo(op.x, largura_ref);
    out.ancora_x = a.ancora;
    out.offset_x = a.offset;
  }
  if (op.y != null) {
    const a = inferirAncoraEixo(op.y, altura_ref);
    // No eixo Y mapeamos esquerda/direita → inferior/superior
    out.ancora_y =
      a.ancora === "esquerda"
        ? "inferior"
        : a.ancora === "direita"
          ? "superior"
          : (a.ancora as "centro" | "absoluto");
    out.offset_y = a.offset;
  }
  return out;
}

// ---------- Extração por coordenadas ----------

type Item = { str: string; x: number; y: number; pagina: number };

async function extrairItens(blob: Blob): Promise<Item[]> {
  const pdfjs = await loadPdfJs();
  const buf = await blob.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const itens: Item[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items) {
      const anyIt = it as unknown as { str: string; transform: number[] };
      if (!anyIt.str || !anyIt.str.trim()) continue;
      const t = anyIt.transform;
      itens.push({ str: anyIt.str, x: t[4], y: t[5], pagina: p });
    }
  }
  return itens;
}

// Agrupa itens em linhas por proximidade de Y (mesma página).
type Linha = { pagina: number; y: number; cels: { x: number; str: string }[]; texto: string };

function agruparEmLinhas(itens: Item[], tolY = 3): Linha[] {
  const porPagina = new Map<number, Item[]>();
  for (const it of itens) {
    if (!porPagina.has(it.pagina)) porPagina.set(it.pagina, []);
    porPagina.get(it.pagina)!.push(it);
  }
  const linhas: Linha[] = [];
  for (const [pagina, lista] of porPagina) {
    lista.sort((a, b) => b.y - a.y || a.x - b.x);
    let atual: Linha | null = null;
    for (const it of lista) {
      if (!atual || Math.abs(atual.y - it.y) > tolY) {
        if (atual) linhas.push(finalizarLinha(atual));
        atual = { pagina, y: it.y, cels: [], texto: "" };
      }
      atual.cels.push({ x: it.x, str: it.str });
    }
    if (atual) linhas.push(finalizarLinha(atual));
  }
  return linhas;
}

function finalizarLinha(l: Linha): Linha {
  l.cels.sort((a, b) => a.x - b.x);
  l.texto = l.cels.map((c) => c.str).join(" ").replace(/\s+/g, " ").trim();
  return l;
}

// ---------- Parser principal ----------

function toNum(s: string): number | null {
  const n = Number(s.replace(",", ".").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isNumericCells(cels: { str: string }[]): boolean {
  if (!cels.length) return false;
  const nums = cels.filter((c) => /^-?\d+([.,]\d+)?$/.test(c.str.trim())).length;
  return nums >= Math.max(2, Math.floor(cels.length * 0.7));
}

function extrairFacesPorContexto(linhas: Linha[]): Map<number, string> {
  // Map<indiceLinha, faceAtiva>
  const out = new Map<number, string>();
  let faceAtual = "";
  for (let i = 0; i < linhas.length; i++) {
    const t = linhas[i].texto.toLowerCase();
    const m = t.match(/\b(?:face|lado)\s*([0-5])\b/);
    if (m) faceAtual = m[1];
    out.set(i, faceAtual);
  }
  return out;
}

function extrairOperacoes(linhas: Linha[]): OperacaoExtraida[] {
  const ops: OperacaoExtraida[] = [];
  const faceCtx = extrairFacesPorContexto(linhas);
  let modo: "furo" | "rasgo" | null = null;
  let ordem = 0;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const t = linha.texto.toLowerCase();

    if (/\bfura(c|ç)(a|õ|o)e?s?\b/.test(t)) modo = "furo";
    else if (/\brasgo?s?\b/.test(t)) modo = "rasgo";
    else if (/\businage(m|ns)\b|\brebaixo\b|\bcanal\b/.test(t)) modo = "furo"; // tratado como op genérica abaixo

    if (!modo) continue;
    if (!isNumericCells(linha.cels)) continue;

    const valores = linha.cels
      .map((c) => toNum(c.str))
      .filter((v): v is number => v != null);
    if (valores.length < 2) continue;

    const face = faceCtx.get(i) || null;

    if (modo === "furo") {
      // Esperado X Y Diam Prof (4 colunas); às vezes só 2 ou 3.
      const [x, y, diam, prof] = [valores[0], valores[1], valores[2] ?? null, valores[3] ?? null];
      ops.push({
        tipo_operacao: "furo",
        face,
        x,
        y,
        z: null,
        diametro: diam,
        profundidade: prof,
        largura: null,
        comprimento: null,
        x1: null,
        x2: null,
        y1: null,
        y2: null,
        ordem: ordem++,
        ancora_x: null,
        ancora_y: null,
        offset_x: null,
        offset_y: null,
        confianca_parser: valores.length >= 4 ? "alta" : "media",
        dados_brutos: { linha: linha.texto, valores },
      });
    } else if (modo === "rasgo") {
      // Y X1 X2 Larg Prof — 5 colunas
      if (valores.length < 4) continue;
      const [y, x1, x2, larg, prof] = [
        valores[0],
        valores[1],
        valores[2],
        valores[3],
        valores[4] ?? null,
      ];
      ops.push({
        tipo_operacao: "rasgo",
        face,
        x: (x1 + x2) / 2,
        y,
        z: null,
        diametro: null,
        profundidade: prof,
        largura: larg,
        comprimento: Math.abs(x2 - x1),
        x1,
        x2,
        y1: null,
        y2: null,
        ordem: ordem++,
        ancora_x: null,
        ancora_y: null,
        offset_x: null,
        offset_y: null,
        confianca_parser: valores.length >= 5 ? "alta" : "media",
        dados_brutos: { linha: linha.texto, valores },
      });
    }
  }
  return ops;
}

function extrairBordas(linhas: Linha[]): BordaExtraida[] {
  const bordas: BordaExtraida[] = [];
  for (const l of linhas) {
    const m = l.texto.match(/\b(FTABS[A-Z0-9.\-_]*)\b/i);
    if (!m) continue;
    const codigo = m[1].toUpperCase();
    // Padrões: FTABS.0.45.19.100 (esp.larg.cor) ou FTABS.1.19.100
    const partes = codigo.split(".").slice(1); // remove "FTABS"
    let espessura: number | null = null;
    let largura: number | null = null;
    let corCodigo: string | null = null;
    if (partes.length >= 4) {
      // ex: 0, 45, 19, 100 → 0.45, 19, 100
      espessura = toNum(`${partes[0]}.${partes[1]}`);
      largura = toNum(partes[2]);
      corCodigo = partes[3];
    } else if (partes.length === 3) {
      espessura = toNum(partes[0]);
      largura = toNum(partes[1]);
      corCodigo = partes[2];
    }
    const descMatch = l.texto.match(/Fita\s+de\s+Borda[^\n]*/i);
    let descricao = descMatch ? descMatch[0].trim() : null;
    const dim = l.texto.match(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/i);
    if (dim && espessura == null) espessura = toNum(dim[1]);
    if (dim && largura == null) largura = toNum(dim[2]);
    const corMatch = l.texto.match(/\b(Branco|Preto|Bege|Cinza|Carvalho|Nogueira|Cerejeira|Cerrado|Beige|Matt|Off\s*White|Carvalho\s*\w+)\b/i);
    const cor = corMatch ? corMatch[1] : null;
    if (!descricao) {
      const partesDesc = ["Fita de Borda ABS"];
      if (espessura != null && largura != null) partesDesc.push(`Espessura ${espessura}x${largura}mm`);
      if (cor) partesDesc.push(cor);
      descricao = partesDesc.join(" ");
    }
    bordas.push({
      lado: "desconhecido",
      codigo_borda: codigo,
      descricao_borda: descricao,
      espessura,
      largura,
      cor: cor ?? corCodigo,
      indicador_desenho: null,
      confianca_parser: espessura != null && largura != null ? "alta" : "media",
    });
  }
  const seen = new Set<string>();
  return bordas.filter((b) => {
    const k = b.codigo_borda ?? "";
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function extrairMedidas(linhas: Linha[]): {
  largura: number | null;
  altura: number | null;
  espessura: number | null;
  material: string | null;
} {
  // Padrão "Chapa X Espessura 15mm (900 x 15 x 460)"
  for (const l of linhas) {
    const m = l.texto.match(/\((\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\)/);
    if (m) {
      const a = toNum(m[1])!;
      const b = toNum(m[2])!;
      const c = toNum(m[3])!;
      // menor valor costuma ser espessura
      const vals = [a, b, c].sort((x, y) => x - y);
      const espessura = vals[0];
      const outros = [a, b, c].filter((v) => v !== espessura);
      const largura = Math.max(...outros);
      const altura = Math.min(...outros);
      const matMatch = l.texto.match(/Chapa\s+([^()]+?)\s+Espessura/i);
      return { largura, altura, espessura, material: matMatch ? matMatch[1].trim() : null };
    }
  }
  // Fallback: três números isolados próximos (largura altura espessura)
  return { largura: null, altura: null, espessura: null, material: null };
}

function extrairNomePeca(linhas: Linha[], codigo: CodigoPecaTecnica | null): string | null {
  if (!codigo) return null;
  // 1) "7537-Base Inferior" ou "7537 - Base Inferior" ou "7537: Base"
  for (const l of linhas) {
    const m = l.texto.match(new RegExp(`${codigo.codigo_principal}\\s*[-–:]\\s*([A-Za-zÀ-ÿ][^|]+)`));
    if (m) return m[1].trim().slice(0, 120);
  }
  // 2) Linha que começa com o tipo amigável (ex: "Afastador Esquerdo")
  const tipoBase = codigo.tipo_peca.split(/[\s/]/)[0];
  if (tipoBase && tipoBase.length >= 3) {
    const re = new RegExp(`^${tipoBase}\\b[^0-9]{2,80}$`, "i");
    for (const l of linhas) {
      if (l.texto.length > 80) continue;
      if (re.test(l.texto.trim())) return l.texto.trim().slice(0, 120);
    }
  }
  // 3) Linha com "Descrição: ..."
  for (const l of linhas) {
    const m = l.texto.match(/Descri[cç][aã]o\s*[:\-]\s*(.+)/i);
    if (m) return m[1].trim().slice(0, 120);
  }
  // 4) Fallback: tipo amigável + código principal+sufixo
  return `${codigo.tipo_peca} ${codigo.codigo_principal}${codigo.sufixo}`.trim();
}

export async function parseTechnicalDrawingPdf(
  file: File | Blob,
  fileName: string,
): Promise<ResultadoParserPDF> {
  const logs: string[] = [];
  const erros: string[] = [];
  const codigo = parseTechnicalPartCode(fileName);
  if (!codigo) erros.push(`Não consegui extrair código do nome do arquivo: ${fileName}`);
  else logs.push(`Código identificado: ${codigo.codigo_completo} (tipo ${codigo.tipo_peca})`);

  let itens: Item[] = [];
  try {
    itens = await extrairItens(file);
    logs.push(`PDF lido: ${itens.length} itens de texto`);
  } catch (e) {
    erros.push(`Falha ao ler PDF: ${(e as Error).message}`);
    return {
      codigo,
      nome_peca: null,
      modulo_origem: null,
      largura_ref: null,
      altura_ref: null,
      espessura_ref: null,
      material_ref: null,
      fita_ref: null,
      operacoes: [],
      bordas: [],
      logs,
      erros,
      dados_brutos: {},
    };
  }

  const linhas = agruparEmLinhas(itens);
  const medidas = extrairMedidas(linhas);
  if (medidas.largura) logs.push(`Medidas: ${medidas.largura} x ${medidas.altura} x ${medidas.espessura}`);
  const nome_peca = extrairNomePeca(linhas, codigo);
  let operacoes = extrairOperacoes(linhas);
  logs.push(`Operações detectadas: ${operacoes.length}`);

  // Inferir âncoras
  operacoes = operacoes.map((op) => inferOperationAnchors(op, medidas.largura, medidas.altura));

  const bordas = extrairBordas(linhas);
  if (bordas.length) logs.push(`Bordas detectadas: ${bordas.map((b) => b.codigo_borda).join(", ")}`);

  // Validação Face 5 fora de Divisória
  const temFace5 = operacoes.some((o) => o.face === "5");
  if (temFace5 && codigo && !ehDivisoria(codigo.prefixo)) {
    erros.push(`Operação na Face 5 detectada em peça do tipo ${codigo.tipo_peca}. Face 5 normalmente é usada apenas em Divisórias.`);
  }

  return {
    codigo,
    nome_peca,
    modulo_origem: null,
    largura_ref: medidas.largura,
    altura_ref: medidas.altura,
    espessura_ref: medidas.espessura,
    material_ref: medidas.material,
    fita_ref: bordas[0]?.codigo_borda ?? null,
    operacoes,
    bordas,
    logs,
    erros,
    dados_brutos: { total_linhas: linhas.length },
  };
}
