// Sugestões de calibração de pós-processador comparando original vs gerado
import { analisar, type Resumo } from "./gcode-diff";

export type Sugestao = {
  categoria: string;
  descricao: string;
  exemplo_original?: string;
  exemplo_gerado?: string;
  severidade: "info" | "warning" | "erro";
};

export function gerarSugestoes(original: string, gerado: string): Sugestao[] {
  const sugs: Sugestao[] = [];
  const oU = original.toUpperCase();
  const gU = gerado.toUpperCase();

  // G00 vs G0
  if (/\bG00\b/.test(oU) && /\bG0\b/.test(gU) && !/\bG00\b/.test(gU)) {
    sugs.push({
      categoria: "Notação de comandos",
      descricao: "Original usa G00/G01/G02 com dois dígitos; gerado usa G0/G1/G2.",
      exemplo_original: "G00 X0 Y0",
      exemplo_gerado: "G0 X0 Y0",
      severidade: "warning",
    });
  }

  // M06 vs M6
  if (/\bM06\b/.test(oU) && /\bM6\b/.test(gU) && !/\bM06\b/.test(gU)) {
    sugs.push({
      categoria: "Notação de comandos",
      descricao: "Original usa M06/M03/M05; gerado usa M6/M3/M5.",
      exemplo_original: "M06 T1",
      exemplo_gerado: "M6 T1",
      severidade: "warning",
    });
  }

  // Comentários ( ) vs ;
  const oTemPar = /\([^)]*\)/.test(original);
  const gTemPar = /\([^)]*\)/.test(gerado);
  const oTemSemi = /;\s*\w/.test(original);
  const gTemSemi = /;\s*\w/.test(gerado);
  if (oTemPar && !gTemPar && gTemSemi) {
    sugs.push({
      categoria: "Comentários",
      descricao: "Original usa comentários entre parênteses (...); gerado usa ponto-e-vírgula.",
      severidade: "info",
    });
  }

  // Vírgula decimal
  if (/\b\d+,\d/.test(original)) {
    sugs.push({
      categoria: "Decimal",
      descricao: "Original usa vírgula como separador decimal; gerado usa ponto.",
      exemplo_original: "X12,50",
      exemplo_gerado: "X12.50",
      severidade: "warning",
    });
  }

  // Casas decimais
  const casasOri = casasDecimaisMedias(original);
  const casasGer = casasDecimaisMedias(gerado);
  if (casasOri && casasGer && Math.abs(casasOri - casasGer) >= 1) {
    sugs.push({
      categoria: "Precisão decimal",
      descricao: `Original usa ~${casasOri.toFixed(1)} casas decimais; gerado usa ~${casasGer.toFixed(1)}.`,
      severidade: "info",
    });
  }

  // Altura segura
  const zOri = maiorZ(original);
  const zGer = maiorZ(gerado);
  if (zOri !== null && zGer !== null && Math.abs(zOri - zGer) > 2) {
    sugs.push({
      categoria: "Altura segura Z",
      descricao: `Altura segura difere: original Z máx ${zOri}, gerado Z máx ${zGer}.`,
      severidade: "warning",
    });
  }

  // Cabeçalho / rodapé
  const linhasOri = original.split(/\r?\n/);
  const linhasGer = gerado.split(/\r?\n/);
  const cabOri = linhasOri.slice(0, 5).join("\n").toUpperCase();
  const cabGer = linhasGer.slice(0, 5).join("\n").toUpperCase();
  if (cabOri !== cabGer && cabOri.trim() && cabGer.trim()) {
    sugs.push({
      categoria: "Cabeçalho",
      descricao: "Cabeçalho (primeiras linhas) difere — pode exigir comandos específicos da máquina.",
      exemplo_original: linhasOri.slice(0, 3).join(" | "),
      exemplo_gerado: linhasGer.slice(0, 3).join(" | "),
      severidade: "warning",
    });
  }
  const rodOri = linhasOri.slice(-5).join("\n").toUpperCase();
  const rodGer = linhasGer.slice(-5).join("\n").toUpperCase();
  if (rodOri !== rodGer && rodOri.trim() && rodGer.trim()) {
    sugs.push({
      categoria: "Rodapé",
      descricao: "Rodapé (últimas linhas) difere — verifique M30/M2 e desligamento do spindle.",
      severidade: "info",
    });
  }

  // Diferença de comandos M usados
  const rO = analisar(original);
  const rG = analisar(gerado);
  const mO = new Set(Object.keys(rO.comandosM));
  const mG = new Set(Object.keys(rG.comandosM));
  const faltam = [...mO].filter((m) => !mG.has(m));
  const sobram = [...mG].filter((m) => !mO.has(m));
  if (faltam.length) {
    sugs.push({
      categoria: "Comandos M",
      descricao: `Original usa comandos M ausentes no gerado: ${faltam.join(", ")}`,
      severidade: "erro",
    });
  }
  if (sobram.length) {
    sugs.push({
      categoria: "Comandos M",
      descricao: `Gerado usa comandos M ausentes no original: ${sobram.join(", ")}`,
      severidade: "warning",
    });
  }

  return sugs;
}

function casasDecimaisMedias(s: string): number | null {
  const m = s.match(/\b\d+\.(\d+)/g);
  if (!m || !m.length) return null;
  const soma = m.reduce((a, x) => a + (x.split(".")[1]?.length ?? 0), 0);
  return soma / m.length;
}

function maiorZ(s: string): number | null {
  const m = [...s.matchAll(/Z(-?\d+(?:\.\d+)?)/gi)];
  if (!m.length) return null;
  return Math.max(...m.map((x) => parseFloat(x[1])));
}

export type Tolerancia = { xy: number; z: number; feed: number; rpm: number };

export type ComparacaoOperacoes = {
  equivalentes: number;
  divergentes: number;
  so_original: number;
  so_gerado: number;
  total_original: number;
  total_gerado: number;
};

export function compararResumos(rO: Resumo, rG: Resumo, _tol: Tolerancia): ComparacaoOperacoes {
  return {
    equivalentes: 0,
    divergentes: 0,
    so_original: Math.max(0, rO.totalLinhas - rG.totalLinhas),
    so_gerado: Math.max(0, rG.totalLinhas - rO.totalLinhas),
    total_original: rO.totalLinhas,
    total_gerado: rG.totalLinhas,
  };
}
