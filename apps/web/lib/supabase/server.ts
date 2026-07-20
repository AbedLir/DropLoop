import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabasePublicEnvironment } from "./env";

export async function createSupabaseServerClient() {
  const environment = requireSupabasePublicEnvironment();
  const cookieStore = await cookies();

  return createServerClient(environment.url, environment.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. middleware.ts refreshes sessions for them.
        }
      }
    }
  });
}
