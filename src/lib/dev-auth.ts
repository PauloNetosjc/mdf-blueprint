import { supabase } from "@/integrations/supabase/client";
import { ensureDemoAuthUser } from "@/lib/demo-auth.functions";
import { DEMO_USER_EMAIL, DEMO_USER_PASSWORD, getStoredDemoUser, isDemoMode, persistDemoUser } from "@/lib/demo-mode";

export const DEV_USER_EMAIL = DEMO_USER_EMAIL;
export const DEV_USER_PASSWORD = DEMO_USER_PASSWORD;

let inflight: Promise<boolean> | null = null;

/**
 * Garante que exista uma sessão ativa. Se não houver, faz login automático
 * com o usuário fixo de desenvolvimento. Cria o usuário se necessário.
 * Retorna true se ao final há sessão válida.
 */
export async function ensureDevSession(): Promise<boolean> {
  if (isDemoMode()) return ensureDemoSession();

  const { data } = await supabase.auth.getSession();
  if (data.session) return true;

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const signIn = await supabase.auth.signInWithPassword({
        email: DEV_USER_EMAIL,
        password: DEV_USER_PASSWORD,
      });
      if (!signIn.error && signIn.data.session) return true;

      const signUp = await supabase.auth.signUp({
        email: DEV_USER_EMAIL,
        password: DEV_USER_PASSWORD,
        options: { emailRedirectTo: window.location.origin },
      });
      if (signUp.data.session) return true;

      const retry = await supabase.auth.signInWithPassword({
        email: DEV_USER_EMAIL,
        password: DEV_USER_PASSWORD,
      });
      return !retry.error && !!retry.data.session;
    } catch {
      return false;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

async function ensureDemoSession(): Promise<boolean> {
  persistDemoUser(getStoredDemoUser());

  const { data } = await supabase.auth.getSession();
  if (data.session?.user.email === DEMO_USER_EMAIL) {
    persistDemoUser({
      id: data.session.user.id,
      email: data.session.user.email,
      name: data.session.user.user_metadata?.name ?? "Usuário Demo",
    });
    return true;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      await ensureDemoAuthUser();

      const signIn = await supabase.auth.signInWithPassword({
        email: DEMO_USER_EMAIL,
        password: DEMO_USER_PASSWORD,
      });
      if (!signIn.error && signIn.data.session?.user.email === DEMO_USER_EMAIL) {
        persistDemoUser({
          id: signIn.data.session.user.id,
          email: signIn.data.session.user.email,
          name: signIn.data.session.user.user_metadata?.name ?? "Usuário Demo",
        });
        return true;
      }

      const retry = await supabase.auth.signInWithPassword({
        email: DEMO_USER_EMAIL,
        password: DEMO_USER_PASSWORD,
      });
      if (!retry.error && retry.data.session?.user.email === DEMO_USER_EMAIL) {
        persistDemoUser({
          id: retry.data.session.user.id,
          email: retry.data.session.user.email,
          name: retry.data.session.user.user_metadata?.name ?? "Usuário Demo",
        });
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
