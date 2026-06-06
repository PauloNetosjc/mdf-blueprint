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

// Sem nomes físicos fixos: face é apenas o identificador local do PDF da peça.
// Nomes amigáveis ("Fundo", "Topo Frontal" etc.) só podem vir de configuração manual.
export const FACE_LABELS: Record<string, string> = {
  "0": "Face 0",
  "1": "Face 1",
  "2": "Face 2",
  "3": "Face 3",
  "4": "Face 4",
  "5": "Face 5",
};

export function nomeFace(face: string | null | undefined): string {
  if (face == null || face === "") return "—";
  return `Face ${face}`;
}

export type PontoUsinagem = {
  x: number | null;
  y: number | null;
  profundidade: number | null;
  tipo?: string | null;
  ordem: number;
};

export type OperacaoExtraida = {
  tipo_operacao:
    | "furo"
    | "rasgo"
    | "rebaixo"
    | "usinagem_parametrica"
    | "contorno"
    | "usinagem"
    | "outro";
  nome_operacao: string | null;
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
  pontos: PontoUsinagem[];
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

export type ResumoParser = {
  furos_detectados: number;
  rasgos_detectados: number;
  usinagens_detectadas: number;
  bordas_detectadas: number;
  fita_detectada: boolean;
  nome_detectado: boolean;
  medidas_detectadas: boolean;
  face_5_detectada: boolean;
  pdf_lido: boolean;
  codigo_detectado: boolean;
  total_operacoes: number;
  faces_com_operacao: number[];
};

export type ClassificacaoPdf = "peca_individual" | "modulo_explodido" | "desconhecido";

export type ResultadoClassificacao = {
  classificacao: ClassificacaoPdf;
  motivo: string;
  confianca: "alta" | "media" | "baixa";
  sinais: {
    tem_composicoes: boolean;
    tem_ferragens: boolean;
    tem_tabela_composicao: boolean;
    referencias_ferragens: string[];
    faces_detectadas: number[];
    tem_furacao_tabela: boolean;
    tem_rasgos_tabela: boolean;
    tem_face_alinhamento: boolean;
    tem_ftabs: boolean;
  };
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
  /** Erros críticos — impedem o cadastro útil da peça. */
  erros: string[];
  /** Alertas — peça foi cadastrada, mas com observações não críticas. */
  alertas: string[];
  resumo: ResumoParser;
  dados_brutos: Record<string, unknown>;
  /** Classificação do tipo de documento (peça individual x módulo/explodido). */
  classificacao: ResultadoClassificacao;
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

  // Para rasgo: a posição relevante é X1 (esquerda) e X2 (direita), não o ponto médio.
  // X1 sempre ancorado à esquerda; X2 sempre ancorado à direita (offset = largura_ref - x2);
  // Y é a distância em relação à borda inferior da face.
  const ehRasgo = op.tipo_operacao === "rasgo";

  if (ehRasgo && op.x1 != null) {
    out.ancora_x = "esquerda";
    out.offset_x = op.x1;
  } else if (op.x != null) {
    const a = inferirAncoraEixo(op.x, largura_ref);
    out.ancora_x = a.ancora;
    out.offset_x = a.offset;
  }

  if (ehRasgo && op.y != null) {
    out.ancora_y = "inferior";
    out.offset_y = op.y;
  } else if (op.y != null) {
    const a = inferirAncoraEixo(op.y, altura_ref);
    out.ancora_y =
      a.ancora === "esquerda"
        ? "inferior"
        : a.ancora === "direita"
          ? "superior"
          : (a.ancora as "centro" | "absoluto");
    out.offset_y = a.offset;
  }

  // Âncoras para extremos do rasgo (x1/x2) e para cada ponto de usinagem.
  // X2 é sempre referenciado à borda direita (offset = largura_ref - x2)
  // para permitir adaptar o rasgo a peças de largura variável.
  const ancorasExtras: Record<string, unknown> = {};
  if (op.x1 != null) {
    ancorasExtras.x1 = { ancora: "esquerda", offset: op.x1 };
  }
  if (op.x2 != null) {
    const offsetDir = largura_ref != null && largura_ref > 0 ? largura_ref - op.x2 : op.x2;
    ancorasExtras.x2 = { ancora: "direita", offset: offsetDir };
  }
  if (op.y1 != null) ancorasExtras.y1 = inferirAncoraEixo(op.y1, altura_ref);
  if (op.y2 != null) ancorasExtras.y2 = inferirAncoraEixo(op.y2, altura_ref);
  if (op.pontos && op.pontos.length > 0) {
    ancorasExtras.pontos = op.pontos.map((p) => ({
      ordem: p.ordem,
      tipo: p.tipo ?? null,
      x: p.x != null ? inferirAncoraEixo(p.x, largura_ref) : null,
      y: p.y != null ? inferirAncoraEixo(p.y, altura_ref) : null,
    }));
  }
  if (Object.keys(ancorasExtras).length > 0) {
    out.dados_brutos = { ...(out.dados_brutos ?? {}), ancoras_extras: ancorasExtras };
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
  const normalizado = s.trim().replace(",", ".");
  if (!/\d/.test(normalizado)) return null;
  const m = normalizado.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function isNumericCells(cels: { str: string }[]): boolean {
  if (!cels.length) return false;
  const nums = cels.filter((c) => /^-?\d+([.,]\d+)?$/.test(c.str.trim())).length;
  return nums >= Math.max(2, Math.floor(cels.length * 0.7));
}

function ultimosValoresNumericos(valores: number[], qtd: number): number[] {
  return valores.length > qtd ? valores.slice(-qtd) : valores;
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

// Section detection helpers — tolerant to acentuação and plural/concatenado
const RE_FURACAO = /\bfura[cç][aãáà][oõ]e?s?\b/i;
const RE_RASGOS = /\brasgo?s?\b/i;
const RE_USINAGENS_SECAO = /\businagens?\b/i;
const RE_USINAGEM_ENTRADA = /(usinagem\s*param[eé]trica\s*\d*|contorno)/i;

export type SecaoDetectada = {
  furacao: boolean;
  rasgos: boolean;
  usinagens: boolean;
};

function detectarSecoes(linhas: Linha[]): SecaoDetectada {
  const out: SecaoDetectada = { furacao: false, rasgos: false, usinagens: false };
  for (const l of linhas) {
    if (RE_FURACAO.test(l.texto)) out.furacao = true;
    if (RE_RASGOS.test(l.texto)) out.rasgos = true;
    if (RE_USINAGENS_SECAO.test(l.texto) || RE_USINAGEM_ENTRADA.test(l.texto)) out.usinagens = true;
  }
  return out;
}

function extrairOperacoes(linhas: Linha[]): OperacaoExtraida[] {
  const ops: OperacaoExtraida[] = [];
  const faceCtx = extrairFacesPorContexto(linhas);
  let modo: "furo" | "rasgo" | "usinagem" | null = null;
  let ordem = 0;
  let usinagemAtual: OperacaoExtraida | null = null;
  let ordemPonto = 0;

  const flushUsinagem = () => {
    if (usinagemAtual && usinagemAtual.pontos.length > 0) {
      ops.push(usinagemAtual);
    }
    usinagemAtual = null;
    ordemPonto = 0;
  };

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const texto = linha.texto;
    const numericLinha = isNumericCells(linha.cels);

    // 1) Cabeçalhos de seção — testados SEMPRE (mesmo que a linha pareça numérica,
    //    pois o cabeçalho "Rasgos Face 0" às vezes vem junto a tokens numéricos).
    //    Ordem importa: usinagem-entrada antes de usinagens-seção antes de rasgos
    //    antes de furação, porque "UsinagemParametrica01" também matcha usinagens
    //    e "Rasgos" nunca matcha furação.
    if (RE_USINAGEM_ENTRADA.test(texto)) {
      flushUsinagem();
      modo = "usinagem";
      const isContorno = /contorno/i.test(texto);
      usinagemAtual = {
        tipo_operacao: isContorno ? "contorno" : "usinagem_parametrica",
        nome_operacao: texto.replace(/\s+/g, " ").trim().slice(0, 120),
        face: faceCtx.get(i) || null,
        x: null,
        y: null,
        z: null,
        diametro: null,
        profundidade: null,
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
        pontos: [],
        confianca_parser: "alta",
        dados_brutos: { cabecalho: texto },
      };
      continue;
    }
    if (RE_USINAGENS_SECAO.test(texto)) {
      flushUsinagem();
      modo = "usinagem";
      continue;
    }
    if (RE_RASGOS.test(texto)) {
      flushUsinagem();
      modo = "rasgo";
      continue;
    }
    if (RE_FURACAO.test(texto)) {
      flushUsinagem();
      modo = "furo";
      continue;
    }

    if (!modo) continue;
    if (!numericLinha) continue;

    const valores = linha.cels
      .map((c) => toNum(c.str))
      .filter((v): v is number => v != null);
    if (valores.length < 2) continue;

    const faceFromCtx = faceCtx.get(i);
    const faceFromUsin: string | null = usinagemAtual ? usinagemAtual.face : null;
    const face: string | null = faceFromCtx || faceFromUsin;

    if (modo === "furo") {
      // Máquina de estados rígida: dentro de Furação, linha numérica SEMPRE é furo.
      // Se houver token extra (ex.: marcador visual "A" virou 0), usa os 4 últimos
      // números da linha para preservar X | Y | Diam | Prof e nunca converter para rasgo.
      if (valores.length < 4) continue;
      const valoresFuro = ultimosValoresNumericos(valores, 4);
      const [x, y, diam, prof] = [valoresFuro[0], valoresFuro[1], valoresFuro[2] ?? null, valoresFuro[3] ?? null];
      ops.push({
        tipo_operacao: "furo",
        nome_operacao: null,
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
        pontos: [],
        confianca_parser: valoresFuro.length >= 4 ? "alta" : "media",
        dados_brutos: {
          linha: linha.texto,
          valores,
          valores_interpretados: valoresFuro,
          ...(diam != null && diam > 100
            ? { alerta: "Furo com diâmetro suspeito detectado na seção Furação. Verificar parser." }
            : {}),
        },
      });
    } else if (modo === "rasgo") {
      if (valores.length < 5) continue;
      const valoresRasgo = ultimosValoresNumericos(valores, 5);
      const [y, x1, x2, larg, prof] = [
        valoresRasgo[0],
        valoresRasgo[1],
        valoresRasgo[2],
        valoresRasgo[3],
        valoresRasgo[4] ?? null,
      ];
      ops.push({
        tipo_operacao: "rasgo",
        nome_operacao: null,
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
        pontos: [],
        confianca_parser: "alta",
        dados_brutos: { linha: linha.texto, valores, valores_interpretados: valoresRasgo },
      });
    } else if (modo === "usinagem") {
      if (valores.length < 3) continue;
      // Se vier numeric antes de uma entrada explícita, cria uma usinagem implícita
      if (!usinagemAtual) {
        usinagemAtual = {
          tipo_operacao: "usinagem_parametrica",
          nome_operacao: "Usinagem",
          face,
          x: null,
          y: null,
          z: null,
          diametro: null,
          profundidade: null,
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
          pontos: [],
          confianca_parser: "media",
          dados_brutos: { implicita: true },
        };
      }
      // X, Y, Profundidade [+ rótulo "Ponto Inicial/Final" no texto]
      const [x, y, prof] = [valores[0], valores[1], valores[2] ?? null];
      const rotuloMatch = linha.texto.match(/ponto\s+(inicial|final|intermedi[aá]rio)/i);
      usinagemAtual.pontos.push({
        x,
        y,
        profundidade: prof,
        tipo: rotuloMatch ? `Ponto ${rotuloMatch[1]}` : null,
        ordem: ordemPonto++,
      });
      if (prof != null && (usinagemAtual.profundidade == null || prof > usinagemAtual.profundidade)) {
        usinagemAtual.profundidade = prof;
      }
    }
  }
  flushUsinagem();
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

// ---------- Face de alinhamento, indicadores B e faces visuais ----------

export type FaceAlinhamentoDetectada = {
  letra: string;
  regiao: "superior" | "inferior" | "esquerda" | "direita" | "centro" | "desconhecida";
  pagina: number;
  x: number;
  y: number;
};

export type IndicadorBordaDetectado = {
  marcador: string;
  regiao: "superior" | "inferior" | "esquerda" | "direita" | "centro" | "desconhecida";
  pagina: number;
  x: number;
  y: number;
};

type Regiao = "superior" | "inferior" | "esquerda" | "direita" | "centro" | "desconhecida";

function classificarRegiao(
  x: number,
  y: number,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
): Regiao {
  const { xMin, xMax, yMin, yMax } = bounds;
  const w = xMax - xMin;
  const h = yMax - yMin;
  if (w <= 0 || h <= 0) return "desconhecida";
  const nx = (x - xMin) / w;
  const ny = (y - yMin) / h;
  const margem = 0.18;
  const dEsq = nx, dDir = 1 - nx, dInf = ny, dSup = 1 - ny;
  const min = Math.min(dEsq, dDir, dInf, dSup);
  if (min > margem) return "centro";
  if (min === dSup) return "superior";
  if (min === dInf) return "inferior";
  if (min === dEsq) return "esquerda";
  return "direita";
}

function calcularBounds(itens: Item[]) {
  if (!itens.length) return { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const it of itens) {
    if (it.x < xMin) xMin = it.x;
    if (it.x > xMax) xMax = it.x;
    if (it.y < yMin) yMin = it.y;
    if (it.y > yMax) yMax = it.y;
  }
  return { xMin, xMax, yMin, yMax };
}

export function extrairFaceAlinhamento(itens: Item[]): FaceAlinhamentoDetectada | null {
  const bounds = calcularBounds(itens);
  const candidatos = itens.filter((it) => /^A$/.test(it.str.trim()));
  if (!candidatos.length) return null;
  const cx = (bounds.xMin + bounds.xMax) / 2;
  const cy = (bounds.yMin + bounds.yMax) / 2;
  let melhor: Item | null = null;
  let melhorDist = Infinity;
  for (const c of candidatos) {
    const d = Math.hypot(c.x - cx, c.y - cy);
    if (d < melhorDist) { melhorDist = d; melhor = c; }
  }
  if (!melhor) return null;
  return {
    letra: "A",
    regiao: classificarRegiao(melhor.x, melhor.y, bounds),
    pagina: melhor.pagina,
    x: melhor.x,
    y: melhor.y,
  };
}

export function extrairIndicadoresBorda(itens: Item[]): IndicadorBordaDetectado[] {
  const bounds = calcularBounds(itens);
  const out: IndicadorBordaDetectado[] = [];
  const seen = new Set<string>();
  for (const it of itens) {
    const m = it.str.trim().match(/^B(\d{1,2})$/);
    if (!m) continue;
    const marcador = `B${m[1]}`;
    const key = `${marcador}@${it.pagina}:${Math.round(it.x)}:${Math.round(it.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      marcador,
      regiao: classificarRegiao(it.x, it.y, bounds),
      pagina: it.pagina,
      x: it.x,
      y: it.y,
    });
  }
  out.sort((a, b) => a.marcador.localeCompare(b.marcador, undefined, { numeric: true }));
  return out;
}

export function extrairFacesVisuais(linhas: Linha[]): {
  faces_detectadas: string[];
  face_principal_visual: string | null;
} {
  const faces = new Set<string>();
  for (const l of linhas) {
    const matches = l.texto.match(/\b(?:face|lado)\s*([0-5])\b/gi);
    if (matches) {
      for (const m of matches) {
        const n = m.match(/([0-5])/);
        if (n) faces.add(n[1]);
      }
    }
  }
  const counts = new Map<string, number>();
  for (const l of linhas) {
    const m = l.texto.trim().match(/^([0-5])$/);
    if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  let principal: string | null = null;
  let max = 0;
  for (const [face, n] of counts) {
    if (n > max) { max = n; principal = face; }
  }
  return {
    faces_detectadas: Array.from(faces).sort(),
    face_principal_visual: principal,
  };
}

function regiaoToLado(r: Regiao): BordaExtraida["lado"] {
  if (r === "superior" || r === "inferior" || r === "esquerda" || r === "direita") return r;
  return "desconhecido";
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
  const alertas: string[] = [];
  const codigo = parseTechnicalPartCode(fileName);
  if (!codigo) erros.push(`Não consegui extrair código do nome do arquivo: ${fileName}`);
  else logs.push(`Código identificado: ${codigo.codigo_completo} (tipo ${codigo.tipo_peca})`);

  const baseResumo: ResumoParser = {
    furos_detectados: 0,
    rasgos_detectados: 0,
    usinagens_detectadas: 0,
    bordas_detectadas: 0,
    fita_detectada: false,
    nome_detectado: false,
    medidas_detectadas: false,
    face_5_detectada: false,
    pdf_lido: false,
    codigo_detectado: !!codigo,
    total_operacoes: 0,
    faces_com_operacao: [],
  };

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
      alertas,
      resumo: baseResumo,
      dados_brutos: {},
      classificacao: {
        classificacao: "desconhecido",
        motivo: "PDF não pôde ser lido",
        confianca: "baixa",
        sinais: {
          tem_composicoes: false,
          tem_ferragens: false,
          tem_tabela_composicao: false,
          referencias_ferragens: [],
          faces_detectadas: [],
          tem_furacao_tabela: false,
          tem_rasgos_tabela: false,
          tem_face_alinhamento: false,
          tem_ftabs: false,
        },
      },
    };
  }

  baseResumo.pdf_lido = true;
  const linhas = agruparEmLinhas(itens);
  const medidas = extrairMedidas(linhas);
  if (medidas.largura) logs.push(`Medidas: ${medidas.largura} x ${medidas.altura} x ${medidas.espessura}`);
  const nome_peca = extrairNomePeca(linhas, codigo);
  // Detecta se o nome veio de fallback (Tipo + código) ou do PDF de verdade
  const nomeFallback = codigo
    ? `${codigo.tipo_peca} ${codigo.codigo_principal}${codigo.sufixo}`.trim()
    : null;
  const nomeDeFato = !!nome_peca && nome_peca !== nomeFallback;

  let operacoes = extrairOperacoes(linhas);
  logs.push(`Operações detectadas: ${operacoes.length}`);
  operacoes = operacoes.map((op) => inferOperationAnchors(op, medidas.largura, medidas.altura));
  const bordas = extrairBordas(linhas);

  // Face de alinhamento (A), indicadores B1/B2... e faces visuais
  const faceAlinhamento = extrairFaceAlinhamento(itens);
  const indicadoresBorda = extrairIndicadoresBorda(itens);
  const facesVisuais = extrairFacesVisuais(linhas);

  if (faceAlinhamento) {
    logs.push(`Face de alinhamento: ${faceAlinhamento.letra} (${faceAlinhamento.regiao})`);
  }
  if (indicadoresBorda.length) {
    logs.push(
      `Indicadores de borda: ${indicadoresBorda.map((b) => `${b.marcador}(${b.regiao})`).join(", ")}`,
    );
  }

  // Associa cada indicador B# à borda correspondente (ordem do indicador → ordem da borda).
  for (let i = 0; i < bordas.length; i++) {
    const ind = indicadoresBorda[i];
    if (!ind) break;
    bordas[i].indicador_desenho = ind.marcador;
    if (bordas[i].lado === "desconhecido") {
      bordas[i].lado = regiaoToLado(ind.regiao);
    }
  }

  if (bordas.length) logs.push(`Bordas detectadas: ${bordas.map((b) => b.codigo_borda).join(", ")}`);


  const furos = operacoes.filter((o) => o.tipo_operacao === "furo").length;
  const rasgos = operacoes.filter((o) => o.tipo_operacao === "rasgo").length;
  const usinagens = operacoes.filter(
    (o) =>
      o.tipo_operacao === "usinagem_parametrica" ||
      o.tipo_operacao === "contorno" ||
      o.tipo_operacao === "usinagem",
  ).length;
  const facesComOp = Array.from(
    new Set(operacoes.map((o) => (o.face != null ? Number(o.face) : null)).filter((v): v is number => v != null)),
  ).sort();
  const temFace5 = operacoes.some((o) => o.face === "5");
  const medidasOk = medidas.largura != null && medidas.altura != null && medidas.espessura != null;

  // Medidas mínimas: pelo menos largura + altura (espessura pode ser inferida depois)
  const medidasMinimas = medidas.largura != null && medidas.altura != null;
  if (!medidasMinimas) {
    erros.push("Não consegui extrair as medidas mínimas (largura × altura) do PDF.");
  } else if (!medidasOk) {
    alertas.push("Medidas detectadas parcialmente (espessura não identificada).");
  }

  if (!nomeDeFato) alertas.push("Nome da peça não encontrado no PDF (usando tipo + código).");
  if (operacoes.length === 0) {
    alertas.push("Nenhuma furação, rasgo ou usinagem encontrada.");
  }

  // Validação por seção: se a tabela existe mas nada foi extraído, registra alerta de parser.
  const secoes = detectarSecoes(linhas);
  if (secoes.furacao && furos === 0) {
    alertas.push("Tabela de furação detectada, mas nenhum furo foi extraído.");
    erros.push("Furação: tabela encontrada no PDF mas o parser não conseguiu extrair os furos.");
  }
  if (secoes.rasgos && rasgos === 0) {
    alertas.push("Tabela de rasgos detectada, mas nenhum rasgo foi extraído.");
    erros.push("Rasgos: tabela encontrada no PDF mas o parser não conseguiu extrair os rasgos.");
  }
  if (secoes.usinagens && usinagens === 0) {
    alertas.push("Tabela de usinagens detectada, mas nenhuma usinagem foi extraída.");
    erros.push("Usinagens: tabela encontrada no PDF mas o parser não conseguiu extrair as usinagens.");
  }

  // Dentro da seção Furação não há conversão automática para rasgo; apenas alerta.
  for (const op of operacoes) {
    if (op.tipo_operacao === "furo" && op.diametro != null && op.diametro > 100) {
      alertas.push(
        `Furo com diâmetro suspeito detectado na seção Furação (${op.diametro}). Verificar parser.`,
      );
    }
  }

  if (bordas.length === 0) alertas.push("Nenhuma borda/fita detectada no PDF.");

  for (const b of bordas) {
    if (b.lado === "desconhecido") {
      alertas.push(`Fita ${b.codigo_borda ?? ""} detectada, mas lado não identificado.`);
      break;
    }
  }


  const opsBaixaConfianca = operacoes.filter((o) => o.confianca_parser === "baixa").length;
  if (opsBaixaConfianca > 0) {
    alertas.push(`${opsBaixaConfianca} operação(ões) com confiança baixa.`);
  }

  // Face 5 não é tratada como caso especial — é apenas o identificador local do PDF.

  const resumo: ResumoParser = {
    furos_detectados: furos,
    rasgos_detectados: rasgos,
    usinagens_detectadas: usinagens,
    bordas_detectadas: bordas.length,
    fita_detectada: bordas.length > 0,
    nome_detectado: nomeDeFato,
    medidas_detectadas: medidasOk,
    face_5_detectada: temFace5,
    pdf_lido: true,
    codigo_detectado: !!codigo,
    total_operacoes: operacoes.length,
    faces_com_operacao: facesComOp,
  };

  const classificacao = classificarDocumentoPdf(linhas, resumo);
  logs.push(`Classificação: ${classificacao.classificacao} (${classificacao.confianca}) — ${classificacao.motivo}`);

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
    alertas,
    resumo,
    dados_brutos: (() => {
      // Conta ocorrências por marcador (B1/B2/...) para detectar "múltiplos lados".
      const ocorrenciasPorMarcador = indicadoresBorda.reduce<Record<string, number>>((acc, b) => {
        acc[b.marcador] = (acc[b.marcador] ?? 0) + 1;
        return acc;
      }, {});
      const ladosPorMarcador = indicadoresBorda.reduce<Record<string, string[]>>((acc, b) => {
        const arr = acc[b.marcador] ?? (acc[b.marcador] = []);
        if (!arr.includes(b.regiao)) arr.push(b.regiao);
        return acc;
      }, {});
      const indicadores_borda_json = Object.keys(ocorrenciasPorMarcador).map((marcador) => ({
        marcador,
        ocorrencias: ocorrenciasPorMarcador[marcador],
        lados: ladosPorMarcador[marcador] ?? [],
        multiplos_lados: (ladosPorMarcador[marcador] ?? []).length > 1
          || ocorrenciasPorMarcador[marcador] > 1,
        fita_associada: bordas[0]?.codigo_borda ?? null,
      }));
      const b1MultiplosLados = indicadores_borda_json.some(
        (i) => i.marcador === "B1" && i.multiplos_lados,
      );
      if (b1MultiplosLados) {
        alertas.push("B1 detectado em múltiplos lados. Revisar lados se necessário.");
      }
      return {
        total_linhas: linhas.length,
        face_alinhamento: faceAlinhamento?.letra ?? null,
        face_alinhamento_regiao: faceAlinhamento?.regiao ?? null,
        face_alinhamento_detalhe: faceAlinhamento,
        indicadores_borda: indicadoresBorda.map((b) => b.marcador),
        indicadores_borda_detalhe: indicadoresBorda,
        indicadores_borda_json,
        b1_multiplos_lados: b1MultiplosLados,
        faces_detectadas: facesVisuais.faces_detectadas,
        face_principal_visual: facesVisuais.face_principal_visual,
      };
    })(),
    classificacao,
  };
}

// ---------- Classificação do tipo de documento ----------

const PALAVRAS_FERRAGENS = [
  "minifix", "cavilha", "corrediça", "corredica", "pistão", "pistao",
  "dobradiça", "dobradica", "tapa furo", "tapa-furo", "puxador",
  "parafuso", "tampão", "tampao", "suporte de prateleira",
];
const PREFIXOS_FERRAGENS = ["CAV", "PARMF", "TMF15", "DOBTA", "PIST", "CORR", "MINIFIX", "DOB", "PUX"];

function temPalavra(texto: string, palavras: string[]): boolean {
  const t = texto.toLowerCase();
  return palavras.some((p) => t.includes(p.toLowerCase()));
}

export function classificarDocumentoPdf(
  linhas: Linha[],
  resumo: ResumoParser,
): ResultadoClassificacao {
  const textoCompleto = linhas.map((l) => l.texto).join(" \n ");
  const textoLower = textoCompleto.toLowerCase();

  // Sinais de módulo/explodido
  const tem_composicoes = /\bcomposi[cç][oõ]es\b/i.test(textoCompleto);
  const tem_ferragens = /\bferragens?\b/i.test(textoCompleto);
  const tem_tabela_composicao =
    /\bitem\b/i.test(textoCompleto) &&
    /\bc[oó]digo\b/i.test(textoCompleto) &&
    /\bdescri[cç][aã]o\b/i.test(textoCompleto) &&
    /\bqtd\.?\b/i.test(textoCompleto);

  const referencias_ferragens: string[] = [];
  for (const p of PREFIXOS_FERRAGENS) {
    const re = new RegExp(`\\b${p}[A-Z0-9\\-]*\\b`, "g");
    const matches = textoCompleto.match(re);
    if (matches) referencias_ferragens.push(...matches.slice(0, 3));
  }
  const tem_palavra_ferragem = temPalavra(textoLower, PALAVRAS_FERRAGENS);

  // Sinais de peça individual
  const faces_detectadas: number[] = [];
  for (let i = 0; i <= 5; i++) {
    if (new RegExp(`\\b(?:face|lado)\\s*${i}\\b`, "i").test(textoCompleto)) {
      faces_detectadas.push(i);
    }
  }
  const tem_furacao_tabela = /\bfura[cç][aã]o\b|\bfura[cç][oõ]es\b/i.test(textoCompleto);
  const tem_rasgos_tabela = /\brasgos?\b/i.test(textoCompleto);
  const tem_face_alinhamento = /\bface\s+de\s+alinhamento\b/i.test(textoCompleto);
  const tem_ftabs = /\bFTABS[\.\-]/i.test(textoCompleto);

  const sinais = {
    tem_composicoes,
    tem_ferragens,
    tem_tabela_composicao,
    referencias_ferragens: Array.from(new Set(referencias_ferragens)).slice(0, 10),
    faces_detectadas,
    tem_furacao_tabela,
    tem_rasgos_tabela,
    tem_face_alinhamento,
    tem_ftabs,
  };

  // Pontuação: módulo vs peça individual
  let scoreModulo = 0;
  if (tem_composicoes) scoreModulo += 3;
  if (tem_ferragens) scoreModulo += 3;
  if (tem_tabela_composicao) scoreModulo += 2;
  if (referencias_ferragens.length >= 2) scoreModulo += 2;
  if (tem_palavra_ferragem) scoreModulo += 1;

  let scorePeca = 0;
  if (faces_detectadas.length >= 2) scorePeca += 3;
  if (tem_face_alinhamento) scorePeca += 3;
  if (tem_furacao_tabela) scorePeca += 2;
  if (tem_rasgos_tabela) scorePeca += 1;
  if (tem_ftabs) scorePeca += 2;
  if (resumo.medidas_detectadas) scorePeca += 1;
  if (resumo.bordas_detectadas > 0) scorePeca += 1;

  // Decisão
  // Módulo é prioritário quando tem AMBOS "Composições" + "Ferragens"
  if (tem_composicoes && tem_ferragens) {
    return {
      classificacao: "modulo_explodido",
      motivo: "PDF contém tabelas de Composições e Ferragens (módulo/explodido)",
      confianca: "alta",
      sinais,
    };
  }
  if (scoreModulo >= 5 && scoreModulo > scorePeca) {
    return {
      classificacao: "modulo_explodido",
      motivo: `Sinais de módulo (score ${scoreModulo} vs peça ${scorePeca})`,
      confianca: scoreModulo - scorePeca >= 3 ? "alta" : "media",
      sinais,
    };
  }
  if (scorePeca >= 4 && scorePeca > scoreModulo) {
    return {
      classificacao: "peca_individual",
      motivo: `Sinais de peça individual: ${faces_detectadas.length} faces, ${
        tem_face_alinhamento ? "face de alinhamento, " : ""
      }${tem_furacao_tabela ? "tabela furação, " : ""}${tem_ftabs ? "FTABS" : ""}`.replace(/,\s*$/, ""),
      confianca: scorePeca >= 7 ? "alta" : "media",
      sinais,
    };
  }
  if (scorePeca > 0 && scorePeca >= scoreModulo) {
    return {
      classificacao: "peca_individual",
      motivo: `Sinais fracos de peça individual (score ${scorePeca} vs módulo ${scoreModulo})`,
      confianca: "baixa",
      sinais,
    };
  }
  return {
    classificacao: "desconhecido",
    motivo: "Sem sinais claros de peça individual nem de módulo/explodido",
    confianca: "baixa",
    sinais,
  };
}

// ---------- Classificação de status para a UI ----------

export type StatusParser =
  | "ok"
  | "com_alertas"
  | "com_erros"
  | "pendente_revisao"
  | "ignorado_modulo"
  | "pendente_classificacao";

export function classificarStatusParser(r: ResultadoParserPDF): {
  status: StatusParser;
  motivo: string;
} {
  // Classificação do tipo de documento tem prioridade — não cadastrar módulos como peça.
  if (r.classificacao.classificacao === "modulo_explodido") {
    return {
      status: "ignorado_modulo",
      motivo: r.classificacao.motivo,
    };
  }
  if (r.classificacao.classificacao === "desconhecido") {
    return {
      status: "pendente_classificacao",
      motivo: r.classificacao.motivo,
    };
  }
  // Erro crítico: não conseguiu identificar código ou medidas mínimas (largura × altura)
  if (!r.codigo) {
    return { status: "com_erros", motivo: "Código da peça não identificado" };
  }
  const temMedidasMinimas = r.largura_ref != null && r.altura_ref != null;
  if (!temMedidasMinimas) {
    return { status: "com_erros", motivo: "Medidas mínimas (largura × altura) não detectadas" };
  }
  // Acima de qualquer outro erro crítico do parser
  const errosCriticos = r.erros.filter((e) => !/medidas/i.test(e));
  if (errosCriticos.length > 0) {
    return { status: "com_erros", motivo: errosCriticos[0] };
  }
  // Engenharia parcial: tem código + medidas mas nenhuma operação encontrada
  if (r.resumo.total_operacoes === 0) {
    return {
      status: "com_alertas",
      motivo: "Nenhuma furação, rasgo ou usinagem encontrada.",
    };
  }
  // Demais alertas (não críticos)
  if (r.alertas.length > 0) {
    return { status: "com_alertas", motivo: r.alertas[0] };
  }
  return { status: "ok", motivo: "PDF processado sem erros críticos" };
}
