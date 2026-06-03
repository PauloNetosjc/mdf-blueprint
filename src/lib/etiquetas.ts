// Geração de códigos e indices para etiquetas
export function indiceLetra(i: number): string {
  // 0 → A, 1 → B, ..., 25 → Z, 26 → AA
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function gerarIndicePeca(numChapa: number, indicePeca: number): string {
  return `${numChapa}${indiceLetra(indicePeca)}`;
}

export function gerarCodigoBarras(params: {
  projetoId: string;
  numChapa: number;
  indicePeca: string;
}): string {
  // Curto e estável: PRJ-{6 últimos do projeto}-CH{NN}-P{IDX}
  const slug = params.projetoId.replace(/-/g, "").slice(-6).toUpperCase();
  const ch = String(params.numChapa).padStart(2, "0");
  return `PRJ-${slug}-CH${ch}-P${params.indicePeca}`;
}

export const PRESETS_ETIQUETA = {
  pequena: { largura_mm: 50, altura_mm: 30, colunas: 4, linhas: 9 },
  media: { largura_mm: 80, altura_mm: 50, colunas: 2, linhas: 5 },
  grande: { largura_mm: 100, altura_mm: 70, colunas: 2, linhas: 4 },
  a4: { largura_mm: 99, altura_mm: 67, colunas: 2, linhas: 4 },
  termica: { largura_mm: 100, altura_mm: 50, colunas: 1, linhas: 1 },
} as const;

export type PresetEtiqueta = keyof typeof PRESETS_ETIQUETA;

export type CamposVisiveis = {
  cliente: boolean;
  projeto: boolean;
  ambiente: boolean;
  modulo: boolean;
  peca: boolean;
  chapa: boolean;
  numero_peca: boolean;
  dimensoes: boolean;
  fita: boolean;
  codigo_item: boolean;
  codigo_barras: boolean;
  qr_code: boolean;
  mini_mapa: boolean;
  observacao: boolean;
};

export type ConteudoEtiqueta = {
  cliente: string;
  projeto: string;
  ambiente: string;
  modulo: string;
  peca_descricao: string;
  peca_codigo: string;
  numero_peca: string;
  numero_chapa: number;
  material: string;
  cor_chapa: string;
  largura: number;
  altura: number;
  espessura: number;
  fita: string;
  observacao: string;
  mini_mapa: {
    chapa_largura: number;
    chapa_altura: number;
    pecas: { x: number; y: number; w: number; h: number; destaque: boolean }[];
  } | null;
};
