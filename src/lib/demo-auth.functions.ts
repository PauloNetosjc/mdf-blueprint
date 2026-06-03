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
  const users = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (users.error) throw new Error(users.error.message);
  const existingUser = users.data.users.find((user) => user.email === DEMO_USER_EMAIL);

  if (existingUser) {
    if (!existingUser.email_confirmed_at) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
        email: DEMO_USER_EMAIL,
        password: DEMO_USER_PASSWORD,
        email_confirm: true,
        user_metadata: { name: DEMO_USER_NAME, demo: true },
        app_metadata: { demo: true },
      });
      if (error) throw new Error(error.message);
    }
    return { id: existingUser.id, email: DEMO_USER_EMAIL, name: DEMO_USER_NAME };
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
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