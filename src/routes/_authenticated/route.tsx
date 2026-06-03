import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";
import { SafetyBanner } from "@/components/safety-banner";
import { ensureDevSession } from "@/lib/dev-auth";
import { getStoredDemoUser, isDemoMode } from "@/lib/demo-mode";

// Cache em módulo — evita re-checar a sessão a cada navegação entre rotas
// filhas do layout autenticado. Sem isso o beforeLoad fica assíncrono em
// toda troca de tela e o <Outlet /> pisca enquanto o await resolve.
let sessionEnsured = false;

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Mantém o match em cache para sempre — não re-executa beforeLoad ao
  // navegar entre rotas irmãs (Projetos → Peças → Chapas, etc).
  staleTime: Infinity,
  gcTime: Infinity,
  shouldReload: false,
  beforeLoad: async () => {
    // Caminho rápido: já garantimos a sessão neste boot. Retorno síncrono,
    // navegação instantânea sem desmontar o layout.
    if (sessionEnsured) {
      return {
        user: isDemoMode() ? getStoredDemoUser() : undefined,
        demo: isDemoMode(),
      };
    }

    if (isDemoMode()) {
      await ensureDevSession();
      sessionEnsured = true;
      return { user: getStoredDemoUser(), demo: true };
    }

    let { data } = await supabase.auth.getSession();
    if (!data.session) {
      const ok = await ensureDevSession();
      if (!ok) throw redirect({ to: "/auth" });
      ({ data } = await supabase.auth.getSession());
      if (!data.session) throw redirect({ to: "/auth" });
    }
    sessionEnsured = true;
    return { user: data.session.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <SafetyBanner />
        {/* min-h-0 + bg-background estável: ao trocar de rota o fundo nunca
            fica branco, mesmo que a página filha demore para montar. */}
        <main className="flex-1 min-h-0 overflow-auto bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
