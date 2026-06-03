import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";
import { SafetyBanner } from "@/components/safety-banner";
import { ensureDevSession } from "@/lib/dev-auth";
import { getStoredDemoUser, isDemoMode } from "@/lib/demo-mode";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  staleTime: Infinity,
  beforeLoad: async () => {
    if (isDemoMode()) {
      await ensureDevSession();
      return { user: getStoredDemoUser(), demo: true };
    }

    let { data } = await supabase.auth.getSession();
    if (!data.session) {
      const ok = await ensureDevSession();
      if (!ok) throw redirect({ to: "/auth" });
      ({ data } = await supabase.auth.getSession());
      if (!data.session) throw redirect({ to: "/auth" });
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
