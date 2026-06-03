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

// Reconhece pasta a partir do caminho (insensível a maiúsculas).
function detectarPasta(caminho: string): string {
  const partes = caminho.split("/").filter(Boolean);
  // descarta a pasta raiz se existir
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
    // raiz: identifica por nome
    if (/^list(\.|$)/i.test(nome) || lower === "list") categoria = "list";
    else if (lower.startsWith("listacorte") && ext === "pdf") categoria = "lista_corte_pdf";
    else if (lower.startsWith("previewcorte") && ext === "pdf") categoria = "preview_corte_pdf";
    else if (lower.includes("almoxarifado") && ext === "pdf") categoria = "almoxarifado_pdf";
  }

  return { caminho, nome, pasta, extensao: ext, categoria, tamanho };
}

// Etiqueta: GAV8252A(1) ou BAS7080A.
export type EtiquetaInfo = {
  referencia: string;
  codigo: string;
  sufixo: string;
  duplicidade: number | null;
  nome_base: string;
};

export function parseNomeEtiqueta(nomeArquivo: string): EtiquetaInfo | null {
  const base = nomeArquivo.replace(/\.[^.]+$/, "");
  // Captura prefixo letras + numeros + sufixo letras + opcional (n)
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
