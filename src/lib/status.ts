// Padronização visual de status em todo o sistema.
// Convenção de cores:
//   cinza    = rascunho / pendente
//   azul     = em andamento
//   verde    = aprovado / concluído
//   amarelo  = atenção
//   vermelho = erro / reprovado / ocorrência
//   roxo     = importado
//   laranja  = aguardando ação

export type StatusTone =
  | "gray" | "blue" | "green" | "yellow" | "red" | "purple" | "orange";

export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  gray:   "bg-muted text-muted-foreground border-border",
  blue:   "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
  green:  "bg-green-100 text-green-800 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30",
  yellow: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/30",
  red:    "bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30",
  purple: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30",
  orange: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30",
};

export const STATUS_DOT_CLASS: Record<StatusTone, string> = {
  gray: "bg-muted-foreground/50",
  blue: "bg-blue-500",
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
  purple: "bg-purple-500",
  orange: "bg-orange-500",
};

// Mapeia chaves de status conhecidas no sistema para tom + rótulo amigável.
const MAP: Record<string, { tone: StatusTone; label: string }> = {
  // genéricos
  rascunho:         { tone: "gray",   label: "Rascunho" },
  pendente:         { tone: "gray",   label: "Pendente" },
  nao_iniciado:     { tone: "gray",   label: "Não iniciado" },
  em_andamento:     { tone: "blue",   label: "Em andamento" },
  em_producao:      { tone: "blue",   label: "Em produção" },
  em_analise:       { tone: "blue",   label: "Em análise" },
  ativo:            { tone: "blue",   label: "Ativo" },
  concluido:        { tone: "green",  label: "Concluído" },
  aprovado:         { tone: "green",  label: "Aprovado" },
  finalizado:       { tone: "green",  label: "Finalizado" },
  ok:               { tone: "green",  label: "OK" },
  validado:         { tone: "green",  label: "Validado" },
  atencao:          { tone: "yellow", label: "Atenção" },
  precisa_ajuste:   { tone: "yellow", label: "Precisa ajuste" },
  parcial:          { tone: "yellow", label: "Parcial" },
  erro:             { tone: "red",    label: "Erro" },
  reprovado:        { tone: "red",    label: "Reprovado" },
  ocorrencia:       { tone: "red",    label: "Ocorrência" },
  cancelado:        { tone: "red",    label: "Cancelado" },
  aberta:           { tone: "red",    label: "Aberta" },
  importado:        { tone: "purple", label: "Importado" },
  importacao_ok:    { tone: "purple", label: "Importado" },
  promob:           { tone: "purple", label: "Promob" },
  nesting:          { tone: "purple", label: "Nesting" },
  aguardando:       { tone: "orange", label: "Aguardando ação" },
  aguardando_acao:  { tone: "orange", label: "Aguardando ação" },
  exportado:        { tone: "orange", label: "Exportado" },
  enviado_maquina:  { tone: "orange", label: "Enviado p/ máquina" },

  // homologação
  gerado:           { tone: "blue",   label: "Gerado" },
  comparado:        { tone: "blue",   label: "Comparado" },

  // produção (status_corte / furacao / etc.)
  iniciado:         { tone: "blue",   label: "Iniciado" },

  // arquivos importados
  nao_analisado:    { tone: "gray",   label: "Não analisado" },
  analisado:        { tone: "green",  label: "Analisado" },
  pendente_vinculo: { tone: "yellow", label: "Pendente vínculo" },
  vinculado:        { tone: "green",  label: "Vinculado" },
};

export function statusInfo(status: string | null | undefined): { tone: StatusTone; label: string } {
  if (!status) return { tone: "gray", label: "—" };
  const key = String(status).toLowerCase().trim();
  return MAP[key] ?? { tone: "gray", label: status };
}

export function statusBadgeClass(status: string | null | undefined): string {
  return STATUS_TONE_CLASS[statusInfo(status).tone];
}
