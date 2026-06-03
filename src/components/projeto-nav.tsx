import { Link, useRouterState } from "@tanstack/react-router";
import {
  GitBranch, Package, Layers, QrCode, Boxes, Factory, ShieldCheck, FileArchive, History,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Item = {
  label: string;
  icon: typeof Package;
  to: string;
  params?: Record<string, string>;
  exact?: boolean;
};

export function ProjetoNav({ projetoId }: { projetoId: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const items: Item[] = [
    { label: "Fluxo",         icon: GitBranch,   to: "/projetos/$id/fluxo", params: { id: projetoId } },
    { label: "Peças",         icon: Package,     to: "/projetos/$id",       params: { id: projetoId }, exact: true },
    { label: "Plano de Corte", icon: Layers,     to: "/projetos/$id/plano", params: { id: projetoId } },
    { label: "Etiquetas",     icon: QrCode,      to: "/etiquetas" },
    { label: "Almoxarifado",  icon: Boxes,       to: "/almoxarifado" },
    { label: "Produção",      icon: Factory,     to: "/producao" },
    { label: "Homologação",   icon: ShieldCheck, to: "/homologacao" },
    { label: "Importações",   icon: FileArchive, to: "/importacoes" },
  ];

  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-border bg-panel/60 px-6 py-2">
      {items.map((it) => {
        const Icon = it.icon;
        const target = it.params
          ? `/projetos/${projetoId}${it.to === "/projetos/$id" ? "" : it.to.replace("/projetos/$id", "")}`
          : it.to;
        const active = it.exact ? pathname === target : pathname === target || pathname.startsWith(target + "/");
        return (
          <Link
            key={it.label}
            to={it.to as any}
            params={it.params as any}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {it.label}
          </Link>
        );
      })}
      <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <History className="h-3 w-3" />
        Auditoria visível no Fluxo
      </span>
    </nav>
  );
}
