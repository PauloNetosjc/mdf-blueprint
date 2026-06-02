import type { Ferramenta, Maquina, Operacao, Peca } from "./db";

function render(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{([A-Z_]+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function gerarGCode(
  peca: Peca,
  operacoes: Operacao[],
  maquina: Maquina,
  ferramentas: Ferramenta[],
): { codigo: string; nome_arquivo: string } {
  const linhas: string[] = [];
  const data = new Date().toLocaleString("pt-BR");

  linhas.push(`; ========================================`);
  linhas.push(`; ${peca.codigo} - ${peca.nome}`);
  linhas.push(`; Cliente: ${peca.cliente ?? "-"}`);
  linhas.push(`; Ambiente: ${peca.ambiente ?? "-"}`);
  linhas.push(`; Dimensoes: ${peca.largura} x ${peca.altura} x ${peca.espessura} mm`);
  linhas.push(`; Face alinhamento: ${peca.face_alinhamento}`);
  linhas.push(`; Maquina: ${maquina.nome} (X${maquina.area_x} Y${maquina.area_y} Z${maquina.area_z})`);
  linhas.push(`; Gerado em: ${data}`);
  linhas.push(`; PREVIA TECNICA - VALIDAR ANTES DE USAR EM MAQUINA REAL`);
  linhas.push(`; ========================================`);
  linhas.push("");

  linhas.push(render(maquina.template_inicio, { ALTURA_SEGURA: maquina.altura_segura_z }));
  linhas.push("");

  const ordenadas = [...operacoes].sort((a, b) => a.ordem - b.ordem);
  let ferramentaAtual: string | null = null;
  let toolCounter = 0;
  const toolNumMap = new Map<string, number>();

  for (const op of ordenadas) {
    const ferr = ferramentas.find((f) => f.id === op.ferramenta_id);
    if (!ferr) {
      linhas.push(`; !! Operacao #${op.ordem} (${op.tipo}) SEM FERRAMENTA - revisar`);
      continue;
    }

    if (ferramentaAtual !== ferr.id) {
      if (!toolNumMap.has(ferr.id)) toolNumMap.set(ferr.id, ++toolCounter);
      const toolNum = toolNumMap.get(ferr.id)!;
      linhas.push(
        render(maquina.template_troca_ferramenta, {
          TOOL_CODE: ferr.codigo,
          TOOL_NAME: ferr.nome,
          TOOL_NUM: toolNum,
          RPM: ferr.rotacao_padrao,
          FEED: ferr.avanco_padrao,
        }),
      );
      linhas.push("");
      ferramentaAtual = ferr.id;
    }

    linhas.push(`; Op #${op.ordem} - ${op.tipo} - Face ${op.numero_face} - ${ferr.codigo}`);

    if (op.numero_face === 0) {
      linhas.push(
        render(maquina.template_furacao_face, {
          X: op.x,
          Y: op.y,
          DEPTH: op.profundidade,
          FEED: ferr.avanco_padrao,
          RPM: ferr.rotacao_padrao,
          ALTURA_SEGURA: maquina.altura_segura_z,
        }),
      );
    } else {
      const zApprox = peca.espessura / 2;
      linhas.push(
        render(maquina.template_furacao_lateral, {
          FACE: op.numero_face,
          X: op.x,
          Y: op.y,
          Z: zApprox,
          Z_FINAL: -op.profundidade,
          DEPTH: op.profundidade,
          FEED: ferr.avanco_padrao,
          RPM: ferr.rotacao_padrao,
          ALTURA_SEGURA: maquina.altura_segura_z,
        }),
      );
    }
    linhas.push("");
  }

  linhas.push(render(maquina.template_fim, { ALTURA_SEGURA: maquina.altura_segura_z }));

  return {
    codigo: linhas.join("\n"),
    nome_arquivo: `${peca.codigo}.nc`,
  };
}
