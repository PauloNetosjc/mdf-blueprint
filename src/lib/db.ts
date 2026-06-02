export type Maquina = {
  id: string;
  nome: string;
  area_x: number;
  area_y: number;
  area_z: number;
  altura_segura_z: number;
  unidade: string;
  origem_padrao: string;
  template_inicio: string;
  template_fim: string;
  template_troca_ferramenta: string;
  template_spindle_on: string;
  template_spindle_off: string;
  template_furacao_face: string;
  template_furacao_lateral: string;
  mapeamento_faces: Record<string, { eixo_x: string; eixo_y: string; eixo_z: string }>;
  ativa: boolean;
};

export type Ferramenta = {
  id: string;
  maquina_id: string | null;
  nome: string;
  codigo: string;
  tipo: string;
  diametro: number;
  area_util: number | null;
  profundidade_maxima: number;
  rotacao_padrao: number;
  avanco_padrao: number;
  face_permitida: "face_superior" | "topo_lateral" | "ambas";
  entrada_por_cima: boolean;
  entrada_lateral: boolean;
  descida_antes_entrada_lateral: number | null;
  altura_segura: number;
  ativa: boolean;
};

export type Peca = {
  id: string;
  codigo: string;
  nome: string;
  cliente: string | null;
  ambiente: string | null;
  largura: number;
  altura: number;
  espessura: number;
  material: string | null;
  face_alinhamento: string;
  status: string;
  arquivo_origem: string | null;
  data_ficha: string | null;
};

export type Operacao = {
  id: string;
  peca_id: string;
  face_id: string | null;
  numero_face: number;
  ferramenta_id: string | null;
  tipo: string;
  x: number;
  y: number;
  z: number | null;
  diametro: number | null;
  largura: number | null;
  comprimento: number | null;
  profundidade: number;
  ordem: number;
  observacao: string | null;
};

export type PreviewCnc = {
  id: string;
  peca_id: string;
  maquina_id: string;
  versao: number;
  conteudo: string;
  nome_arquivo: string;
  validado: boolean;
  aprovado_por: string | null;
  created_at: string;
};

export const TIPOS_OPERACAO = [
  { value: "furacao", label: "Furação" },
  { value: "rasgo", label: "Rasgo" },
  { value: "canal", label: "Canal" },
  { value: "rebaixo", label: "Rebaixo" },
  { value: "corte", label: "Corte simples" },
  { value: "usinagem_linear", label: "Usinagem linear" },
  { value: "usinagem_retangular", label: "Usinagem retangular" },
];

export const TIPOS_FERRAMENTA = [
  { value: "furo_face", label: "Furo de face" },
  { value: "furo_topo", label: "Furo de topo/lateral" },
  { value: "rasgo", label: "Rasgo" },
  { value: "rebaixo", label: "Rebaixo" },
  { value: "canal", label: "Canal" },
  { value: "corte", label: "Corte" },
  { value: "usinagem_linear", label: "Usinagem linear" },
];

export const FACES_PERMITIDAS = [
  { value: "face_superior", label: "Face superior (0)" },
  { value: "topo_lateral", label: "Topo / lateral (1-4)" },
  { value: "ambas", label: "Ambas" },
];
