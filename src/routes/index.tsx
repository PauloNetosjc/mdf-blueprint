import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Package, Wrench, Cog, FileCode2, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Visualizador Técnico CNC" },
      { name: "description", content: "Painel do Visualizador Técnico CNC." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [pecas, ferramentas, previews, maquinas] = await Promise.all([
        supabase.from("pecas").select("id,status,largura,altura,espessura"),
        supabase.from("ferramentas").select("id,ativa"),
        supabase.from("previews_cnc").select("id,validado"),
        supabase.from("maquinas").select("id,area_x,area_y,area_z").eq("ativa", true),
      ]);
      const m = maquinas.data?.[0];
      const foraLimite = (pecas.data ?? []).filter(
        (p) => m && (p.largura > m.area_x || p.altura > m.area_y || p.espessura > m.area_z),
      );
      return {
        pecasTotal: pecas.data?.length ?? 0,
        pecasPendentes: pecas.data?.filter((p) => p.status !== "aprovada").length ?? 0,
        ferramentas: ferramentas.data?.filter((f) => f.ativa).length ?? 0,
        previews: previews.data?.length ?? 0,
        foraLimite: foraLimite.length,
        maquina: m,
      };
    },
  });

  const cards = [
    { label: "Peças cadastradas", value: data?.pecasTotal ?? 0, icon: Package, link: "/pecas" },
    { label: "Pendentes de validação", value: data?.pecasPendentes ?? 0, icon: AlertTriangle, link: "/pecas" },
    { label: "G-codes gerados", value: data?.previews ?? 0, icon: FileCode2, link: "/pecas" },
    { label: "Ferramentas ativas", value: data?.ferramentas ?? 0, icon: Wrench, link: "/ferramentas" },
  ];

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral do sistema.</p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.label}
              to={c.link}
              className="rounded border border-border bg-surface p-4 transition-colors hover:border-primary"
            >
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</div>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-2 font-mono text-3xl font-semibold">{c.value}</div>
            </Link>
          );
        })}
      </div>

      <section className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded border border-border bg-surface p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Cog className="h-4 w-4" /> Limites da máquina
          </div>
          {data?.maquina ? (
            <ul className="space-y-1 font-mono text-sm">
              <li>X máximo: {data.maquina.area_x} mm</li>
              <li>Y máximo: {data.maquina.area_y} mm</li>
              <li>Z máximo: {data.maquina.area_z} mm</li>
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma máquina ativa.</p>
          )}
        </div>
        <div className="rounded border border-border bg-surface p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-warning" /> Alertas
          </div>
          <p className="text-sm">
            {data?.foraLimite
              ? `${data.foraLimite} peça(s) fora dos limites da máquina ativa.`
              : "Nenhum alerta crítico no momento."}
          </p>
        </div>
      </section>
    </div>
  );
}
