// Nesting retangular simples (shelf packing) por material/espessura.
// Primeira versão — suficiente para plano de corte 2D em chapas padrão.

export type Chapa = {
  id: string;
  nome: string;
  codigo: string;
  cor: string;
  espessura: number;
  largura: number; // X
  altura: number;  // Y
  permite_rotacao: boolean;
  veio: string; // "nenhum" | "horizontal" | "vertical"
};

export type PecaInput = {
  id: string;            // projeto_peca_id (origem)
  descricao: string;
  codigo?: string | null;
  largura: number;
  altura: number;
  espessura: number;
  chapa_id: string | null;
  quantidade: number;
  permite_rotacao_peca?: boolean; // veio da peça
};

export type PecaPosicionada = {
  id: string;                // único nesta posição
  projeto_peca_id: string;
  descricao: string;
  codigo?: string | null;
  x: number;
  y: number;
  largura: number;
  altura: number;
  rotacionada: boolean;
};

export type Sobra = { x: number; y: number; largura: number; altura: number };

export type ChapaPlano = {
  indice: number;
  chapa: Chapa;
  pecas: PecaPosicionada[];
  sobras: Sobra[];
  aproveitamento: number; // 0..1
  area_usada: number;
};

export type ResultadoPlano = {
  chapas: ChapaPlano[];
  aproveitamento_medio: number;
  total_pecas: number;
  total_chapas: number;
};

const KERF_DEFAULT = 4; // mm — folga padrão entre peças e refilo

type Item = {
  projeto_peca_id: string;
  descricao: string;
  codigo?: string | null;
  largura: number;
  altura: number;
  chapa_id: string;
  permite_rotacao_peca: boolean;
  uid: string; // único por instância
};

export function calcularPlanoCorte(
  pecas: PecaInput[],
  chapas: Chapa[],
  refilo: number = KERF_DEFAULT,
): ResultadoPlano {
  // 1) Expandir por quantidade e filtrar peças com chapa atribuída
  const items: Item[] = [];
  for (const p of pecas) {
    if (!p.chapa_id) continue;
    for (let i = 0; i < (p.quantidade ?? 1); i++) {
      items.push({
        projeto_peca_id: p.id,
        descricao: p.descricao,
        codigo: p.codigo,
        largura: p.largura,
        altura: p.altura,
        chapa_id: p.chapa_id,
        permite_rotacao_peca: p.permite_rotacao_peca ?? true,
        uid: `${p.id}-${i}`,
      });
    }
  }

  // 2) Agrupar por chapa_id
  const grupos = new Map<string, Item[]>();
  for (const it of items) {
    const arr = grupos.get(it.chapa_id) ?? [];
    arr.push(it);
    grupos.set(it.chapa_id, arr);
  }

  const planoChapas: ChapaPlano[] = [];
  let indiceGlobal = 1;

  for (const [chapaId, lote] of grupos.entries()) {
    const chapa = chapas.find((c) => c.id === chapaId);
    if (!chapa) continue;

    // ordenar maior área desc
    lote.sort((a, b) => b.largura * b.altura - a.largura * a.altura);

    let restantes = [...lote];
    while (restantes.length > 0) {
      const { posicionadas, naoCabe, sobras, areaUsada } = empacotarShelf(restantes, chapa, refilo);
      if (posicionadas.length === 0) {
        // peça maior que a chapa — pula para evitar loop
        const skip = restantes.shift();
        if (skip) {
          console.warn("Peça maior que a chapa, ignorada:", skip);
        }
        continue;
      }
      const areaTotal = chapa.largura * chapa.altura;
      planoChapas.push({
        indice: indiceGlobal++,
        chapa,
        pecas: posicionadas,
        sobras,
        area_usada: areaUsada,
        aproveitamento: areaUsada / areaTotal,
      });
      restantes = naoCabe;
    }
  }

  const total_pecas = planoChapas.reduce((s, c) => s + c.pecas.length, 0);
  const aproveitamento_medio =
    planoChapas.length === 0
      ? 0
      : planoChapas.reduce((s, c) => s + c.aproveitamento, 0) / planoChapas.length;

  return {
    chapas: planoChapas,
    aproveitamento_medio,
    total_pecas,
    total_chapas: planoChapas.length,
  };
}

function empacotarShelf(items: Item[], chapa: Chapa, KERF: number = KERF_DEFAULT) {
  const W = chapa.largura;
  const H = chapa.altura;
  const posicionadas: PecaPosicionada[] = [];
  const sobras: Sobra[] = [];

  let cursorY = KERF;
  let alturaLinha = 0;
  let cursorX = KERF;
  let usadosUid = new Set<string>();
  let areaUsada = 0;

  // peças que ficaram fora desta chapa
  const naoCabe: Item[] = [];

  for (const it of items) {
    // orientações possíveis
    const orientacoes: Array<{ w: number; h: number; rot: boolean }> = [
      { w: it.largura, h: it.altura, rot: false },
    ];
    if (chapa.permite_rotacao && it.permite_rotacao_peca && chapa.veio === "nenhum") {
      orientacoes.push({ w: it.altura, h: it.largura, rot: true });
    }

    let colocou = false;
    for (const o of orientacoes) {
      if (o.w > W - 2 * KERF || o.h > H - 2 * KERF) continue;

      // cabe na linha atual?
      if (cursorX + o.w + KERF <= W && cursorY + o.h + KERF <= H) {
        posicionadas.push({
          id: it.uid,
          projeto_peca_id: it.projeto_peca_id,
          descricao: it.descricao,
          codigo: it.codigo,
          x: cursorX,
          y: cursorY,
          largura: o.w,
          altura: o.h,
          rotacionada: o.rot,
        });
        areaUsada += o.w * o.h;
        usadosUid.add(it.uid);
        cursorX += o.w + KERF;
        alturaLinha = Math.max(alturaLinha, o.h);
        colocou = true;
        break;
      }

      // tenta nova linha
      const novoY = cursorY + alturaLinha + KERF;
      if (novoY + o.h + KERF <= H && o.w + 2 * KERF <= W) {
        // registra sobra final da linha anterior (faixa horizontal à direita)
        if (cursorX < W - KERF && alturaLinha > 0) {
          sobras.push({
            x: cursorX,
            y: cursorY,
            largura: W - KERF - cursorX,
            altura: alturaLinha,
          });
        }
        cursorY = novoY;
        cursorX = KERF;
        alturaLinha = 0;

        posicionadas.push({
          id: it.uid,
          projeto_peca_id: it.projeto_peca_id,
          descricao: it.descricao,
          codigo: it.codigo,
          x: cursorX,
          y: cursorY,
          largura: o.w,
          altura: o.h,
          rotacionada: o.rot,
        });
        areaUsada += o.w * o.h;
        usadosUid.add(it.uid);
        cursorX += o.w + KERF;
        alturaLinha = o.h;
        colocou = true;
        break;
      }
    }

    if (!colocou) {
      naoCabe.push(it);
    }
  }

  // sobra final da última linha
  if (cursorX < W - KERF && alturaLinha > 0) {
    sobras.push({
      x: cursorX,
      y: cursorY,
      largura: W - KERF - cursorX,
      altura: alturaLinha,
    });
  }
  // sobra inferior (faixa inteira abaixo da última linha)
  const baseFinal = cursorY + alturaLinha + KERF;
  if (baseFinal < H - KERF) {
    sobras.push({
      x: KERF,
      y: baseFinal,
      largura: W - 2 * KERF,
      altura: H - KERF - baseFinal,
    });
  }

  return { posicionadas, naoCabe, sobras, areaUsada };
}

export function detectarColisao(
  pecas: PecaPosicionada[],
  chapa: { largura: number; altura: number },
  ignoreId?: string,
): boolean {
  for (let i = 0; i < pecas.length; i++) {
    const a = pecas[i];
    if (a.x < 0 || a.y < 0 || a.x + a.largura > chapa.largura || a.y + a.altura > chapa.altura) {
      if (a.id !== ignoreId) return true;
    }
    for (let j = i + 1; j < pecas.length; j++) {
      const b = pecas[j];
      if (
        a.x < b.x + b.largura &&
        a.x + a.largura > b.x &&
        a.y < b.y + b.altura &&
        a.y + a.altura > b.y
      ) {
        if (a.id !== ignoreId && b.id !== ignoreId) return true;
        return true;
      }
    }
  }
  return false;
}
