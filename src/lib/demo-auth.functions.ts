import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import {
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
  DEMO_USER_NAME,
  DEMO_USER_PASSWORD,
  isPreviewHost,
} from "@/lib/demo-mode";

function assertPreviewRequest() {
  const request = getRequest();
  const host = new URL(request.url).hostname;
  if (!isPreviewHost(host)) {
    throw new Response("Demo auth is only available in preview/dev.", { status: 403 });
  }
}

export const ensureDemoAuthUser = createServerFn({ method: "POST" }).handler(async () => {
  assertPreviewRequest();

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const existing = await supabaseAdmin.auth.admin.getUserById(DEMO_USER_ID);

  if (existing.data.user) {
    if (existing.data.user.email !== DEMO_USER_EMAIL) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(DEMO_USER_ID, {
        email: DEMO_USER_EMAIL,
        password: DEMO_USER_PASSWORD,
        email_confirm: true,
        user_metadata: { name: DEMO_USER_NAME, demo: true },
        app_metadata: { demo: true },
      });
      if (error) throw new Error(error.message);
    }
    return { id: DEMO_USER_ID, email: DEMO_USER_EMAIL, name: DEMO_USER_NAME };
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    id: DEMO_USER_ID,
    email: DEMO_USER_EMAIL,
    password: DEMO_USER_PASSWORD,
    email_confirm: true,
    user_metadata: { name: DEMO_USER_NAME, demo: true },
    app_metadata: { demo: true },
  });

  if (error) throw new Error(error.message);
  return {
    id: data.user?.id ?? DEMO_USER_ID,
    email: data.user?.email ?? DEMO_USER_EMAIL,
    name: DEMO_USER_NAME,
  };
});