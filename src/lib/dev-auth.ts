import { supabase } from "@/integrations/supabase/client";

export const DEV_USER_EMAIL = "dev@visualizercnc.local";
export const DEV_USER_PASSWORD = "DevAutoLogin!2026";

let inflight: Promise<boolean> | null = null;

/**
 * Garante que exista uma sessão ativa. Se não houver, faz login automático
 * com o usuário fixo de desenvolvimento. Cria o usuário se necessário.
 * Retorna true se ao final há sessão válida.
 */
export async function ensureDevSession(): Promise<boolean> {
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
