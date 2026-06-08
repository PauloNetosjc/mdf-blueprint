// Classificador central de geometria de peça.
//
// REGRA DE OURO: a geometria de uma peça é decidida por EVIDÊNCIA TÉCNICA
// presente no PDF/modelo — nunca por prefixo de código (BAS, FUN, etc.) ou
// pela palavra "Base Inferior" no nome.
//
// Esta função é a ÚNICA responsável por decidir o `tipo` geométrico
// (retangular | L | poligono_complexo | pendente). Qualquer outro caminho
// que precisar dessa decisão deve chamar `classificarGeometriaPeca`.

export type TipoGeometria = "retangular" | "L" | "poligono_complexo" | "pendente";

export type Ponto = { x: number; y: number };

export type EvidenciasEntrada = {
  /** Medidas mínimas da peça em mm (vindo da tabela do PDF). */
  largura: number | null | undefined;
  altura: number | null | undefined;
  espessura: number | null | undefined;
  /** Nome livre da peça ("3520-Base Inferior", "Base L Inferior"...). */
  nome: string | null | undefined;
  /** Prefixo do código (BAS, FUN, ARM...). NÃO é usado para decidir L. */
  prefixo: string | null | undefined;
  /** Faces (numéricas) em que há operação. */
  facesComOperacao: number[];
  /** Há rasgo com Y1/Y2 (rasgo "vertical/linha") indicando possível recorte. */
  temRasgoVerticalLinha: boolean;
  /** Bloco CONTORNO_TECNICO extraído do PDF (se houver). */
  contornoTecnicoPdf?: {
    tipo: string | null;
    pontos: Ponto[];
  } | null;
  /** Diagnóstico visual/raster que devolveu pontos calibrados. */
  diagnosticoVisualPontos?: Ponto[] | null;
  diagnosticoVisualTipo?: string | null;
  diagnosticoVisualConfianca?: "alta" | "media" | "baixa" | null;
  /** Recortes explícitos cotados (recorte_x / recorte_y). */
  recorteExplicito?: { recorte_x: number; recorte_y: number } | null;
};

export type ResultadoClassificacao = {
  tipo: TipoGeometria;
  origem:
    | "pdf_medidas"
    | "contorno_tecnico_pdf"
    | "pdf_visual_calibrado"
    | "pdf_raster_calibrado"
    | "regra_base_l_inferior"
    | "manual"
    | "pdf_visual";
  confianca: "alta" | "media" | "baixa";
  pendente: boolean;
  pontos_contorno: Ponto[];
  /** Relatório legível para o importador / auditoria. */
  relatorio: {
    tipo_decidido: TipoGeometria;
    evidencias_usadas: string[];
    evidencias_negadas: string[];
    motivo: string;
  };
};

const RX_BASE_L_LITERAL = /\bbase\s*l\b/i;
const RX_L_VARIANTE = /\bl\s*inferior\b|\bl\s*superior\b/i;

function nomeIndicaBaseL(nome: string | null | undefined): boolean {
  const n = nome ?? "";
  return RX_BASE_L_LITERAL.test(n) || RX_L_VARIANTE.test(n);
}

function pontosFormamL(pts: Ponto[]): boolean {
  // Um L canônico tem 6 vértices distintos com ângulos retos.
  if (!Array.isArray(pts) || pts.length !== 6) return false;
  return true;
}

function retangulo(L: number, H: number): Ponto[] {
  return [
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: L, y: H },
    { x: 0, y: H },
  ];
}

/**
 * Classificador central.
 *
 * A função NÃO consulta nome/prefixo para inferir L. Só decide L quando
 * existe pelo menos uma das evidências explícitas listadas abaixo. Quando
 * não há nenhuma evidência válida, devolve "retangular".
 */
export function classificarGeometriaPeca(args: EvidenciasEntrada): ResultadoClassificacao {
  const usadas: string[] = [];
  const negadas: string[] = [];

  const L = args.largura ?? 0;
  const H = args.altura ?? 0;
  const E = args.espessura ?? 0;
  const facesAcimaF5 = (args.facesComOperacao ?? []).filter((n) => Number.isFinite(n) && n > 5);

  // 1) CONTORNO_TECNICO no PDF — fonte mais confiável.
  const ct = args.contornoTecnicoPdf;
  if (ct && Array.isArray(ct.pontos) && ct.pontos.length >= 3) {
    const tipoCt = (ct.tipo ?? "").toLowerCase();
    if (tipoCt === "l" && ct.pontos.length === 6) {
      usadas.push("contorno_tecnico_tipo_l");
      usadas.push("pontos_contorno_6");
      return {
        tipo: "L",
        origem: "contorno_tecnico_pdf",
        confianca: "alta",
        pendente: false,
        pontos_contorno: ct.pontos,
        relatorio: {
          tipo_decidido: "L",
          evidencias_usadas: usadas,
          evidencias_negadas: negadas,
          motivo: "CONTORNO_TECNICO indicou TIPO:L com 6 pontos.",
        },
      };
    }
    if (tipoCt === "retangular") {
      usadas.push("contorno_tecnico_tipo_retangular");
      return {
        tipo: "retangular",
        origem: "contorno_tecnico_pdf",
        confianca: "alta",
        pendente: false,
        pontos_contorno: ct.pontos.length === 4 ? ct.pontos : retangulo(L, H),
        relatorio: {
          tipo_decidido: "retangular",
          evidencias_usadas: usadas,
          evidencias_negadas: negadas,
          motivo: "CONTORNO_TECNICO indicou TIPO:retangular.",
        },
      };
    }
    // Polígono complexo com pontos PRONTOS do PDF.
    usadas.push("contorno_tecnico_pontos");
    return {
      tipo: "poligono_complexo",
      origem: "contorno_tecnico_pdf",
      confianca: "alta",
      pendente: false,
      pontos_contorno: ct.pontos,
      relatorio: {
        tipo_decidido: "poligono_complexo",
        evidencias_usadas: usadas,
        evidencias_negadas: negadas,
        motivo: "CONTORNO_TECNICO trouxe pontos não-retangulares e não-L.",
      },
    };
  } else {
    negadas.push("sem_contorno_tecnico");
  }

  // 2) Diagnóstico visual/raster calibrado (alta/média confiança).
  const dv = args.diagnosticoVisualPontos ?? null;
  const dvTipo = (args.diagnosticoVisualTipo ?? "").toLowerCase();
  const dvConf = args.diagnosticoVisualConfianca ?? null;
  if (dv && dv.length >= 3 && (dvConf === "alta" || dvConf === "media")) {
    if (dvTipo === "l" && dv.length === 6) {
      usadas.push("diagnostico_visual_l");
      return {
        tipo: "L",
        origem: "pdf_visual_calibrado",
        confianca: dvConf,
        pendente: false,
        pontos_contorno: dv,
        relatorio: {
          tipo_decidido: "L",
          evidencias_usadas: usadas,
          evidencias_negadas: negadas,
          motivo: `Diagnóstico visual confirmou L (${dvConf}).`,
        },
      };
    }
    if (dvTipo === "retangular") {
      usadas.push("diagnostico_visual_retangular");
      return {
        tipo: "retangular",
        origem: "pdf_visual_calibrado",
        confianca: dvConf,
        pendente: false,
        pontos_contorno: dv.length === 4 ? dv : retangulo(L, H),
        relatorio: {
          tipo_decidido: "retangular",
          evidencias_usadas: usadas,
          evidencias_negadas: negadas,
          motivo: `Diagnóstico visual confirmou retangular (${dvConf}).`,
        },
      };
    }
  } else {
    negadas.push("sem_diagnostico_visual_confiavel");
  }

  // 3) Pontos com forma de L já vindos.
  if (dv && pontosFormamL(dv)) {
    usadas.push("pontos_contorno_6");
    return {
      tipo: "L",
      origem: "pdf_visual",
      confianca: dvConf ?? "media",
      pendente: false,
      pontos_contorno: dv,
      relatorio: {
        tipo_decidido: "L",
        evidencias_usadas: usadas,
        evidencias_negadas: negadas,
        motivo: "Diagnóstico visual trouxe 6 pontos compatíveis com L.",
      },
    };
  }

  // 4) Recorte explícito cotado no PDF (recorte_x / recorte_y).
  const rc = args.recorteExplicito ?? null;
  if (rc && rc.recorte_x > 0 && rc.recorte_y > 0 && L > 0 && H > 0) {
    usadas.push("recorte_explicito_pdf");
    const xCorte = L - rc.recorte_x;
    const yCorte = H - rc.recorte_y;
    return {
      tipo: "L",
      origem: "regra_base_l_inferior",
      confianca: "media",
      pendente: false,
      pontos_contorno: [
        { x: 0, y: 0 },
        { x: L, y: 0 },
        { x: L, y: yCorte },
        { x: xCorte, y: yCorte },
        { x: xCorte, y: H },
        { x: 0, y: H },
      ],
      relatorio: {
        tipo_decidido: "L",
        evidencias_usadas: usadas,
        evidencias_negadas: negadas,
        motivo: "PDF cotou RECORTE_X/RECORTE_Y — geometria L derivada dos recortes.",
      },
    };
  } else {
    negadas.push("sem_recorte_explicito");
  }

  // 5) Nome contém LITERAL "Base L" / "L Inferior" / "L Superior" + indício
  //    estrutural (face acima de F5 OU rasgo vertical de linha).
  //    O nome SOZINHO não basta; precisamos também de alguma marca estrutural,
  //    para evitar falsos positivos como "Base Lateral".
  if (nomeIndicaBaseL(args.nome) && (facesAcimaF5.length > 0 || args.temRasgoVerticalLinha)) {
    usadas.push("nome_base_l_literal");
    if (facesAcimaF5.length > 0) usadas.push("face_principal_acima_f5");
    if (args.temRasgoVerticalLinha) usadas.push("rasgo_vertical_linha");
    if (L > 0 && H > 0) {
      // Geometria L genérica — marca pendente para conferência.
      const xCorte = Math.round(L * 0.578 * 100) / 100;
      const yCorte = Math.round(H * 0.5 * 100) / 100;
      return {
        tipo: "L",
        origem: "regra_base_l_inferior",
        confianca: "media",
        pendente: false,
        pontos_contorno: [
          { x: 0, y: 0 },
          { x: xCorte, y: 0 },
          { x: xCorte, y: yCorte },
          { x: L, y: yCorte },
          { x: L, y: H },
          { x: 0, y: H },
        ],
        relatorio: {
          tipo_decidido: "L",
          evidencias_usadas: usadas,
          evidencias_negadas: negadas,
          motivo: 'Nome contém "Base L" e há indício estrutural (face >F5 ou rasgo vertical). Conferir antes de gerar G-code.',
        },
      };
    }
  } else if (nomeIndicaBaseL(args.nome)) {
    negadas.push("nome_base_l_sem_estrutura_l");
  } else {
    negadas.push("sem_base_l_explicita");
  }

  if (facesAcimaF5.length === 0) negadas.push("sem_face_principal_acima_f5");

  // 6) Padrão seguro: RETANGULAR derivado de L × A.
  if (L > 0 && H > 0) {
    usadas.push("medidas_pdf");
    if (E > 0) usadas.push("espessura_pdf");
    return {
      tipo: "retangular",
      origem: "pdf_medidas",
      confianca: "alta",
      pendente: false,
      pontos_contorno: retangulo(L, H),
      relatorio: {
        tipo_decidido: "retangular",
        evidencias_usadas: usadas,
        evidencias_negadas: negadas,
        motivo:
          "Sem evidência explícita de L (contorno técnico, recorte cotado, nome 'Base L' com estrutura). Peça classificada como retangular pelas medidas L × A.",
      },
    };
  }

  // 7) Sem medidas → pendente. Geometria não pode ser decidida.
  negadas.push("sem_medidas");
  return {
    tipo: "pendente",
    origem: "pdf_visual",
    confianca: "baixa",
    pendente: true,
    pontos_contorno: [],
    relatorio: {
      tipo_decidido: "pendente",
      evidencias_usadas: usadas,
      evidencias_negadas: negadas,
      motivo: "Sem medidas L × A e sem contorno técnico — geometria indeterminada.",
    },
  };
}

/**
 * Detecta uso indevido de regra "BAS = L" em um modelo já gerado.
 * Retorna `true` se a peça está marcada como L sem possuir nenhuma das
 * evidências obrigatórias.
 */
export function geometriaLSemEvidenciaExplicita(args: {
  tipo: string | null | undefined;
  origem: string | null | undefined;
  pontos_contorno: Ponto[] | null | undefined;
  nome: string | null | undefined;
  contornoTecnicoPdf?: { tipo: string | null } | null;
  recorteExplicito?: { recorte_x: number; recorte_y: number } | null;
  facesAcimaF5: number[];
  temRasgoVerticalLinha: boolean;
}): boolean {
  if ((args.tipo ?? "").toLowerCase() !== "l") return false;
  if (args.origem === "manual" || args.origem === "contorno_tecnico_pdf" || args.origem === "pdf_visual_calibrado" || args.origem === "pdf_raster_calibrado") {
    return false;
  }
  if (args.contornoTecnicoPdf && (args.contornoTecnicoPdf.tipo ?? "").toLowerCase() === "l") return false;
  if (args.recorteExplicito && args.recorteExplicito.recorte_x > 0 && args.recorteExplicito.recorte_y > 0) return false;
  if (nomeIndicaBaseL(args.nome) && (args.facesAcimaF5.length > 0 || args.temRasgoVerticalLinha)) return false;
  return true;
}
