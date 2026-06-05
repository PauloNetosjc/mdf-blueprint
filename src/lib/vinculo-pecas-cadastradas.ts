// Vínculo automático entre peças do projeto (projeto_pecas) e a biblioteca
// (pecas_cadastradas). Adapta a engenharia cadastrada às medidas reais da
// peça do projeto e cria operações + bordas IMPORTADAS para revisão.
//
// Não cria operações CNC definitivas — isso continua sendo manual via
// componente OperacoesImportadas / botão "Converter".

import { supabase } from "@/integrations/supabase/client";
import { parseTechnicalPartCode, getTipoPecaPorPrefixo } from "@/lib/pecas-cadastradas-parser";

// ---------- Tipos ----------

export type ProjetoPecaRow = {
  id: string;
  projeto_id: string;
  descricao: string;
  largura: number;
  altura: number;
  espessura: number;
  codigo_peca: string | null;
  modulo: string | null;
  fita_codigo: string | null;
};

export type PecaCadastradaRow = {
  id: string;
  codigo_completo: string | null;
  codigo_principal: string | null;
  prefixo: string | null;
  sufixo: string | null;
  tipo_peca: string | null;
  nome: string | null;
  largura_ref: number | null;
  altura_ref: number | null;
  espessura_ref: number | null;
  fita_ref: string | null;
};

export type TipoVinculo =
  | "codigo_exato"
  | "codigo_principal"
  | "prefixo_codigo"
  | "descricao"
  | "manual";

export type ConfiancaVinculo = "alta" | "media" | "baixa";

export type ResultadoVinculo = {
  projeto_peca_id: string;
  peca_cadastrada_id: string | null;
  tipo_vinculo: TipoVinculo;
  confianca: ConfiancaVinculo;
  motivo: string;
};

export type LogVinculo = {
  pecas_projeto: number;
  pecas_biblioteca: number;
  por_codigo_exato: number;
  por_codigo_principal: number;
  por_prefixo: number;
  por_descricao: number;
  sem_vinculo: number;
  operacoes_importadas: number;
  bordas_importadas: number;
  divergencias_fita: number;
  face5_em_nao_div: number;
  erros: string[];
  mensagens: string[];
};

// ---------- Normalização / heurísticas ----------

function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .trim();
}

const PALAVRA_TO_PREFIXO: Array<[RegExp, string]> = [
  [/divisor/i, "DIV"],
  [/\bbase\b|fundo da base/i, "BAS"],
  [/lateral/i, "LAT"],
  [/\bfundo\b/i, "FUN"],
  [/prateleir/i, "PRA"],
  [/painel/i, "PAI"],
  [/\btampo\b|tampa superior/i, "TAM"],
  [/travessa/i, "TRA"],
  [/\bcosta\b|costas/i, "COS"],
  [/\bporta\b/i, "POR"],
  [/\bfrente\b/i, "FRE"],
  [/gaveta/i, "GAV"],
  [/cabeceir/i, "CAB"],
  [/testeira/i, "TES"],
  [/rodap/i, "ROD"],
  [/perfil/i, "PRF"],
  [/regua|régua/i, "REG"],
  [/refor[cç]o/i, "REF"],
  [/\bsuporte\b/i, "SUP"],
  [/\bripado\b/i, "RIP"],
  [/afastador/i, "AFA"],
  [/arm[aá]rio|m[oó]dulo/i, "ARM"],
  [/pilar/i, "PIL"],
  [/zocalo|zócalo/i, "ZOC"],
];

export function inferirPrefixoPorDescricao(desc: string | null | undefined): string | null {
  const d = (desc ?? "").toString();
  for (const [re, pref] of PALAVRA_TO_PREFIXO) if (re.test(d)) return pref;
  return null;
}

export function inferirCodigoPrincipal(codigo: string | null | undefined): string | null {
  if (!codigo) return null;
  const t = codigo.toString().trim();
  // BAS1101A → 1101
  const m = t.match(/^[A-Za-z]*?(\d{2,})[A-Za-z]*$/);
  if (m) return m[1];
  const m2 = t.match(/(\d{3,})/);
  return m2 ? m2[1] : null;
}

// ---------- Matching ----------

export function casarPeca(
  peca: ProjetoPecaRow,
  catalogo: PecaCadastradaRow[],
  porCodigoCompleto: Map<string, PecaCadastradaRow>,
  porCodigoPrincipal: Map<string, PecaCadastradaRow[]>,
): ResultadoVinculo {
  const codigoNormal = (peca.codigo_peca ?? "").toUpperCase().trim();
  const parsed = codigoNormal ? parseTechnicalPartCode(codigoNormal) : null;

  // 1) Código completo exato
  if (parsed) {
    const hit = porCodigoCompleto.get(parsed.codigo_completo);
    if (hit) {
      return {
        projeto_peca_id: peca.id,
        peca_cadastrada_id: hit.id,
        tipo_vinculo: "codigo_exato",
        confianca: "alta",
        motivo: `Código ${parsed.codigo_completo} encontrado na biblioteca`,
      };
    }
  }

  // 2) Código principal
  const codigoPrincipal = parsed?.codigo_principal ?? inferirCodigoPrincipal(peca.codigo_peca);
  if (codigoPrincipal) {
    const hits = porCodigoPrincipal.get(codigoPrincipal) ?? [];
    if (hits.length === 1) {
      return {
        projeto_peca_id: peca.id,
        peca_cadastrada_id: hits[0].id,
        tipo_vinculo: "codigo_principal",
        confianca: "alta",
        motivo: `Código principal ${codigoPrincipal} (correspondência única)`,
      };
    }
    if (hits.length > 1) {
      // 3) Prefixo + código principal — tentar desambiguar
      const prefDesc = parsed?.prefixo ?? inferirPrefixoPorDescricao(peca.descricao);
      if (prefDesc) {
        const filt = hits.filter((h) => (h.prefixo ?? "").toUpperCase() === prefDesc);
        if (filt.length === 1) {
          return {
            projeto_peca_id: peca.id,
            peca_cadastrada_id: filt[0].id,
            tipo_vinculo: "prefixo_codigo",
            confianca: "media",
            motivo: `Prefixo ${prefDesc} + código ${codigoPrincipal}`,
          };
        }
      }
      return {
        projeto_peca_id: peca.id,
        peca_cadastrada_id: null,
        tipo_vinculo: "manual",
        confianca: "baixa",
        motivo: `Múltiplas peças (${hits.length}) com código ${codigoPrincipal} — escolha manual`,
      };
    }
  }

  // 4) Descrição semelhante
  const prefDesc = inferirPrefixoPorDescricao(peca.descricao);
  if (prefDesc) {
    const candidatos = catalogo.filter((c) => (c.prefixo ?? "").toUpperCase() === prefDesc);
    if (candidatos.length) {
      const tipo = getTipoPecaPorPrefixo(prefDesc);
      const targetDesc = normalize(peca.descricao);
      // melhor candidato: nome com maior overlap de palavras
      let best: { row: PecaCadastradaRow; score: number } | null = null;
      for (const c of candidatos) {
        const nome = normalize(c.nome ?? c.codigo_completo ?? "");
        const palavras = new Set(targetDesc.split(/\s+/).filter(Boolean));
        let score = 0;
        for (const p of nome.split(/\s+/)) if (palavras.has(p)) score++;
        if (!best || score > best.score) best = { row: c, score };
      }
      if (best && best.score > 0) {
        return {
          projeto_peca_id: peca.id,
          peca_cadastrada_id: best.row.id,
          tipo_vinculo: "descricao",
          confianca: "baixa",
          motivo: `Inferido por descrição (${tipo}) — revisar`,
        };
      }
    }
  }

  // 5) Sem vínculo
  return {
    projeto_peca_id: peca.id,
    peca_cadastrada_id: null,
    tipo_vinculo: "manual",
    confianca: "baixa",
    motivo: "Sem correspondência automática",
  };
}

// ---------- Adaptação às medidas reais ----------

type OperacaoCadastrada = {
  id: string;
  face: number;
  tipo: string | null;
  tipo_operacao: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  diametro: number | null;
  profundidade: number | null;
  largura: number | null;
  comprimento: number | null;
  x1: number | null;
  x2: number | null;
  y1: number | null;
  y2: number | null;
  ancora_x: string | null;
  ancora_y: string | null;
  offset_x: number | null;
  offset_y: number | null;
  ordem: number | null;
  confianca: string | null;
  observacao: string | null;
  dados_brutos: unknown;
};

type BordaCadastrada = {
  id: string;
  lado: string;
  tem_fita: boolean;
  fita_codigo: string | null;
  fita_descricao: string | null;
  espessura: number | null;
  largura: number | null;
  cor: string | null;
  indicador_desenho: string | null;
};

function adaptarX(
  op: OperacaoCadastrada,
  larguraReal: number,
  larguraRef: number | null,
): number | null {
  if (op.x == null && op.offset_x == null) return null;
  const ancora = (op.ancora_x ?? "absoluto").toLowerCase();
  const off = op.offset_x ?? op.x ?? 0;
  switch (ancora) {
    case "esquerda":
      return off;
    case "direita":
      return larguraReal - off;
    case "centro":
      return larguraReal / 2 + off;
    case "absoluto":
    default: {
      if (op.x == null) return null;
      // Se referência conhecida e ponto está perto da borda direita, espelhar.
      if (larguraRef && op.x > larguraRef * 0.5) {
        const dirOff = larguraRef - op.x;
        return larguraReal - dirOff;
      }
      return op.x;
    }
  }
}

function adaptarY(
  op: OperacaoCadastrada,
  alturaReal: number,
  alturaRef: number | null,
): number | null {
  if (op.y == null && op.offset_y == null) return null;
  const ancora = (op.ancora_y ?? "absoluto").toLowerCase();
  const off = op.offset_y ?? op.y ?? 0;
  switch (ancora) {
    case "inferior":
      return off;
    case "superior":
      return alturaReal - off;
    case "centro":
      return alturaReal / 2 + off;
    case "absoluto":
    default: {
      if (op.y == null) return null;
      if (alturaRef && op.y > alturaRef * 0.5) {
        const supOff = alturaRef - op.y;
        return alturaReal - supOff;
      }
      return op.y;
    }
  }
}

function adaptarX1X2(
  op: OperacaoCadastrada,
  larguraReal: number,
  larguraRef: number | null,
): { x1: number | null; x2: number | null } {
  if (op.x1 == null && op.x2 == null) return { x1: null, x2: null };
  if (!larguraRef) return { x1: op.x1, x2: op.x2 };
  // x1: offset da esquerda (mantém)
  // x2: offset da direita (largura_ref - x2)
  const offDir = op.x2 != null ? larguraRef - op.x2 : null;
  return {
    x1: op.x1 ?? null,
    x2: offDir != null ? larguraReal - offDir : null,
  };
}

// ---------- Função principal ----------

export type ModoReprocesso = "ausentes" | "todos" | "baixa_confianca";

export async function processarVinculosProjeto(
  projetoId: string,
  opts: { modo?: ModoReprocesso; substituirImportadasNaoRevisadas?: boolean } = {},
): Promise<LogVinculo> {
  const modo = opts.modo ?? "ausentes";
  const substituir = opts.substituirImportadasNaoRevisadas ?? true;

  const log: LogVinculo = {
    pecas_projeto: 0,
    pecas_biblioteca: 0,
    por_codigo_exato: 0,
    por_codigo_principal: 0,
    por_prefixo: 0,
    por_descricao: 0,
    sem_vinculo: 0,
    operacoes_importadas: 0,
    bordas_importadas: 0,
    divergencias_fita: 0,
    face5_em_nao_div: 0,
    erros: [],
    mensagens: [],
  };

  const { data: pecasProjeto, error: ePP } = await supabase
    .from("projeto_pecas")
    .select("id, projeto_id, descricao, largura, altura, espessura, codigo_peca, modulo, fita_codigo")
    .eq("projeto_id", projetoId);
  if (ePP) { log.erros.push(ePP.message); return log; }
  const pecas = (pecasProjeto ?? []) as ProjetoPecaRow[];
  log.pecas_projeto = pecas.length;

  const { data: catalogo, error: eCat } = await supabase
    .from("pecas_cadastradas")
    .select("id, codigo_completo, codigo_principal, prefixo, sufixo, tipo_peca, nome, largura_ref, altura_ref, espessura_ref, fita_ref");
  if (eCat) { log.erros.push(eCat.message); return log; }
  const cat = (catalogo ?? []) as PecaCadastradaRow[];
  log.pecas_biblioteca = cat.length;

  const porCodigoCompleto = new Map<string, PecaCadastradaRow>();
  const porCodigoPrincipal = new Map<string, PecaCadastradaRow[]>();
  for (const c of cat) {
    if (c.codigo_completo) porCodigoCompleto.set(c.codigo_completo.toUpperCase(), c);
    if (c.codigo_principal) {
      const list = porCodigoPrincipal.get(c.codigo_principal) ?? [];
      list.push(c);
      porCodigoPrincipal.set(c.codigo_principal, list);
    }
  }

  // Vínculos existentes
  const { data: vincExist } = await supabase
    .from("vinculos_peca_cadastrada")
    .select("*")
    .eq("projeto_id", projetoId);
  const vincPorPeca = new Map<string, any>();
  for (const v of (vincExist ?? []) as any[]) vincPorPeca.set(v.projeto_peca_id, v);

  // Filtragem por modo
  const pecasParaProcessar = pecas.filter((p) => {
    const v = vincPorPeca.get(p.id);
    if (!v) return true;
    if (v.status === "manual" || v.status === "rejeitado") return false;
    if (modo === "ausentes") return v.peca_cadastrada_id == null;
    if (modo === "baixa_confianca") return v.confianca === "baixa";
    return true; // "todos"
  });

  log.mensagens.push(`Iniciando vínculo com Peças Cadastradas (modo=${modo})`);
  log.mensagens.push(`Peças do projeto analisadas: ${pecasParaProcessar.length} de ${pecas.length}`);

  // Casar
  const resultados: ResultadoVinculo[] = pecasParaProcessar.map((p) =>
    casarPeca(p, cat, porCodigoCompleto, porCodigoPrincipal),
  );

  for (const r of resultados) {
    if (r.peca_cadastrada_id) {
      if (r.tipo_vinculo === "codigo_exato") log.por_codigo_exato++;
      else if (r.tipo_vinculo === "codigo_principal") log.por_codigo_principal++;
      else if (r.tipo_vinculo === "prefixo_codigo") log.por_prefixo++;
      else if (r.tipo_vinculo === "descricao") log.por_descricao++;
    } else log.sem_vinculo++;
  }

  // Upsert vínculos
  const vincRows = resultados.map((r) => ({
    projeto_id: projetoId,
    projeto_peca_id: r.projeto_peca_id,
    peca_cadastrada_id: r.peca_cadastrada_id,
    tipo_vinculo: r.tipo_vinculo,
    confianca: r.confianca,
    status: r.peca_cadastrada_id ? (r.confianca === "alta" ? "vinculado" : "pendente_revisao") : "sugerido",
    motivo: r.motivo,
  }));
  if (vincRows.length) {
    const { error } = await supabase
      .from("vinculos_peca_cadastrada")
      .upsert(vincRows as any, { onConflict: "projeto_peca_id" });
    if (error) log.erros.push(`Erro salvando vínculos: ${error.message}`);
  }

  // Aplicar engenharia para vínculos alta/média
  const aplicaveis = resultados.filter(
    (r) => r.peca_cadastrada_id && (r.confianca === "alta" || r.confianca === "media"),
  );

  if (aplicaveis.length) {
    // Carrega operações e bordas de todas as cadastradas envolvidas
    const cadIds = [...new Set(aplicaveis.map((r) => r.peca_cadastrada_id!))];
    const [{ data: opsCad }, { data: bordCad }] = await Promise.all([
      supabase.from("peca_cadastrada_operacoes").select("*").in("peca_cadastrada_id", cadIds),
      supabase.from("peca_cadastrada_bordas").select("*").in("peca_cadastrada_id", cadIds),
    ]);
    const opsPorPeca = new Map<string, OperacaoCadastrada[]>();
    for (const o of (opsCad ?? []) as any[]) {
      const list = opsPorPeca.get(o.peca_cadastrada_id) ?? [];
      list.push(o as OperacaoCadastrada);
      opsPorPeca.set(o.peca_cadastrada_id, list);
    }
    const bordPorPeca = new Map<string, BordaCadastrada[]>();
    for (const b of (bordCad ?? []) as any[]) {
      const list = bordPorPeca.get(b.peca_cadastrada_id) ?? [];
      list.push(b as BordaCadastrada);
      bordPorPeca.set(b.peca_cadastrada_id, list);
    }

    const pecaPorId = new Map<string, ProjetoPecaRow>(pecas.map((p) => [p.id, p]));
    const catPorId = new Map<string, PecaCadastradaRow>(cat.map((c) => [c.id, c]));

    // Limpar operações/bordas importadas anteriores (apenas não revisadas) se substituir=true
    const opsRowsParaInserir: any[] = [];
    const bordRowsParaInserir: any[] = [];

    for (const r of aplicaveis) {
      const peca = pecaPorId.get(r.projeto_peca_id)!;
      const cadRow = catPorId.get(r.peca_cadastrada_id!)!;
      const isDiv = (cadRow.prefixo ?? "").toUpperCase() === "DIV";

      if (substituir) {
        await supabase
          .from("peca_operacoes_importadas")
          .delete()
          .eq("projeto_peca_id", peca.id)
          .eq("origem", "biblioteca_pecas_cadastradas")
          .is("convertida_operacao_id", null);
        await supabase
          .from("peca_bordas_importadas")
          .delete()
          .eq("projeto_peca_id", peca.id)
          .eq("origem", "biblioteca_pecas_cadastradas")
          .neq("status", "revisada");
      }

      const ops = opsPorPeca.get(cadRow.id) ?? [];
      for (const op of ops) {
        if (op.face === 5 && !isDiv) {
          log.face5_em_nao_div++;
        }
        const xReal = adaptarX(op, peca.largura, cadRow.largura_ref);
        const yReal = adaptarY(op, peca.altura, cadRow.altura_ref);
        const { x1, x2 } = adaptarX1X2(op, peca.largura, cadRow.largura_ref);
        opsRowsParaInserir.push({
          projeto_id: projetoId,
          projeto_peca_id: peca.id,
          peca_cadastrada_id: cadRow.id,
          tipo_operacao: op.tipo_operacao ?? op.tipo ?? "furacao",
          face: String(op.face ?? 0),
          x: xReal,
          y: yReal,
          z: op.z,
          diametro: op.diametro,
          profundidade: op.profundidade,
          largura: op.largura,
          comprimento: op.comprimento,
          x1,
          x2,
          y1: op.y1,
          y2: op.y2,
          ordem: op.ordem ?? 0,
          confianca_parser: op.confianca ?? "media",
          origem: "biblioteca_pecas_cadastradas",
          status_vinculo: "aguardando_revisao",
          revisada: false,
          dados_brutos: {
            cad_id: op.id,
            ancora_x: op.ancora_x,
            ancora_y: op.ancora_y,
            offset_x: op.offset_x,
            offset_y: op.offset_y,
            face5_alerta: op.face === 5 && !isDiv,
          },
        });
      }

      const bords = bordPorPeca.get(cadRow.id) ?? [];
      for (const b of bords) {
        let divergencia: string | null = null;
        if (peca.fita_codigo && b.fita_codigo && peca.fita_codigo !== b.fita_codigo) {
          divergencia = `Projeto=${peca.fita_codigo} ≠ Biblioteca=${b.fita_codigo}`;
          log.divergencias_fita++;
        }
        bordRowsParaInserir.push({
          projeto_id: projetoId,
          projeto_peca_id: peca.id,
          peca_cadastrada_id: cadRow.id,
          lado: b.lado,
          tem_fita: b.tem_fita,
          fita_codigo: b.fita_codigo,
          fita_descricao: b.fita_descricao,
          espessura: b.espessura,
          largura: b.largura,
          cor: b.cor,
          indicador_desenho: b.indicador_desenho,
          origem: "biblioteca_pecas_cadastradas",
          status: "aguardando_revisao",
          divergencia,
        });
      }
    }

    // Insert em lote
    const inserir = async (tabela: string, rows: any[]) => {
      if (!rows.length) return 0;
      let total = 0;
      for (let i = 0; i < rows.length; i += 200) {
        const slice = rows.slice(i, i + 200);
        const { error } = await (supabase as any).from(tabela).insert(slice);
        if (error) log.erros.push(`${tabela}: ${error.message}`);
        else total += slice.length;
      }
      return total;
    };
    log.operacoes_importadas = await inserir("peca_operacoes_importadas", opsRowsParaInserir);
    log.bordas_importadas = await inserir("peca_bordas_importadas", bordRowsParaInserir);
  }

  log.mensagens.push(`Vínculos por código exato: ${log.por_codigo_exato}`);
  log.mensagens.push(`Vínculos por código principal: ${log.por_codigo_principal}`);
  log.mensagens.push(`Vínculos por prefixo+código: ${log.por_prefixo}`);
  log.mensagens.push(`Vínculos por descrição: ${log.por_descricao}`);
  log.mensagens.push(`Peças sem vínculo: ${log.sem_vinculo}`);
  log.mensagens.push(`Operações importadas para revisão: ${log.operacoes_importadas}`);
  log.mensagens.push(`Bordas importadas: ${log.bordas_importadas}`);
  if (log.divergencias_fita) log.mensagens.push(`Divergências de fita: ${log.divergencias_fita}`);
  if (log.face5_em_nao_div) log.mensagens.push(`Face 5 detectada em peça não-Divisória: ${log.face5_em_nao_div}`);

  return log;
}

// ---------- Vínculo manual ----------

export async function vincularManual(
  projetoId: string,
  projetoPecaId: string,
  pecaCadastradaId: string,
  aplicarEngenharia = true,
): Promise<LogVinculo> {
  await supabase.from("vinculos_peca_cadastrada").upsert(
    {
      projeto_id: projetoId,
      projeto_peca_id: projetoPecaId,
      peca_cadastrada_id: pecaCadastradaId,
      tipo_vinculo: "manual",
      confianca: "alta",
      status: "manual",
      motivo: "Vínculo manual confirmado pelo usuário",
    } as any,
    { onConflict: "projeto_peca_id" },
  );
  if (!aplicarEngenharia) {
    return {
      pecas_projeto: 1, pecas_biblioteca: 0, por_codigo_exato: 0, por_codigo_principal: 0,
      por_prefixo: 0, por_descricao: 0, sem_vinculo: 0, operacoes_importadas: 0,
      bordas_importadas: 0, divergencias_fita: 0, face5_em_nao_div: 0,
      erros: [], mensagens: ["Vínculo manual gravado sem aplicar engenharia"],
    };
  }
  return processarVinculosProjeto(projetoId, { modo: "todos", substituirImportadasNaoRevisadas: true });
}
