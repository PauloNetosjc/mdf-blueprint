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
