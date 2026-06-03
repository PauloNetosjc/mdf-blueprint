import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Package,
  Wrench,
  Cog,
  AlertTriangle,
  FolderKanban,
  Layers,
  Tag,
  QrCode,
  Scan,
  Boxes,
  GitCompare,
  ShieldCheck,
} from "lucide-react";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/projetos", label: "Projetos", icon: FolderKanban },
  { to: "/pecas", label: "Peças", icon: Package },
  { to: "/chapas", label: "Chapas", icon: Layers },
  { to: "/fitas", label: "Fitas", icon: Tag },
  { to: "/ferramentas", label: "Ferramentas", icon: Wrench },
  { to: "/maquina", label: "Máquina", icon: Cog },
  { to: "/etiquetas", label: "Etiquetas", icon: QrCode },
  { to: "/producao", label: "Produção", icon: Scan },
  { to: "/almoxarifado", label: "Almoxarifado", icon: Boxes },
  { to: "/homologacao", label: "Homologação", icon: ShieldCheck },
  { to: "/comparador", label: "Comparador CNC", icon: GitCompare },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });



  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border-strong bg-panel">
      <div className="flex items-center gap-2 border-b border-border-strong px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-primary text-primary-foreground">
          <Cog className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">Visualizador</div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Técnico CNC</div>
        </div>
      </div>

      <nav className="flex-1 p-2">
        {items.map((it) => {
          const active = it.to === "/" ? pathname === "/" : pathname.startsWith(it.to);
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              className={`mb-1 flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-surface-2"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{it.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border-strong p-3">

        <div className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            Prévia técnica. Validar G-code, pós-processador, ferramentas e limites antes da máquina real.
          </span>
        </div>
      </div>
    </aside>
  );
}
