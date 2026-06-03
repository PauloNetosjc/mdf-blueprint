// G-code parser - Fase 7
// Lê um arquivo .nc / .gcode e extrai comandos + operações inferidas.

export type GcodeLinha = {
  linha: number;
  raw: string;
  comando: string | null;
  ferramenta: string | null;
  spindle: number | null;
  avanco: number | null;
  x: number | null;
  y: number | null;
  z: number | null;
  comentario: string | null;
  tipo_inferido: TipoOperacaoInferido;
};

export type TipoOperacaoInferido =
  | "movimento_rapido"
  | "movimento_linear"
  | "arco"
  | "furacao"
  | "rasgo"
  | "corte"
  | "rebaixo"
  | "contorno"
  | "troca_ferramenta"
  | "spindle_on"
  | "spindle_off"
  | "fim_programa"
  | "configuracao"
  | "comentario"
  | "desconhecido";

export type OperacaoInferida = {
  tipo: TipoOperacaoInferido;
  x: number | null;
  y: number | null;
  z: number | null;
  profundidade: number | null;
  diametro: number | null;
  ferramenta: string | null;
  ordem: number;
  confianca: "alta" | "media" | "baixa";
  origem_linha: number;
};

const RX_TOKENS = /([A-Z])(-?\d+(?:\.\d+)?)/g;
const RX_COMENT = /\(([^)]*)\)|;(.*)$/;

function parseTokens(raw: string) {
  const out: Record<string, number> = {};
  let m;
  while ((m = RX_TOKENS.exec(raw)) !== null) {
    out[m[1]] = parseFloat(m[2]);
  }
  return out;
}

export function parseGcode(conteudo: string): {
  linhas: GcodeLinha[];
  operacoes: OperacaoInferida[];
  ferramentas_usadas: string[];
  total_comandos: number;
} {
  const linhas: GcodeLinha[] = [];
  const operacoes: OperacaoInferida[] = [];
  const ferramentas_usadas = new Set<string>();

  let ferramenta_atual: string | null = null;
  let spindle_atual: number | null = null;
  let avanco_atual: number | null = null;
  let x_atual: number | null = null;
  let y_atual: number | null = null;
  let z_atual: number | null = null;
  let ordem = 0;
  let total_comandos = 0;

  const rawLinhas = conteudo.split(/\r?\n/);
  for (let i = 0; i < rawLinhas.length; i++) {
    const raw = rawLinhas[i];
    const trim = raw.trim();
    if (!trim) continue;

    const com = RX_COMENT.exec(trim);
    const comentario = com ? (com[1] ?? com[2] ?? "").trim() : null;
    const sem_com = trim.replace(RX_COMENT, "").trim().toUpperCase();

    const tk = parseTokens(sem_com);

    let comando: string | null = null;
    if ("G" in tk) comando = `G${tk.G}`;
    else if ("M" in tk) comando = `M${tk.M}`;
    else if ("T" in tk) comando = `T${tk.T}`;

    if ("T" in tk) {
      ferramenta_atual = `T${tk.T}`;
      ferramentas_usadas.add(ferramenta_atual);
    }
    if ("S" in tk) spindle_atual = tk.S;
    if ("F" in tk) avanco_atual = tk.F;

    const x_novo = "X" in tk ? tk.X : null;
    const y_novo = "Y" in tk ? tk.Y : null;
    const z_novo = "Z" in tk ? tk.Z : null;

    let tipo_inferido: TipoOperacaoInferido = "desconhecido";

    if (!comando && comentario && !("X" in tk) && !("Y" in tk) && !("Z" in tk)) {
      tipo_inferido = "comentario";
    } else if (comando === "G0") tipo_inferido = "movimento_rapido";
    else if (comando === "G1") {
      // descida em Z (Z negativo após posição livre) = furação/usinagem
      if (z_novo !== null && z_novo < 0 && x_novo === null && y_novo === null) {
        tipo_inferido = "furacao";
      } else if (z_novo !== null && z_novo < 0) {
        tipo_inferido = "corte";
      } else if (x_novo !== null || y_novo !== null) {
        tipo_inferido = "movimento_linear";
      } else {
        tipo_inferido = "movimento_linear";
      }
    } else if (comando === "G2" || comando === "G3") tipo_inferido = "arco";
    else if (comando === "M6" || (comando && comando.startsWith("T"))) tipo_inferido = "troca_ferramenta";
    else if (comando === "M3" || comando === "M4") tipo_inferido = "spindle_on";
    else if (comando === "M5") tipo_inferido = "spindle_off";
    else if (comando === "M30" || comando === "M2") tipo_inferido = "fim_programa";
    else if (comando === "G17" || comando === "G21" || comando === "G90" || comando === "G91" || comando === "G20") {
      tipo_inferido = "configuracao";
    }

    if (x_novo !== null) x_atual = x_novo;
    if (y_novo !== null) y_atual = y_novo;
    if (z_novo !== null) z_atual = z_novo;

    if (comando || comentario || x_novo !== null || y_novo !== null || z_novo !== null) {
      total_comandos++;
      linhas.push({
        linha: i + 1,
        raw,
        comando,
        ferramenta: ferramenta_atual,
        spindle: spindle_atual,
        avanco: avanco_atual,
        x: x_atual,
        y: y_atual,
        z: z_atual,
        comentario,
        tipo_inferido,
      });
    }
  }

  // Reduzir em operações inferidas: agrupar furações repetidas (sobe/desce no mesmo XY)
  const cortes = linhas.filter(
    (l) => l.tipo_inferido === "furacao" || l.tipo_inferido === "corte",
  );
  for (const c of cortes) {
    ordem++;
    operacoes.push({
      tipo: c.tipo_inferido,
      x: c.x,
      y: c.y,
      z: c.z,
      profundidade: c.z !== null ? Math.abs(c.z) : null,
      diametro: null,
      ferramenta: c.ferramenta,
      ordem,
      confianca: c.tipo_inferido === "furacao" ? "alta" : "media",
      origem_linha: c.linha,
    });
  }

  return {
    linhas,
    operacoes,
    ferramentas_usadas: [...ferramentas_usadas],
    total_comandos,
  };
}

// Tenta extrair operações de arquivos Parts/Profile que podem ser JSON ou texto-chave
export function parsePartsProfile(conteudo: string): {
  operacoes: OperacaoInferida[];
  formato: "json" | "key-value" | "desconhecido";
} {
  const operacoes: OperacaoInferida[] = [];
  let ordem = 0;

  // tentar JSON
  try {
    const j = JSON.parse(conteudo);
    const buckets = [
      ["Holes", "furacao"],
      ["holes", "furacao"],
      ["Drills", "furacao"],
      ["Grooves", "rasgo"],
      ["grooves", "rasgo"],
      ["Slots", "rasgo"],
      ["slots", "rasgo"],
      ["Contours", "contorno"],
      ["contours", "contorno"],
    ] as const;
    for (const [k, tipo] of buckets) {
      const arr = (j as Record<string, unknown>)[k];
      if (Array.isArray(arr)) {
        for (const item of arr) {
          const o = item as Record<string, number | string>;
          ordem++;
          operacoes.push({
            tipo: tipo as TipoOperacaoInferido,
            x: Number(o.X ?? o.x ?? o.X1 ?? 0) || null,
            y: Number(o.Y ?? o.y ?? o.Y1 ?? 0) || null,
            z: Number(o.Z ?? o.z ?? 0) || null,
            diametro: Number(o.Diam ?? o.D ?? o.Diameter ?? 0) || null,
            profundidade: Number(o.Prof ?? o.Depth ?? o.P ?? 0) || null,
            ferramenta: String(o.Tool ?? o.T ?? "") || null,
            ordem,
            confianca: "media",
            origem_linha: 0,
          });
        }
      }
    }
    if (operacoes.length) return { operacoes, formato: "json" };
  } catch {
    // não é JSON
  }

  // padrão key-value: linhas tipo "Hole X=32 Y=45 D=8 P=12"
  const rxLinha = /(Hole|Drill|Groove|Slot|Contour)\b/i;
  const rx = /\b([XYZ]|Diam|D|Prof|P|Face|F)[=:]\s*(-?\d+(?:\.\d+)?)/gi;
  let achou = false;
  for (const linha of conteudo.split(/\r?\n/)) {
    const m = rxLinha.exec(linha);
    if (!m) continue;
    achou = true;
    const valores: Record<string, number> = {};
    let mm;
    while ((mm = rx.exec(linha)) !== null) {
      valores[mm[1].toUpperCase()] = parseFloat(mm[2]);
    }
    const tipo: TipoOperacaoInferido =
      m[1].toLowerCase() === "groove" || m[1].toLowerCase() === "slot"
        ? "rasgo"
        : m[1].toLowerCase() === "contour"
        ? "contorno"
        : "furacao";
    ordem++;
    operacoes.push({
      tipo,
      x: valores.X ?? null,
      y: valores.Y ?? null,
      z: valores.Z ?? null,
      diametro: valores.DIAM ?? valores.D ?? null,
      profundidade: valores.PROF ?? valores.P ?? null,
      ferramenta: null,
      ordem,
      confianca: "baixa",
      origem_linha: 0,
    });
  }

  return {
    operacoes,
    formato: achou ? "key-value" : "desconhecido",
  };
}

// Vincula um arquivo técnico a uma peça pelo nome (ex: TR12349A.nc)
export function inferirCodigoPecaDoArquivo(nome: string): {
  referencia: string | null;
  codigo: string | null;
  sufixo: string | null;
} {
  // remove extensão e parêntese de duplicidade
  const base = nome.replace(/\.[a-z0-9]+$/i, "").replace(/\(\d+\)$/, "");
  const m = /^([A-Z]{2,4})(\d{2,8})([A-Z]?)/i.exec(base);
  if (!m) return { referencia: null, codigo: null, sufixo: null };
  return {
    referencia: m[1].toUpperCase(),
    codigo: m[2],
    sufixo: m[3] ? m[3].toUpperCase() : null,
  };
}
