export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_USER_EMAIL = "demo@cnc.local";
export const DEMO_USER_PASSWORD = "DevAutoLogin!2026";
export const DEMO_USER_NAME = "Usuário Demo";

const DEMO_STORAGE_KEY = "cnc-demo-user";

export type DemoUser = {
  id: string;
  email: string;
  name: string;
};

export function isPreviewHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.startsWith("id-preview--") ||
    host.includes("-preview-") ||
    host.includes("preview--") ||
    host.endsWith(".lovableproject.com") ||
    host.endsWith("-dev.lovable.app")
  );
}

export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  return import.meta.env.DEV || isPreviewHost(window.location.hostname);
}

export function getDemoUser(): DemoUser {
  return {
    id: DEMO_USER_ID,
    email: DEMO_USER_EMAIL,
    name: DEMO_USER_NAME,
  };
}

export function getStoredDemoUser(): DemoUser {
  if (typeof window === "undefined") return getDemoUser();
  try {
    const stored = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<DemoUser>;
      if (parsed.id && parsed.email && parsed.name) {
        return { id: parsed.id, email: parsed.email, name: parsed.name };
      }
    }
  } catch {
    // localStorage pode estar indisponível; usa usuário padrão em memória.
  }
  return persistDemoUser(getDemoUser());
}

export function persistDemoUser(user: DemoUser = getDemoUser()): DemoUser {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(user));
    } catch {
      // Ignora falhas de persistência local sem bloquear o modo demo.
    }
  }
  return user;
}