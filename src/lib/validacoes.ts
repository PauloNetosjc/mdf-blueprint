import type { Ferramenta, Maquina, Operacao, Peca } from "./db";

export type Alerta = {
  nivel: "erro" | "aviso";
  mensagem: string;
  operacao_id?: string;
};

export function validarPecaMaquina(peca: Peca, maquina: Maquina): Alerta[] {
  const alertas: Alerta[] = [];
  if (peca.largura > maquina.area_x)
    alertas.push({ nivel: "erro", mensagem: `Largura ${peca.largura}mm excede X máximo da máquina (${maquina.area_x}mm).` });
  if (peca.altura > maquina.area_y)
    alertas.push({ nivel: "erro", mensagem: `Altura/profundidade ${peca.altura}mm excede Y máximo (${maquina.area_y}mm).` });
  if (peca.espessura > maquina.area_z)
    alertas.push({ nivel: "erro", mensagem: `Espessura ${peca.espessura}mm excede Z máximo (${maquina.area_z}mm).` });
  return alertas;
}

export function validarOperacoes(
  peca: Peca,
  operacoes: Operacao[],
  ferramentas: Ferramenta[],
): Alerta[] {
  const alertas: Alerta[] = [];
  for (const op of operacoes) {
    const ferr = ferramentas.find((f) => f.id === op.ferramenta_id);
    if (!op.ferramenta_id || !ferr) {
      alertas.push({ nivel: "erro", mensagem: `Operação #${op.ordem} (${op.tipo}) sem ferramenta selecionada.`, operacao_id: op.id });
      continue;
    }

    // Face 0 = superior (X = largura, Y = altura)
    if (op.numero_face === 0) {
      if (op.x < 0 || op.x > peca.largura)
        alertas.push({ nivel: "erro", mensagem: `Op #${op.ordem}: X=${op.x} fora da peça (0–${peca.largura}).`, operacao_id: op.id });
      if (op.y < 0 || op.y > peca.altura)
        alertas.push({ nivel: "erro", mensagem: `Op #${op.ordem}: Y=${op.y} fora da peça (0–${peca.altura}).`, operacao_id: op.id });
      if (op.profundidade > peca.espessura)
        alertas.push({ nivel: "aviso", mensagem: `Op #${op.ordem}: profundidade ${op.profundidade} maior que espessura ${peca.espessura}.`, operacao_id: op.id });
      if (ferr.face_permitida === "topo_lateral")
        alertas.push({ nivel: "aviso", mensagem: `Op #${op.ordem}: ferramenta ${ferr.codigo} é de topo/lateral, mas operação é na face superior.`, operacao_id: op.id });
    } else {
      // Faces laterais (1-4): X percorre a aresta, Y é a posição em profundidade/espessura
      const arestaMax = op.numero_face === 1 || op.numero_face === 2 ? peca.altura : peca.largura;
      if (op.x < 0 || op.x > arestaMax + 5)
        alertas.push({ nivel: "aviso", mensagem: `Op #${op.ordem} face ${op.numero_face}: X=${op.x} possivelmente fora da aresta (0–${arestaMax}).`, operacao_id: op.id });
      if (op.profundidade > Math.max(peca.largura, peca.altura))
        alertas.push({ nivel: "aviso", mensagem: `Op #${op.ordem}: profundidade ${op.profundidade} muito grande.`, operacao_id: op.id });
      if (ferr.face_permitida === "face_superior")
        alertas.push({ nivel: "aviso", mensagem: `Op #${op.ordem}: ferramenta ${ferr.codigo} é de face superior, mas operação é em topo/lateral.`, operacao_id: op.id });
    }

    if (op.profundidade > ferr.profundidade_maxima)
      alertas.push({ nivel: "aviso", mensagem: `Op #${op.ordem}: profundidade ${op.profundidade} excede o limite da ferramenta ${ferr.codigo} (${ferr.profundidade_maxima}).`, operacao_id: op.id });
  }
  return alertas;
}
