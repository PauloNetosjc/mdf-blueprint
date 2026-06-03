import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import {
  ArrowLeft, Package, Layers, QrCode, Boxes, FileCode2, ShieldCheck,
  Send, Factory, CheckCircle2, ChevronRight, FileArchive, History,
} from "lucide-react";
import type { StatusTone } from "@/lib/status";
import { ProjetoNav } from "@/components/projeto-nav";

export const Route = createFileRoute("/_authenticated/projetos/$id/fluxo")({
  head: () => ({ meta: [{ title: "Fluxo do Projeto — Visualizador CNC" }] }),
  component: FluxoProjeto,
});

type Etapa = {
  key: string;
  titulo: string;
  icone: typeof Package;
  tone: StatusTone;
  status: string;
  resumo: string;
  pendencias: string[];
  data?: string | null;
  responsavel?: string | null;
  acao?: { label: string; to: string; params?: Record<string, string> };
};

function fmtData(d?: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }
  catch { return d; }
}

function FluxoProjeto() {
  const { id } = Route.useParams();

  const { data: projeto } = useQuery({
    queryKey: ["projeto", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("projetos").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: bundle, isLoading } = useQuery({
    queryKey: ["projeto-fluxo", id],
    staleTime: 5_000,
    queryFn: async () => {
      const [pecas, planos, etiquetas, almox, gcodes, aud, importacoes, producao] = await Promise.all([
        supabase.from("projeto_pecas").select("id,chapa_id,quantidade").eq("projeto_id", id),
        supabase.from("planos_corte").select("id,created_at,total_chapas,total_pecas,aproveitamento_medio,versao").eq("projeto_id", id).order("created_at", { ascending: false }),
        supabase.from("etiquetas").select("id,status_impressao,impresso_em,criado_em").eq("projeto_id", id),
        supabase.from("projeto_almoxarifado_itens").select("id,status,separado_em,separado_por").eq("projeto_id", id),
        supabase.from("previews_cnc_chapas").select("id,status_homologacao,aprovado_em,aprovado_por,exportado_em,exportado_por,enviado_maquina_em,enviado_maquina_por,criado_em,versao").eq("projeto_id", id).order("criado_em", { ascending: false }),
        supabase.from("auditoria_eventos").select("id,acao,operador,criado_em").eq("projeto_id", id).order("criado_em", { ascending: false }).limit(20),
        supabase.from("importacoes").select("id,status,criado_em,nome_arquivo").eq("projeto_id", id).order("criado_em", { ascending: false }),
        supabase.from("producao_eventos").select("id,tipo_evento,operador,criado_em").eq("projeto_id", id).order("criado_em", { ascending: false }).limit(50),
      ]);
      return {
        pecas: pecas.data ?? [],
        planos: planos.data ?? [],
        etiquetas: etiquetas.data ?? [],
        almox: almox.data ?? [],
        gcodes: gcodes.data ?? [],
        auditoria: aud.data ?? [],
        importacoes: importacoes.data ?? [],
        producao: producao.data ?? [],
      };
    },
  });

  const etapas: Etapa[] = (() => {
    if (!bundle) return [];
    const { pecas, planos, etiquetas, almox, gcodes, importacoes, producao } = bundle;

    // 0. Importação (se houver)
    const impOk = importacoes.find((i: any) => i.status === "concluido" || i.status === "ok") ?? importacoes[0];

    // 1. Peças
    const semChapa = pecas.filter((p: any) => !p.chapa_id).length;
    const totalUnid = pecas.reduce((s: number, p: any) => s + (p.quantidade ?? 0), 0);
    const etapaPecas: Etapa = {
      key: "pecas",
      titulo: "Peças cadastradas",
      icone: Package,
      tone: pecas.length === 0 ? "gray" : semChapa > 0 ? "yellow" : "green",
      status: pecas.length === 0 ? "Vazio" : semChapa > 0 ? "Atenção" : "OK",
      resumo: `${pecas.length} peças · ${totalUnid} unidades`,
      pendencias: semChapa > 0 ? [`${semChapa} peça(s) sem chapa definida`] : [],
      acao: { label: "Ver peças", to: "/projetos/$id", params: { id } },
    };

    // 2. Plano de corte
    const plano = planos[0];
    const etapaPlano: Etapa = {
      key: "plano",
      titulo: "Plano de corte gerado",
      icone: Layers,
      tone: plano ? "green" : "gray",
      status: plano ? "Gerado" : "Pendente",
      resumo: plano ? `v${plano.versao} · ${plano.total_chapas} chapa(s) · ${Math.round((plano.aproveitamento_medio ?? 0) * 100)}% aproveitamento` : "Nenhum plano gerado",
      pendencias: !plano && pecas.length > 0 ? ["Gere o plano de corte"] : [],
      data: plano?.created_at,
      acao: { label: plano ? "Abrir plano" : "Gerar plano", to: "/projetos/$id/plano", params: { id } },
    };

    // 3. Etiquetas
    const etiqImpressas = etiquetas.filter((e: any) => e.status_impressao === "impresso").length;
    const etapaEtiq: Etapa = {
      key: "etiquetas",
      titulo: "Etiquetas geradas",
      icone: QrCode,
      tone: etiquetas.length === 0 ? "gray" : etiqImpressas === etiquetas.length ? "green" : "orange",
      status: etiquetas.length === 0 ? "Pendente" : etiqImpressas === etiquetas.length ? "Impressas" : "Aguardando impressão",
      resumo: etiquetas.length === 0 ? "Nenhuma etiqueta" : `${etiquetas.length} etiqueta(s) · ${etiqImpressas} impressa(s)`,
      pendencias: etiquetas.length > 0 && etiqImpressas < etiquetas.length ? [`${etiquetas.length - etiqImpressas} etiqueta(s) pendente(s) de impressão`] : (plano && etiquetas.length === 0 ? ["Gere etiquetas a partir do plano"] : []),
      acao: { label: "Abrir etiquetas", to: "/etiquetas" },
    };

    // 4. Almoxarifado
    const almoxSep = almox.filter((a: any) => a.status === "separado" || a.status === "concluido").length;
    const etapaAlmox: Etapa = {
      key: "almox",
      titulo: "Almoxarifado separado",
      icone: Boxes,
      tone: almox.length === 0 ? "gray" : almoxSep === almox.length ? "green" : "orange",
      status: almox.length === 0 ? "Vazio" : almoxSep === almox.length ? "Separado" : "Em separação",
      resumo: almox.length === 0 ? "Sem itens" : `${almoxSep}/${almox.length} item(ns) separado(s)`,
      pendencias: almox.length > 0 && almoxSep < almox.length ? [`${almox.length - almoxSep} item(ns) pendente(s)`] : [],
      acao: { label: "Abrir almoxarifado", to: "/almoxarifado" },
    };

    // 5. G-code gerado
    const etapaGcode: Etapa = {
      key: "gcode",
      titulo: "G-code gerado",
      icone: FileCode2,
      tone: gcodes.length === 0 ? "gray" : "blue",
      status: gcodes.length === 0 ? "Pendente" : "Gerado",
      resumo: gcodes.length === 0 ? "Nenhum G-code" : `${gcodes.length} versão(ões)`,
      pendencias: plano && gcodes.length === 0 ? ["Gere G-code das chapas"] : [],
      data: gcodes[0]?.criado_em,
      acao: { label: plano ? "Abrir plano" : "Gerar plano primeiro", to: "/projetos/$id/plano", params: { id } },
    };

    // 6. Homologação
    const aprovados = gcodes.filter((g: any) => g.status_homologacao === "aprovado" || g.aprovado_em).length;
    const reprovados = gcodes.filter((g: any) => g.status_homologacao === "reprovado").length;
    const etapaHomo: Etapa = {
      key: "homo",
      titulo: "G-code homologado",
      icone: ShieldCheck,
      tone: gcodes.length === 0 ? "gray" : reprovados > 0 ? "red" : aprovados === gcodes.length ? "green" : "yellow",
      status: gcodes.length === 0 ? "—" : reprovados > 0 ? "Tem reprovação" : aprovados === gcodes.length ? "Aprovado" : "Pendente",
      resumo: gcodes.length === 0 ? "—" : `${aprovados}/${gcodes.length} aprovado(s)${reprovados ? ` · ${reprovados} reprovado(s)` : ""}`,
      pendencias: gcodes.length > aprovados ? [`${gcodes.length - aprovados} versão(ões) sem aprovação`] : [],
      data: gcodes.find((g: any) => g.aprovado_em)?.aprovado_em,
      responsavel: gcodes.find((g: any) => g.aprovado_por)?.aprovado_por,
      acao: { label: "Abrir homologação", to: "/homologacao" },
    };

    // 7. Enviado para máquina
    const enviados = gcodes.filter((g: any) => g.enviado_maquina_em).length;
    const etapaEnvio: Etapa = {
      key: "envio",
      titulo: "Enviado para máquina",
      icone: Send,
      tone: enviados === 0 ? "gray" : enviados === gcodes.length && gcodes.length > 0 ? "green" : "orange",
      status: enviados === 0 ? "Pendente" : `${enviados}/${gcodes.length}`,
      resumo: enviados === 0 ? "Aguardando envio" : `${enviados} arquivo(s) enviado(s)`,
      pendencias: aprovados > 0 && enviados < aprovados ? [`${aprovados - enviados} aprovado(s) ainda não enviado(s)`] : [],
      data: gcodes.find((g: any) => g.enviado_maquina_em)?.enviado_maquina_em,
      responsavel: gcodes.find((g: any) => g.enviado_maquina_por)?.enviado_maquina_por,
      acao: { label: "Homologação", to: "/homologacao" },
    };

    // 8. Em produção
    const evtCorte = producao.filter((p: any) => /corte/i.test(p.tipo_evento ?? "")).length;
    const etapaProd: Etapa = {
      key: "prod",
      titulo: "Em produção",
      icone: Factory,
      tone: producao.length === 0 ? "gray" : "blue",
      status: producao.length === 0 ? "Pendente" : "Em produção",
      resumo: producao.length === 0 ? "Sem bipagens" : `${producao.length} evento(s) · ${evtCorte} corte(s)`,
      pendencias: [],
      data: producao[0]?.criado_em,
      acao: { label: "Abrir produção", to: "/producao" },
    };

    // 9. Finalizado
    const finalizado = projeto?.status === "concluido" || projeto?.status === "finalizado";
    const etapaFim: Etapa = {
      key: "fim",
      titulo: "Finalizado",
      icone: CheckCircle2,
      tone: finalizado ? "green" : "gray",
      status: finalizado ? "Finalizado" : "Em aberto",
      resumo: finalizado ? "Projeto concluído" : "Pendente de encerramento",
      pendencias: [],
    };

    const lista: Etapa[] = [];
    if (impOk) {
      lista.push({
        key: "imp",
        titulo: "Importação técnica",
        icone: FileArchive,
        tone: "purple",
        status: impOk.status ?? "Importado",
        resumo: impOk.nome_arquivo ?? "Pacote importado",
        pendencias: [],
        data: impOk.criado_em,
        acao: { label: "Ver importação", to: "/importacoes/$id", params: { id: impOk.id } },
      });
    }
    lista.push(etapaPecas, etapaPlano, etapaEtiq, etapaAlmox, etapaGcode, etapaHomo, etapaEnvio, etapaProd, etapaFim);
    return lista;
  })();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border bg-panel px-6 py-3">
        <div className="flex items-center gap-3">
          <Link to="/projetos/$id" params={{ id }}>
            <Button size="sm" variant="ghost"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Fluxo · {projeto?.nome ?? "..."}</h1>
            <p className="text-xs text-muted-foreground">
              {[projeto?.cliente, projeto?.ambiente].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>
        {projeto?.status && <StatusBadge status={projeto.status} />}
      </header>

      <ProjetoNav projetoId={id} />

      <div className="flex-1 overflow-auto p-6">

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando fluxo…</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
            <ol className="relative space-y-3 border-l-2 border-border pl-6">
              {etapas.map((e) => {
                const Icon = e.icone;
                return (
                  <li key={e.key} className="relative">
                    <span
                      className={`absolute -left-[33px] top-2 grid h-6 w-6 place-content-center rounded-full border-2 border-background bg-${
                        e.tone === "green" ? "green" : e.tone === "red" ? "red" : e.tone === "yellow" ? "yellow" : e.tone === "orange" ? "orange" : e.tone === "blue" ? "blue" : e.tone === "purple" ? "purple" : "gray"
                      }-500`}
                      aria-hidden
                    >
                      <Icon className="h-3 w-3 text-white" />
                    </span>
                    <div className="rounded border border-border bg-surface p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold">{e.titulo}</h3>
                          <StatusBadge tone={e.tone} label={e.status} />
                        </div>
                        {e.acao && (
                          <Link to={e.acao.to as any} params={e.acao.params as any}>
                            <Button size="sm" variant="outline">
                              {e.acao.label}<ChevronRight className="ml-1 h-3 w-3" />
                            </Button>
                          </Link>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{e.resumo}</p>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                        {e.data && <span>📅 {fmtData(e.data)}</span>}
                        {e.responsavel && <span>👤 {e.responsavel}</span>}
                      </div>
                      {e.pendencias.length > 0 && (
                        <ul className="mt-2 space-y-0.5 rounded bg-yellow-50 p-2 text-[11px] text-yellow-800 dark:bg-yellow-500/10 dark:text-yellow-300">
                          {e.pendencias.map((p, i) => <li key={i}>⚠ {p}</li>)}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            <aside className="rounded border border-border bg-surface p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <History className="h-4 w-4" /> Auditoria recente
              </h3>
              {bundle && bundle.auditoria.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum evento registrado.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {bundle?.auditoria.slice(0, 12).map((a: any) => (
                    <li key={a.id} className="border-b border-border pb-2 last:border-0">
                      <div className="font-medium">{a.acao}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {fmtData(a.criado_em)}{a.operador ? ` · ${a.operador}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
