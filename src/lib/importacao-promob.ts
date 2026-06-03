// Helpers para a importação de pacote Promob/Nesting/Cut Pro.

export type CategoriaArquivo =
  | "autolabel_etiqueta"
  | "autolabel_small_preview"
  | "autolabel_large_preview"
  | "autolabel_pdf"
  | "nc_bmp"
  | "nc_gcode"
  | "nc_cyc"
  | "parts_info"
  | "parts_nc"
  | "profile_info"
  | "profile_nc"
  | "xml_cyc"
  | "list"
  | "lista_corte_pdf"
  | "preview_corte_pdf"
  | "almoxarifado_pdf"
  | "ignorado";

export type ArquivoClassificado = {
  caminho: string;
  nome: string;
  pasta: string;
  extensao: string;
  categoria: CategoriaArquivo;
  tamanho: number;
};

function detectarPasta(caminho: string): string {
  const partes = caminho.split("/").filter(Boolean);
  for (const p of partes) {
    const l = p.toLowerCase();
    if (["autolabel", "nc", "parts", "profile", "xml"].includes(l)) return l;
  }
  return "";
}

export function classificarArquivo(caminho: string, tamanho = 0): ArquivoClassificado {
  const nome = caminho.split("/").pop() ?? caminho;
  const ext = (nome.includes(".") ? nome.split(".").pop() ?? "" : "").toLowerCase();
  const pasta = detectarPasta(caminho);
  const lower = nome.toLowerCase();

  let categoria: CategoriaArquivo = "ignorado";

  if (pasta === "autolabel") {
    if (lower.includes("smallpreview")) categoria = "autolabel_small_preview";
    else if (lower.includes("largepreview")) categoria = "autolabel_large_preview";
    else if (ext === "pdf" && lower.includes("label")) categoria = "autolabel_pdf";
    else if (["bmp", "png", "jpg", "jpeg"].includes(ext)) categoria = "autolabel_etiqueta";
  } else if (pasta === "nc") {
    if (ext === "bmp") categoria = "nc_bmp";
    else if (ext === "nc") categoria = "nc_gcode";
    else if (ext === "cyc") categoria = "nc_cyc";
  } else if (pasta === "parts") {
    if (ext === "nc") categoria = "parts_nc";
    else categoria = "parts_info";
  } else if (pasta === "profile") {
    if (ext === "nc") categoria = "profile_nc";
    else categoria = "profile_info";
  } else if (pasta === "xml") {
    if (ext === "cyc") categoria = "xml_cyc";
  } else {
    if (/^list(\.|$)/i.test(nome) || lower === "list") categoria = "list";
    else if (lower.startsWith("listacorte") && ext === "pdf") categoria = "lista_corte_pdf";
    else if (lower.startsWith("previewcorte") && ext === "pdf") categoria = "preview_corte_pdf";
    else if (lower.includes("almoxarifado") && ext === "pdf") categoria = "almoxarifado_pdf";
  }

  return { caminho, nome, pasta, extensao: ext, categoria, tamanho };
}

// Etiqueta: GAV8252A(1), BAS7080A, PRA1234B(2).
export type EtiquetaInfo = {
  referencia: string;
  codigo: string;
  sufixo: string;
  duplicidade: number | null;
  nome_base: string;
};

export function parseNomeEtiqueta(nomeArquivo: string): EtiquetaInfo | null {
  const base = nomeArquivo.replace(/\.[^.]+$/, "");
  const m = base.match(/^([A-Za-z]+)(\d+)([A-Za-z]*)(?:\((\d+)\))?$/);
  if (!m) return null;
  const [, referencia, codigo, sufixo, dup] = m;
  return {
    referencia,
    codigo,
    sufixo: sufixo || "",
    duplicidade: dup ? Number(dup) : null,
    nome_base: base,
  };
}

// Chapa do xml: 01_MDP_Beige_Matt_15.cyc
export type ChapaInfoArquivo = {
  ordem: number;
  material: string;
  cor: string;
  espessura: number;
  nome_arquivo: string;
};

export function parseNomeChapa(nomeArquivo: string): ChapaInfoArquivo | null {
  const base = nomeArquivo.replace(/\.[^.]+$/, "");
  const partes = base.split("_");
  if (partes.length < 3) return null;
  const ordem = Number(partes[0]);
  if (!Number.isFinite(ordem)) return null;
  const espessura = Number(partes[partes.length - 1]);
  if (!Number.isFinite(espessura)) return null;
  const material = partes[1];
  const cor = partes.slice(2, -1).join(" ");
  return { ordem, material, cor, espessura, nome_arquivo: nomeArquivo };
}

export const CHAPA_PADRAO_LARGURA = 2750;
export const CHAPA_PADRAO_ALTURA = 1850;

export type ResumoImportacao = {
  total_arquivos: number;
  por_categoria: Record<string, number>;
  chapas_detectadas: ChapaInfoArquivo[];
  etiquetas_detectadas: number;
  tem_list: boolean;
  tem_lista_corte: boolean;
  tem_preview_corte: boolean;
  tem_almoxarifado: boolean;
};

export function resumirArquivos(arquivos: ArquivoClassificado[]): ResumoImportacao {
  const por_categoria: Record<string, number> = {};
  const chapas: ChapaInfoArquivo[] = [];
  let etiquetas = 0;
  for (const a of arquivos) {
    por_categoria[a.categoria] = (por_categoria[a.categoria] ?? 0) + 1;
    if (a.categoria === "xml_cyc") {
      const c = parseNomeChapa(a.nome);
      if (c) chapas.push(c);
    }
    if (a.categoria === "autolabel_etiqueta" || a.categoria === "nc_bmp") etiquetas += 1;
  }
  chapas.sort((a, b) => a.ordem - b.ordem);
  return {
    total_arquivos: arquivos.length,
    por_categoria,
    chapas_detectadas: chapas,
    etiquetas_detectadas: etiquetas,
    tem_list: !!por_categoria["list"],
    tem_lista_corte: !!por_categoria["lista_corte_pdf"],
    tem_preview_corte: !!por_categoria["preview_corte_pdf"],
    tem_almoxarifado: !!por_categoria["almoxarifado_pdf"],
  };
}

export const CATEGORIA_LABEL: Record<CategoriaArquivo, string> = {
  autolabel_etiqueta: "Etiqueta AutoLabel",
  autolabel_small_preview: "Preview pequeno",
  autolabel_large_preview: "Preview grande",
  autolabel_pdf: "PDF Labels",
  nc_bmp: "Etiqueta BMP (NC)",
  nc_gcode: "G-code chapa (NC)",
  nc_cyc: "Coordenadas etiquetas (CYC)",
  parts_info: "Info peça (Parts)",
  parts_nc: "G-code peça (Parts)",
  profile_info: "Info perfil (Profile)",
  profile_nc: "G-code perfil (Profile)",
  xml_cyc: "Chapa (xml/.cyc)",
  list: "Arquivo List",
  lista_corte_pdf: "ListaCorte.pdf",
  preview_corte_pdf: "PreviewCorte.pdf",
  almoxarifado_pdf: "Relatório Almoxarifado",
  ignorado: "Ignorado",
};

// ============================================================
// PDF parsing usando pdfjs-dist (browser)
// ============================================================
let _pdfjs: typeof import("pdfjs-dist") | null = null;
async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  _pdfjs = pdfjs;
  return pdfjs;
}

export type PaginaTexto = { pagina: number; linhas: string[] };

export async function extrairTextoPdf(blob: Blob): Promise<PaginaTexto[]> {
  const pdfjs = await loadPdfJs();
  const buf = await blob.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const out: PaginaTexto[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Reagrupar por linha usando Y
    type Item = { str: string; x: number; y: number };
    const items: Item[] = [];
    for (const it of content.items as Array<{ str: string; transform: number[] }>) {
      const t = it.transform;
      items.push({ str: it.str, x: t[4], y: Math.round(t[5]) });
    }
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const linhas: string[] = [];
    let yAtual: number | null = null;
    let buffer = "";
    for (const it of items) {
      if (yAtual === null || Math.abs(it.y - yAtual) > 2) {
        if (buffer.trim()) linhas.push(buffer.trim());
        buffer = it.str;
        yAtual = it.y;
      } else {
        buffer += " " + it.str;
      }
    }
    if (buffer.trim()) linhas.push(buffer.trim());
    out.push({ pagina: p, linhas });
  }
  return out;
}

// ----- ListaCorte -----
export type PecaListaCorte = {
  chapa_numero: number | null;
  indice: string | null; // ex: 1.A
  codigo: string | null; // ex: 7651
  descricao: string;
  largura: number;
  altura: number;
  borda: string | null;
  modulo: string | null;
};

/**
 * Parser heurístico para ListaCorte.pdf.
 * Procura blocos por "Chapa N" e, em cada bloco, linhas que tenham dimensões
 * <largura> x <altura>. Captura o restante como descrição e tenta separar
 * índice/código no início.
 */
export function parseListaCorte(paginas: PaginaTexto[]): PecaListaCorte[] {
  const out: PecaListaCorte[] = [];
  let chapaAtual: number | null = null;
  const reChapa = /\bChapa\s+(\d+)\b/i;
  const reDim = /(\d{2,4}(?:[.,]\d+)?)\s*[xX×]\s*(\d{2,4}(?:[.,]\d+)?)/;
  const reIndice = /^(\d+\.?[A-Z]?)\b/;

  for (const p of paginas) {
    for (const linha of p.linhas) {
      const mc = linha.match(reChapa);
      if (mc) {
        chapaAtual = Number(mc[1]);
        continue;
      }
      const md = linha.match(reDim);
      if (!md) continue;
      const largura = Number(md[1].replace(",", "."));
      const altura = Number(md[2].replace(",", "."));
      if (!Number.isFinite(largura) || !Number.isFinite(altura)) continue;
      if (largura < 30 || altura < 30) continue;
      if (largura > 3500 || altura > 3500) continue;

      const mi = linha.match(reIndice);
      const indice = mi ? mi[1] : null;
      const semIndice = indice ? linha.slice(mi![0].length).trim() : linha;
      // Tenta extrair código (sequência de 3-6 dígitos depois do índice)
      const mcod = semIndice.match(/^(\d{3,6})\b/);
      const codigo = mcod ? mcod[1] : null;
      let descricao = semIndice;
      if (codigo) descricao = descricao.slice(mcod![0].length).trim();
      descricao = descricao.replace(md[0], "").trim().replace(/\s+/g, " ");

      // Tenta extrair fita/borda no padrão @1..@8 ou palavras "borda"
      const mb = descricao.match(/@[1-8]+/);
      const borda = mb ? mb[0] : null;

      out.push({
        chapa_numero: chapaAtual,
        indice,
        codigo,
        descricao: descricao.slice(0, 200),
        largura,
        altura,
        borda,
        modulo: null,
      });
    }
  }
  return out;
}

// ----- Almoxarifado -----
export type ItemAlmoxarifado = {
  referencia: string | null;
  descricao: string;
  quantidade: number;
  unidade: string;
};

export function parseAlmoxarifado(paginas: PaginaTexto[]): ItemAlmoxarifado[] {
  const out: ItemAlmoxarifado[] = [];
  // Linhas típicas: "REF1234  Cavilha 8mm  120 un"
  const re = /^(\S+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(un|pç|pc|mt|m|kg|cm)\b/i;
  for (const p of paginas) {
    for (const linha of p.linhas) {
      const m = linha.match(re);
      if (!m) continue;
      const ref = m[1];
      const desc = m[2].trim();
      const qtd = Number(m[3].replace(",", "."));
      const unid = m[4].toLowerCase();
      if (!desc || desc.length < 3) continue;
      if (!Number.isFinite(qtd) || qtd <= 0) continue;
      // Evitar capturar números como referência puramente decimal
      if (/^\d+([.,]\d+)?$/.test(ref)) continue;
      out.push({
        referencia: ref.length > 30 ? null : ref,
        descricao: desc.slice(0, 200),
        quantidade: qtd,
        unidade: unid === "pc" ? "pç" : unid,
      });
    }
  }
  return out;
}
