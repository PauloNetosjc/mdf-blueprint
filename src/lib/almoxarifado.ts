// Helpers para o módulo Almoxarifado / Lista de Compras.

export const CATEGORIAS_ALMOX = [
  { value: "fita_borda", label: "Fita de borda" },
  { value: "ferragem", label: "Ferragem" },
  { value: "parafuso", label: "Parafuso" },
  { value: "dobradica", label: "Dobradiça" },
  { value: "corredica", label: "Corrediça" },
  { value: "puxador", label: "Puxador" },
  { value: "acessorio", label: "Acessório" },
  { value: "acabamento", label: "Acabamento" },
  { value: "outro", label: "Outro" },
];

export const UNIDADES_ALMOX = ["un", "pç", "m", "m²", "kg", "par", "jogo"];

export const STATUS_SEPARACAO = [
  { value: "pendente", label: "Pendente", color: "text-warning" },
  { value: "em_separacao", label: "Em separação", color: "text-info" },
  { value: "separado", label: "Separado", color: "text-success" },
  { value: "falta_item", label: "Falta", color: "text-destructive" },
  { value: "substituido", label: "Substituído", color: "text-muted-foreground" },
  { value: "cancelado", label: "Cancelado", color: "text-muted-foreground" },
];

export const TIPOS_MOVIMENTO = [
  { value: "entrada", label: "Entrada" },
  { value: "reserva", label: "Reserva" },
  { value: "saida_projeto", label: "Saída p/ Projeto" },
  { value: "ajuste", label: "Ajuste" },
  { value: "devolucao", label: "Devolução" },
  { value: "perda", label: "Perda" },
];

// Códigos de fita: número de lados curtos e longos por peça.
// curto = lado menor (largura típica), longo = lado maior (altura típica).
const MAPA_FITA: Record<string, { curtos: number; longos: number }> = {
  "@1": { curtos: 2, longos: 0 },
  "@2": { curtos: 0, longos: 2 },
  "@3": { curtos: 2, longos: 2 },
  "@4": { curtos: 1, longos: 1 },
  "@5": { curtos: 1, longos: 2 },
  "@6": { curtos: 2, longos: 1 },
  "@7": { curtos: 1, longos: 0 },
  "@8": { curtos: 0, longos: 1 },
};

export type PecaParaFita = {
  largura: number;
  altura: number;
  quantidade: number;
  fita_codigo: string | null;
  ambiente?: string | null;
  modulo?: string | null;
};

export type ConsumoFita = {
  fita_codigo: string;
  metros: number;
  pecas: number;
  detalhe: string;
};

export function calcularConsumoFita(pecas: PecaParaFita[]): ConsumoFita[] {
  const acc = new Map<string, { mm: number; pecas: number }>();
  for (const p of pecas) {
    const code = (p.fita_codigo ?? "").trim();
    const cfg = MAPA_FITA[code];
    if (!cfg) continue;
    const curto = Math.min(p.largura, p.altura);
    const longo = Math.max(p.largura, p.altura);
    const qtd = Math.max(p.quantidade ?? 1, 0);
    const mm = (cfg.curtos * curto + cfg.longos * longo) * qtd;
    const prev = acc.get(code) ?? { mm: 0, pecas: 0 };
    acc.set(code, { mm: prev.mm + mm, pecas: prev.pecas + qtd });
  }
  return Array.from(acc.entries())
    .map(([fita_codigo, v]) => ({
      fita_codigo,
      metros: Math.ceil((v.mm / 1000) * 100) / 100,
      pecas: v.pecas,
      detalhe: MAPA_FITA[fita_codigo]
        ? `${MAPA_FITA[fita_codigo].curtos} curto(s) + ${MAPA_FITA[fita_codigo].longos} longo(s)`
        : "",
    }))
    .sort((a, b) => a.fita_codigo.localeCompare(b.fita_codigo));
}

export function statusInfo(status: string) {
  return STATUS_SEPARACAO.find((s) => s.value === status) ?? STATUS_SEPARACAO[0];
}
