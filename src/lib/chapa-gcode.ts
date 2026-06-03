// Geração de G-code para uma chapa inteira (plano de corte).
// MVP: contorno externo das peças + furos importados/convertidos + rasgos simples.

export type SheetPiece = {
  id: string;
  projeto_peca_id: string;
  descricao: string;
  x: number; // posição na chapa
  y: number;
  largura: number;
  altura: number;
  rotacionada: boolean;
  espessura: number;
};

export type SheetOperation = {
  id: string;
  projeto_peca_id: string;
  tipo: string; // 'furacao' | 'rasgo' | 'rebaixo' | ...
  face?: number | string | null;
  x: number; // coord local na peça
  y: number;
  z?: number | null;
  diametro?: number | null;
  profundidade?: number | null;
  largura?: number | null;
  comprimento?: number | null;
  ferramenta_codigo?: string | null;
};

export type SheetMachine = {
  id: string;
  nome: string;
  area_x: number;
  area_y: number;
  area_z: number;
  altura_segura_z: number;
  template_inicio: string;
  template_fim: string;
  template_troca_ferramenta: string;
};

export type SheetTool = {
  id: string;
  codigo: string;
  nome: string;
  tipo: string;
  diametro: number;
  rotacao_padrao: number;
  avanco_padrao: number;
};

export type SheetParams = {
  espessura: number;
  passthrough: number; // mm abaixo da peça no corte de contorno
  z_seguro: number;
  feed_corte: number;
  feed_furacao: number;
  rotacao: number;
  ferramenta_corte_id: string | null;
  ferramenta_furacao_id: string | null;
  ordem: "furos_depois_contorno" | "usinagens_depois_corte" | "personalizada";
  incluir_contorno: boolean;
  incluir_furos: boolean;
  incluir_rasgos: boolean;
  incluir_sobras: boolean;
  refilo: number;
};

export type Validacao = {
  nivel: "erro" | "aviso";
  mensagem: string;
  peca_id?: string;
};

export type SheetGenResult = {
  codigo: string;
  nome_arquivo: string;
  validacoes: Validacao[];
  paths: Array<{
    tipo: "rapido" | "corte" | "furo" | "rasgo";
    pontos: Array<{ x: number; y: number }>;
    ferramenta?: string;
  }>;
};

function render(t: string, vars: Record<string, string | number>): string {
  return t.replace(/\{([A-Z_]+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

// Converte coordenada local da peça (com possível rotação) para coordenada global da chapa.
export function localToSheetCoordinates(
  piece: SheetPiece,
  lx: number,
  ly: number,
): { x: number; y: number } {
  if (!piece.rotacionada) {
    return { x: piece.x + lx, y: piece.y + ly };
  }
  // Rotação 90º horária: (lx, ly) -> (ly, larguraOriginal - lx)
  // largura visível na chapa = altura original (porque rotacionada)
  // Aqui largura/altura JÁ refletem dimensões rotacionadas (largura<->altura).
  // Então a coord local original em (lx, ly) onde a peça tinha largura piece.altura (rot) deve mapear.
  const wRot = piece.largura; // largura rotacionada
  return { x: piece.x + ly, y: piece.y + (wRot - lx) };
}

export function rotateOperationCoordinates(
  piece: SheetPiece,
  op: SheetOperation,
): { x: number; y: number } {
  return localToSheetCoordinates(piece, op.x, op.y);
}

function fmt(n: number): string {
  return n.toFixed(3);
}

export function generateSheetGCode(
  projeto: { nome: string; cliente?: string | null; ambiente?: string | null },
  chapa: { nome: string; codigo?: string | null; largura: number; altura: number; espessura: number; numero: number },
  pecas: SheetPiece[],
  operacoes: SheetOperation[],
  maquina: SheetMachine,
  ferramentas: SheetTool[],
  params: SheetParams,
  aproveitamento: number,
): SheetGenResult {
  const validacoes: Validacao[] = [];
  const paths: SheetGenResult["paths"] = [];

  // Validações
  if (!maquina) validacoes.push({ nivel: "erro", mensagem: "Máquina não definida" });
  if (!pecas.length) validacoes.push({ nivel: "erro", mensagem: "Chapa sem peças posicionadas" });
  if (params.incluir_contorno && !params.ferramenta_corte_id)
    validacoes.push({ nivel: "erro", mensagem: "Ferramenta de corte externa não selecionada" });
  if (params.incluir_furos && !params.ferramenta_furacao_id)
    validacoes.push({ nivel: "aviso", mensagem: "Ferramenta de furação não selecionada" });

  for (const p of pecas) {
    if (p.x < 0 || p.y < 0 || p.x + p.largura > chapa.largura || p.y + p.altura > chapa.altura) {
      validacoes.push({ nivel: "erro", mensagem: `Peça "${p.descricao}" fora da chapa`, peca_id: p.id });
    }
  }
  // colisões
  for (let i = 0; i < pecas.length; i++) {
    for (let j = i + 1; j < pecas.length; j++) {
      const a = pecas[i], b = pecas[j];
      if (a.x < b.x + b.largura && a.x + a.largura > b.x && a.y < b.y + b.altura && a.y + a.altura > b.y) {
        validacoes.push({ nivel: "erro", mensagem: `Colisão: "${a.descricao}" ↔ "${b.descricao}"` });
      }
    }
  }

  const ferrCorte = ferramentas.find((f) => f.id === params.ferramenta_corte_id);
  const ferrFur = ferramentas.find((f) => f.id === params.ferramenta_furacao_id);

  const linhas: string[] = [];
  const data = new Date().toLocaleString("pt-BR");
  linhas.push(`; ========================================`);
  linhas.push(`; PROJETO: ${projeto.nome}`);
  linhas.push(`; CLIENTE: ${projeto.cliente ?? "-"}  AMBIENTE: ${projeto.ambiente ?? "-"}`);
  linhas.push(`; CHAPA #${chapa.numero}: ${chapa.nome}`);
  linhas.push(`; MATERIAL: ${chapa.codigo ?? "-"}  ESPESSURA: ${params.espessura} mm`);
  linhas.push(`; DIMENSAO: ${chapa.largura} x ${chapa.altura} mm  APROVEITAMENTO: ${Math.round(aproveitamento * 100)}%`);
  linhas.push(`; MAQUINA: ${maquina.nome}  Z_SEGURO: ${params.z_seguro} mm`);
  linhas.push(`; GERADO: ${data}`);
  linhas.push(`; PREVIA TECNICA - VALIDAR ANTES DE USAR EM MAQUINA REAL`);
  linhas.push(`; ========================================`);
  linhas.push("");
  linhas.push(render(maquina.template_inicio, { ALTURA_SEGURA: params.z_seguro }));
  linhas.push("");

  let toolCounter = 0;
  const toolNumMap = new Map<string, number>();
  let ferramentaAtual: string | null = null;
  const trocarFerramenta = (f: SheetTool) => {
    if (ferramentaAtual === f.id) return;
    if (!toolNumMap.has(f.id)) toolNumMap.set(f.id, ++toolCounter);
    linhas.push(render(maquina.template_troca_ferramenta, {
      TOOL_CODE: f.codigo, TOOL_NAME: f.nome,
      TOOL_NUM: toolNumMap.get(f.id)!,
      RPM: params.rotacao || f.rotacao_padrao,
      FEED: params.feed_corte || f.avanco_padrao,
    }));
    linhas.push("");
    ferramentaAtual = f.id;
  };

  // Pré-computa ops por peça
  const opsByPeca = new Map<string, SheetOperation[]>();
  for (const op of operacoes) {
    const arr = opsByPeca.get(op.projeto_peca_id) ?? [];
    arr.push(op);
    opsByPeca.set(op.projeto_peca_id, arr);
  }

  const emitFuros = () => {
    if (!params.incluir_furos || !ferrFur) return;
    trocarFerramenta(ferrFur);
    linhas.push(`; --- Furos ---`);
    for (const p of pecas) {
      const ops = opsByPeca.get(p.projeto_peca_id) ?? [];
      for (const op of ops.filter((o) => o.tipo === "furacao")) {
        const g = rotateOperationCoordinates(p, op);
        const prof = op.profundidade ?? params.espessura;
        linhas.push(`; Furo peça ${p.descricao}`);
        linhas.push(`G0 X${fmt(g.x)} Y${fmt(g.y)}`);
        linhas.push(`G0 Z${fmt(params.z_seguro)}`);
        linhas.push(`G1 Z${fmt(-prof)} F${params.feed_furacao}`);
        linhas.push(`G0 Z${fmt(params.z_seguro)}`);
        paths.push({ tipo: "furo", pontos: [{ x: g.x, y: g.y }], ferramenta: ferrFur.codigo });
      }
    }
    linhas.push("");
  };

  const emitRasgos = () => {
    if (!params.incluir_rasgos) return;
    const ferr = ferrFur ?? ferrCorte;
    if (!ferr) return;
    trocarFerramenta(ferr);
    linhas.push(`; --- Rasgos/Rebaixos ---`);
    for (const p of pecas) {
      const ops = opsByPeca.get(p.projeto_peca_id) ?? [];
      for (const op of ops.filter((o) => ["rasgo", "rebaixo"].includes(o.tipo))) {
        const g = rotateOperationCoordinates(p, op);
        const L = op.comprimento ?? 20;
        const prof = op.profundidade ?? 5;
        linhas.push(`; Rasgo peça ${p.descricao}`);
        linhas.push(`G0 X${fmt(g.x)} Y${fmt(g.y)}`);
        linhas.push(`G1 Z${fmt(-prof)} F${params.feed_furacao}`);
        linhas.push(`G1 X${fmt(g.x + L)} Y${fmt(g.y)} F${params.feed_corte}`);
        linhas.push(`G0 Z${fmt(params.z_seguro)}`);
        paths.push({
          tipo: "rasgo",
          pontos: [{ x: g.x, y: g.y }, { x: g.x + L, y: g.y }],
          ferramenta: ferr.codigo,
        });
      }
    }
    linhas.push("");
  };

  const emitContornos = () => {
    if (!params.incluir_contorno || !ferrCorte) return;
    trocarFerramenta(ferrCorte);
    linhas.push(`; --- Contorno externo das peças ---`);
    const zFinal = -(params.espessura + params.passthrough);
    for (const p of pecas) {
      const x0 = p.x, y0 = p.y;
      const x1 = p.x + p.largura, y1 = p.y + p.altura;
      linhas.push(`; Contorno peça ${p.descricao} (${p.largura}x${p.altura})`);
      linhas.push(`G0 X${fmt(x0)} Y${fmt(y0)}`);
      linhas.push(`G0 Z${fmt(params.z_seguro)}`);
      linhas.push(`G1 Z${fmt(zFinal)} F${params.feed_corte}`);
      linhas.push(`G1 X${fmt(x1)} Y${fmt(y0)}`);
      linhas.push(`G1 X${fmt(x1)} Y${fmt(y1)}`);
      linhas.push(`G1 X${fmt(x0)} Y${fmt(y1)}`);
      linhas.push(`G1 X${fmt(x0)} Y${fmt(y0)}`);
      linhas.push(`G0 Z${fmt(params.z_seguro)}`);
      paths.push({
        tipo: "corte",
        pontos: [
          { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 },
        ],
        ferramenta: ferrCorte.codigo,
      });
    }
    linhas.push("");
  };

  const ordem = params.ordem;
  if (ordem === "usinagens_depois_corte") {
    emitFuros();
    emitRasgos();
    emitContornos();
  } else if (ordem === "personalizada") {
    emitFuros();
    emitRasgos();
    emitContornos();
  } else {
    // padrão: furos depois contorno
    emitFuros();
    emitRasgos();
    emitContornos();
  }

  linhas.push(render(maquina.template_fim, { ALTURA_SEGURA: params.z_seguro }));

  const matSlug = (chapa.codigo ?? chapa.nome ?? "MAT").replace(/[^A-Z0-9]+/gi, "_").toUpperCase();
  const nome_arquivo = `CH${String(chapa.numero).padStart(2, "0")}_${matSlug}_${params.espessura}.nc`;
  return { codigo: linhas.join("\n"), nome_arquivo, validacoes, paths };
}

export function validateSheetGCode(res: SheetGenResult): { ok: boolean; erros: number; avisos: number } {
  const erros = res.validacoes.filter((v) => v.nivel === "erro").length;
  const avisos = res.validacoes.filter((v) => v.nivel === "aviso").length;
  return { ok: erros === 0, erros, avisos };
}
