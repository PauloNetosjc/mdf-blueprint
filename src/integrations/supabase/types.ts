export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      almoxarifado_itens_catalogo: {
        Row: {
          ativo: boolean
          categoria: string
          criado_em: string
          custo_unitario: number
          descricao: string
          estoque_atual: number
          estoque_minimo: number
          id: string
          referencia: string
          unidade: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          categoria?: string
          criado_em?: string
          custo_unitario?: number
          descricao: string
          estoque_atual?: number
          estoque_minimo?: number
          id?: string
          referencia: string
          unidade?: string
          user_id?: string
        }
        Update: {
          ativo?: boolean
          categoria?: string
          criado_em?: string
          custo_unitario?: number
          descricao?: string
          estoque_atual?: number
          estoque_minimo?: number
          id?: string
          referencia?: string
          unidade?: string
          user_id?: string
        }
        Relationships: []
      }
      almoxarifado_movimentos: {
        Row: {
          criado_em: string
          id: string
          item_catalogo_id: string | null
          observacao: string | null
          operador: string | null
          origem: string | null
          projeto_id: string | null
          quantidade: number
          tipo_movimento: string
          unidade: string
          user_id: string
        }
        Insert: {
          criado_em?: string
          id?: string
          item_catalogo_id?: string | null
          observacao?: string | null
          operador?: string | null
          origem?: string | null
          projeto_id?: string | null
          quantidade?: number
          tipo_movimento?: string
          unidade?: string
          user_id?: string
        }
        Update: {
          criado_em?: string
          id?: string
          item_catalogo_id?: string | null
          observacao?: string | null
          operador?: string | null
          origem?: string | null
          projeto_id?: string | null
          quantidade?: number
          tipo_movimento?: string
          unidade?: string
          user_id?: string
        }
        Relationships: []
      }
      arquivos_importados: {
        Row: {
          created_at: string
          dados_extraidos_json: Json | null
          id: string
          nome_arquivo: string
          peca_id: string | null
          status_leitura: string | null
          tipo: string
          url_arquivo: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          dados_extraidos_json?: Json | null
          id?: string
          nome_arquivo: string
          peca_id?: string | null
          status_leitura?: string | null
          tipo: string
          url_arquivo?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          dados_extraidos_json?: Json | null
          id?: string
          nome_arquivo?: string
          peca_id?: string | null
          status_leitura?: string | null
          tipo?: string
          url_arquivo?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "arquivos_importados_peca_id_fkey"
            columns: ["peca_id"]
            isOneToOne: false
            referencedRelation: "pecas"
            referencedColumns: ["id"]
          },
        ]
      }
      arquivos_tecnicos: {
        Row: {
          chapa_id: string | null
          criado_em: string
          dados_extraidos_json: Json
          id: string
          importacao_id: string | null
          nome_arquivo: string
          origem_pasta: string | null
          peca_id: string | null
          projeto_id: string | null
          storage_url: string | null
          tipo_arquivo: string | null
          user_id: string
        }
        Insert: {
          chapa_id?: string | null
          criado_em?: string
          dados_extraidos_json?: Json
          id?: string
          importacao_id?: string | null
          nome_arquivo: string
          origem_pasta?: string | null
          peca_id?: string | null
          projeto_id?: string | null
          storage_url?: string | null
          tipo_arquivo?: string | null
          user_id?: string
        }
        Update: {
          chapa_id?: string | null
          criado_em?: string
          dados_extraidos_json?: Json
          id?: string
          importacao_id?: string | null
          nome_arquivo?: string
          origem_pasta?: string | null
          peca_id?: string | null
          projeto_id?: string | null
          storage_url?: string | null
          tipo_arquivo?: string | null
          user_id?: string
        }
        Relationships: []
      }
      centros_trabalho: {
        Row: {
          ativo: boolean
          criado_em: string
          id: string
          nome: string
          tipo: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          criado_em?: string
          id?: string
          nome: string
          tipo?: string
          user_id?: string
        }
        Update: {
          ativo?: boolean
          criado_em?: string
          id?: string
          nome?: string
          tipo?: string
          user_id?: string
        }
        Relationships: []
      }
      chapas: {
        Row: {
          altura: number
          ativa: boolean
          codigo: string
          cor: string
          created_at: string
          custo: number
          espessura: number
          estoque: number
          id: string
          largura: number
          nome: string
          permite_rotacao: boolean
          tipo: string
          user_id: string
          veio: string
        }
        Insert: {
          altura?: number
          ativa?: boolean
          codigo: string
          cor?: string
          created_at?: string
          custo?: number
          espessura: number
          estoque?: number
          id?: string
          largura?: number
          nome: string
          permite_rotacao?: boolean
          tipo?: string
          user_id?: string
          veio?: string
        }
        Update: {
          altura?: number
          ativa?: boolean
          codigo?: string
          cor?: string
          created_at?: string
          custo?: number
          espessura?: number
          estoque?: number
          id?: string
          largura?: number
          nome?: string
          permite_rotacao?: boolean
          tipo?: string
          user_id?: string
          veio?: string
        }
        Relationships: []
      }
      etiqueta_config: {
        Row: {
          altura_mm: number
          campos_visiveis: Json
          colunas: number
          espacamento_h_mm: number
          espacamento_v_mm: number
          id: string
          largura_mm: number
          linhas: number
          margem_mm: number
          orientacao: string
          preset: string
          updated_at: string
          user_id: string
        }
        Insert: {
          altura_mm?: number
          campos_visiveis?: Json
          colunas?: number
          espacamento_h_mm?: number
          espacamento_v_mm?: number
          id?: string
          largura_mm?: number
          linhas?: number
          margem_mm?: number
          orientacao?: string
          preset?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          altura_mm?: number
          campos_visiveis?: Json
          colunas?: number
          espacamento_h_mm?: number
          espacamento_v_mm?: number
          id?: string
          largura_mm?: number
          linhas?: number
          margem_mm?: number
          orientacao?: string
          preset?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      etiquetas: {
        Row: {
          codigo_barras: string
          conteudo_json: Json
          criado_em: string
          id: string
          impresso_em: string | null
          indice_peca: string
          numero_chapa: number
          plano_chapa_id: string | null
          plano_corte_peca_id: string | null
          plano_id: string | null
          projeto_id: string
          projeto_peca_id: string
          qr_code: string | null
          quantidade_impressoes: number
          status_impressao: string
          user_id: string
        }
        Insert: {
          codigo_barras: string
          conteudo_json?: Json
          criado_em?: string
          id?: string
          impresso_em?: string | null
          indice_peca?: string
          numero_chapa?: number
          plano_chapa_id?: string | null
          plano_corte_peca_id?: string | null
          plano_id?: string | null
          projeto_id: string
          projeto_peca_id: string
          qr_code?: string | null
          quantidade_impressoes?: number
          status_impressao?: string
          user_id?: string
        }
        Update: {
          codigo_barras?: string
          conteudo_json?: Json
          criado_em?: string
          id?: string
          impresso_em?: string | null
          indice_peca?: string
          numero_chapa?: number
          plano_chapa_id?: string | null
          plano_corte_peca_id?: string | null
          plano_id?: string | null
          projeto_id?: string
          projeto_peca_id?: string
          qr_code?: string | null
          quantidade_impressoes?: number
          status_impressao?: string
          user_id?: string
        }
        Relationships: []
      }
      faces: {
        Row: {
          eixo_x_mapeado: string | null
          eixo_y_mapeado: string | null
          eixo_z_mapeado: string | null
          id: string
          nome_face: string | null
          numero_face: number
          orientacao: string | null
          peca_id: string
          user_id: string
        }
        Insert: {
          eixo_x_mapeado?: string | null
          eixo_y_mapeado?: string | null
          eixo_z_mapeado?: string | null
          id?: string
          nome_face?: string | null
          numero_face: number
          orientacao?: string | null
          peca_id: string
          user_id?: string
        }
        Update: {
          eixo_x_mapeado?: string | null
          eixo_y_mapeado?: string | null
          eixo_z_mapeado?: string | null
          id?: string
          nome_face?: string | null
          numero_face?: number
          orientacao?: string | null
          peca_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "faces_peca_id_fkey"
            columns: ["peca_id"]
            isOneToOne: false
            referencedRelation: "pecas"
            referencedColumns: ["id"]
          },
        ]
      }
      ferramentas: {
        Row: {
          altura_segura: number
          area_util: number | null
          ativa: boolean
          avanco_padrao: number
          codigo: string
          created_at: string
          descida_antes_entrada_lateral: number | null
          diametro: number
          entrada_lateral: boolean
          entrada_por_cima: boolean
          face_permitida: string
          id: string
          maquina_id: string | null
          nome: string
          profundidade_maxima: number
          rotacao_padrao: number
          tipo: string
          user_id: string
        }
        Insert: {
          altura_segura?: number
          area_util?: number | null
          ativa?: boolean
          avanco_padrao?: number
          codigo: string
          created_at?: string
          descida_antes_entrada_lateral?: number | null
          diametro: number
          entrada_lateral?: boolean
          entrada_por_cima?: boolean
          face_permitida?: string
          id?: string
          maquina_id?: string | null
          nome: string
          profundidade_maxima?: number
          rotacao_padrao?: number
          tipo: string
          user_id?: string
        }
        Update: {
          altura_segura?: number
          area_util?: number | null
          ativa?: boolean
          avanco_padrao?: number
          codigo?: string
          created_at?: string
          descida_antes_entrada_lateral?: number | null
          diametro?: number
          entrada_lateral?: boolean
          entrada_por_cima?: boolean
          face_permitida?: string
          id?: string
          maquina_id?: string | null
          nome?: string
          profundidade_maxima?: number
          rotacao_padrao?: number
          tipo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ferramentas_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
        ]
      }
      fitas: {
        Row: {
          chapa_id: string | null
          codigo: string
          cor: string
          created_at: string
          custo: number
          descricao: string
          espessura: number
          estoque_m: number
          id: string
          largura: number
          user_id: string
        }
        Insert: {
          chapa_id?: string | null
          codigo: string
          cor?: string
          created_at?: string
          custo?: number
          descricao: string
          espessura?: number
          estoque_m?: number
          id?: string
          largura?: number
          user_id?: string
        }
        Update: {
          chapa_id?: string | null
          codigo?: string
          cor?: string
          created_at?: string
          custo?: number
          descricao?: string
          espessura?: number
          estoque_m?: number
          id?: string
          largura?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fitas_chapa_id_fkey"
            columns: ["chapa_id"]
            isOneToOne: false
            referencedRelation: "chapas"
            referencedColumns: ["id"]
          },
        ]
      }
      importacao_arquivos: {
        Row: {
          caminho_original: string
          criado_em: string
          id: string
          importacao_id: string
          metadados_json: Json
          nome_arquivo: string
          origem_pasta: string | null
          status_leitura: string
          storage_url: string | null
          tipo_arquivo: string | null
          user_id: string
        }
        Insert: {
          caminho_original: string
          criado_em?: string
          id?: string
          importacao_id: string
          metadados_json?: Json
          nome_arquivo: string
          origem_pasta?: string | null
          status_leitura?: string
          storage_url?: string | null
          tipo_arquivo?: string | null
          user_id?: string
        }
        Update: {
          caminho_original?: string
          criado_em?: string
          id?: string
          importacao_id?: string
          metadados_json?: Json
          nome_arquivo?: string
          origem_pasta?: string | null
          status_leitura?: string
          storage_url?: string | null
          tipo_arquivo?: string | null
          user_id?: string
        }
        Relationships: []
      }
      importacoes: {
        Row: {
          ambiente_detectado: string | null
          cliente_detectado: string | null
          criado_em: string
          erros_json: Json
          id: string
          nome_arquivo: string
          projeto_detectado: string | null
          projeto_id: string | null
          resumo_json: Json
          status: string
          tipo: string
          user_id: string
        }
        Insert: {
          ambiente_detectado?: string | null
          cliente_detectado?: string | null
          criado_em?: string
          erros_json?: Json
          id?: string
          nome_arquivo: string
          projeto_detectado?: string | null
          projeto_id?: string | null
          resumo_json?: Json
          status?: string
          tipo?: string
          user_id?: string
        }
        Update: {
          ambiente_detectado?: string | null
          cliente_detectado?: string | null
          criado_em?: string
          erros_json?: Json
          id?: string
          nome_arquivo?: string
          projeto_detectado?: string | null
          projeto_id?: string | null
          resumo_json?: Json
          status?: string
          tipo?: string
          user_id?: string
        }
        Relationships: []
      }
      maquinas: {
        Row: {
          altura_segura_z: number
          area_x: number
          area_y: number
          area_z: number
          ativa: boolean
          created_at: string
          id: string
          mapeamento_faces: Json
          nome: string
          origem_padrao: string
          template_fim: string
          template_furacao_face: string
          template_furacao_lateral: string
          template_inicio: string
          template_spindle_off: string
          template_spindle_on: string
          template_troca_ferramenta: string
          unidade: string
          updated_at: string
          user_id: string
        }
        Insert: {
          altura_segura_z?: number
          area_x?: number
          area_y?: number
          area_z?: number
          ativa?: boolean
          created_at?: string
          id?: string
          mapeamento_faces?: Json
          nome: string
          origem_padrao?: string
          template_fim?: string
          template_furacao_face?: string
          template_furacao_lateral?: string
          template_inicio?: string
          template_spindle_off?: string
          template_spindle_on?: string
          template_troca_ferramenta?: string
          unidade?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          altura_segura_z?: number
          area_x?: number
          area_y?: number
          area_z?: number
          ativa?: boolean
          created_at?: string
          id?: string
          mapeamento_faces?: Json
          nome?: string
          origem_padrao?: string
          template_fim?: string
          template_furacao_face?: string
          template_furacao_lateral?: string
          template_inicio?: string
          template_spindle_off?: string
          template_spindle_on?: string
          template_troca_ferramenta?: string
          unidade?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ocorrencias_producao: {
        Row: {
          centro_trabalho_id: string | null
          criado_em: string
          descricao: string | null
          etiqueta_id: string | null
          id: string
          operador: string | null
          projeto_id: string | null
          projeto_peca_id: string | null
          resolvido_em: string | null
          status: string
          tipo: string
          user_id: string
        }
        Insert: {
          centro_trabalho_id?: string | null
          criado_em?: string
          descricao?: string | null
          etiqueta_id?: string | null
          id?: string
          operador?: string | null
          projeto_id?: string | null
          projeto_peca_id?: string | null
          resolvido_em?: string | null
          status?: string
          tipo?: string
          user_id?: string
        }
        Update: {
          centro_trabalho_id?: string | null
          criado_em?: string
          descricao?: string | null
          etiqueta_id?: string | null
          id?: string
          operador?: string | null
          projeto_id?: string | null
          projeto_peca_id?: string | null
          resolvido_em?: string | null
          status?: string
          tipo?: string
          user_id?: string
        }
        Relationships: []
      }
      operacoes: {
        Row: {
          comprimento: number | null
          created_at: string
          diametro: number | null
          face_id: string | null
          ferramenta_id: string | null
          id: string
          largura: number | null
          numero_face: number
          observacao: string | null
          ordem: number
          peca_id: string
          profundidade: number
          tipo: string
          user_id: string
          x: number
          y: number
          z: number | null
        }
        Insert: {
          comprimento?: number | null
          created_at?: string
          diametro?: number | null
          face_id?: string | null
          ferramenta_id?: string | null
          id?: string
          largura?: number | null
          numero_face?: number
          observacao?: string | null
          ordem?: number
          peca_id: string
          profundidade: number
          tipo: string
          user_id?: string
          x: number
          y: number
          z?: number | null
        }
        Update: {
          comprimento?: number | null
          created_at?: string
          diametro?: number | null
          face_id?: string | null
          ferramenta_id?: string | null
          id?: string
          largura?: number | null
          numero_face?: number
          observacao?: string | null
          ordem?: number
          peca_id?: string
          profundidade?: number
          tipo?: string
          user_id?: string
          x?: number
          y?: number
          z?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "operacoes_face_id_fkey"
            columns: ["face_id"]
            isOneToOne: false
            referencedRelation: "faces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operacoes_ferramenta_id_fkey"
            columns: ["ferramenta_id"]
            isOneToOne: false
            referencedRelation: "ferramentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operacoes_peca_id_fkey"
            columns: ["peca_id"]
            isOneToOne: false
            referencedRelation: "pecas"
            referencedColumns: ["id"]
          },
        ]
      }
      peca_operacoes_importadas: {
        Row: {
          arquivo_tecnico_id: string | null
          comprimento: number | null
          criado_em: string
          dados_brutos: Json
          diametro: number | null
          face: string | null
          id: string
          largura: number | null
          origem: string | null
          peca_id: string | null
          profundidade: number | null
          projeto_id: string | null
          tipo_operacao: string | null
          user_id: string
          x: number | null
          y: number | null
          z: number | null
        }
        Insert: {
          arquivo_tecnico_id?: string | null
          comprimento?: number | null
          criado_em?: string
          dados_brutos?: Json
          diametro?: number | null
          face?: string | null
          id?: string
          largura?: number | null
          origem?: string | null
          peca_id?: string | null
          profundidade?: number | null
          projeto_id?: string | null
          tipo_operacao?: string | null
          user_id?: string
          x?: number | null
          y?: number | null
          z?: number | null
        }
        Update: {
          arquivo_tecnico_id?: string | null
          comprimento?: number | null
          criado_em?: string
          dados_brutos?: Json
          diametro?: number | null
          face?: string | null
          id?: string
          largura?: number | null
          origem?: string | null
          peca_id?: string | null
          profundidade?: number | null
          projeto_id?: string | null
          tipo_operacao?: string | null
          user_id?: string
          x?: number | null
          y?: number | null
          z?: number | null
        }
        Relationships: []
      }
      pecas: {
        Row: {
          altura: number
          ambiente: string | null
          arquivo_origem: string | null
          cliente: string | null
          codigo: string
          created_at: string
          data_ficha: string | null
          espessura: number
          face_alinhamento: string
          id: string
          largura: number
          material: string | null
          nome: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          altura: number
          ambiente?: string | null
          arquivo_origem?: string | null
          cliente?: string | null
          codigo: string
          created_at?: string
          data_ficha?: string | null
          espessura: number
          face_alinhamento?: string
          id?: string
          largura: number
          material?: string | null
          nome: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          altura?: number
          ambiente?: string | null
          arquivo_origem?: string | null
          cliente?: string | null
          codigo?: string
          created_at?: string
          data_ficha?: string | null
          espessura?: number
          face_alinhamento?: string
          id?: string
          largura?: number
          material?: string | null
          nome?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      plano_corte_chapas: {
        Row: {
          aproveitamento: number
          area_usada: number
          chapa_id: string
          id: string
          indice: number
          plano_id: string
          user_id: string
        }
        Insert: {
          aproveitamento?: number
          area_usada?: number
          chapa_id: string
          id?: string
          indice: number
          plano_id: string
          user_id?: string
        }
        Update: {
          aproveitamento?: number
          area_usada?: number
          chapa_id?: string
          id?: string
          indice?: number
          plano_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plano_corte_chapas_chapa_id_fkey"
            columns: ["chapa_id"]
            isOneToOne: false
            referencedRelation: "chapas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_corte_chapas_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "planos_corte"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_corte_pecas: {
        Row: {
          altura: number
          id: string
          largura: number
          plano_chapa_id: string
          projeto_peca_id: string
          rotacionada: boolean
          user_id: string
          x: number
          y: number
        }
        Insert: {
          altura: number
          id?: string
          largura: number
          plano_chapa_id: string
          projeto_peca_id: string
          rotacionada?: boolean
          user_id?: string
          x: number
          y: number
        }
        Update: {
          altura?: number
          id?: string
          largura?: number
          plano_chapa_id?: string
          projeto_peca_id?: string
          rotacionada?: boolean
          user_id?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "plano_corte_pecas_plano_chapa_id_fkey"
            columns: ["plano_chapa_id"]
            isOneToOne: false
            referencedRelation: "plano_corte_chapas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_corte_pecas_projeto_peca_id_fkey"
            columns: ["projeto_peca_id"]
            isOneToOne: false
            referencedRelation: "projeto_pecas"
            referencedColumns: ["id"]
          },
        ]
      }
      planos_corte: {
        Row: {
          aproveitamento_medio: number
          created_at: string
          id: string
          projeto_id: string
          total_chapas: number
          total_pecas: number
          user_id: string
          versao: number
        }
        Insert: {
          aproveitamento_medio?: number
          created_at?: string
          id?: string
          projeto_id: string
          total_chapas?: number
          total_pecas?: number
          user_id?: string
          versao?: number
        }
        Update: {
          aproveitamento_medio?: number
          created_at?: string
          id?: string
          projeto_id?: string
          total_chapas?: number
          total_pecas?: number
          user_id?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "planos_corte_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      previews_cnc: {
        Row: {
          aprovado_por: string | null
          conteudo: string
          created_at: string
          id: string
          maquina_id: string
          nome_arquivo: string
          peca_id: string
          user_id: string
          validado: boolean
          versao: number
        }
        Insert: {
          aprovado_por?: string | null
          conteudo: string
          created_at?: string
          id?: string
          maquina_id: string
          nome_arquivo: string
          peca_id: string
          user_id?: string
          validado?: boolean
          versao?: number
        }
        Update: {
          aprovado_por?: string | null
          conteudo?: string
          created_at?: string
          id?: string
          maquina_id?: string
          nome_arquivo?: string
          peca_id?: string
          user_id?: string
          validado?: boolean
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "previews_cnc_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "previews_cnc_peca_id_fkey"
            columns: ["peca_id"]
            isOneToOne: false
            referencedRelation: "pecas"
            referencedColumns: ["id"]
          },
        ]
      }
      producao_eventos: {
        Row: {
          centro_trabalho_id: string | null
          codigo_barras: string | null
          criado_em: string
          etiqueta_id: string | null
          id: string
          observacao: string | null
          operador: string | null
          plano_corte_peca_id: string | null
          projeto_id: string | null
          projeto_peca_id: string | null
          status_anterior: string | null
          status_novo: string | null
          tipo_evento: string
          user_id: string
        }
        Insert: {
          centro_trabalho_id?: string | null
          codigo_barras?: string | null
          criado_em?: string
          etiqueta_id?: string | null
          id?: string
          observacao?: string | null
          operador?: string | null
          plano_corte_peca_id?: string | null
          projeto_id?: string | null
          projeto_peca_id?: string | null
          status_anterior?: string | null
          status_novo?: string | null
          tipo_evento: string
          user_id?: string
        }
        Update: {
          centro_trabalho_id?: string | null
          codigo_barras?: string | null
          criado_em?: string
          etiqueta_id?: string | null
          id?: string
          observacao?: string | null
          operador?: string | null
          plano_corte_peca_id?: string | null
          projeto_id?: string | null
          projeto_peca_id?: string | null
          status_anterior?: string | null
          status_novo?: string | null
          tipo_evento?: string
          user_id?: string
        }
        Relationships: []
      }
      producao_status_pecas: {
        Row: {
          atualizado_em: string
          etiqueta_id: string | null
          id: string
          plano_corte_peca_id: string | null
          projeto_id: string
          projeto_peca_id: string
          status_almoxarifado: string
          status_borda: string
          status_corte: string
          status_expedicao: string
          status_furacao: string
          status_separacao: string
          user_id: string
        }
        Insert: {
          atualizado_em?: string
          etiqueta_id?: string | null
          id?: string
          plano_corte_peca_id?: string | null
          projeto_id: string
          projeto_peca_id: string
          status_almoxarifado?: string
          status_borda?: string
          status_corte?: string
          status_expedicao?: string
          status_furacao?: string
          status_separacao?: string
          user_id?: string
        }
        Update: {
          atualizado_em?: string
          etiqueta_id?: string | null
          id?: string
          plano_corte_peca_id?: string | null
          projeto_id?: string
          projeto_peca_id?: string
          status_almoxarifado?: string
          status_borda?: string
          status_corte?: string
          status_expedicao?: string
          status_furacao?: string
          status_separacao?: string
          user_id?: string
        }
        Relationships: []
      }
      projeto_almoxarifado_itens: {
        Row: {
          ambiente: string | null
          categoria: string
          criado_em: string
          descricao: string
          id: string
          item_catalogo_id: string | null
          modulo: string | null
          observacao: string | null
          origem: string
          projeto_id: string
          quantidade: number
          referencia: string | null
          separado_em: string | null
          separado_por: string | null
          status: string
          unidade: string
          user_id: string
        }
        Insert: {
          ambiente?: string | null
          categoria?: string
          criado_em?: string
          descricao: string
          id?: string
          item_catalogo_id?: string | null
          modulo?: string | null
          observacao?: string | null
          origem?: string
          projeto_id: string
          quantidade?: number
          referencia?: string | null
          separado_em?: string | null
          separado_por?: string | null
          status?: string
          unidade?: string
          user_id?: string
        }
        Update: {
          ambiente?: string | null
          categoria?: string
          criado_em?: string
          descricao?: string
          id?: string
          item_catalogo_id?: string | null
          modulo?: string | null
          observacao?: string | null
          origem?: string
          projeto_id?: string
          quantidade?: number
          referencia?: string | null
          separado_em?: string | null
          separado_por?: string | null
          status?: string
          unidade?: string
          user_id?: string
        }
        Relationships: []
      }
      projeto_pecas: {
        Row: {
          altura: number
          chapa_id: string | null
          created_at: string
          descricao: string
          espessura: number
          fita_codigo: string | null
          id: string
          largura: number
          modulo: string | null
          observacao: string | null
          ordem: number
          peca_id: string | null
          projeto_id: string
          quantidade: number
          user_id: string
        }
        Insert: {
          altura: number
          chapa_id?: string | null
          created_at?: string
          descricao: string
          espessura?: number
          fita_codigo?: string | null
          id?: string
          largura: number
          modulo?: string | null
          observacao?: string | null
          ordem?: number
          peca_id?: string | null
          projeto_id: string
          quantidade?: number
          user_id?: string
        }
        Update: {
          altura?: number
          chapa_id?: string | null
          created_at?: string
          descricao?: string
          espessura?: number
          fita_codigo?: string | null
          id?: string
          largura?: number
          modulo?: string | null
          observacao?: string | null
          ordem?: number
          peca_id?: string | null
          projeto_id?: string
          quantidade?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projeto_pecas_chapa_id_fkey"
            columns: ["chapa_id"]
            isOneToOne: false
            referencedRelation: "chapas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projeto_pecas_peca_id_fkey"
            columns: ["peca_id"]
            isOneToOne: false
            referencedRelation: "pecas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projeto_pecas_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      projetos: {
        Row: {
          ambiente: string | null
          cliente: string | null
          created_at: string
          id: string
          nome: string
          observacao: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ambiente?: string | null
          cliente?: string | null
          created_at?: string
          id?: string
          nome: string
          observacao?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          ambiente?: string | null
          cliente?: string | null
          created_at?: string
          id?: string
          nome?: string
          observacao?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sobras_chapa: {
        Row: {
          altura: number
          id: string
          largura: number
          plano_chapa_id: string
          user_id: string
          x: number
          y: number
        }
        Insert: {
          altura: number
          id?: string
          largura: number
          plano_chapa_id: string
          user_id?: string
          x: number
          y: number
        }
        Update: {
          altura?: number
          id?: string
          largura?: number
          plano_chapa_id?: string
          user_id?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "sobras_chapa_plano_chapa_id_fkey"
            columns: ["plano_chapa_id"]
            isOneToOne: false
            referencedRelation: "plano_corte_chapas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
