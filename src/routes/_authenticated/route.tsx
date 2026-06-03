import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";
import { SafetyBanner } from "@/components/safety-banner";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Não re-executa o beforeLoad ao navegar entre rotas filhas —
  // a sessão é local (localStorage) e fica válida até logout/expiração.
  staleTime: Infinity,
  beforeLoad: async () => {
    // getSession() é síncrono em relação ao storage local (sem rede),
    // muito mais rápido que getUser() (que valida no servidor a cada call).
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/auth" });
    }
    return { user: data.session.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <SafetyBanner />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
