// Análise e comparação de G-code

export type LinhaDiff = {
  num: number;
  esquerda: string | null;
  direita: string | null;
  tipo: "igual" | "diferente" | "so_esquerda" | "so_direita";
};

export type Resumo = {
  comandosG: Record<string, number>;
  comandosM: Record<string, number>;
  ferramentas: string[]; // T1, T2…
  rangeX: [number, number] | null;
  rangeY: [number, number] | null;
  rangeZ: [number, number] | null;
  feeds: number[];
  rpms: number[];
  totalLinhas: number;
  linhasComentario: number;
};

function limparLinha(l: string): string {
  // remove comentários ; ... e (...) e espaços extras
  return l.replace(/;.*/, "").replace(/\([^)]*\)/g, "").trim();
}

export function analisar(codigo: string): Resumo {
  const linhas = codigo.split(/\r?\n/);
  const r: Resumo = {
    comandosG: {},
    comandosM: {},
    ferramentas: [],
    rangeX: null,
    rangeY: null,
    rangeZ: null,
    feeds: [],
    rpms: [],
    totalLinhas: linhas.length,
    linhasComentario: 0,
  };
  const ferrSet = new Set<string>();
  const feedSet = new Set<number>();
  const rpmSet = new Set<number>();

  for (const raw of linhas) {
    if (/^\s*(;|\()/.test(raw)) r.linhasComentario++;
    const l = limparLinha(raw).toUpperCase();
    if (!l) continue;
    const tokens = l.match(/[A-Z][-+]?\d*\.?\d+/g) ?? [];
    for (const tk of tokens) {
      const letra = tk[0];
      const valor = tk.slice(1);
      if (letra === "G") r.comandosG[`G${valor}`] = (r.comandosG[`G${valor}`] ?? 0) + 1;
      else if (letra === "M") r.comandosM[`M${valor}`] = (r.comandosM[`M${valor}`] ?? 0) + 1;
      else if (letra === "T") ferrSet.add(`T${valor}`);
      else if (letra === "F") feedSet.add(+valor);
      else if (letra === "S") rpmSet.add(+valor);
      else if (letra === "X") atualizaRange(r, "rangeX", +valor);
      else if (letra === "Y") atualizaRange(r, "rangeY", +valor);
      else if (letra === "Z") atualizaRange(r, "rangeZ", +valor);
    }
  }
  r.ferramentas = [...ferrSet].sort();
  r.feeds = [...feedSet].sort((a, b) => a - b);
  r.rpms = [...rpmSet].sort((a, b) => a - b);
  return r;
}

function atualizaRange(r: Resumo, k: "rangeX" | "rangeY" | "rangeZ", v: number) {
  if (Number.isNaN(v)) return;
  const cur = r[k];
  if (!cur) r[k] = [v, v];
  else r[k] = [Math.min(cur[0], v), Math.max(cur[1], v)];
}

// Conjunto de comandos normalizados (linhas sem coordenadas) para comparar presença
export function comandosNormalizados(codigo: string): Set<string> {
  const set = new Set<string>();
  for (const raw of codigo.split(/\r?\n/)) {
    const l = limparLinha(raw).toUpperCase();
    if (!l) continue;
    // normaliza: mantém só letras de comando, remove valores numéricos
    const norm = (l.match(/[A-Z]\d*/g) ?? [])
      .map((tk) => {
        const letra = tk[0];
        const valor = tk.slice(1);
        // mantém G/M com valor (ex G0, G1, M3), demais letras só letra
        if (letra === "G" || letra === "M" || letra === "T") return `${letra}${valor}`;
        return letra;
      })
      .join(" ");
    if (norm) set.add(norm);
  }
  return set;
}

export function diferencaConjuntos(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const v of a) if (!b.has(v)) out.push(v);
  return out.sort();
}

// Diff linha a linha simples (LCS leve por igualdade após limpeza)
export function diffLinhas(esq: string, dir: string): LinhaDiff[] {
  const a = esq.split(/\r?\n/);
  const b = dir.split(/\r?\n/);
  const n = a.length;
  const m = b.length;
  const max = Math.max(n, m);
  const result: LinhaDiff[] = [];
  for (let i = 0; i < max; i++) {
    const la = i < n ? a[i] : null;
    const lb = i < m ? b[i] : null;
    let tipo: LinhaDiff["tipo"];
    if (la === null) tipo = "so_direita";
    else if (lb === null) tipo = "so_esquerda";
    else if (limparLinha(la).toUpperCase() === limparLinha(lb).toUpperCase()) tipo = "igual";
    else tipo = "diferente";
    result.push({ num: i + 1, esquerda: la, direita: lb, tipo });
  }
  return result;
}
