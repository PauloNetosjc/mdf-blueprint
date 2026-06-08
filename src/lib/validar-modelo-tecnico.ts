// Validador determinístico do modelo técnico extraído do PDF.
//
// O fluxo é: PDF → parser → modelo_tecnico_json → VALIDAR → visualizador.
// Enquanto o JSON não passar nas regras determinísticas (especialmente o
// fixture BAS0485A), o visualizador deve mostrar o erro e NÃO desenhar.

export type OperacaoLite = {
  tipo: string | null | undefined;
  face: number | string | null | undefined;
  x?: number | null;
  y?: number | null;
  diametro?: number | null;
  profundidade?: number | null;
  parametrico?: unknown;
};

export type GeometriaLite = {
  tipo?: string | null;
  origem?: string | null;
  face_principal?: string | number | null;
  pontos_contorno?: { x: number; y: number }[];
};

export type ModeloTecnicoLite = {
  codigo?: string | null;
  geometria?: GeometriaLite | null;
  faces_operacionais?: number[];
  faces_visuais?: number[];
  operacoes: OperacaoLite[];
  parametrizacao?: unknown;
  face_alinhamento?: string | null;
  medidas?: { largura?: number | null; altura?: number | null; espessura?: number | null };
  bordas?: Array<{
    codigo_borda?: string | null;
    indicador_desenho?: string | null;
    quantidade_m?: number | null;
  }>;
};


export type ResultadoValidacao = {
  ok: boolean;
  erros: string[];
  avisos: string[];
  detalhes: {
    operacoes_total: number;
    furos_total: number;
    rasgos_total: number;
    usinagens_total: number;
    por_face: Record<string, { furos: number; rasgos: number; usinagens: number; total: number }>;
    pontos_contorno: number;
  };
};

function faceKey(face: OperacaoLite["face"]): string {
  if (face == null || face === "") return "0";
  return String(face);
}

export function calcularDetalhesModelo(m: ModeloTecnicoLite): ResultadoValidacao["detalhes"] {
  const por_face: ResultadoValidacao["detalhes"]["por_face"] = {};
  let furos = 0, rasgos = 0, usinagens = 0;
  for (const op of m.operacoes ?? []) {
    const k = faceKey(op.face);
    const slot = por_face[k] ?? { furos: 0, rasgos: 0, usinagens: 0, total: 0 };
    slot.total++;
    if (op.tipo === "furo") { slot.furos++; furos++; }
    else if (op.tipo === "rasgo") { slot.rasgos++; rasgos++; }
    else { slot.usinagens++; usinagens++; }
    por_face[k] = slot;
  }
  return {
    operacoes_total: (m.operacoes ?? []).length,
    furos_total: furos,
    rasgos_total: rasgos,
    usinagens_total: usinagens,
    por_face,
    pontos_contorno: m.geometria?.pontos_contorno?.length ?? 0,
  };
}

/** Validação genérica que vale para todas as peças. */
export function validarModeloTecnico(m: ModeloTecnicoLite): ResultadoValidacao {
  const erros: string[] = [];
  const avisos: string[] = [];
  const detalhes = calcularDetalhesModelo(m);

  if (detalhes.por_face["0"]?.total) {
    erros.push(
      `Face 0 não pode ter operações (recebeu ${detalhes.por_face["0"].total}). Indica falha na detecção de "Face N" no parser.`,
    );
  }

  for (const op of m.operacoes ?? []) {
    const tipoLower = (op.tipo ?? "").toLowerCase();
    if (
      tipoLower === "contorno" ||
      tipoLower === "contorno_tecnico" ||
      tipoLower === "usinagem_parametrica" &&
        m.geometria?.origem === "contorno_tecnico_pdf"
    ) {
      // permitido apenas se NÃO for o bloco CONTORNO_TECNICO indo virar operação
      // detecta pelo nome
    }
  }

  const g = m.geometria;
  if (g?.origem === "contorno_tecnico_pdf") {
    if ((g.pontos_contorno?.length ?? 0) < 3) {
      erros.push(`Geometria veio do CONTORNO_TECNICO mas tem ${g.pontos_contorno?.length ?? 0} pontos.`);
    }
    if ((g.tipo ?? "").toUpperCase() === "L" && (g.pontos_contorno?.length ?? 0) !== 6) {
      erros.push(`Base L deveria ter exatamente 6 pontos no contorno, recebeu ${g.pontos_contorno?.length ?? 0}.`);
    }
  }

  // Parametrização (âncoras aos topos) — aviso, não erro
  const semParam = (m.operacoes ?? []).filter((o) => !o.parametrico).length;
  if (semParam > 0) {
    avisos.push(
      `${semParam} operação(ões) sem parametrização — conferir antes de gerar CNC.`,
    );
  }
  if (!m.parametrizacao) {
    avisos.push("Modelo sem parametrização base — peça não acompanhará mudanças de tamanho.");
  }

  return { ok: erros.length === 0, erros, avisos, detalhes };
}


// ---------- Fixture / teste obrigatório: BAS0485A ----------

export const EXPECTED_BAS0485A = {
  codigo: "BAS0485A",
  geometria: {
    tipo: "L",
    face_principal: "7",
    origem: "contorno_tecnico_pdf",
    pontos_contorno: [
      { x: 0, y: 0 },
      { x: 543, y: 0 },
      { x: 543, y: 396.5 },
      { x: 939.5, y: 396.5 },
      { x: 939.5, y: 939.5 },
      { x: 0, y: 939.5 },
    ],
  },
  faces_operacionais: [2, 5, 7],
  faces_visuais: [1, 2, 3, 4, 5, 6, 7],
  por_face: {
    "2": { furos: 5, rasgos: 0 },
    "5": { furos: 5, rasgos: 0 },
    "7": { furos: 12, rasgos: 2 },
  },
  furos_total: 22,
  rasgos_total: 2,
} as const;

export function validarParserBAS0485A(m: ModeloTecnicoLite): ResultadoValidacao {
  const base = validarModeloTecnico(m);
  const erros = [...base.erros];
  const avisos = [...base.avisos];
  const d = base.detalhes;

  const g = m.geometria;
  if ((g?.tipo ?? "").toUpperCase() !== "L") {
    erros.push(`Geometria esperada tipo=L, recebeu ${g?.tipo ?? "—"}.`);
  }
  if (String(g?.face_principal ?? "") !== "7") {
    erros.push(`FACE_PRINCIPAL esperada 7, recebeu ${g?.face_principal ?? "—"}.`);
  }
  if (g?.origem !== "contorno_tecnico_pdf") {
    erros.push(`Origem da geometria esperada "contorno_tecnico_pdf", recebeu "${g?.origem ?? "—"}".`);
  }
  if (d.pontos_contorno !== 6) {
    erros.push(`PONTOS_CONTORNO esperava 6, recebeu ${d.pontos_contorno}.`);
  } else {
    const esperado = EXPECTED_BAS0485A.geometria.pontos_contorno;
    for (let i = 0; i < esperado.length; i++) {
      const p = g!.pontos_contorno![i];
      if (Math.abs(p.x - esperado[i].x) > 0.01 || Math.abs(p.y - esperado[i].y) > 0.01) {
        erros.push(
          `Ponto ${i + 1} esperado (${esperado[i].x}, ${esperado[i].y}), recebeu (${p.x}, ${p.y}). A ORDEM DOS PONTOS NÃO PODE SER ALTERADA.`,
        );
      }
    }
  }

  const esp = EXPECTED_BAS0485A.por_face;
  for (const f of ["2", "5", "7"] as const) {
    const got = d.por_face[f] ?? { furos: 0, rasgos: 0, total: 0 };
    if (got.furos !== esp[f].furos) {
      erros.push(`Face ${f}: esperava ${esp[f].furos} furos, recebeu ${got.furos}.`);
    }
    if (got.rasgos !== esp[f].rasgos) {
      erros.push(`Face ${f}: esperava ${esp[f].rasgos} rasgos, recebeu ${got.rasgos}.`);
    }
  }
  if (d.furos_total !== EXPECTED_BAS0485A.furos_total) {
    erros.push(`Total de furos esperado ${EXPECTED_BAS0485A.furos_total}, recebeu ${d.furos_total}.`);
  }
  if (d.rasgos_total !== EXPECTED_BAS0485A.rasgos_total) {
    erros.push(`Total de rasgos esperado ${EXPECTED_BAS0485A.rasgos_total}, recebeu ${d.rasgos_total}.`);
  }
  if (d.usinagens_total > 0) {
    erros.push(`Esperava 0 usinagens, recebeu ${d.usinagens_total} (CONTORNO_TECNICO pode estar virando operação).`);
  }

  return { ok: erros.length === 0, erros, avisos, detalhes: d };
}


// ---------- Fixture / teste obrigatório: BAS1101A ----------
//
// Peça retangular 189 × 580 × 15 com:
//   - 5 furos na Face 1, 5 furos na Face 3
//   - 4 furos + 1 rasgo na Face 5
//   - Fita FTABS.0.45.19.100, quantidade ≈ 0.458 m
//   - Face de alinhamento "A"

export const EXPECTED_BAS1101A = {
  codigo: "BAS1101A",
  medidas: { largura: 189, altura: 580, espessura: 15 },
  face_alinhamento: "A",
  fita: { codigo: "FTABS.0.45.19.100", quantidade_m: 0.458 },
  por_face: {
    "1": { furos: 5, rasgos: 0 },
    "3": { furos: 5, rasgos: 0 },
    "5": { furos: 4, rasgos: 1 },
  },
  furos_total: 14,
  rasgos_total: 1,
} as const;

export function validarParserBAS1101A(m: ModeloTecnicoLite): ResultadoValidacao {
  const base = validarModeloTecnico(m);
  const erros = [...base.erros];
  const avisos = [...base.avisos];
  const d = base.detalhes;

  // Medidas (largura/altura não podem estar invertidas).
  const med = m.medidas ?? {};
  if (med.largura != null && Math.abs((med.largura ?? 0) - EXPECTED_BAS1101A.medidas.largura) > 0.5) {
    erros.push(`Largura esperada ${EXPECTED_BAS1101A.medidas.largura}, recebeu ${med.largura}.`);
  }
  if (med.altura != null && Math.abs((med.altura ?? 0) - EXPECTED_BAS1101A.medidas.altura) > 0.5) {
    erros.push(`Altura esperada ${EXPECTED_BAS1101A.medidas.altura}, recebeu ${med.altura}.`);
  }
  if (med.espessura != null && Math.abs((med.espessura ?? 0) - EXPECTED_BAS1101A.medidas.espessura) > 0.5) {
    avisos.push(`Espessura esperada ${EXPECTED_BAS1101A.medidas.espessura}, recebeu ${med.espessura}.`);
  }

  // Face de alinhamento.
  if ((m.face_alinhamento ?? "") !== EXPECTED_BAS1101A.face_alinhamento) {
    erros.push(`Face de alinhamento esperada "${EXPECTED_BAS1101A.face_alinhamento}", recebeu "${m.face_alinhamento ?? "—"}".`);
  }

  // Operações por face.
  for (const f of ["1", "3", "5"] as const) {
    const esp = EXPECTED_BAS1101A.por_face[f];
    const got = d.por_face[f] ?? { furos: 0, rasgos: 0, total: 0 };
    if (got.furos !== esp.furos) {
      erros.push(`Face ${f}: esperava ${esp.furos} furos, recebeu ${got.furos}.`);
    }
    if (got.rasgos !== esp.rasgos) {
      erros.push(`Face ${f}: esperava ${esp.rasgos} rasgos, recebeu ${got.rasgos}.`);
    }
  }
  if (d.furos_total !== EXPECTED_BAS1101A.furos_total) {
    erros.push(`Total de furos esperado ${EXPECTED_BAS1101A.furos_total}, recebeu ${d.furos_total}.`);
  }
  if (d.rasgos_total !== EXPECTED_BAS1101A.rasgos_total) {
    erros.push(`Total de rasgos esperado ${EXPECTED_BAS1101A.rasgos_total}, recebeu ${d.rasgos_total}.`);
  }
  if (d.usinagens_total > 0) {
    erros.push(`Esperava 0 usinagens, recebeu ${d.usinagens_total}.`);
  }

  // Fita esperada presente nas bordas extraídas.
  const bordas = m.bordas ?? [];
  const fitaEsperada = EXPECTED_BAS1101A.fita.codigo.toUpperCase();
  const fitaEncontrada = bordas.find(
    (b) => (b.codigo_borda ?? "").toUpperCase() === fitaEsperada,
  );
  if (!fitaEncontrada) {
    erros.push(`Fita ${fitaEsperada} não detectada nas bordas extraídas.`);
  } else if (
    fitaEncontrada.quantidade_m == null ||
    Math.abs(fitaEncontrada.quantidade_m - EXPECTED_BAS1101A.fita.quantidade_m) > 0.05
  ) {
    avisos.push(
      `Quantidade de fita esperada ≈ ${EXPECTED_BAS1101A.fita.quantidade_m} m, recebeu ${
        fitaEncontrada.quantidade_m ?? "—"
      } m.`,
    );
  }

  return { ok: erros.length === 0, erros, avisos, detalhes: d };
}


// ---------- Fixture / teste obrigatório: BAS3520A ----------
//
// Peça RETANGULAR 569 × 580 × 15 com:
//   - 5 furos na Face 1
//   - 5 furos na Face 3
//   - 4 furos + 1 rasgo (ponta a ponta: X1=0, X2=569, Y=560.75) na Face 5
//   - Borda B1 = FTABS.0.45.19.100, quantidade ≈ 1.218 m
//   - Face de alinhamento "A"
// Esta peça é "Base Inferior" comum — NÃO é Base L. Serve para garantir que
// a regra genérica "BAS = L" foi removida.

export const EXPECTED_BAS3520A = {
  codigo: "BAS3520A",
  medidas: { largura: 569, altura: 580, espessura: 15 },
  face_alinhamento: "A",
  fita: { codigo: "FTABS.0.45.19.100", quantidade_m: 1.218 },
  por_face: {
    "1": { furos: 5, rasgos: 0 },
    "3": { furos: 5, rasgos: 0 },
    "5": { furos: 4, rasgos: 1 },
  },
  furos_total: 14,
  rasgos_total: 1,
} as const;

export function validarParserBAS3520A(m: ModeloTecnicoLite): ResultadoValidacao {
  const base = validarModeloTecnico(m);
  const erros = [...base.erros];
  const avisos = [...base.avisos];
  const d = base.detalhes;

  // Geometria DEVE ser retangular (não L).
  const g = m.geometria;
  if ((g?.tipo ?? "").toLowerCase() === "l") {
    erros.push(`Geometria classificada como L, mas BAS3520A é retangular.`);
  } else if ((g?.tipo ?? "").toLowerCase() !== "retangular") {
    erros.push(`Geometria esperada "retangular", recebeu "${g?.tipo ?? "—"}".`);
  }
  if (d.pontos_contorno !== 0 && d.pontos_contorno !== 4) {
    avisos.push(`Contorno retangular esperava 0 ou 4 pontos, recebeu ${d.pontos_contorno}.`);
  }

  const med = m.medidas ?? {};
  if (med.largura != null && Math.abs((med.largura ?? 0) - EXPECTED_BAS3520A.medidas.largura) > 0.5) {
    erros.push(`Largura esperada ${EXPECTED_BAS3520A.medidas.largura}, recebeu ${med.largura}.`);
  }
  if (med.altura != null && Math.abs((med.altura ?? 0) - EXPECTED_BAS3520A.medidas.altura) > 0.5) {
    erros.push(`Altura esperada ${EXPECTED_BAS3520A.medidas.altura}, recebeu ${med.altura}.`);
  }

  if ((m.face_alinhamento ?? "") !== EXPECTED_BAS3520A.face_alinhamento) {
    erros.push(`Face de alinhamento esperada "${EXPECTED_BAS3520A.face_alinhamento}", recebeu "${m.face_alinhamento ?? "—"}".`);
  }

  for (const f of ["1", "3", "5"] as const) {
    const esp = EXPECTED_BAS3520A.por_face[f];
    const got = d.por_face[f] ?? { furos: 0, rasgos: 0, total: 0 };
    if (got.furos !== esp.furos) {
      erros.push(`Face ${f}: esperava ${esp.furos} furos, recebeu ${got.furos}.`);
    }
    if (got.rasgos !== esp.rasgos) {
      erros.push(`Face ${f}: esperava ${esp.rasgos} rasgos, recebeu ${got.rasgos}.`);
    }
  }
  if (d.furos_total !== EXPECTED_BAS3520A.furos_total) {
    erros.push(`Total de furos esperado ${EXPECTED_BAS3520A.furos_total}, recebeu ${d.furos_total}.`);
  }
  if (d.rasgos_total !== EXPECTED_BAS3520A.rasgos_total) {
    erros.push(`Total de rasgos esperado ${EXPECTED_BAS3520A.rasgos_total}, recebeu ${d.rasgos_total}.`);
  }
  if (d.usinagens_total > 0) {
    erros.push(`Esperava 0 usinagens, recebeu ${d.usinagens_total}.`);
  }

  const bordas = m.bordas ?? [];
  const fitaEsperada = EXPECTED_BAS3520A.fita.codigo.toUpperCase();
  const fitaEncontrada = bordas.find(
    (b) => (b.codigo_borda ?? "").toUpperCase() === fitaEsperada,
  );
  if (!fitaEncontrada) {
    erros.push(`Fita ${fitaEsperada} não detectada nas bordas extraídas.`);
  } else if (
    fitaEncontrada.quantidade_m == null ||
    Math.abs(fitaEncontrada.quantidade_m - EXPECTED_BAS3520A.fita.quantidade_m) > 0.05
  ) {
    avisos.push(
      `Quantidade de fita esperada ≈ ${EXPECTED_BAS3520A.fita.quantidade_m} m, recebeu ${
        fitaEncontrada.quantidade_m ?? "—"
      } m.`,
    );
  }

  return { ok: erros.length === 0, erros, avisos, detalhes: d };
}
